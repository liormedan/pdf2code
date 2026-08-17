// What is actually on these pages?
//
// Rasterising a page needs a real canvas, which is browser-only here. But deciding how
// a page *should* be rasterised does not: the operator list says whether a page is
// photographic, line art, or plain text, and that is exactly what should pick the
// image format. JPEG rings around glyph and vector edges; PNG is enormous on photos.

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const ASSETS = {
  standardFontDataUrl: join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + "/",
  cMapUrl: join(ROOT, "node_modules", "pdfjs-dist", "cmaps") + "/",
  cMapPacked: true,
};

/**
 * Classify a page by what paints it. Mirrors classifyPage() in the converter so the
 * two cannot drift — if you change one, change both and re-run this.
 */
function classify({ images, vector, text }) {
  if (images > 0 && vector <= 4 && text < 20) return "photographic";
  if (vector > 20 || (vector > 0 && text > 0)) return "line art / mixed";
  if (images > 0) return "mixed";
  return "plain text";
}

const files = (await readdir(join(ROOT, "fixtures"))).filter((f) => f.endsWith(".pdf")).sort();

console.log("\n  PAGE COMPOSITION — what an exact copy has to reproduce\n");
console.log("  " + "fixture".padEnd(24) + "pg".padEnd(5) + "images".padEnd(8) +
  "vector".padEnd(8) + "text".padEnd(7) + "classification");
console.log("  " + "-".repeat(74));

for (const file of files) {
  const data = new Uint8Array(await readFile(join(ROOT, "fixtures", file)));
  const doc = await pdfjs.getDocument({ data, ...ASSETS }).promise;
  const { OPS } = pdfjs;

  for (let n = 1; n <= Math.min(doc.numPages, 2); n++) {
    const page = await doc.getPage(n);
    const ops = await page.getOperatorList();

    let images = 0, vector = 0, text = 0;
    for (const fn of ops.fnArray) {
      if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject
        || fn === OPS.paintImageMaskXObject || fn === OPS.paintJpegXObject) images++;
      else if (fn === OPS.fill || fn === OPS.stroke || fn === OPS.eoFill
        || fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.shadingFill) vector++;
      else if (fn === OPS.showText) text++;
    }
    page.cleanup();

    console.log(
      "  " + (n === 1 ? file : "").padEnd(24) + String(n).padEnd(5) +
      String(images).padEnd(8) + String(vector).padEnd(8) + String(text).padEnd(7) +
      classify({ images, vector, text }),
    );
  }
  await doc.destroy();
}

console.log(`
  Why this matters

    photographic       JPEG. PNG would be several times larger for no visible gain.
    line art / mixed   PNG. JPEG rings around glyph and vector edges, and on a product
                       promising an exact copy that ringing is the whole failure.
    plain text         No raster needed at all — the text layer already reproduces it.
`);
