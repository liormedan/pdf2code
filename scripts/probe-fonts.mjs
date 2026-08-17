// Can we recover the actual embedded font files from a PDF?
//
// This decides the whole engine question. getTextContent() only reports pdf.js's CSS
// *guess* at a family, which is usually generic. The real embedded face lands in
// page.commonObjs once the operator list has been built — and if we can reach its bytes,
// a reconstructed HTML page can carry the original typography via @font-face.

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const STANDARD_FONTS = join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + "/";
const CMAPS = join(ROOT, "node_modules", "pdfjs-dist", "cmaps") + "/";

const files = (await readdir(join(ROOT, "fixtures"))).filter((f) => f.endsWith(".pdf")).sort();

console.log("\n  FONT RECOVERY PROBE\n");

for (const file of files) {
  const data = new Uint8Array(await readFile(join(ROOT, "fixtures", file)));
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
    useSystemFonts: false,
  }).promise;

  const page = await doc.getPage(1);
  // Building the operator list is what forces fonts to load into commonObjs.
  await page.getOperatorList();
  const { styles } = await page.getTextContent();

  const found = [];
  for (const fontName of Object.keys(styles ?? {})) {
    let obj = null;
    try { obj = page.commonObjs.get(fontName); } catch { /* not loaded */ }
    found.push({
      fontName,
      cssGuess: styles[fontName]?.fontFamily ?? "-",
      realName: obj?.name ?? null,
      loadedName: obj?.loadedName ?? null,
      hasBytes: !!(obj?.data?.length),
      bytes: obj?.data?.length ?? 0,
      mimetype: obj?.mimetype ?? null,
    });
  }

  console.log(`  ${file}`);
  if (!found.length) console.log("      (no fonts on page 1)");
  for (const f of found) {
    const status = f.hasBytes
      ? `EMBEDDED ${(f.bytes / 1024).toFixed(1)} KB  ${f.mimetype ?? ""}`
      : f.realName ? "no bytes (standard/system font)" : "unresolved";
    console.log(`      ${f.fontName.padEnd(10)} css="${f.cssGuess}"  real="${f.realName ?? "-"}"  ${status}`);
  }
  console.log("");

  await doc.destroy();
}
