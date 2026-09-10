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

/**
 * A line with its trailing comment removed.
 *
 * This check is about what ends up in a `className`, and a comment is not one. The comment
 * most likely to mention `left-1/2` is the comment explaining why the code beside it does
 * **not** use `left-1/2` — so scanning comments punishes exactly the person who did the
 * right thing and then wrote down why. Found the first time a fix and its explanation were
 * committed together.
 *
 * The `:` guard keeps `https://` intact, which is the only `//` in this codebase that is
 * not the start of a comment.
 */
const code = (line) => line.replace(/(^|[^:])\/\/.*$/, "$1");

const offenders = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const [index, line] of text.split("\n").entries()) {
    const cleaned = code(line).replace(/slide-in-from-(left|right)-[0-9.]+/g, "");
    for (const match of cleaned.matchAll(PHYSICAL)) {
      offenders.push(`${relative(ROOT, file)}:${index + 1} — ${match[1]}`);
    }
  }
}

// Stripping comments is only safe if the rule still bites through it.
const IN_A_CLASS = 'className="ml-2 flex"';
const IN_A_COMMENT = '// deliberately not ml-2 here, see below';
const A_URL = 'const docs = "https://example.com/a";';
if ([...code(IN_A_CLASS).matchAll(PHYSICAL)].length === 1) {
  ok("a physical utility inside a class is still caught");
} else {
  fail("stripping comments also stopped the rule catching a real class");
}
if ([...code(IN_A_COMMENT).matchAll(PHYSICAL)].length === 0) {
  ok("and one merely named in a comment is not");
} else {
  fail("a comment mentioning a class is still reported");
}
if (code(A_URL).includes("https://example.com")) {
  ok("a URL is not mistaken for a comment");
} else {
  fail("comment stripping ate a URL");
}

if (offenders.length) {
  for (const item of offenders.slice(0, 15)) fail(`screen-anchored utility: ${item}`);
  if (offenders.length > 15) fail(`…and ${offenders.length - 15} more`);
} else {
  ok(`no screen-anchored spacing in ${files.length} files — all of it follows the text`);
}

// --- buttons that are only a picture -----------------------------------------------------
//
// A control whose label is an image needs a name, or it reaches the accessibility tree as
// "button" and nothing else. WCAG 4.1.2.
//
// **This used to look only at `<Button size="icon">`** — the shadcn component with that
// one prop. The workbench's page card is a plain `<button>` wrapping an `<img alt="">`,
// so it was never in range, and it sat there with no accessible name at all while this
// check reported that every icon button carried one. That was a true sentence about a
// smaller set than anybody reading it assumed.
//
// So both shapes are matched now. The two differ in what counts as a name: a shadcn
// `size="icon"` button has no room for text, so only an explicit label or an `sr-only`
// span will do, while a plain `<button>` may perfectly well be named by its own text.

/** An explicit label. The only thing that names a `<Button size="icon">`. */
const LABELLED = /aria-label[=\s]|aria-labelledby[=\s]|\bsr-only\b/;

/**
 * Whether a button's children put any text on screen.
 *
 * **Not a search for `t(`, which is what this was first and what got it wrong.** That
 * matched a button whose label came in as a prop — `<span>{label}</span>` — and reported a
 * perfectly well named control as a defect. A check that cries wolf is a check people
 * switch off, so the rule had to become the real distinction rather than a proxy for it.
 *
 * The real distinction is what sits in **child position**. Both of these are one
 * interpolation inside a button, and only one of them is text:
 *
 *     {label}                                  → text
 *     {thumb ? (<img alt="" />) : (<Spinner/>)} → two pictures
 *
 * So every tag is flattened to a bare marker, attributes and all — that is what removes
 * `style={{…}}` and `className={…}` from consideration, since those are braces that are
 * not children. What is left is children only, and an interpolation with no tag marker
 * inside it is a value being rendered: text.
 */
function showsText(body) {
  // Drop the button's own opening tag — via `tagEnd`, not `indexOf(">")`, which lands
  // inside the `=>` of an onClick and leaves half an attribute looking like child text.
  // Written the wrong way first, and the self-test below is what said so.
  // JSX comments go first. `{/* … */}` is an interpolation holding no tag, which is the
  // exact shape of a rendered value — so left in, a comment above an icon names the
  // button, and the real page card slipped through on one. Found against the real file
  // after the snippet below already passed, which is why the snippet now carries one.
  const rest = body.slice(tagEnd(body, 0) + 1).replace(/\{\s*\/\*[^]*?\*\/\s*\}/g, "");
  let flat = "";
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== "<") {
      flat += rest[index];
      continue;
    }
    const closing = rest[index + 1] === "/";
    const end = closing ? rest.indexOf(">", index) : tagEnd(rest, index);
    if (end < 0) break;
    flat += closing ? "</>" : "<>";
    index = end;
  }

  // Balanced interpolations. One holding no tag marker is a value on screen.
  for (let index = 0; index < flat.length; index += 1) {
    if (flat[index] !== "{") continue;
    let depth = 0;
    let end = index;
    for (; end < flat.length; end += 1) {
      if (flat[end] === "{") depth += 1;
      else if (flat[end] === "}" && --depth === 0) break;
    }
    const inside = flat.slice(index + 1, end);
    if (!inside.includes("<") && inside.trim()) return true;
    index = end;
  }

  // Or a literal, written straight into the markup.
  return /[^\s<>{}/]/.test(flat.replace(/\{[^]*?\}/g, "").replace(/<\/?>/g, ""));
}

/** Where an opening tag's `>` is, counting braces so an attribute's `=>` cannot end it. */
function tagEnd(text, at) {
  let depth = 0;
  let quote = null;
  for (let index = at + 1; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === ">" && depth === 0) return index;
  }
  return -1;
}

/**
 * The element starting at `at`, from `<tag` to its matching `</tag>`.
 *
 * **Not a bounded regex, and that is the whole point of this function.** The first version
 * of it was `<button\b[\s\S]{0,900}?</button>`, and the button it was written to catch is
 * 1689 characters long — so it matched nothing, found no unnamed buttons, and printed that
 * everything carried a name. A cap that is too small does not report that it gave up.
 *
 * Two things a regex cannot do here and this can. **JSX attributes contain `>`:** the page
 * card's `onClick={(event) => click(...)}` has one, so the opening tag does not end at the
 * first `>` — it ends at the first `>` that is outside quotes and outside braces. And
 * **buttons nest**, so the closing tag is found by counting rather than by proximity.
 *
 * Returns null only for a tag that is never closed, which is a syntax error the compiler
 * will report better than this can.
 */
function element(text, at, tag) {
  let depth = 0;
  let quote = null;
  let index = at + 1 + tag.length;

  for (; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === ">" && depth === 0) break;
  }
  if (index >= text.length) return null;

  // `<button ... />` — no children, so the opening tag is the whole of it.
  if (text[index - 1] === "/") return text.slice(at, index + 1);

  const open = new RegExp(`<${tag}\\b`, "g");
  const close = new RegExp(`</${tag}\\s*>`, "g");
  let nested = 1;
  let cursor = index + 1;

  while (nested > 0) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const next = open.exec(text);
    const end = close.exec(text);
    if (!end) return null;
    if (next && next.index < end.index) {
      nested += 1;
      cursor = next.index + 1;
    } else {
      nested -= 1;
      cursor = end.index + end[0].length;
    }
  }
  return text.slice(at, cursor);
}

/** Every button in the source, as `{ kind, body }`. A self-test below runs on this. */
function buttons(text) {
  const found = [];
  for (const match of text.matchAll(/<Button\b[^>]*?size="icon"/g)) {
    const body = element(text, match.index, "Button");
    if (body !== null) found.push({ kind: "icon", body });
  }
  // Lower-case `b`: the DOM element rather than the component.
  for (const match of text.matchAll(/<button\b/g)) {
    const body = element(text, match.index, "button");
    if (body !== null) found.push({ kind: "plain", body });
  }
  return found;
}

const named = ({ kind, body }) =>
  LABELLED.test(body) || (kind === "plain" && showsText(body));

let unnamed = 0;
let counted = 0;
for (const file of files) {
  for (const button of buttons(readFileSync(file, "utf8"))) {
    counted += 1;
    if (named(button)) continue;
    unnamed += 1;
    fail(`button with no accessible name in ${relative(ROOT, file)}`);
  }
}
if (unnamed === 0) ok(`every one of ${counted} buttons carries a name`);

// --- and a check on the check ------------------------------------------------------------
//
// The rule above was written *because* it missed a real defect for a whole sprint, and a
// widened rule that quietly stops matching would fail the same way — silently, reporting
// that everything is fine. So it is run against the two cases it exists to tell apart.
//
// The bad one is the page card as it actually was, copied rather than invented.
const CAUGHT = `
  <button type="button" onClick={(e) => click(leaf.uid, e)} aria-pressed={sel} className="block">
    {/* Square on purpose: a page turned a quarter turn swaps its width and height. */}
    <span className="flex h-36 w-full items-center justify-center">
      {thumbs.get(pageKey(leaf)) ? (
        <img src={thumb} alt="" style={{ transform: \`rotate(\${deg}deg)\` }} />
      ) : (
        <Loader2 className="size-4" aria-hidden="true" />
      )}
    </span>
  </button>`;
const ALLOWED = `
  <button type="button" aria-label={t("workbenchPageCard", { index })}><img alt="" /></button>
  <button type="button">{t("workbenchSearchRun")}</button>
  <button type="button">Save</button>
  <Button size="icon" aria-label={t("modeSettings")}><Settings className="size-4" /></Button>
  <button type="button" onClick={onClick} aria-pressed={chosen}>
    <span className={\`size-1.5 \${TONE[tone].dot}\`} aria-hidden="true" />
    <span dir="auto" className="flex-1 truncate">{label}</span>
  </button>`;

const caught = buttons(CAUGHT).filter((b) => !named(b)).length;
const wrongly = buttons(ALLOWED).filter((b) => !named(b)).length;

if (caught === 1) ok("the rule catches a button whose only child is an unlabelled image");
else fail(`the rule did NOT catch the defect it was written for (caught ${caught} of 1)`);

if (wrongly === 0) ok("and passes a labelled one, a text one, and a named icon button");
else fail(`the rule rejected ${wrongly} button(s) that are properly named`);

// The two ways the reader that feeds the rule stops seeing things. Both are silent — the
// rule keeps printing that every button is named — so both are asserted rather than
// trusted. The first is what actually happened.
const LONG = `<button type="button" onClick={(event) => go(event)}>\n${"  // filler\n".repeat(200)}<img alt="" />\n</button>`;
if (buttons(LONG).length === 1) ok("a button longer than a kilobyte is still read whole");
else fail("a long button was not read — the reader is capping again");

const NESTED = `<button aria-label={t("outer")}><span><button><img alt="" /></button></span></button>`;
if (buttons(NESTED).filter((b) => !named(b)).length === 1) {
  ok("and an unnamed button nested inside a named one is still found");
} else {
  fail("nesting confused the reader");
}

console.log();
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all checks passed");
