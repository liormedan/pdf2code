// Script detection, for <html lang> and dir.
//
// Not full language identification — distinguishing Spanish from Portuguese needs
// statistics and is not worth the weight. But declaring a Hebrew document as English
// is a real accessibility failure: screen readers pick the wrong voice, hyphenation
// and font fallback go wrong, and the direction of the whole page is wrong.
//
// Every range below is written as \u escapes rather than literal characters. A literal
// presentation-form glyph such as U+FB1D is canonically decomposable, and one Unicode
// normalisation pass over this file is enough to split it into two code points — which
// silently turns "יִ-ﭏ" into a range starting at U+05B4 that matches most of
// the Basic Multilingual Plane, Latin and CJK included.

import type { Direction } from "./types.ts";

interface Script {
  lang: string;
  dir: Direction;
  re: RegExp;
}

// A warning for anyone editing the ranges below. They contain presentation-form
// characters such as U+FB1D, which are canonically decomposable. A single Unicode
// normalisation pass — any tool that rewrites this file through NFD — splits that
// into two code points and turns the range into one starting at U+05B4, which then
// matches most of the Basic Multilingual Plane, Latin and CJK included. That bug is
// silent: everything still compiles and every document is reported as right-to-left.
// If you touch these, re-run `npm run validate` and confirm only the Hebrew fixture
// reports RTL.
const SCRIPTS: Script[] = [
  { lang: "he", dir: "rtl", re: /[֐-׿יִ-ﭏ]/g },
  { lang: "ar", dir: "rtl", re: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g },
  { lang: "el", dir: "ltr", re: /[Ͱ-Ͽἀ-῿]/g },
  { lang: "ru", dir: "ltr", re: /[Ѐ-ӿ]/g },
  { lang: "ja", dir: "ltr", re: /[぀-ヿ]/g },
  { lang: "ko", dir: "ltr", re: /[가-힯]/g },
  { lang: "zh", dir: "ltr", re: /[一-鿿]/g },
];

// Below this, a few stray glyphs in an otherwise English document would relabel it.
const MIN_EVIDENCE = 12;

export function detectLanguage(text: string | null | undefined): { lang: string; dir: Direction } {
  const sample = String(text ?? "");
  let best: Script | null = null;
  let bestCount = 0;

  for (const script of SCRIPTS) {
    const count = (sample.match(script.re) ?? []).length;
    if (count > bestCount) {
      bestCount = count;
      best = script;
    }
  }

  return best && bestCount >= MIN_EVIDENCE
    ? { lang: best.lang, dir: best.dir }
    : { lang: "en", dir: "ltr" };
}
