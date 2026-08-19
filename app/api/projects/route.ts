// The project list, and the only way a project is ever written.
//
// Firestore is closed to browsers entirely (see firestore.rules), so both directions go
// through here on the Admin SDK. That costs a round trip and gives up live updates, and
// it buys two things worth more: the client bundle never carries the Firestore SDK, and
// `keepFileNames` is applied where the record is *written* rather than where it is
// displayed — a preference a client could bypass from its own console is not one.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { SESSION_COOKIE, readAuthConfig, readSession } from "@/src/lib/auth.ts";
import { adminDb, AdminConfigError } from "@/src/lib/firebase/admin.ts";
import { ANONYMOUS_NAME, readDraft, usageMonth, type Project } from "@/src/lib/projects.ts";

export const runtime = "nodejs";

/** How many projects a screen asks for at once. Paging arrives with the projects screen. */
const PAGE_SIZE = 50;

/** The signed-in uid, or null. Middleware already refused anyone without a session. */
async function currentUid(): Promise<string | null> {
  const config = readAuthConfig();
  const store = await cookies();
  const claims = await readSession(store.get(SESSION_COOKIE)?.value, config.secret);
  return claims?.uid ?? null;
}

const notConfigured = () =>
  NextResponse.json({ error: "Projects are not configured on this server." }, { status: 503 });

export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    // Sorted, not filtered. An equality filter beside a sort on another field needs a
    // composite index, and nothing is archived yet — archiving arrives with the projects
    // screen, and the index in firestore.indexes.json arrives with it. Until then the
    // filter below costs nothing and the query needs no index at all.
    const snapshot = await adminDb()
      .collection("users").doc(uid).collection("projects")
      .orderBy("lastConvertedAt", "desc")
      .limit(PAGE_SIZE)
      .get();

    const projects: Project[] = snapshot.docs.filter((doc) => doc.data().archived !== true).map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        name: d.name,
        kind: d.kind,
        driveFileId: d.driveFileId ?? undefined,
        sourceSize: d.sourceSize ?? undefined,
        pages: d.pages ?? 0,
        formats: d.formats ?? [],
        background: d.background === true,
        outputBytes: d.outputBytes ?? 0,
        // Timestamps become epoch milliseconds at the boundary, so neither the wire nor
        // the browser has to know what a Firestore Timestamp is.
        createdAt: d.createdAt?.toMillis?.() ?? 0,
        lastConvertedAt: d.lastConvertedAt?.toMillis?.() ?? 0,
        runCount: d.runCount ?? 1,
        archived: d.archived === true,
      };
    });

    return NextResponse.json({ projects });
  } catch (err) {
    if (err instanceof AdminConfigError) return notConfigured();
    throw err;
  }
}

export async function POST(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const draft = readDraft(body);
  if (!draft) return NextResponse.json({ error: "That is not a conversion we can record." }, { status: 400 });

  try {
    const db = adminDb();
    const user = db.collection("users").doc(uid);
    const projects = user.collection("projects");

    // Read the preference from the account, never from the request: the browser has no
    // say in whether the name it just sent is the name that gets stored.
    const profile = await user.get();
    const keepFileNames = profile.data()?.keepFileNames !== false;
    const name = keepFileNames ? draft.name : ANONYMOUS_NAME;

    const now = new Date();

    // Only a Slides deck has an identity that survives the conversion, so only a Slides
    // deck can be recognised as the same document a second time.
    const existing = draft.driveFileId
      ? await projects.where("driveFileId", "==", draft.driveFileId).limit(1).get()
      : null;
    const previous = existing?.docs[0];

    let id: string;
    if (previous) {
      await previous.ref.update({
        name,
        pages: draft.pages,
        formats: draft.formats,
        background: draft.background,
        outputBytes: draft.outputBytes,
        lastConvertedAt: now,
        runCount: FieldValue.increment(1),
        archived: false,
      });
      id = previous.id;
    } else {
      const created = await projects.add({
        ...draft,
        name,
        driveFileId: draft.driveFileId ?? null,
        sourceSize: draft.sourceSize ?? null,
        createdAt: now,
        lastConvertedAt: now,
        runCount: 1,
        archived: false,
      });
      id = created.id;
    }

    await recordUsage(user, draft.pages, now);

    return NextResponse.json({ id, created: !previous }, { status: previous ? 200 : 201 });
  } catch (err) {
    if (err instanceof AdminConfigError) return notConfigured();
    throw err;
  }
}

/**
 * Delete every project on the account.
 *
 * Actually deleted, not flagged. "Clear" used to empty a tab and cost nothing; now it
 * throws away the record permanently, which is why the screen asks first — and why there
 * is no tombstone left behind to make the promise a half-truth.
 *
 * `usage` is untouched on purpose: it is what a quota is counted from, and letting a
 * delete reset it would make the quota advisory.
 */
export async function DELETE() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const projects = adminDb().collection("users").doc(uid).collection("projects");

    // In batches, because a single batch caps at 500 writes and an account with more
    // projects than that would otherwise fail at exactly the moment it matters most.
    for (;;) {
      const snapshot = await projects.limit(400).get();
      if (snapshot.empty) break;

      const batch = projects.firestore.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      if (snapshot.size < 400) break;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminConfigError) return notConfigured();
    throw err;
  }
}

/**
 * Count the conversion against the account's month.
 *
 * Written here and nowhere else, and never by the browser, because this is what quotas
 * will be enforced from. A transaction rather than two increments: the read of which
 * month it is and the decision to reset have to happen together, or two conversions
 * landing at midnight on the first can each reset the other's count.
 */
async function recordUsage(
  user: FirebaseFirestore.DocumentReference,
  pages: number,
  now: Date,
): Promise<void> {
  const month = usageMonth(now);

  await user.firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(user);
    const usage = snapshot.data()?.usage;

    if (usage?.month === month) {
      tx.update(user, {
        "usage.conversions": FieldValue.increment(1),
        "usage.pages": FieldValue.increment(pages),
      });
    } else {
      tx.set(user, { usage: { month, conversions: 1, pages } }, { merge: true });
    }
  });
}
