// Minimal PDF writer, for QA fixtures we cannot download.
//
// Two things the public corpora do not give us: a document whose *text* is hostile
// (script tags, quote characters, entity sequences), and one long enough to stress the
// pipeline. Both matter, so we generate them.

const ESC = { "\\": "\\\\", "(": "\\(", ")": "\\)" };

/** PDF string literals are delimited by parentheses, so those and backslash must escape. */
const pdfString = (s) => String(s).replace(/[\\()]/g, (c) => ESC[c]);

/**
 * @param {string[][]} pages  one array of text lines per page
 * @returns {Uint8Array}
 */
export function makePdf(pages) {
  const objects = [];
  const push = (body) => objects.push(body) && objects.length;

  // Reserve 1 = catalog, 2 = page tree; page and content objects follow.
  const catalogId = 1;
  const pagesId = 2;
  objects.push(null, null);

  const fontId = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const pageIds = [];
  for (const lines of pages) {
    const ops = [
      "BT",
      "/F1 14 Tf",
      "1 0 0 1 56 736 Tm",
      "17 TL",
      ...lines.map((line) => `(${pdfString(line)}) Tj T*`),
      "ET",
    ].join("\n");

    const contentId = push(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    const pageId = push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  // Serialise, recording each object's byte offset for the xref table.
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    out += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  out += `startxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(out);
}

/** Text designed to break naive HTML generation. */
export const HOSTILE_LINES = [
  "<script>window.__pwned = true;</script>",
  "<img src=x onerror=\"window.__pwned2=true\">",
  "</span><script>alert(1)</script><span>",
  "\" onmouseover=\"window.__pwned3=true\" x=\"",
  "' onfocus='window.__pwned4=true' y='",
  "&lt;already escaped&gt; &amp; &quot;entities&quot;",
  "</style></head><body><h1>injected</h1>",
  "javascript:alert(document.domain)",
  "{{ template }} ${literal} `backtick`",
];

// CLI: node scripts/make-test-pdf.mjs <out.pdf> [pageCount]
// pathToFileURL, not string surgery — a Windows path yields file:///C:/… with three
// slashes, so a hand-built "file://" + path never matches and the CLI silently no-ops.
const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { writeFile } = await import("node:fs/promises");
  const [target, count] = process.argv.slice(2);
  if (!target) {
    console.error("usage: node scripts/make-test-pdf.mjs <out.pdf> [pageCount]");
    process.exit(1);
  }

  const pageCount = Number(count) || 1;
  const pages = pageCount > 1
    ? Array.from({ length: pageCount }, (_, i) => [
        `Page ${i + 1} of ${pageCount}`,
        "The quick brown fox jumps over the lazy dog.",
        ...Array.from({ length: 28 }, (_, n) => `Line ${n + 1}: filler text for load testing.`),
      ])
    : [HOSTILE_LINES];

  await writeFile(target, makePdf(pages));
  console.log(`wrote ${target} (${pageCount} page${pageCount === 1 ? "" : "s"})`);
}
