// Browser-side pdf.js setup.
//
// Everything here is client-only: the whole point of the architecture is that the file
// never leaves the user's machine, so there is no server counterpart to this module.

let pdfjsPromise = null;

/** Load pdf.js once and point it at its worker and font data. */
export async function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
    return pdfjs;
  })();
  return pdfjsPromise;
}

export const PDF_ASSETS = {
  standardFontDataUrl: "/standard_fonts/",
  cMapUrl: "/cmaps/",
  cMapPacked: true,
};

export class PdfOpenError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PdfOpenError";
    this.code = code;
  }
}

/**
 * Open a PDF from raw bytes, translating pdf.js's exceptions into messages that tell
 * the user what went wrong and what they can do about it.
 */
export async function openPdf(bytes, pdfjs) {
  try {
    return await pdfjs.getDocument({ data: bytes, ...PDF_ASSETS }).promise;
  } catch (err) {
    const name = err?.name ?? "";
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
    throw new PdfOpenError(err?.message || "The PDF could not be opened.", "UNKNOWN");
  }
}

/**
 * Render a page to a data: URI for use as the background layer.
 * JPEG keeps output small on photographic pages; PNG would balloon a 30-page document.
 */
export async function rasterizePage(page, scale = 2) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  const url = canvas.toDataURL("image/jpeg", 0.82);
  // Free the backing store immediately — a 30-page document otherwise holds every
  // canvas alive until GC decides otherwise, which is how these tabs run out of memory.
  canvas.width = canvas.height = 0;
  return url;
}
