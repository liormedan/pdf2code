/**
 * Dump the TypeScript engine's page model for a few fixtures.
 *
 *     npx tsx desktop/engine/parity/dump_pages.mts
 *
 * `fonts.ts` and `language.ts` could be compared by feeding both sides the same strings.
 * `extract.ts` cannot: its input is a live pdf.js page, and its output depends on how
 * pdf.js chose to group glyphs into text items. So the comparison runs the other way —
 * the TypeScript produces a model here, and the Python engine is measured against it.
 *
 * What is *not* expected to match, and why the Python checks compare these loosely:
 *
 *   * **Run boundaries.** pdf.js hands back text items whose grouping is its own
 *     decision; pdfminer hands back individual characters, which the Python extractor
 *     groups itself. Two implementations will split a line differently and both be
 *     right. What must agree is the text once a line is reassembled, and where that
 *     line sits.
 *   * **stats.** pdf.js counts painting operators. pdfminer reports laid-out objects.
 *     The counts cannot match; the decision they feed — does this page need a raster —
 *     must.
 *
 * Page geometry, font identity, language, direction and the scanned flag are exact, and
 * are checked as such.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { extractPage, inspect } from "../../../src/converter/extract.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const STANDARD_FONTS = join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + "/";
const CMAPS = join(ROOT, "node_modules", "pdfjs-dist", "cmaps") + "/";

/** One page each, chosen for what they stress rather than for coverage. */
const FIXTURES = [
  "08-hebrew-doc.pdf", // right-to-left, embedded subsets
  "07-academic-tables.pdf", // dense positioning, many small runs
  "09-hostile-text.pdf", // text that must never become markup
  "04-scanned-ccitt.pdf", // no text layer at all
];

const out: Record<string, unknown> = {};

for (const file of FIXTURES) {
  const data = new Uint8Array(await readFile(join(ROOT, "fixtures", file)));
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
  }).promise;

  const info = await inspect(doc);
  const page = await doc.getPage(1);
  const model = await extractPage(page, pdfjs);
  page.cleanup();
  await doc.destroy();

  out[file] = {
    info,
    page: {
      number: model.number,
      width: model.width,
      height: model.height,
      stats: model.stats,
      fonts: model.fonts,
      runs: model.runs,
    },
  };

  console.log(
    `${file}: ${model.runs.length} runs, ${Object.keys(model.fonts).length} fonts, ` +
      `${model.width}x${model.height}, lang=${info.lang} dir=${info.dir} scanned=${info.scanned}`,
  );
}

await writeFile(join(HERE, "pages.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`\nwrote pages.json`);
