// Public conversion API.
//
// Isomorphic on purpose. Extraction and generation are pure and run anywhere; only
// background rasterisation needs a canvas, so it is injected by the caller rather than
// imported. In the browser the app passes a real canvas factory; in Node tests it
// passes nothing and gets text-only output.

import { extractPage, inspect } from "./extract.ts";
import { toHtml } from "./html.ts";
import { toReact } from "./react.ts";
import type {
  ConversionResult,
  ConversionWarning,
  ConvertOptions,
  DocumentInfo,
  PageModel,
  PdfDocumentProxy,
  PdfjsModule,
} from "./types.ts";

export { extractPage, inspect, toHtml, toReact };
export type * from "./types.ts";

export class ConversionError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ConversionError";
    this.code = code;
  }
}

const DEFAULTS = {
  formats: ["html"] as const,
  background: true,
  backgroundScale: 2,
  title: "Converted document",
  componentName: "PdfDocument",
  maxPages: 0,
};

/** Convert an already-opened pdf.js document. */
export async function convert(
  doc: PdfDocumentProxy,
  pdfjs: PdfjsModule,
  options: ConvertOptions = {},
): Promise<ConversionResult> {
  const opts = { ...DEFAULTS, ...options, formats: options.formats ?? [...DEFAULTS.formats] };
  const { rasterize, onProgress, signal } = opts;

  const info = await inspect(doc);
  const pageCount = opts.maxPages > 0 ? Math.min(doc.numPages, opts.maxPages) : doc.numPages;

  const pages: PageModel[] = [];
  const backgrounds: (string | null)[] = [];

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

  const files: Record<string, string> = {};
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
function buildWarnings(
  info: DocumentInfo,
  pages: PageModel[],
  backgrounds: (string | null)[],
  opts: { background: boolean; maxPages: number },
): ConversionWarning[] {
  const warnings: ConversionWarning[] = [];

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
