// Choosing a language without shipping JavaScript to do it.
//
// The app has a dropdown for this; the webpage cannot use it, because that dropdown is a
// client component and this page is meant to arrive with no client bundle at all. So the
// switch is a form post answered with a redirect — which also means it works with
// scripting off, and is reachable before anyone has an account.

import { cookies } from "next/headers";
import { LOCALE_COOKIE, isSupported } from "@/src/i18n/config.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const locale = form?.get("locale");

  if (typeof locale === "string" && isSupported(locale)) {
    const store = await cookies();
    store.set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }

  // Back where they were. The switch appears on more than one page now, and sending
  // everyone to the root meant changing language also navigated you away from what you
  // were reading. Only the path of a same-origin referer is used — a referer is
  // attacker-controllable, so it picks where on this site to land, never which site.
  let path = "/";
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.origin === new URL(request.url).origin) path = url.pathname;
    } catch {
      // Unparseable referer: the root is a safe destination.
    }
  }
  return Response.redirect(new URL(path, request.url), 303);
}
