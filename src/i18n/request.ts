import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isSupported, negotiate } from "./config.ts";

// Locale lives in a cookie rather than the URL. The dashboard sits behind an access
// gate, so there is no SEO reason to carry /he/ or /en/ in every path — and keeping
// paths locale-free means links shared between people just work.
export default getRequestConfig(async () => {
  const store = await cookies();
  const chosen = store.get(LOCALE_COOKIE)?.value;

  // An explicit choice wins; otherwise fall back to what the browser asks for.
  // Annotated rather than inferred: isSupported() narrows nothing on its own, and
  // next-intl requires a definite string here.
  const locale: string = chosen && isSupported(chosen)
    ? chosen
    : negotiate((await headers()).get("accept-language")) || DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
