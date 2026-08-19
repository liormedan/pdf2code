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

  // Back where they were, which is the only page that offers this.
  return Response.redirect(new URL("/", request.url), 303);
}
