// QA suite.
//
// Covers the things the unit test and the HTML validator do not: whether hostile PDF
// text can escape into executable markup, whether a large document completes in a
// sane time and memory envelope, whether cancellation and limits actually hold, and
// whether the generated React really compiles and renders.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { convert, ConversionError, classifyPage } from "../src/converter/index.ts";
import { detectLanguage } from "../src/converter/language.ts";
import { describeFont } from "../src/converter/fonts.ts";
import { quote, validateFile, baseNameOf, detectKind, pptxEnabled, MAX_PAGES } from "../src/lib/pricing.ts";
import { sniffPresentation } from "../src/lib/office-server.ts";
import { createSession, createToken, readSession, verifySession } from "../src/lib/auth.ts";
import { HOSTILE_LINES } from "./make-test-pdf.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const ASSETS = {
  standardFontDataUrl: join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + "/",
  cMapUrl: join(ROOT, "node_modules", "pdfjs-dist", "cmaps") + "/",
  cMapPacked: true,
};

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`    ok    ${name}`); }
  else { fail++; console.log(`    FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};
const section = (t) => console.log(`\n  ${t}\n  ${"-".repeat(t.length)}`);

const openFixture = async (name) =>
  pdfjs.getDocument({ data: new Uint8Array(await readFile(join(ROOT, "fixtures", name))), ...ASSETS }).promise;

console.log("\n  QA SUITE");

// ───────────────────────────────────────────────────────────── injection
section("1. Injection — hostile PDF text must not become executable markup");
{
  const doc = await openFixture("09-hostile-text.pdf");
  const r = await convert(doc, pdfjs, {
    formats: ["html", "react"], background: false, title: "hostile",
    componentName: "Hostile",
  });
  await doc.destroy();

  const html = r.files["index.html"];
  const jsx = r.files["Hostile.jsx"];

  // The generated page has exactly one script — the responsive fitter we author.
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)];
  check("no injected <script> in HTML", scripts.length === 1, `${scripts.length} script tags`);

  // Inspect the *tags*, not the whole document. Hostile text survives as escaped
  // content — "&lt;img src=x onerror=…" — so a regex over the raw string matches
  // harmless text and proves nothing. Since "<" is always escaped in text, the tag
  // pattern below reliably isolates real markup.
  const tags = [...html.matchAll(/<[a-z!/][^>]*>/gi)].map((m) => m[0]);
  const withHandler = tags.filter((t) => /\son[a-z]+\s*=/i.test(t));
  check("no inline event handlers on any tag", withHandler.length === 0,
    withHandler[0]?.slice(0, 60));
  const withJsUrl = tags.filter((t) => /(?:href|src|action)\s*=\s*["']?\s*javascript:/i.test(t));
  check("no javascript: URLs in attributes", withJsUrl.length === 0, withJsUrl[0]?.slice(0, 60));

  // The span that carries the hostile line must hold it as text, not as structure.
  const hostileSpan = tags.find((t) => t.includes("onerror"));
  check("hostile text never became a tag", !hostileSpan, hostileSpan?.slice(0, 60));

  // The dangerous strings must survive as visible text, escaped.
  const escapedScript = html.includes("&lt;script&gt;");
  check("script text preserved but escaped", escapedScript);

  // Double-escaping check: text that was already an entity in the PDF must not
  // render as "&amp;lt;" to the reader.
  const alreadyEntities = r.pages[0].runs.some((run) => run.text.includes("&lt;already"));
  check("pre-existing entity text captured", alreadyEntities);

  // React output: text goes in an expression container, so it can never be parsed as
  // markup. Verify that structurally — but neutralise string literals first, because
  // the hostile text literally contains "<span>" and would otherwise match itself.
  const skeleton = jsx.replace(/"(?:[^"\\]|\\.)*"/g, '"S"');
  const spanChildren = [...skeleton.matchAll(/<span[^>]*>(.)/g)].map((m) => m[1]);
  check("every JSX span holds text in an expression container",
    spanChildren.length > 0 && spanChildren.every((c) => c === "{"),
    `${spanChildren.filter((c) => c !== "{").length} of ${spanChildren.length} spans hold raw text`);
  await transform(jsx, { loader: "jsx", jsx: "automatic" })
    .then(() => check("hostile JSX still compiles", true))
    .catch((e) => check("hostile JSX still compiles", false, e.message));

  const covered = HOSTILE_LINES.filter((l) =>
    r.pages[0].runs.some((run) => run.text.includes(l.slice(0, 18)))).length;
  check("hostile lines reached the model", covered >= 6, `${covered}/${HOSTILE_LINES.length}`);

  await mkdir(join(ROOT, "out"), { recursive: true });
  await writeFile(join(ROOT, "out", "hostile.html"), html);
}

// ───────────────────────────────────────────────────────────── scale
section("2. Scale — a large document must finish in a sane envelope");
{
  const doc = await openFixture("10-large-150p.pdf");
  const before = process.memoryUsage().heapUsed;
  const t0 = performance.now();

  const progress = [];
  const r = await convert(doc, pdfjs, {
    formats: ["html"], background: false, maxPages: MAX_PAGES,
    title: "large", onProgress: (p) => progress.push(p),
  });

  const ms = performance.now() - t0;
  const heapMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
  await doc.destroy();

  check("all 150 pages converted", r.info.converted === 150, `${r.info.converted}`);
  check("progress reported per page", progress.length >= 150, `${progress.length} events`);
  check("finishes under 60s", ms < 60_000, `${(ms / 1000).toFixed(1)}s`);
  check("heap growth under 400 MB", heapMb < 400, `${heapMb.toFixed(0)} MB`);
  console.log(`          ${(ms / 1000).toFixed(1)}s · ${heapMb.toFixed(0)} MB · ${(new Blob([r.files["index.html"]]).size / 1024 / 1024).toFixed(1)} MB HTML`);
}

// ───────────────────────────────────────────────────────────── limits
section("3. Limits — page cap and cancellation must actually hold");
{
  const doc = await openFixture("10-large-150p.pdf");
  const r = await convert(doc, pdfjs, { formats: ["html"], background: false, maxPages: 10 });
  check("maxPages truncates", r.info.converted === 10, `${r.info.converted}`);
  check("truncation is warned about", r.warnings.some((w) => w.code === "TRUNCATED"));

  let aborted = false;
  const doc2 = await openFixture("10-large-150p.pdf");
  let seen = 0;
  await convert(doc2, pdfjs, {
    formats: ["html"], background: false,
    signal: { get aborted() { return seen >= 5; } },
    onProgress: () => { seen++; },
  }).catch((e) => { aborted = e instanceof ConversionError && e.code === "CANCELLED"; });

  check("cancellation stops the run", aborted, aborted ? "" : "did not throw CANCELLED");
  check("cancellation is prompt", seen < 20, `${seen} pages processed after abort`);

  await doc.destroy();
  await doc2.destroy();
}

// ───────────────────────────────────────────────────────────── pure units
section("4. Units — pricing, validation, language, fonts");
{
  check("1 page → $4.99", quote(1).price === 4.99);
  check("5 page boundary → $4.99", quote(5).price === 4.99);
  check("6 page boundary → $9.99", quote(6).price === 9.99);
  check("50 page boundary → $19.99", quote(50).price === 19.99);
  check("51 pages → overage", quote(51).price === 20.34, `${quote(51).price}`);
  check("0/undefined pages floors at 1", quote(0).price === 4.99 && quote(undefined).price === 4.99);

  check("rejects an unsupported type", !!validateFile({ name: "a.txt", type: "text/plain", size: 10 }));
  // PowerPoint is the one source that needs a server, so a deployment can switch it
  // off — and then it must be refused with a way forward, not with "wrong file type".
  const pptx = { name: "deck.pptx", type: "", size: 1000 };
  const pptxVerdict = validateFile(pptx);
  check(
    pptxEnabled() ? "accepts a presentation when enabled" : "refuses a presentation when disabled",
    pptxEnabled() ? pptxVerdict === null : /Export .* as a PDF/.test(pptxVerdict ?? ""),
    pptxVerdict ?? "accepted",
  );
  check("the classifier still knows what a .pptx is", detectKind(pptx) === "pptx");
  check("classifies pdf and pptx apart",
    detectKind({ name: "a.pdf" }) === "pdf" && detectKind({ name: "a.pptx" }) === "pptx");
  check("a dotless name is not an extension", detectKind({ name: "README" }) === null);
  check("base name strips either extension",
    baseNameOf("deck.pptx") === "deck" && baseNameOf("report.PDF") === "report");
  check("rejects empty", !!validateFile({ name: "a.pdf", type: "application/pdf", size: 0 }));
  check("rejects oversize", !!validateFile({ name: "a.pdf", type: "application/pdf", size: 99e6 }));
  check("accepts by extension when type is missing",
    validateFile({ name: "a.PDF", type: "", size: 1000 }) === null);
  check("rejects nothing selected", !!validateFile(null));

  // The server decides what to parse from the bytes, never from the name it was given.
  const sig = (...bytes) => new Uint8Array([...bytes, 0, 0, 0, 0, 0, 0, 0, 0]);
  check("zip signature reads as pptx", sniffPresentation(sig(0x50, 0x4b, 0x03, 0x04)) === "pptx");
  check("OLE2 signature reads as ppt",
    sniffPresentation(sig(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) === "ppt");
  check("a PDF is not a presentation", sniffPresentation(sig(0x25, 0x50, 0x44, 0x46)) === null);
  check("a truncated file is not a presentation", sniffPresentation(new Uint8Array([0x50, 0x4b])) === null);

  // A token carrying no uid is nobody, however well signed it is. Nothing mints one
  // any more, but readSession is what stands between a forged cookie and the app.
  const secret = "s".repeat(32);
  const session = await createSession(secret, { uid: "u1", email: "a@example.com" });
  const uidless = await createToken({ gate: true }, secret, 60);

  check("an authentic token without a uid is not a session",
    (await verifySession(uidless, secret)) && (await readSession(uidless, secret)) === null);
  check("session reads back its uid", (await readSession(session, secret))?.uid === "u1");
  check("a tampered session is rejected",
    (await readSession(`${session.slice(0, -2)}aa`, secret)) === null);
  check("another secret cannot mint a session",
    (await readSession(session, "d".repeat(32))) === null);
  check("an expired session is rejected",
    (await readSession(await createToken({ uid: "u1" }, secret, -10), secret)) === null);

  check("Hebrew detected", detectLanguage("שלום עולם ".repeat(4)).lang === "he");
  check("Hebrew is rtl", detectLanguage("שלום עולם ".repeat(4)).dir === "rtl");
  check("Arabic detected", detectLanguage("مرحبا بالعالم ".repeat(4)).lang === "ar");
  check("English stays English", detectLanguage("Hello world, this is plain English text.").lang === "en");
  check("a few stray glyphs do not relabel",
    detectLanguage("Mostly English with שלום in it").lang === "en");
  check("empty input is safe", detectLanguage("").lang === "en" && detectLanguage(null).lang === "en");

  const bold = describeFont("ABCDEF+Arial-BoldMT");
  check("subset prefix stripped", bold.name === "Arial-BoldMT");
  check("bold weight detected", bold.weight === 700);
  check("known family mapped", bold.family.includes("Arial"));
  check("font families never use double quotes",
    ["Times-Roman", "MUFUZY+Alef-Regular", 'Weird"Name', "CMTT10", "NimbusRomNo9L-ReguItal"]
      .every((n) => !describeFont(n).family.includes('"')));
  check("italic detected", describeFont("X+Foo-ReguItal").style === "italic");
  check("monospace detected", describeFont("X+CMTT10").generic === "monospace");
  check("serif detected", describeFont("X+NimbusRomNo9L-Regu").generic === "serif");
}

// ───────────────────────────────────────────────────────────── react render
section("5. React output must compile and render");
{
  const doc = await openFixture("08-hebrew-doc.pdf");
  const r = await convert(doc, pdfjs, {
    formats: ["react"], background: false, maxPages: 2, componentName: "QaDoc",
  });
  await doc.destroy();

  const jsx = r.files["QaDoc.jsx"];
  const compiled = await transform(jsx, { loader: "jsx", jsx: "transform", jsxFactory: "h" })
    .then((res) => res.code).catch(() => null);
  check("JSX compiles", !!compiled);

  if (compiled) {
    // Execute the component with a tiny h() to confirm it renders a real tree rather
    // than merely parsing — a component that throws on render is not "working output".
    const calls = [];
    const h = (type, props, ...kids) => {
      calls.push(typeof type === "function" ? "fn" : type);
      const children = kids.flat();
      return typeof type === "function" ? type({ ...props, children }) : { type, props, children };
    };
    const body = compiled.replace(/^import .*$/gm, "").replace(/export default /, "return ");
    try {
      const factory = new Function("h", `${body}`);
      const Component = factory(h);
      const tree = Component({ scale: 1 });
      check("component renders a tree", !!tree && tree.type === "main");
      check("root carries dir", tree.props?.dir === "rtl", String(tree.props?.dir));
      check("root carries lang", tree.props?.lang === "he", String(tree.props?.lang));
      check("pages rendered", calls.filter((c) => c === "section").length === 2,
        `${calls.filter((c) => c === "section").length} sections`);
      check("scale uses transform not zoom",
        !jsx.includes("zoom:") && jsx.includes("transform: `scale("));
    } catch (err) {
      check("component renders a tree", false, err.message);
    }
  }
}

// ───────────────────────────────────────────────────────── raster format
section("6. Raster format must follow page content");
{
  const mk = (vector, images, runs) => ({ stats: { vector, images, total: 0 }, runs: new Array(runs).fill({}) });

  const photo = classifyPage(mk(0, 3, 2));
  check("a scan is photographic", photo.kind === "photographic", photo.kind);
  check("a scan uses JPEG", photo.format === "jpeg", photo.format);

  const mixed = classifyPage(mk(40, 1, 150));
  check("vector-plus-text is line art", mixed.kind === "lineArt", mixed.kind);
  // The bug this guards: JPEG here rings around every glyph and rule, which is exactly
  // the artefact an exact copy cannot have.
  check("line art uses PNG, never JPEG", mixed.format === "png", mixed.format);

  const rules = classifyPage(mk(3, 0, 60));
  check("a few rules still count as line art", rules.kind === "lineArt", rules.kind);

  const plain = classifyPage(mk(0, 0, 30));
  check("pure text needs no raster", plain.kind === "text", plain.kind);
}

// ──────────────────────────────────────────────────── secrets vs the client bundle
section("7. No server-only secret may reach the browser");
{
  // Anything named NEXT_PUBLIC_ is inlined into the bundle at build time. The check is
  // on the *name*, because that prefix is the whole of what decides it — a private key
  // does not become private again by being handled carefully afterwards.
  const SOURCE_DIRS = ["app", "src", "components", "lib", "scripts"];
  const SERVER_ONLY = ["src/lib/firebase/admin.ts", "src/lib/office-server.ts"];

  async function walk(dir) {
    const out = [];
    for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...await walk(rel));
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(rel);
    }
    return out;
  }

  const files = (await Promise.all(SOURCE_DIRS.map(walk))).flat();
  const sources = new Map();
  for (const file of files) sources.set(file, await readFile(join(ROOT, file), "utf8"));

  const publicSecrets = [];
  for (const [file, text] of sources) {
    for (const [, name] of text.matchAll(/NEXT_PUBLIC_([A-Z0-9_]+)/g)) {
      if (/SECRET|PRIVATE|SERVICE_ACCOUNT|ACCESS_CODE|CREDENTIAL/.test(name)) {
        publicSecrets.push(`${file}: NEXT_PUBLIC_${name}`);
      }
    }
  }
  check("no secret is named NEXT_PUBLIC_", publicSecrets.length === 0, publicSecrets[0]);

  // A "use client" file that imports the admin SDK ships a service account to the
  // browser. Direct imports only, which is the mistake that actually happens.
  const leaks = [];
  for (const [file, text] of sources) {
    if (!/^\s*["']use client["']/m.test(text)) continue;
    for (const server of SERVER_ONLY) {
      const bare = server.replace(/^src\//, "").replace(/\.ts$/, "");
      if (text.includes(server) || text.includes(bare)) leaks.push(`${file} imports ${server}`);
    }
  }
  check("no client component imports a server-only module", leaks.length === 0, leaks[0]);

  const env = await readFile(join(ROOT, ".env.example"), "utf8");
  check("the service account is documented without a NEXT_PUBLIC prefix",
    /^FIREBASE_SERVICE_ACCOUNT=/m.test(env) && !/NEXT_PUBLIC_FIREBASE_SERVICE/.test(env));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
