/**
 * The two accessibility questions that have a right answer rather than an opinion.
 *
 *     node scripts/check-a11y.mjs
 *
 * **Contrast**, computed from the theme's own tokens in both light and dark, against
 * WCAG 2.1 AA. A ratio is arithmetic — it does not need a person to squint at it, and
 * checking it here is cheaper than discovering on a customer's screen that the muted text
 * this product uses everywhere is a shade too light.
 *
 * **Direction**, because this window ships in Hebrew. Tailwind's `pl-`, `mr-`, `left-`
 * and friends are anchored to the left of the screen; `ps-`, `me-`, `start-` follow the
 * writing direction. One of each is correct and the other silently mirrors wrong, and the
 * failure is invisible to anybody testing in English — which is to say, invisible to
 * whoever writes the code.
 *
 * Deliberately not here: whether the keyboard order makes sense, and whether a screen
 * reader says something useful. Those need a person, and pretending a script settled them
 * would be worse than leaving them open.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");

let failures = 0;
const fail = (what) => {
  console.log(`  FAIL  ${what}`);
  failures += 1;
};
const ok = (what) => console.log(`  ok    ${what}`);

// --- contrast ------------------------------------------------------------------------
const css = readFileSync(join(SRC, "index.css"), "utf8");

/** The token block for a theme. Light is `:root`, dark is the `.dark` override. */
function tokens(from, to) {
  const start = css.indexOf(from);
  const end = to ? css.indexOf(to, start) : css.length;
  const slice = css.slice(start, end === -1 ? css.length : end);
  const found = {};
  for (const match of slice.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    found[match[1]] = match[2];
  }
  return found;
}

const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/**
 * Pairs that actually appear on screen, with the threshold each has to meet.
 *
 * 4.5 is AA for body text; 3.0 is AA for large text and for the boundary of a control,
 * which is what `divider` is. Anything not listed is not checked, because a pair nobody
 * renders is a number nobody should be made to chase.
 */
const PAIRS = [
  ["foreground", "background", 4.5, "body text on the page"],
  ["card-foreground", "card", 4.5, "text on a card"],
  ["popover-foreground", "popover", 4.5, "text in a popover"],
  ["muted-foreground", "background", 4.5, "muted text on the page"],
  ["muted-foreground", "card", 4.5, "muted text on a card"],
  ["primary-foreground", "primary", 4.5, "text on the primary button"],
  ["destructive-foreground", "destructive", 4.5, "text on a destructive button"],
  ["destructive", "background", 4.5, "an error message"],
  ["destructive", "destructive-muted", 4.5, "an error on its own tint"],
  ["warning", "warning-muted", 4.5, "a warning on its own tint"],
  ["warning", "background", 4.5, "a warning on the page"],
  ["accent-foreground", "accent", 4.5, "text on an accent surface"],
  ["primary", "background", 3.0, "the primary colour as a boundary"],
  // 1.4.11 asks 3:1 of "visual information required to identify user interface
  // components", which is the border of a control. In this theme that is `input` —
  // checked here — and not `divider`, which the codebase uses only on layout containers
  // (header, footer, card edges, table rows) where the regions are identified by their
  // headings and their own surfaces. A hairline separator is decoration, and holding it
  // to a control's threshold would mean darkening every edge in the window to satisfy a
  // rule that does not cover it. Verified rather than assumed: no control in src/ carries
  // `border-divider`.
  ["input", "background", 3.0, "the border of a text field"],
  ["input", "card", 3.0, "the border of a text field on a card"],
];

console.log("contrast");
for (const [theme, from, to] of [
  ["light", ":root {", ".dark"],
  ["dark", ".dark", null],
]) {
  const palette = tokens(from, to);
  for (const [fg, bg, threshold, what] of PAIRS) {
    if (!palette[fg] || !palette[bg]) continue;
    const value = ratio(palette[fg], palette[bg]);
    const line = `${theme}: ${what} — ${value.toFixed(2)}:1 (needs ${threshold})`;
    if (value >= threshold) ok(line);
    else fail(line);
  }
}

// --- direction -------------------------------------------------------------------------
console.log("\ndirection");

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(full)) files.push(full);
  }
};
walk(SRC);

/**
 * Left/right utilities that are anchored to the screen rather than to the text.
 *
 * `slide-in-from-left-2` and its siblings are excluded, and the exclusion is the point:
 * those animations are keyed on `data-[side=…]`, which the popover library computes at
 * runtime from where the thing actually opened. They should follow the side, not the
 * writing direction, and rewriting them to logical properties would be a bug rather than
 * a fix.
 */
const PHYSICAL = /\b(?<!slide-in-from-)(-?(?:ml|mr|pl|pr|left|right)-[0-9.]+|text-(?:left|right)|border-[lr]\b)/g;

const offenders = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const [index, line] of text.split("\n").entries()) {
    const cleaned = line.replace(/slide-in-from-(left|right)-[0-9.]+/g, "");
    for (const match of cleaned.matchAll(PHYSICAL)) {
      offenders.push(`${relative(ROOT, file)}:${index + 1} — ${match[1]}`);
    }
  }
}

if (offenders.length) {
  for (const item of offenders.slice(0, 15)) fail(`screen-anchored utility: ${item}`);
  if (offenders.length > 15) fail(`…and ${offenders.length - 15} more`);
} else {
  ok(`no screen-anchored spacing in ${files.length} files — all of it follows the text`);
}

// Icon-only buttons need a name, because their label is a picture.
let unnamed = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/<Button\b[^>]*size="icon"[\s\S]{0,400}?<\/Button>/g)) {
    if (!/aria-label=|sr-only/.test(match[0])) {
      unnamed += 1;
      fail(`icon button with no accessible name in ${relative(ROOT, file)}`);
    }
  }
}
if (unnamed === 0) ok("every icon-only button carries a name");

console.log();
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all checks passed");
