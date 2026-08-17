// Contrast audit computed from the token definitions.
//
// Measuring in a browser sounds more authoritative but is not: a pane running Chrome's
// forced-dark mode reports colours the stylesheet never asked for. The tokens are the
// source of truth, so the arithmetic is done on them directly — deterministic, and it
// covers the theme the current machine is not displaying.

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const hex = (h) => {
  const s = h.replace("#", "").trim();
  const full = s.length === 3 ? [...s].map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const luminance = (h) => {
  const [r, g, b] = hex(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** Pull `--name: #value;` pairs out of one CSS block. */
function tokensIn(css, blockRe) {
  const block = css.match(blockRe)?.[0] ?? "";
  const out = {};
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{3,8})/gi)) out[m[1]] = m[2];
  return out;
}

const css = await readFile(join(ROOT, "app", "globals.css"), "utf8");

const light = tokensIn(css, /:root\s*\{[\s\S]*?\n\}/);
const darkBlock = tokensIn(css, /\.dark\s*\{[\s\S]*?\n\}/);
const dark = { ...light, ...darkBlock };

// Every foreground/background pairing the interface actually uses, with the size class
// it is used at. 4.5:1 for body text, 3:1 for large text and for control boundaries.
const PAIRS = [
  ["foreground", "background", 4.5, "body text on the page"],
  ["foreground", "card", 4.5, "body text on a card"],
  ["foreground", "muted", 4.5, "body text on a sunken panel"],
  ["muted-foreground", "card", 4.5, "small mono labels on a card"],
  ["muted-foreground", "muted", 4.5, "small mono labels on a sunken panel"],
  ["muted-foreground", "background", 4.5, "small mono labels on the page"],
  ["muted-foreground", "sidebar", 4.5, "inactive nav items"],
  ["primary", "card", 4.5, "accent text on a card"],
  ["primary", "background", 4.5, "accent text on the page"],
  ["accent-foreground", "accent", 4.5, "accent text on its own tint"],
  ["primary-foreground", "primary", 4.5, "primary button label"],
  ["destructive", "destructive-muted", 4.5, "error text on its tint"],
  ["destructive", "card", 4.5, "error text on a card"],
  ["warning", "warning-muted", 4.5, "warning text on its tint"],
  ["warning", "card", 4.5, "warning text on a card"],
  ["sidebar-accent-foreground", "sidebar-accent", 4.5, "active nav item"],
  ["sidebar-foreground", "sidebar", 4.5, "sidebar text"],
  // WCAG 1.4.11: the boundary of an interactive control needs 3:1 when it is what
  // identifies the control. Chips and outline buttons sit on the same colour as the
  // panel behind them, so their border is exactly that. --divider is a decorative
  // hairline and carries no such requirement, which is why it is not here.
  ["border", "card", 3, "interactive control borders on a card"],
  ["border", "background", 3, "interactive control borders on the page"],
];

let failures = 0;

for (const [name, tokens] of [["LIGHT", light], ["DARK", dark]]) {
  console.log(`\n  ${name}`);
  console.log("  " + "-".repeat(name.length));

  for (const [fg, bg, need, what] of PAIRS) {
    if (!tokens[fg] || !tokens[bg]) {
      console.log(`    ?     --${fg} on --${bg} — token missing`);
      failures++;
      continue;
    }
    const r = contrast(tokens[fg], tokens[bg]);
    const ok = r >= need;
    if (!ok) failures++;
    console.log(
      `    ${ok ? "ok  " : "FAIL"}  ${r.toFixed(2).padStart(5)}:1  (needs ${need})  ` +
      `--${fg} on --${bg} — ${what}`,
    );
  }
}

console.log(failures === 0 ? "\n  CONTRAST OK\n" : `\n  ${failures} CONTRAST FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
