// Browser-side pdf.js setup.
//
// Everything here is client-only: the whole point of the architecture is that the file
// never leaves the user's machine, so there is no server counterpart to this module.

import type { PdfDocumentProxy, PdfjsModule, PdfPageProxy } from "@/src/converter/types.ts";

/** The pdf.js module plus the entry points only the browser side uses. */
export interface PdfjsBrowserModule extends PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocumentProxy> };
}

let pdfjsPromise: Promise<PdfjsBrowserModule> | null = null;

/** Load pdf.js once and point it at its worker and font data. */
export async function loadPdfjs(): Promise<PdfjsBrowserModule> {
  pdfjsPromise ??= (async () => {
    // The deep build path is the entry the browser needs, and it ships no declarations
    // of its own — see types/pdfjs-dist.d.ts, where it is declared against our shapes.
    const pdfjs = (await import("pdfjs-dist/build/pdf.mjs")) as unknown as PdfjsBrowserModule;
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
    return pdfjs;
  })();
  return pdfjsPromise;
}

export const PDF_ASSETS = {
  standardFontDataUrl: "/standard_fonts/",
  cMapUrl: "/cmaps/",
  cMapPacked: true,
} as const;

export class PdfOpenError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "PdfOpenError";
    this.code = code;
  }
}

/**
 * Open a PDF from raw bytes, translating pdf.js's exceptions into messages that tell
 * the user what went wrong and what they can do about it.
 */
export async function openPdf(
  bytes: Uint8Array,
  pdfjs: PdfjsBrowserModule,
): Promise<PdfDocumentProxy> {
  try {
    return await pdfjs.getDocument({ data: bytes, ...PDF_ASSETS }).promise;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") {
      throw new PdfOpenError(
        "This PDF is password protected. Remove the password and try again.",
        "ENCRYPTED",
      );
    }
    if (name === "InvalidPDFException") {
      throw new PdfOpenError(
        "This file is not a readable PDF — it may be corrupt or only partly downloaded.",
        "CORRUPT",
      );
    }
    throw new PdfOpenError(
      err instanceof Error ? err.message : "The PDF could not be opened.",
      "UNKNOWN",
    );
  }
}

/**
 * Render a page to a data: URI for use as the background layer.
 * JPEG keeps output small on photographic pages; PNG would balloon a 30-page document.
 */
export async function rasterizePage(page: PdfPageProxy, scale = 2): Promise<string | null> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  const url = canvas.toDataURL("image/jpeg", 0.82);
  // Free the backing store immediately — a 30-page document otherwise holds every
  // canvas alive until GC decides otherwise, which is how these tabs run out of memory.
  canvas.width = canvas.height = 0;
  return url;
}
