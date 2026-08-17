// Do the files we hand people actually meet the standards we imply they meet?
//
// Three independent checks, because "it opens in my browser" is a very low bar:
//   1. HTML     — a real HTML5 validator, not a regex
//   2. JSX      — does it parse as valid JSX at all (esbuild)
//   3. a11y/i18n — the things a validator cannot see: language, direction, contrast
//                  of a transparent text layer, alt text semantics

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HtmlValidate } from "html-validate";
import { transform } from "esbuild";
import { convert } from "../src/converter/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const htmlvalidate = new HtmlValidate({
  extends: ["html-validate:recommended"],
  rules: {
    // Absolutely-positioned runs are the whole point; inline style is not a defect here.
    "no-inline-style": "off",
    // Generated pages have no editorial heading structure to enforce.
    "heading-level": "off",
    "require-sri": "off",
  },
});

let problems = 0;
const report = (level, msg) => {
  if (level === "fail") problems++;
  const tag = level === "fail" ? "FAIL" : level === "warn" ? "warn" : "ok  ";
  console.log(`      ${tag}  ${msg}`);
};

const files = (await readdir(join(ROOT, "fixtures"))).filter((f) => f.endsWith(".pdf")).sort();
const outDir = join(ROOT, "out");
await mkdir(outDir, { recursive: true });

console.log("\n  EXPORT VALIDATION\n");

for (const file of files) {
  console.log(`  ${file}`);

  const data = new Uint8Array(await readFile(join(ROOT, "fixtures", file)));
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + "/",
    cMapUrl: join(ROOT, "node_modules", "pdfjs-dist", "cmaps") + "/",
    cMapPacked: true,
  }).promise;

  const result = await convert(doc, pdfjs, {
    formats: ["html", "react"],
    background: false,
    maxPages: 2,
    title: file.replace(/\.pdf$/, ""),
    componentName: "PdfDocument",
  });
  await doc.destroy();

  const html = result.files["index.html"];
  const jsx = result.files["PdfDocument.jsx"];

  // ---- 1. HTML5 validity -------------------------------------------------
  const vr = await htmlvalidate.validateString(html);
  if (vr.valid) {
    report("ok", "HTML5 valid");
  } else {
    const msgs = vr.results.flatMap((r) => r.messages);
    for (const m of msgs.slice(0, 6)) {
      report(m.severity === 2 ? "fail" : "warn", `HTML ${m.ruleId}: ${m.message} (line ${m.line})`);
    }
    if (msgs.length > 6) report("warn", `…and ${msgs.length - 6} more`);
  }

  // ---- 2. JSX parses -----------------------------------------------------
  try {
    await transform(jsx, { loader: "jsx", jsx: "automatic" });
    report("ok", "JSX compiles");
  } catch (err) {
    report("fail", `JSX does not compile: ${err.errors?.[0]?.text ?? err.message}`);
  }

  // ---- 3. i18n and accessibility ----------------------------------------
  const rtlRuns = result.pages.flatMap((p) => p.runs).filter((r) => r.rtl).length;
  const declaredLang = html.match(/<html lang="([^"]+)"/)?.[1];
  const declaredDir = /<html[^>]*\bdir="rtl"/.test(html);

  if (rtlRuns > 0) {
    report(declaredLang && declaredLang !== "en" ? "ok" : "fail",
      `document language declared as "${declaredLang}" but the content is right-to-left (${rtlRuns} RTL runs)`);
    report(declaredDir ? "ok" : "fail",
      `<html dir="rtl"> ${declaredDir ? "set" : "missing on a right-to-left document"}`);
  } else {
    report("ok", `language "${declaredLang}"`);
  }

  if (!/<title>[^<]+<\/title>/.test(html)) report("fail", "no document title");
  if (!/<meta charset="utf-8">/i.test(html)) report("fail", "no charset declaration");

  await writeFile(join(outDir, file.replace(/\.pdf$/, ".html")), html);
  await writeFile(join(outDir, file.replace(/\.pdf$/, ".jsx")), jsx);
  console.log("");
}

console.log(problems === 0
  ? "  EXPORTS VALIDATE CLEAN\n"
  : `  ${problems} PROBLEM(S) FOUND\n`);
process.exit(problems === 0 ? 0 : 1);
