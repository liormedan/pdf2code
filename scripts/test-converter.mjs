// Sprint 1/2 verification: run the real converter over every fixture in Node and
// assert the output is structurally sound. No canvas here, so this exercises the
// text-only path — which is exactly the path that has to be correct on its own.

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { convert } from "../src/converter/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const STANDARD_FONTS = join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + "/";
const CMAPS = join(ROOT, "node_modules", "pdfjs-dist", "cmaps") + "/";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    console.log(`      ok    ${name}`);
  } else {
    console.log(`      FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
};

const files = (await readdir(join(ROOT, "fixtures"))).filter((f) => f.endsWith(".pdf")).sort();
const outDir = join(ROOT, "out");
await mkdir(outDir, { recursive: true });

console.log("\n  CONVERTER TEST (text-only path)\n");

for (const file of files) {
  console.log(`  ${file}`);

  const data = new Uint8Array(await readFile(join(ROOT, "fixtures", file)));
  const doc = await pdfjs.getDocument({
    data, standardFontDataUrl: STANDARD_FONTS, cMapUrl: CMAPS, cMapPacked: true,
  }).promise;

  const progress = [];
  const result = await convert(doc, pdfjs, {
    formats: ["html", "react"],
    background: false,
    maxPages: 3,
    title: file,
    componentName: "PdfDocument",
    onProgress: (p) => progress.push(p),
  });

  const html = result.files["index.html"];
  const jsx = result.files["PdfDocument.jsx"];

  check("html produced", typeof html === "string" && html.length > 0);
  check("react produced", typeof jsx === "string" && jsx.length > 0);
  check("css produced", !!result.files["PdfDocument.css"]);
  check("readme produced", !!result.files["README.md"]);
  check("progress reported", progress.length > 0, `${progress.length} events`);

  // Structural soundness of the HTML.
  const opens = (html.match(/<span /g) ?? []).length;
  const closes = (html.match(/<\/span>/g) ?? []).length;
  check("spans balanced", opens === closes, `${opens} open / ${closes} close`);
  check("doctype present", html.startsWith("<!DOCTYPE html>"));

  // Escaping: inspect the span text content itself rather than the whole document,
  // which legitimately contains "<" inside its script block.
  const spanBodies = [...html.matchAll(/<span [^>]*>([\s\S]*?)<\/span>/g)].map((m) => m[1]);
  const badEscape = spanBodies.filter((t) => /[<>]/.test(t) || /&(?!amp;|lt;|gt;|quot;|#)/.test(t));
  check("text content escaped", badEscape.length === 0,
    badEscape.length ? JSON.stringify(badEscape[0].slice(0, 40)) : "");

  // JSX soundness. Neutralise string literals first: page text is embedded as JS
  // strings, and a PDF whose text contains "</span>" or "<img …>" would otherwise
  // fail these checks for content that is perfectly safe inside a quoted literal.
  const skeleton = jsx.replace(/"(?:[^"\\]|\\.)*"/g, '"S"');
  const jsxOpens = (skeleton.match(/<span /g) ?? []).length;
  const jsxCloses = (skeleton.match(/<\/span>/g) ?? []).length;
  check("jsx spans balanced", jsxOpens === jsxCloses, `${jsxOpens}/${jsxCloses}`);
  check("jsx img self-closed", !/<img(?![^>]*\/>)[^>]*>/.test(skeleton));
  check("jsx has default export", /export default function/.test(jsx));

  // Fonts must resolve to something better than a bare generic wherever the PDF
  // actually embedded a face — this was the Sprint 0 finding.
  const allFonts = result.pages.flatMap((p) => Object.values(p.fonts));
  // A named family is quoted; a bare generic is not. Quotes are single, because double
  // quotes would terminate the style="…" attribute they end up inside.
  const named = allFonts.filter((f) => f.family.includes("'"));
  check("no double quotes in font families", !allFonts.some((f) => f.family.includes('"')));
  if (allFonts.length) {
    check("fonts resolved to real families", named.length > 0,
      `${named.length}/${allFonts.length} named`);
    console.log(`            e.g. ${[...new Set(named.map((f) => f.family))].slice(0, 3).join(" | ") || "(none)"}`);
  }

  // RTL must survive.
  const rtlRuns = result.pages.flatMap((p) => p.runs).filter((r) => r.rtl);
  if (rtlRuns.length) {
    check("rtl runs marked", html.includes('dir="rtl"'), `${rtlRuns.length} runs`);
    console.log(`            e.g. ${JSON.stringify(rtlRuns[0].text.slice(0, 30))}`);
  }

  if (result.warnings.length) {
    for (const w of result.warnings) console.log(`      warn  ${w.code}: ${w.message.slice(0, 80)}`);
  }

  await writeFile(join(outDir, file.replace(/\.pdf$/, ".html")), html);
  await doc.destroy();
  console.log("");
}

console.log(failures === 0 ? `  ALL CHECKS PASSED\n` : `  ${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
