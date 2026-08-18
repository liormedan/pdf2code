import { NextResponse } from "next/server";
import {
  GATE_COOKIE,
  GATE_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  constantTimeEqual,
  createGate,
  createSession,
  readAuthConfig,
} from "@/src/lib/auth.ts";

// The comparison happens here, on the server, and never in the browser: a code checked
// in client JavaScript is sitting in the bundle for anyone to read.
export const runtime = "nodejs";

// Crude in-memory throttle. It resets on redeploy and is per-instance, which is fine
// for its actual job — making a brute-force attempt slow enough to be pointless
// against a gate that guards no stored data.
const attempts = new Map<string, { start: number; count: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now - record.start > WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
    return false;
  }

  record.count++;
  return record.count > MAX_ATTEMPTS;
}

/**
 * Development convenience: sign in without the code.
 *
 * Gated on NODE_ENV here, in the handler — not merely by hiding the button. A control
 * that is only hidden is still reachable by anyone who opens the network tab, which
 * would make the gate decorative. Next sets NODE_ENV=production for `next build` and
 * `next start`, so this fails closed on every deployment without anyone remembering
 * to switch it off.
 */
export const DEV_LOGIN_AVAILABLE = process.env.NODE_ENV !== "production";

export async function POST(request: Request) {
  const config = readAuthConfig();
  if (!config.ok) {
    // Say what is misconfigured — this only ever reaches the operator, and a silent
    // failure here is hours of confusion.
    return NextResponse.json(
      { error: `Server is not configured: ${config.problems.join("; ")}.` },
      { status: 500 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a minute and try again." },
      { status: 429 },
    );
  }

  let body: { code?: unknown; dev?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const wantsDevLogin = body?.dev === true;

  if (wantsDevLogin && !DEV_LOGIN_AVAILABLE) {
    // Deliberately the same response an unknown code gets: a distinct error would
    // confirm to a prober that a developer path exists at all.
    return NextResponse.json({ error: "That access code is not correct." }, { status: 401 });
  }

  if (!wantsDevLogin && !constantTimeEqual(body?.code ?? "", config.code)) {
    return NextResponse.json({ error: "That access code is not correct." }, { status: 401 });
  }

  const secure = process.env.NODE_ENV === "production";
  const response = NextResponse.json({ ok: true, dev: wantsDevLogin });

  // The code proves nothing about who you are — it only opens the door to the sign-in
  // screen. The account is what the session cookie is minted from, in /api/session.
  response.cookies.set(GATE_COOKIE, await createGate(config.secret!), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: GATE_TTL_SECONDS,
  });

  if (wantsDevLogin) {
    // Local development runs without a Firebase project, so this path mints the
    // identity too. It is unreachable in any production build — see above.
    response.cookies.set(
      SESSION_COOKIE,
      await createSession(config.secret!, { uid: "dev", email: null }),
      { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_TTL_SECONDS },
    );
  }

  return response;
}

/** Forget both the gate and the account — a full reset of this browser. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(GATE_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
