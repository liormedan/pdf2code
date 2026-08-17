// Locale registry.
//
// Adding a language is meant to cost one line here plus one JSON file in messages/.
// Nothing else in the app hardcodes a locale, and direction is derived rather than
// configured per screen — so a right-to-left language works without touching layout.

/** Scripts written right to left. Derived from the language subtag, never hand-set. */
import type { Direction } from "@/src/converter/types.ts";

export interface LocaleEntry {
  code: string;
  name: string;
}

const RTL_LANGUAGES = new Set<string>([
  "ar", "arc", "ckb", "dv", "fa", "he", "ks", "ku", "ps", "sd", "ur", "yi",
]);

/**
 * Shipped languages. `name` is written in the language itself — a person scanning a
 * language menu is looking for their own word for their own language, not ours.
 */
export const LOCALES: LocaleEntry[] = [
  { code: "en", name: "English" },
  { code: "he", name: "עברית" },
];

export const DEFAULT_LOCALE = "en";

export const LOCALE_COOKIE = "locale";

/** "he-IL" and "he" are the same language for direction purposes. */
export function directionOf(locale: string | null | undefined): Direction {
  const language = String(locale ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
}

export function isSupported(locale: string | null | undefined): boolean {
  return LOCALES.some((l) => l.code === locale);
}

/**
 * Pick the best locale we actually ship for an Accept-Language header.
 * Falls back rather than throwing: an unknown language should read English, not 500.
 */
export function negotiate(acceptLanguage: string | null | undefined): string {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: (tag ?? "").trim().toLowerCase(), q: q ? Number(q.split("=")[1]) : 1 };
    })
    .filter((entry) => entry.tag)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const exact = LOCALES.find((l) => l.code.toLowerCase() === tag);
    if (exact) return exact.code;
    // "he-IL" should match the "he" we ship.
    const base = tag.split("-")[0] ?? tag;
    const partial = LOCALES.find((l) => l.code.toLowerCase() === base);
    if (partial) return partial.code;
  }

  return DEFAULT_LOCALE;
}
