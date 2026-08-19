// One project: rename it, archive it, or throw it away.
//
// Every route reads the uid from the session cookie and scopes the document path to it.
// The id in the URL therefore cannot address another account's project — it is a key
// inside a collection the caller already owns, not a global handle.

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
  NextResponse.json({ error: "Projects are not configured on this server." }, { status: 503 });

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if (typeof b.name === "string") {
    const name = b.name.trim().slice(0, 300);
    if (!name) return NextResponse.json({ error: "A project needs a name." }, { status: 400 });
    patch.name = name;
  }
  if (typeof b.archived === "boolean") patch.archived = b.archived;

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  try {
    const user = adminDb().collection("users").doc(uid);

    // The preference is checked again on rename, not only when a conversion is recorded:
    // otherwise typing a name by hand is a way around a setting that says not to keep one.
    if (patch.name !== undefined) {
      const profile = await user.get();
      if (profile.data()?.keepFileNames === false) patch.name = ANONYMOUS_NAME;
    }

    const ref = user.collection("projects").doc(id);
    if (!(await ref.get()).exists) {
      return NextResponse.json({ error: "No such project." }, { status: 404 });
    }

    await ref.update(patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminConfigError) return notConfigured();
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;

  try {
    // Deleting something that is already gone is the state the caller wanted, so this
    // does not 404 — it would only invite a retry that cannot succeed.
    await adminDb().collection("users").doc(uid).collection("projects").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminConfigError) return notConfigured();
    throw err;
  }
}
