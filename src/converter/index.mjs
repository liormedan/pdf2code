// Public conversion API.
//
// Isomorphic on purpose. Extraction and generation are pure and run anywhere; only
// background rasterisation needs a canvas, so it is injected by the caller rather than
// imported. In the browser the app passes a real canvas factory; in Node tests it
// passes nothing and gets text-only output.

import { extractPage, inspect } from "./extract.mjs";
import { toHtml } from "./html.mjs";
import { toReact } from "./react.mjs";

export { extractPage, inspect, toHtml, toReact };

export class ConversionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ConversionError";
    this.code = code;
  }
}

const DEFAULTS = {
  formats: ["html"],       // any of "html", "react"
  background: true,        // rasterise non-text content
  backgroundScale: 2,      // raster resolution multiplier
  title: "Converted document",
  componentName: "PdfDocument",
  maxPages: 0,             // 0 = no limit
};

/**
 * Convert an already-opened pdf.js document.
 *
 * @param {object} doc            PDFDocumentProxy
 * @param {object} pdfjs          the pdf.js module (for Util/OPS)
 * @param {object} [options]
 * @param {(page, scale) => Promise<string|null>} [options.rasterize]
 *        Renders a page to a data: URI. Omit for text-only output.
 * @param {(p: {page:number, pages:number, phase:string}) => void} [options.onProgress]
 */
export async function convert(doc, pdfjs, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const { rasterize, onProgress, signal } = opts;

  const info = await inspect(doc);
  const pageCount = opts.maxPages > 0 ? Math.min(doc.numPages, opts.maxPages) : doc.numPages;

  const pages = [];
  const backgrounds = [];

  for (let n = 1; n <= pageCount; n++) {
    if (signal?.aborted) throw new ConversionError("Conversion cancelled", "CANCELLED");
    onProgress?.({ page: n, pages: pageCount, phase: "extract" });

    const page = await doc.getPage(n);
    const model = await extractPage(page, pdfjs);
    pages.push(model);

    // Rasterise only where it earns its bytes: a page that is pure text reconstructs
    // perfectly as markup, and a background image there is dead weight.
    const worthRastering = model.stats.vector > 4 || model.stats.images > 0 || model.runs.length === 0;

    if (opts.background && rasterize && worthRastering) {
      onProgress?.({ page: n, pages: pageCount, phase: "render" });
      try {
        backgrounds.push(await rasterize(page, opts.backgroundScale));
      } catch {
        // A failed raster degrades to text-only for that page rather than killing the job.
        backgrounds.push(null);
      }
    } else {
      backgrounds.push(null);
    }

    page.cleanup();
  }

  onProgress?.({ page: pageCount, pages: pageCount, phase: "generate" });

  const files = {};
  if (opts.formats.includes("html")) {
    files["index.html"] = toHtml(pages, {
      title: info.title || opts.title,
      backgrounds,
      lang: info.lang,
      dir: info.dir,
    });
  }
  if (opts.formats.includes("react")) {
    Object.assign(files, toReact(pages, {
      backgrounds,
      componentName: opts.componentName,
      lang: info.lang,
      dir: info.dir,
    }));
  }

  return {
    info: { ...info, converted: pageCount },
    pages,
    // Kept alongside the finished files so a caller can re-render any single page —
    // which is what the preview does, rather than approximating the output.
    backgrounds,
    files,
    warnings: buildWarnings(info, pages, backgrounds, opts),
  };
}

/**
 * Warnings carry a code and its parameters, not a sentence.
 *
 * The converter has no idea what language the person reading it speaks — and it runs
 * in Node tests where there is no locale at all. So it reports *what happened* and the
 * interface decides how to say it. `message` stays as an English fallback for callers
 * without a translator, such as the CLI test scripts.
 */
function buildWarnings(info, pages, backgrounds, opts) {
  const warnings = [];

  if (info.scanned) {
    warnings.push({
      code: "SCANNED",
      params: {},
      message: "This PDF has no text layer — it is a scan. The output keeps the page images, but the text will not be selectable or searchable without OCR.",
    });
  }

  const droppedGraphics = pages.filter((p, i) =>
    !backgrounds[i] && (p.stats.vector > 4 || p.stats.images > 0)).length;

  if (droppedGraphics && !opts.background) {
    warnings.push({
      code: "GRAPHICS_DROPPED",
      params: { count: droppedGraphics },
      message: `${droppedGraphics} page${droppedGraphics === 1 ? "" : "s"} contain graphics that text-only output cannot reproduce. Turn on "Keep graphics" to keep them.`,
    });
  }

  if (info.pages > (opts.maxPages || Infinity)) {
    warnings.push({
      code: "TRUNCATED",
      params: { limit: opts.maxPages, total: info.pages },
      message: `Only the first ${opts.maxPages} of ${info.pages} pages were converted.`,
    });
  }

  return warnings;
}
