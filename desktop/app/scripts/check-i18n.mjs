/**
 * The strings audit: every key the window asks for exists, and every key we ship is asked for.
 *
 *     node scripts/check-i18n.mjs
 *
 * Three failures this catches, and each has happened in a codebase this size:
 *
 * 1. **A key the code asks for and the bundle does not have.** The provider returns the
 *    key itself rather than throwing, which is the right call at runtime — a screen
 *    reading `desktop.settingsFoo` tells you exactly what to add — and is also why nobody
 *    notices until a customer sees it.
 * 2. **A key in one language and not the other.** The provider falls back to English, so
 *    a Hebrew screen quietly grows English patches.
 * 3. **Keys nobody asks for.** The desktop bundles were copied whole from the web app,
 *    and most of what came across belongs to screens this product does not have. Dead
 *    strings are not harmless: they get translated, reviewed and maintained, and they
 *    make the real gaps hard to see.
 *
 * The engine's codes are checked too, from the Python that defines them, because a code
 * with no wording reaches the window as a bare identifier at exactly the worst moment.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");
const ENGINE = join(ROOT, "..", "engine");

/** Namespaces the desktop window actually renders. The rest came from the web app. */
const OURS = new Set(["app", "desktop"]);

let failures = 0;
const fail = (what) => {
  console.log(`  FAIL  ${what}`);
  failures += 1;
};
const ok = (what) => console.log(`  ok    ${what}`);

// --- what we ship -----------------------------------------------------------------
const bundle = (name) => JSON.parse(readFileSync(join(SRC, "messages", name), "utf8"));
const flatten = (node, prefix = "") =>
  Object.entries(node).flatMap(([key, value]) =>
    typeof value === "string" ? [prefix + key] : flatten(value, `${prefix}${key}.`),
  );

const he = new Set(flatten(bundle("he.json")));
const en = new Set(flatten(bundle("en.json")));

// --- what the window asks for -------------------------------------------------------
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(full)) files.push(full);
  }
};
walk(SRC);

/** Every `t("key")` in a file, paired with the namespace that file's `t` was made with. */
const asked = new Map();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  // Bound by variable name rather than by file. app-shell.tsx holds two of these — `t`
  // for "desktop" and `tApp` for "app" — and crediting every call to both namespaces made
  // the first run of this script report two dozen missing keys that were not missing.
  const bound = new Map();
  for (const m of text.matchAll(
    /(?:const|let)\s+(\w+)\s*=\s*useTranslations\(\s*"([^"]+)"\s*\)/g,
  )) {
    bound.set(m[1], m[2]);
  }
  // A file whose translator arrives as a prop names no namespace of its own; the caller
  // that made it is where those keys are accounted for.
  if (bound.size === 0) continue;

  for (const [variable, ns] of bound) {
    for (const match of text.matchAll(new RegExp(`\\b${variable}\\(\\s*"([^"]+)"`, "g"))) {
      const key = `${ns}.${match[1]}`;
      if (!asked.has(key)) asked.set(key, relative(ROOT, file));
    }
    // Keys built by template, e.g. t(`convertPhase${cap(phase)}`) — recorded as prefixes
    // so the unused check does not accuse them, since they cannot be resolved statically.
    for (const match of text.matchAll(new RegExp(`\\b${variable}\\(\\s*\`([^\`$]*)\\$\\{`, "g"))) {
      asked.set(`${ns}.${match[1]}*`, relative(ROOT, file));
    }
  }
}

console.log("strings");

// --- 1. every key asked for exists, in both languages --------------------------------
const missing = [];
for (const [key, file] of asked) {
  if (key.endsWith("*")) continue;
  if (!he.has(key)) missing.push(`${key} (he) — ${file}`);
  if (!en.has(key)) missing.push(`${key} (en) — ${file}`);
}
if (missing.length) {
  for (const item of missing.slice(0, 12)) fail(`missing string: ${item}`);
  if (missing.length > 12) fail(`…and ${missing.length - 12} more missing strings`);
} else {
  ok(`every one of ${asked.size} keys the window asks for exists in both languages`);
}

// --- 2. the two languages agree ------------------------------------------------------
const onlyHe = [...he].filter((k) => !en.has(k));
const onlyEn = [...en].filter((k) => !he.has(k));
if (onlyHe.length || onlyEn.length) {
  for (const key of [...onlyHe, ...onlyEn].slice(0, 10)) fail(`in one language only: ${key}`);
} else {
  ok("the two bundles hold exactly the same keys");
}

// --- 3. nothing shipped that nobody asks for ------------------------------------------
const prefixes = [...asked.keys()].filter((k) => k.endsWith("*")).map((k) => k.slice(0, -1));
// A key can also be named as a bare string and resolved through a variable later — the
// shortcuts table takes an array of key names, and the queue tags a failure with the key
// its wording lives under. Those are used; they are just not used at a call site this
// script can see, and accusing them would teach people to ignore it.
const allSource = files.map((f) => readFileSync(f, "utf8")).join("\n");
const namedAnywhere = new Set(
  [...allSource.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((m) => m[1]),
);

const unused = [...he].filter(
  (key) =>
    OURS.has(key.split(".")[0]) &&
    !asked.has(key) &&
    !namedAnywhere.has(key.split(".").slice(1).join(".")) &&
    !prefixes.some((prefix) => key.startsWith(prefix)),
);
if (unused.length) {
  for (const key of unused.slice(0, 12)) fail(`nobody asks for: ${key}`);
  if (unused.length > 12) fail(`…and ${unused.length - 12} more unused keys`);
} else {
  ok("every key in our own namespaces is asked for somewhere");
}

// Namespaces the web app left behind. Reported, not failed: they are shared files, and
// deleting them is a decision about the website rather than about this window.
const foreign = [...he].filter((key) => !OURS.has(key.split(".")[0]));
console.log(
  `  note  ${foreign.length} keys in namespaces this window never reads ` +
    `(${[...new Set(foreign.map((k) => k.split(".")[0]))].join(", ")})`,
);

// --- 4. every engine code has a sentence ------------------------------------------------
const protocol = readFileSync(join(ENGINE, "protocol.py"), "utf8");
const codesIn = (name) => {
  const block = protocol.match(new RegExp(`${name}\\s*=\\s*\\(([^)]*)\\)`, "s"));
  return block ? [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]) : [];
};

// Which codes the window is expected to word, and which are answers rather than failures.
const NOT_SHOWN = new Set(["CANCELLED", "INTERNAL", "BAD_REQUEST", "UNKNOWN_OP"]);
const errorCodes = codesIn("ERROR_CODES").filter((c) => !NOT_SHOWN.has(c));
const warningCodes = codesIn("WARNING_CODES");

const sources = files.map((f) => readFileSync(f, "utf8")).join("\n");
for (const code of errorCodes) {
  if (sources.includes(`"${code}"`)) ok(`the window words ${code}`);
  else fail(`no wording for engine error ${code} — it would reach the screen as a code`);
}
for (const code of warningCodes) {
  if (sources.includes(`"${code}"`)) ok(`the window words the ${code} warning`);
  else fail(`no wording for engine warning ${code}`);
}

console.log();
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all checks passed");
