// Locale registry.
//
// Carried over from src/i18n/config.ts in the web app, with two changes: the `Direction`
// type is declared here rather than imported from the converter (which is Python now),
// and the header-negotiation helper is gone — a desktop app has no Accept-Language
// header. What it has instead is `navigator.language`, handled in provider.tsx.
//
// Adding a language still costs one line here plus one JSON file in src/messages/.
// Direction is derived from the language subtag and never hand-set, so a right-to-left
// language works without touching a single layout.

export type Direction = "ltr" | "rtl";

export interface LocaleEntry {
  code: string;
  name: string;
}

/** Scripts written right to left. Derived from the language subtag, never hand-set. */
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

/** Where the choice survives a restart. Not a cookie any more — there is no server. */
export const LOCALE_KEY = "locale";

/** "he-IL" and "he" are the same language for direction purposes. */
export function directionOf(locale: string | null | undefined): Direction {
  const language = String(locale ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
}

export function isSupported(locale: string | null | undefined): boolean {
  return LOCALES.some((l) => l.code === locale);
}

/**
 * Pick the best locale we actually ship for a browser/OS language tag.
 * Falls back rather than throwing: an unknown language should read English.
 */
export function nearest(tag: string | null | undefined): string {
  const wanted = String(tag ?? "").toLowerCase();
  if (!wanted) return DEFAULT_LOCALE;

  const exact = LOCALES.find((l) => l.code.toLowerCase() === wanted);
  if (exact) return exact.code;

  // "he-IL" should match the "he" we ship.
  const base = wanted.split(/[-_]/)[0] ?? wanted;
  return LOCALES.find((l) => l.code.toLowerCase() === base)?.code ?? DEFAULT_LOCALE;
}
