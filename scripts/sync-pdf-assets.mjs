// pdf.js loads three things over HTTP at runtime: its worker, the 14 standard font
// files, and the CMap tables for CJK and other multi-byte encodings. They live inside
// node_modules, so they have to be copied into public/ to be served.
//
// Runs before dev and build; skips work when the copy is already current.

import { cp, mkdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FROM = join(ROOT, "node_modules", "pdfjs-dist");
const TO = join(ROOT, "public");

const exists = async (p) => !!(await stat(p).catch(() => null));

await mkdir(TO, { recursive: true });

const jobs = [
  { from: join(FROM, "build", "pdf.worker.mjs"), to: join(TO, "pdf.worker.mjs"), name: "worker" },
  { from: join(FROM, "standard_fonts"), to: join(TO, "standard_fonts"), name: "standard fonts" },
  { from: join(FROM, "cmaps"), to: join(TO, "cmaps"), name: "cmaps" },
];

for (const job of jobs) {
  if (!(await exists(job.from))) {
    console.warn(`  skip  ${job.name} — not found at ${job.from}`);
    continue;
  }
  await cp(job.from, job.to, { recursive: true, force: true });
  console.log(`  ok    ${job.name}`);
}
