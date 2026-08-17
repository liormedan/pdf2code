// Script detection, for <html lang> and dir.
//
// Not full language identification — distinguishing Spanish from Portuguese needs
// statistics and is not worth the weight. But declaring a Hebrew document as English
// is a real accessibility failure: screen readers pick the wrong voice, hyphenation
// and font fallback go wrong, and the direction of the whole page is wrong.

const SCRIPTS = [
  { lang: "he", dir: "rtl", re: /[֐-׿יִ-ﭏ]/g },
  { lang: "ar", dir: "rtl", re: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g },
  { lang: "el", dir: "ltr", re: /[Ͱ-Ͽ]/g },
  { lang: "ru", dir: "ltr", re: /[Ѐ-ӿ]/g },
  { lang: "ja", dir: "ltr", re: /[぀-ヿ]/g },
  { lang: "ko", dir: "ltr", re: /[가-힯]/g },
  { lang: "zh", dir: "ltr", re: /[一-鿿]/g },
];

// Below this, a few stray glyphs in an otherwise English document would relabel it.
const MIN_EVIDENCE = 12;

/** @returns {{ lang: string, dir: "ltr"|"rtl" }} */
export function detectLanguage(text) {
  const sample = String(text ?? "");
  let best = null;
  let bestCount = 0;

  for (const script of SCRIPTS) {
    const count = (sample.match(script.re) ?? []).length;
    if (count > bestCount) {
      bestCount = count;
      best = script;
    }
  }

  return bestCount >= MIN_EVIDENCE
    ? { lang: best.lang, dir: best.dir }
    : { lang: "en", dir: "ltr" };
}
