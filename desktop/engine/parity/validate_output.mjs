/**
 * Validate the Python engine's output with the same tools that validate the TypeScript's.
 *
 *     node desktop/engine/parity/validate_output.mjs <directory>
 *
 * "It opens in my browser" is a very low bar. scripts/validate-output.mjs holds the real
 * one for the web app — a genuine HTML5 validator and an actual JSX parse — and there is
 * no reason a second engine should be held to a lower one. So rather than reimplementing
 * either check in Python, this points the existing tools at whatever the Python engine
 * just wrote.
 *
 * It lives here and not in scripts/ because it takes a directory of finished files
 * instead of running a conversion itself: the Python engine writes to disk, which is the
 * whole point of desktop/architecture.md's rule about not sending output through the
 * pipe.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { HtmlValidate } from "html-validate";
import { transform } from "esbuild";

const target = process.argv[2];
if (!target) {
  console.error("usage: node validate_output.mjs <directory>");
  process.exit(2);
}

const htmlvalidate = new HtmlValidate({
  extends: ["html-validate:recommended"],
  rules: {
    // Absolutely-positioned runs are the whole point; inline style is not a defect here.
    "no-inline-style": "off",
    // Generated pages have no editorial heading structure to enforce.
    "heading-level": "off",
    "require-sri": "off",
  },
});

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** Every output directory below the target, so one call covers a whole run. */
async function* outputs(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* outputs(path);
    else if (entry.name === "index.html" || entry.name.endsWith(".jsx")) yield path;
  }
}

console.log(`\n  EXPORT VALIDATION — ${target}\n`);

let seen = 0;
for await (const file of outputs(target)) {
  seen++;
  const contents = await readFile(file, "utf8");
  const label = file.slice(target.length + 1);

  if (file.endsWith(".html")) {
    const report = await htmlvalidate.validateString(contents, file);
    const messages = report.results.flatMap((r) => r.messages);
    const errors = messages.filter((m) => m.severity === 2);
    check(
      `${label} is valid HTML5`,
      errors.length === 0,
      errors.length ? `${errors[0].message} (line ${errors[0].line})` : "",
    );
  } else {
    try {
      await transform(contents, { loader: "jsx", jsx: "automatic" });
      check(`${label} compiles as JSX`, true);
    } catch (error) {
      check(`${label} compiles as JSX`, false, error.message.split("\n")[0]);
    }
  }
}

if (seen === 0) {
  console.error(`  no index.html or .jsx found under ${target}`);
  process.exit(2);
}

console.log(`\n  ${seen} files checked, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
