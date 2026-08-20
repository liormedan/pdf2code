// Runs the product's own converter over the hero document.
//
// The point of doing it this way rather than hand-authoring the "after" state: every span
// the video shows is output the shipping converter produced, at the offsets it chose. If the
// converter regresses, this video stops matching it, which is the correct behaviour.
//
// Run from the app root so its node_modules and its TypeScript sources resolve:
//   npx tsx video/convert-hero.mts

import { readFile, writeFile } from "node:fs/promises";
import { convert } from "../src/converter/index.ts";

const VIDEO = "video";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const data = new Uint8Array(await readFile(`${VIDEO}/public/report.pdf`));
const doc = await pdfjs.getDocument({
  data,
  standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/",
  cMapUrl: "node_modules/pdfjs-dist/cmaps/",
  cMapPacked: true,
}).promise;

const result = await convert(doc, pdfjs as never, {
  formats: ["html", "react"],
  title: "דוח רבעוני",
  componentName: "QuarterlyReport",
});

for (const [name, contents] of Object.entries(result.files as Record<string, string>)) {
  await writeFile(`${VIDEO}/assets/converted-${name}`, contents as string, "utf8");
  console.log(`  converted-${name}  ${(contents as string).length} bytes`);
}
