import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "@/src/lib/auth.ts";

/**
 * Paths anyone may reach.
 *
 * A list rather than a hole in the matcher's regex. The matcher excludes by negative
 * lookahead, and the webpage lives at "/" — where the captured group is empty, so no
 * amount of exclusion there spares it. Worse, that is the kind of expression that looks
 * right and fails silently. The gate is easier to trust when it is written as words.
 */
const PUBLIC_PATHS = new Set(["/", "/login"]);

export async function middleware(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // readSession, not a bare signature check: a token that carries no uid is not an
  // identity, and the dashboard is entirely user-scoped from here on.
  if (await readSession(token, secret)) return NextResponse.next();

  // An API caller needs to be refused, not redirected. fetch follows redirects on its
  // own, so sending it to the sign-in page hands it 200 and a page of HTML — response.ok
  // is true, and the caller parses a login screen as if it were the answer it asked for.
  // A session expiring mid-conversion surfaced as "corrupt PDF" because of this.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  // Carry where they were headed, so signing in lands them there rather than at the
  // top of the app. Only a same-site path — never an absolute URL an attacker supplied.
  const intended = request.nextUrl.pathname + request.nextUrl.search;
  if (intended.startsWith("/") && !intended.startsWith("//") && intended !== "/") {
    login.searchParams.set("next", intended);
  }
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login screen, the two endpoints that grant a session —
  // neither of which can require a session to reach — Next's own assets, and the pdf.js
  // runtime files the converter fetches.
  matcher: [
    "/((?!login|api/session|api/dev-session|_next/static|_next/image|favicon.ico|pdf.worker.mjs|standard_fonts|cmaps).*)",
  ],
};
