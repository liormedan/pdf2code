/**
 * Regenerate desktop/engine/_bidi_tables.py from pdf.js.
 *
 *     node desktop/engine/parity/dump_bidi_tables.mjs
 *
 * Five hundred and twelve character-type entries, copied by eye, is a transcription bug
 * waiting to happen — and one wrong entry mis-orders exactly one script in exactly one
 * document, which is the kind of report nobody can reproduce. So they are lifted out of
 * the shipped pdf.js build mechanically instead.
 *
 * The tables come from `src/core/bidi.js` upstream. If a pdfjs-dist upgrade changes
 * them, running this produces a diff — which is the point.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const SOURCE = join(ROOT, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");

const lines = readFileSync(SOURCE, "utf8").split("\n");

function grab(name) {
  const line = lines.find((l) => l.startsWith(`const ${name} = [`));
  if (!line) throw new Error(`${name} not found in ${SOURCE}`);
  return JSON.parse(line.slice(line.indexOf("[")).replace(/;\s*$/, ""));
}

const base = grab("baseTypes");
const arabic = grab("arabicTypes");

const format = (values) => {
  const quoted = values.map((v) => JSON.stringify(v));
  const rows = [];
  for (let i = 0; i < quoted.length; i += 8) {
    rows.push("    " + quoted.slice(i, i + 8).join(", ") + ",");
  }
  return rows.join("\n");
};

const header = `"""Bidi character-type tables, extracted mechanically from pdf.js.

Do not edit by hand. Regenerate with parity/dump_bidi_tables.mjs.
Five hundred and twelve entries copied by eye is a transcription bug waiting to
happen, and one wrong entry mis-orders exactly one script in exactly one document.
"""

`;

writeFileSync(
  join(HERE, "..", "_bidi_tables.py"),
  `${header}BASE_TYPES = [\n${format(base)}\n]\n\nARABIC_TYPES = [\n${format(arabic)}\n]\n`,
  "utf8",
);

console.log(`baseTypes ${base.length}, arabicTypes ${arabic.length}`);
