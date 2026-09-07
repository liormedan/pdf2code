/**
 * The About box names ten components and their versions. This checks it is still true.
 *
 *     node scripts/check-credits.mjs
 *
 * That list is a legal statement, not a courtesy: it tells a customer which third-party
 * software is inside the thing they installed and under what licence. It was compiled by
 * reading the installed packages rather than from memory — and reading it once caught a
 * wrong licence, which is exactly why it cannot be left to drift.
 *
 * Nothing keeps it in step. Bump pypdfium2 in `requirements.txt`, or let `npm update`
 * move React, and the About box goes on naming the old version — a statement about
 * software the product no longer ships. Every version claimed here is compared against
 * the file that actually decides it:
 *
 *   - the engine's libraries      -> desktop/engine/requirements.txt (pinned)
 *   - Tauri and rusqlite          -> src-tauri/Cargo.lock
 *   - everything in the window    -> package.json + the installed package
 *
 * Sprint 10 re-checks the whole list against whatever is locked at release. This is the
 * check that keeps the gap between now and then from growing quietly.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

let failures = 0;
const fail = (what) => {
  console.log(`  FAIL  ${what}`);
  failures += 1;
};
const ok = (what) => console.log(`  ok    ${what}`);

// --- what the About box claims ---------------------------------------------------------
const settings = read("src-tauri", "src", "settings.rs");
const claimed = [
  ...settings.matchAll(
    /Credit\s*\{\s*name:\s*"([^"]+)",\s*version:\s*"([^"]+)",\s*license:\s*"([^"]+)"/g,
  ),
].map(([, name, version, license]) => ({ name, version, license }));

console.log(`credits — ${claimed.length} components named in the About box\n`);
if (claimed.length === 0) {
  fail("could not read the credits list out of settings.rs");
}

// --- what is actually installed -----------------------------------------------------
const requirements = read("..", "engine", "requirements.txt");
const cargoLock = read("src-tauri", "Cargo.lock");
const pkg = JSON.parse(read("package.json"));

const pinned = (name) =>
  requirements.match(new RegExp(`^${name.replace(".", "\\.")}==([\\d.]+)`, "m"))?.[1];

// `\r?\n` and not `\n`: Cargo.lock is written with CRLF line endings on Windows, and the
// first version of this failed to match either Tauri or rusqlite for that reason alone —
// reported as "could not find an installed version", which sounded like a missing
// dependency rather than a missing carriage return.
const crate = (name) =>
  cargoLock.match(new RegExp(`name = "${name}"\\r?\\nversion = "([^"]+)"`))?.[1];

const node = (name) => {
  try {
    return JSON.parse(read("node_modules", ...name.split("/"), "package.json")).version;
  } catch {
    // Not installed here — a fresh checkout without `npm ci`. Reported rather than
    // guessed at from the range in package.json, which is not what ships.
    return null;
  }
};

/** How each claimed name is verified. A name absent from here is a name nobody checks. */
const SOURCES = {
  "PDFium (pypdfium2)": () => pinned("pypdfium2"),
  "pdfminer.six": () => pinned("pdfminer.six"),
  Pillow: () => pinned("pillow"),
  Tauri: () => crate("tauri"),
  "rusqlite / SQLite": () => crate("rusqlite"),
  React: () => node("react"),
  "Tailwind CSS": () => node("tailwindcss"),
  "Radix UI": () => node("radix-ui"),
  Lucide: () => node("lucide-react"),
  Vite: () => node("vite"),
};

for (const { name, version, license } of claimed) {
  const lookup = SOURCES[name];
  if (!lookup) {
    fail(`${name} is claimed in the About box and nothing here verifies it`);
    continue;
  }
  const actual = lookup();
  if (actual === null) {
    console.log(`  note  ${name} — not installed in this checkout, version unverified`);
    continue;
  }
  if (!actual) {
    fail(`${name} — could not find an installed version to compare against`);
  } else if (actual !== version) {
    fail(`${name} — the About box says ${version}, what ships is ${actual}`);
  } else {
    ok(`${name} ${version} (${license})`);
  }
}

// A dependency that arrived without reaching the About box is the other direction of the
// same mistake, and the harder one to notice.
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);
const NOT_SHIPPED = new Set([
  // Build-time only: none of these end up inside the installer.
  "@tauri-apps/cli",
  "@types/react",
  "@types/react-dom",
  "@vitejs/plugin-react",
  "@tailwindcss/vite",
  "typescript",
  "tw-animate-css",
]);
/** Which packages each named credit stands for, so the reverse check does not guess. */
const COVERS = {
  React: ["react", "react-dom"],
  "Tailwind CSS": ["tailwindcss"],
  "Radix UI": ["radix-ui"],
  Lucide: ["lucide-react"],
  Vite: ["vite"],
  Tauri: ["@tauri-apps/api"],
};
const covered = new Set(claimed.flatMap((c) => COVERS[c.name] ?? []));
const unnamed = [...declared].filter((dep) => !NOT_SHIPPED.has(dep) && !covered.has(dep));
if (unnamed.length) {
  console.log(
    `\n  note  ${unnamed.length} runtime dependencies are not named individually: ` +
      unnamed.join(", "),
  );
  console.log("        Small MIT utilities. Sprint 10 decides whether the list names all");
  console.log("        of them or states a category; either is defensible, silence is not.");
}

console.log();
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all checks passed");
