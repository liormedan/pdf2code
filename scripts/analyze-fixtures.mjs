// Sprint 0 — objective engine analysis.
//
// Visual judgement needs eyes, but the decision between "rasterise the page" and
// "reconstruct real HTML" turns on things that are countable: how much of the page is
// text vs vector art, whether embedded fonts actually resolve, and how much a text-only
// reconstruction would silently drop. This measures those.

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

// Ops that paint something a text-only reconstruction cannot reproduce.
const VECTOR_OPS = new Set(["fill", "stroke", "eoFill", "eoFillStroke", "fillStroke",
  "closeFillStroke", "closeEOFillStroke", "closeStroke", "shadingFill"]);
const IMAGE_OPS = new Set(["paintImageXObject", "paintInlineImageXObject",
  "paintImageMaskXObject", "paintJpegXObject"]);

const OP_NAME = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]));

const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 100));

async function analyzePage(page) {
  const [{ items, styles }, ops] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ]);

  let vector = 0, image = 0, text = 0, other = 0;
  for (const fn of ops.fnArray) {
    const name = OP_NAME[fn];
    if (VECTOR_OPS.has(name)) vector++;
    else if (IMAGE_OPS.has(name)) image++;
    else if (name === "showText" || name === "showSpacedText") text++;
    else other++;
  }

  // Does pdf.js resolve each font to a real embedded face, or fall back to a generic?
  const fonts = Object.entries(styles ?? {}).map(([name, s]) => ({
    name,
    family: s.fontFamily ?? "",
    generic: /^(serif|sans-serif|monospace|cursive|fantasy)$/i.test(s.fontFamily ?? ""),
  }));

  const chars = items.reduce((n, i) => n + (i.str?.length ?? 0), 0);
  const rotated = items.filter((i) => i.transform[1] !== 0 || i.transform[2] !== 0).length;
  const rtl = items.filter((i) => /[֐-ࣿ]/.test(i.str ?? "")).length;

  return { chars, runs: items.length, rotated, rtl, vector, image, text, other, fonts };
}

async function analyzeDoc(file) {
  const data = new Uint8Array(await readFile(join(ROOT, "fixtures", file)));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;

  const sample = Math.min(doc.numPages, 5);
  const pages = [];
  for (let i = 1; i <= sample; i++) pages.push(await analyzePage(await doc.getPage(i)));

  const sum = (k) => pages.reduce((n, p) => n + p[k], 0);
  const allFonts = new Map();
  for (const p of pages) for (const f of p.fonts) allFonts.set(f.family + f.name, f);
  const fonts = [...allFonts.values()];

  const meta = await doc.getMetadata().catch(() => null);
  await doc.destroy();

  return {
    file,
    pages: doc.numPages,
    sampled: sample,
    chars: sum("chars"),
    runs: sum("runs"),
    rtl: sum("rtl"),
    rotated: sum("rotated"),
    vectorOps: sum("vector"),
    imageOps: sum("image"),
    fontsTotal: fonts.length,
    fontsGeneric: fonts.filter((f) => f.generic).length,
    producer: meta?.info?.Producer ?? "",
  };
}

const files = (await readdir(join(ROOT, "fixtures"))).filter((f) => f.endsWith(".pdf")).sort();
if (!files.length) {
  console.error("No fixtures. Run: npm run fixtures");
  process.exit(1);
}

const rows = [];
for (const f of files) {
  try {
    rows.push(await analyzeDoc(f));
  } catch (err) {
    console.error(`  ${f}: FAILED — ${err.message}`);
  }
}

console.log("\n  SPRINT 0 — ENGINE ANALYSIS\n");
console.log("  " + "fixture".padEnd(24) + "pages  chars   runs   RTL  vector  image  fonts(generic)");
console.log("  " + "-".repeat(88));
for (const r of rows) {
  console.log(
    "  " + r.file.padEnd(24) +
    String(r.pages).padStart(4) +
    String(r.chars).padStart(8) +
    String(r.runs).padStart(7) +
    String(r.rtl).padStart(6) +
    String(r.vectorOps).padStart(8) +
    String(r.imageOps).padStart(7) +
    `   ${r.fontsTotal} (${r.fontsGeneric})`,
  );
}

console.log("\n  VERDICT PER FIXTURE  (sampled pages only)\n");
for (const r of rows) {
  const scanned = r.chars < 30;
  // A text-only reconstruction reproduces text runs but no vector art or images.
  const paintTotal = r.vectorOps + r.imageOps;
  const lossy = paintTotal > r.runs;
  const fontLoss = pct(r.fontsGeneric, r.fontsTotal);

  const notes = [];
  if (scanned) notes.push("SCANNED — no text layer, needs OCR");
  if (lossy) notes.push(`graphics-dominant (${paintTotal} paint ops vs ${r.runs} text runs) — text-only output loses the page`);
  if (fontLoss > 0) notes.push(`${fontLoss}% of fonts fall back to a generic family — typography lost`);
  if (r.rtl) notes.push(`${r.rtl} RTL runs`);
  if (r.rotated) notes.push(`${r.rotated} rotated runs`);
  if (!notes.length) notes.push("clean text document — text-only reconstruction is viable");

  console.log(`  ${r.file}`);
  for (const n of notes) console.log(`      - ${n}`);
  console.log("");
}

const totalFonts = rows.reduce((n, r) => n + r.fontsTotal, 0);
const genericFonts = rows.reduce((n, r) => n + r.fontsGeneric, 0);
const graphicsHeavy = rows.filter((r) => r.vectorOps + r.imageOps > r.runs).length;

console.log("  AGGREGATE\n");
console.log(`      fixtures analysed:        ${rows.length}`);
console.log(`      graphics-dominant:        ${graphicsHeavy}/${rows.length}`);
console.log(`      fonts falling back:       ${genericFonts}/${totalFonts} (${pct(genericFonts, totalFonts)}%)`);
console.log(`      scanned (need OCR):       ${rows.filter((r) => r.chars < 30).length}/${rows.length}`);
console.log("");
