/**
 * Run the TypeScript engine over the shared cases and write down what it says.
 *
 *     npx tsx desktop/engine/parity/dump.mts
 *
 * This is the half of the parity harness that nobody should have to think about twice.
 * The Python engine is a translation of code that already works and is covered by 67
 * checks, so "does the translation agree with the original" is a question with an exact
 * answer — as long as somebody actually asks it. This asks it.
 *
 * Only the pure modules are dumped here. `fonts.ts` and `language.ts` have no DOM and
 * no pdf.js dependency, which is why they can run in Node at all; `extract.ts` needs a
 * live pdf.js page and is compared differently, on the model it produces.
 *
 * The output is committed. That is deliberate: it means the Python checks run without a
 * Node toolchain present, and it means a change to the TypeScript shows up as a diff in
 * this file rather than as a silent shift in what "correct" means.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describeFont } from "../../../src/converter/fonts.ts";
import { detectLanguage } from "../../../src/converter/language.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Cases {
  fonts: [string | null, string | null][];
  languages: string[];
}

const cases: Cases = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));

const expected = {
  fonts: cases.fonts.map(([raw, hint]) => {
    const d = describeFont(raw ?? "", hint ?? undefined);
    // Only the fields describeFont itself sets. `vertical`, `ascent` and `descent` came
    // from pdf.js's style table, which has no counterpart on the Python side.
    return {
      input: [raw, hint],
      family: d.family,
      weight: d.weight,
      style: d.style,
      generic: d.generic,
      name: d.name,
    };
  }),

  languages: cases.languages.map((sample) => {
    const { lang, dir } = detectLanguage(sample);
    return { input: sample, lang, dir };
  }),
};

writeFileSync(join(HERE, "expected.json"), JSON.stringify(expected, null, 2) + "\n", "utf8");

console.log(
  `wrote expected.json — ${expected.fonts.length} fonts, ${expected.languages.length} languages`,
);
