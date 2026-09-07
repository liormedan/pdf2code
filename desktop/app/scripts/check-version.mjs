/**
 * The version is declared in three files. This is the check that they still agree.
 *
 *     node scripts/check-version.mjs
 *
 * `package.json`, `Cargo.toml` and `tauri.conf.json` each carry a version string, and
 * nothing keeps them in step. They are read by different things — npm, cargo, and the
 * installer builder — so a mismatch does not fail a build. It ships: an MSI stamped
 * 0.2.0 whose About box says 0.1.0, and a bug report about a release that does not exist.
 *
 * The About box reads `CARGO_PKG_VERSION`, so **Cargo.toml is the one that is true** and
 * the other two are asked to match it. That is stated here rather than left implicit,
 * because the next person to bump a version needs to know which file to bump.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const cargo = read("src-tauri", "Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const pkg = JSON.parse(read("package.json")).version;
const tauri = JSON.parse(read("src-tauri", "tauri.conf.json")).version;

console.log("version");
console.log(`  Cargo.toml        ${cargo}   <- the one the About box reads`);
console.log(`  package.json      ${pkg}`);
console.log(`  tauri.conf.json   ${tauri}`);
console.log();

const wrong = [];
if (!cargo) wrong.push("Cargo.toml has no version at all");
if (pkg !== cargo) wrong.push(`package.json says ${pkg}, Cargo.toml says ${cargo}`);
if (tauri !== cargo) wrong.push(`tauri.conf.json says ${tauri}, Cargo.toml says ${cargo}`);

// A version that is not three numbers is a version an installer will argue with: MSI
// product versions are numeric, and a suffix like "0.2.0-beta" fails late and unhelpfully.
if (cargo && !/^\d+\.\d+\.\d+$/.test(cargo)) {
  wrong.push(`"${cargo}" is not major.minor.patch — an MSI product version has to be`);
}

if (wrong.length) {
  for (const item of wrong) console.log(`  FAIL  ${item}`);
  console.log(`\n${wrong.length} failed`);
  process.exit(1);
}

console.log(`  ok    all three declare ${cargo}`);
console.log("\nall checks passed");
