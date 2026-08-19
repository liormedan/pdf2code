// Sign in without an account, in development only.
//
// This exists so the app can be run on a machine with no Firebase project configured —
// there is no other way in, now that the account screen is the only door.
//
// Gated on NODE_ENV here, in the handler, not merely by hiding the button. A control
// that is only hidden is still reachable by anyone who opens the network tab. Next sets
// NODE_ENV=production for `next build` and `next start`, so this fails closed on every
// deployment without anyone remembering to switch it off.

import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSession,
  readAuthConfig,
} from "@/src/lib/auth.ts";

export const runtime = "nodejs";

export const DEV_LOGIN_AVAILABLE = process.env.NODE_ENV !== "production";

export async function POST() {
  // 404 rather than 403: in a production build this route should look like it was never
  // deployed, because as far as anyone outside development is concerned it was not.
  if (!DEV_LOGIN_AVAILABLE) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const config = readAuthConfig();
  if (!config.ok) {
    // Say what is misconfigured — this only ever reaches the operator, and a silent
    // failure here is hours of confusion.
    return NextResponse.json(
      { error: `Server is not configured: ${config.problems.join("; ")}.` },
      { status: 500 },
    );
  }

  const response = NextResponse.json({ ok: true, dev: true });
  response.cookies.set(
    SESSION_COOKIE,
    await createSession(config.secret!, { uid: "dev", email: null }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    },
  );
  return response;
}

/** Forget the account — a full reset of this browser. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
