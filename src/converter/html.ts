// Page model -> standalone HTML.
//
// The analysis in Sprint 0 settled the shape: 2 of 5 test documents were graphics-
// dominant, where a text-only reconstruction loses the page entirely, while the rest
// reconstruct cleanly. So each page is two stacked layers — a raster carrying every
// vector path, image and rule, and real positioned markup carrying the text.
//
// Text stays selectable, searchable, translatable and editable; visuals stay exact.
// Callers that want clean markup instead of pixel fidelity omit the background.

import type { Direction, FontDescription, PageModel } from "./types.ts";

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, (c) => ESCAPE[c] ?? c);

/** One page as a positioned block. `background` is an optional data: URI. */
export function pageToHtml(
  page: PageModel,
  { background = null, indent = "  " }: { background?: string | null; indent?: string } = {},
): string {
  const lines = [];
  const pad = indent.repeat(2);

  lines.push(`${indent}<section class="pdf-page" style="width:${page.width}px;height:${page.height}px" data-page="${page.number}">`);

  if (background) {
    lines.push(`${pad}<img class="pdf-bg" src="${background}" alt="" width="${page.width}" height="${page.height}">`);
  }

  for (const run of page.runs) {
    // A run can name a font the style table never described; the stack degrades to the
    // browser default rather than the generator failing.
    const f: FontDescription | undefined = page.fonts[run.font];
    const style = [
      `left:${run.x}px`,
      `top:${run.y}px`,
      `font-size:${run.size}px`,
      f?.family ? `font-family:${f.family}` : "",
      f?.weight && f.weight !== 400 ? `font-weight:${f.weight}` : "",
      f?.style === "italic" ? "font-style:italic" : "",
      run.angle ? `transform:rotate(${run.angle}rad)` : "",
    ].filter(Boolean).join(";");

    // Per-run direction is what keeps Hebrew and Arabic readable without us
    // reordering anything ourselves — the browser resolves bidi from here.
    const runDir = run.rtl ? ' dir="rtl"' : "";
    // esc() on the style too: font families are quoted, and an unescaped quote here
    // would terminate the attribute and corrupt the whole document.
    lines.push(`${pad}<span style="${esc(style)}"${runDir}>${esc(run.text)}</span>`);
  }

  lines.push(`${indent}</section>`);
  return lines.join("\n");
}

export const PAGE_CSS = `.pdf-doc {
  --page-gap: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--page-gap);
  margin: 0;
  padding: var(--page-gap);
  background: #525659;
}
.pdf-page {
  position: relative;
  flex: none;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
  transform-origin: 0 0;
}
.pdf-page > span {
  position: absolute;
  white-space: pre;
  transform-origin: 0 0;
  line-height: 1;
  color: #000;
}
.pdf-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  user-select: none;
  pointer-events: none;
}
/* The raster already shows the glyphs; the text layer sits on top only so it can be
   selected, searched and read by assistive tech. Without a background it must show. */
.pdf-doc[data-background="true"] .pdf-page > span {
  color: transparent;
}
.pdf-doc[data-background="true"] .pdf-page > span::selection {
  background: rgb(0 102 204 / 0.35);
}
@media print {
  .pdf-doc { background: none; padding: 0; gap: 0; }
  .pdf-page { box-shadow: none; page-break-after: always; }
}`;

/** Full standalone document. */
export interface HtmlOptions {
  title?: string;
  backgrounds?: (string | null)[];
  responsive?: boolean;
  lang?: string;
  dir?: Direction;
  /**
   * Drop the viewer chrome — the dark surround, the page gap and the drop shadow —
   * and let a single page fill the viewport exactly.
   *
   * The default styling exists for someone opening the file directly, where a page
   * floating on a grey ground reads as a document. Rendered into a frame already sized
   * to the page, that same ground becomes a grey band across the top and shifts the
   * content out of alignment with whatever it is being compared against.
   */
  bare?: boolean;
}

export function toHtml(pages: PageModel[], {
  title = "Converted document",
  backgrounds = [],
  responsive = true,
  lang = "en",
  dir = "ltr",
  bare = false,
}: HtmlOptions = {}): string {
  const hasBg = backgrounds.some(Boolean);

  const body = pages
    .map((p, i) => pageToHtml(p, { background: backgrounds[i] ?? null }))
    .join("\n");

  // Pages are laid out at their true pixel size; on narrow screens we scale the whole
  // stack down rather than reflowing, because reflowing a fixed layout destroys it.
  const responsiveScript = responsive ? `
<script>
(function () {
  var doc = document.querySelector('.pdf-doc');
  if (!doc) return;
  function fit() {
    var pad = 48;
    var natural = Math.max.apply(null, [].map.call(
      doc.querySelectorAll('.pdf-page'), function (p) { return p.offsetWidth; }));
    if (!natural) return;
    var scale = Math.min(1, (doc.clientWidth - pad) / natural);
    [].forEach.call(doc.querySelectorAll('.pdf-page'), function (p) {
      p.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
      p.style.marginBottom = scale < 1 ? (p.offsetHeight * (scale - 1)) + 'px' : '';
      p.style.marginRight = scale < 1 ? (p.offsetWidth * (scale - 1)) + 'px' : '';
    });
  }
  addEventListener('resize', fit);
  fit();
})();
</script>` : "";

  return `<!DOCTYPE html>
<html lang="${esc(lang)}" dir="${esc(dir)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
html, body { margin: 0; padding: 0; }
${PAGE_CSS}${bare ? `
/* Chrome removed: the page is the whole viewport. */
.pdf-doc { padding: 0; gap: 0; background: none; }
.pdf-page { box-shadow: none; }` : ""}
</style>
</head>
<body>
<main class="pdf-doc" data-background="${hasBg}">
${body}
</main>${responsiveScript}
</body>
</html>
`;
}
