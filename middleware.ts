import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/src/lib/auth.ts";

export async function middleware(request: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (await verifySession(token, secret)) return NextResponse.next();

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
  // Everything except the login screen, the endpoint that grants access, Next's own
  // assets, and the pdf.js runtime files the converter fetches.
  matcher: [
    "/((?!login|api/access|_next/static|_next/image|favicon.ico|pdf.worker.mjs|standard_fonts|cmaps).*)",
  ],
};
