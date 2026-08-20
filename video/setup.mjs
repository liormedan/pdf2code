// Rebuilds everything the repo deliberately does not carry.
//
// Committed: src/, docs/, assets/report.html, the scripts, and audio/original — the raw
// recordings, which cost credits and which no re-record reproduces bit for bit.
//
// Derived, and rebuilt here: the hero PDF, the pdf.js runtime, the converter's output, the
// tightened takes, and public/. Run this once on a fresh clone and `npm run render` works.
//
//   cd video && npm install && npm run setup

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";

const APP = "..";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const step = (name) => console.log(`\n· ${name}`);
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", encoding: "utf8", ...opts });

for (const dir of ["public", "public/audio", "out"]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

step("pdf.js runtime, from the app's node_modules");
const PDFJS = `${APP}/node_modules/pdfjs-dist/build`;
if (!existsSync(PDFJS)) {
  console.error(`  ${PDFJS} is missing — run npm install in the app root first.`);
  process.exit(1);
}
copyFileSync(`${PDFJS}/pdf.min.mjs`, "public/pdf.mjs");
copyFileSync(`${PDFJS}/pdf.worker.min.mjs`, "public/pdf.worker.mjs");

step("hero document: assets/report.html → public/report.pdf");
if (!existsSync(CHROME)) {
  console.error(`  Chrome not found at ${CHROME}. Print assets/report.html to`);
  console.error("  public/report.pdf by hand, or edit CHROME in this script.");
  process.exit(1);
}
run(CHROME, [
  "--headless",
  "--disable-gpu",
  "--no-pdf-header-footer",
  `--print-to-pdf=${process.cwd().replace(/\\/g, "/")}/public/report.pdf`,
  `file:///${process.cwd().replace(/\\/g, "/")}/assets/report.html`,
]);

step("converting it with the product's own converter");
const convert = spawnSync("npx", ["tsx", "video/convert-hero.mts"], {
  cwd: APP,
  stdio: "inherit",
  shell: true,
});
if (convert.status !== 0) {
  console.error("  Conversion failed. src/report1.json is committed, so the film still");
  console.error("  renders — but assets/converted-* will be missing.");
}

step("tightening the takes (tempo 1.1, gaps 0.15s)");
run("node", ["tighten.mjs", "1.1", "0.15"]);

step("copying takes into public/audio");
for (const file of readdirSync("audio").filter((f) => f.endsWith(".mp3"))) {
  copyFileSync(`audio/${file}`, `public/audio/${file}`);
}

console.log("\nReady. `npm run studio` to review, `npm run render Film out/he.mp4` to render.");
