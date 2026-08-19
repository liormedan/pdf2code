// Account preferences that the server is the one to enforce.
//
// Only one so far, and it is the one that decides what gets stored rather than what gets
// shown — which is why it cannot live in the browser's own settings.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, readAuthConfig, readSession } from "@/src/lib/auth.ts";
import { adminDb, AdminConfigError } from "@/src/lib/firebase/admin.ts";
import { ANONYMOUS_NAME } from "@/src/lib/projects.ts";

export const runtime = "nodejs";

async function currentUid(): Promise<string | null> {
  const config = readAuthConfig();
  const store = await cookies();
  const claims = await readSession(store.get(SESSION_COOKIE)?.value, config.secret);
  return claims?.uid ?? null;
}

const notConfigured = () =>
  NextResponse.json({ error: "Preferences are not configured on this server." }, { status: 503 });

export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const profile = await adminDb().collection("users").doc(uid).get();
    return NextResponse.json({ keepFileNames: profile.data()?.keepFileNames !== false });
  } catch (err) {
    if (err instanceof AdminConfigError) return notConfigured();
    throw err;
  }
}

export async function PATCH(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const keepFileNames = (body as Record<string, unknown> | null)?.keepFileNames;
  if (typeof keepFileNames !== "boolean") {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  try {
    const user = adminDb().collection("users").doc(uid);
    await user.set({ keepFileNames }, { merge: true });

    // Turning it off has to reach backwards. A setting that means "stop keeping names"
    // while every name already kept stays on file is only half true, and the half that
    // is false is the half someone turned it on for.
    const scrubbed = keepFileNames ? 0 : await forgetNames(user);

    return NextResponse.json({ keepFileNames, scrubbed });
  } catch (err) {
    if (err instanceof AdminConfigError) return notConfigured();
    throw err;
  }
}

/** Replace every stored project name with the placeholder. Batched, for the same reason as delete-all. */
async function forgetNames(user: FirebaseFirestore.DocumentReference): Promise<number> {
  const projects = user.collection("projects");
  let scrubbed = 0;

  for (;;) {
    const snapshot = await projects.where("name", "!=", ANONYMOUS_NAME).limit(400).get();
    if (snapshot.empty) break;

    const batch = projects.firestore.batch();
    snapshot.docs.forEach((doc) => batch.update(doc.ref, { name: ANONYMOUS_NAME }));
    await batch.commit();

    scrubbed += snapshot.size;
    if (snapshot.size < 400) break;
  }

  return scrubbed;
}
