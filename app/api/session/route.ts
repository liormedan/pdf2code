// Turning a Firebase sign-in into this app's session.
//
// The browser signs in with Firebase and gets an ID token. That token is verified here,
// once, and exchanged for the signed cookie every other request is checked against —
// see src/lib/auth.ts for why the two are separate.
//
// This route is excluded from the middleware matcher, because requiring a session to
// obtain a session cannot work. It is still behind the beta gate at the interface
// level, and it grants nothing without a token Firebase itself signed.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSession, readAuthConfig } from "@/src/lib/auth.ts";
import { adminAuth, adminDb, AdminConfigError } from "@/src/lib/firebase/admin.ts";
import { LOCALE_COOKIE, isSupported } from "@/src/i18n/config.ts";

export const runtime = "nodejs";

/**
 * Create the user's record the first time they appear.
 *
 * Only the fields the app decides — `usage` is written here and nowhere else, and
 * never by the client, because it is what quotas will be counted from.
 */
async function ensureUserDocument(uid: string, email: string | null, name: string | null, locale: string) {
  const ref = adminDb().collection("users").doc(uid);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    await ref.set({
      email,
      displayName: name,
      locale,
      // Names can be as revealing as the documents themselves; this is the switch that
      // turns that off. On by default, because a project list without names is hard to use.
      keepFileNames: true,
      createdAt: new Date(),
      usage: { month: new Date().toISOString().slice(0, 7), conversions: 0, pages: 0 },
    });
    return;
  }

  // An existing user may have changed either at the provider since last sign-in.
  await ref.set({ email, displayName: name }, { merge: true });
}

export async function POST(request: Request) {
  const config = readAuthConfig();
  if (!config.ok) {
    return NextResponse.json(
      { error: `Server is not configured: ${config.problems.join("; ")}.` },
      { status: 500 },
    );
  }

  let body: { idToken?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  if (!idToken) return NextResponse.json({ error: "No sign-in token was sent." }, { status: 400 });

  let uid: string;
  let email: string | null;
  let name: string | null;
  try {
    // checkRevoked: a token from an account that has since been disabled or had its
    // sessions revoked must not buy a fresh twelve hours here.
    const decoded = await adminAuth().verifyIdToken(idToken, true);
    uid = decoded.uid;
    email = decoded.email ?? null;
    name = decoded.name ?? null;
  } catch (err) {
    if (err instanceof AdminConfigError) {
      return NextResponse.json({ error: "Accounts are not configured on this server." }, { status: 503 });
    }
    // Anything else is a token we could not vouch for, whatever the reason.
    return NextResponse.json({ error: "That sign-in could not be verified." }, { status: 401 });
  }

  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale = cookieLocale && isSupported(cookieLocale) ? cookieLocale : "en";

  try {
    await ensureUserDocument(uid, email, name, locale);
  } catch {
    // The account is real and verified; failing to write the profile should not block
    // the sign-in. The record is created again on the next one.
  }

  const response = NextResponse.json({ ok: true, uid });
  response.cookies.set(SESSION_COOKIE, await createSession(config.secret!, { uid, email }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
