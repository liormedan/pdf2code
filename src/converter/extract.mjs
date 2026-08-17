// PDF page -> plain structured model.
//
// Deliberately free of DOM and of pdf.js rendering: the model is JSON, so the same
// extraction runs in Node (for tests) and in the browser (for the real product), and
// every downstream generator — HTML, React — consumes the same shape.

import { resolvePageFonts } from "./fonts.mjs";
import { detectLanguage } from "./language.mjs";

const RTL_SCRIPT = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

/**
 * @typedef {object} TextRun
 * @property {string} text
 * @property {number} x      left edge, CSS px at scale 1
 * @property {number} y      top edge, CSS px at scale 1
 * @property {number} width  advance width
 * @property {number} size   font size in px
 * @property {number} angle  rotation in radians (0 for the overwhelming majority)
 * @property {string} font   key into the page's font table
 * @property {boolean} rtl
 */

/**
 * Extract one page into a renderer-agnostic model.
 * @param {import("pdfjs-dist").PDFPageProxy} page
 * @param {{ Util: any }} pdfjs the module object, for its transform helper
 */
export async function extractPage(page, pdfjs) {
  // getOperatorList is not optional: it is what loads embedded fonts into commonObjs,
  // and without it every typeface degrades to a generic family.
  const [textContent, ops] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ]);

  const viewport = page.getViewport({ scale: 1 });
  const fontTable = resolvePageFonts(page, textContent.styles);

  const runs = [];
  for (const item of textContent.items) {
    if (!item.str) continue;

    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (size <= 0) continue;

    // Blank runs still carry layout meaning in tables, but empty ones are noise.
    if (!item.str.trim() && item.width === 0) continue;

    runs.push({
      text: item.str,
      x: round(tx[4]),
      y: round(tx[5] - size),
      width: round(item.width ?? 0),
      size: round(size),
      angle: tx[1] === 0 && tx[2] === 0 ? 0 : round(Math.atan2(tx[1], tx[0]), 4),
      font: item.fontName,
      rtl: RTL_SCRIPT.test(item.str),
    });
  }

  return {
    number: page.pageNumber,
    width: round(viewport.width),
    height: round(viewport.height),
    runs,
    fonts: Object.fromEntries(fontTable),
    // Kept so callers can decide whether a page needs the raster layer at all.
    stats: countPaintOps(ops, pdfjs),
  };
}

function countPaintOps(ops, pdfjs) {
  const { OPS } = pdfjs;
  const vectorOps = new Set([OPS.fill, OPS.stroke, OPS.eoFill, OPS.fillStroke,
    OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.closeStroke,
    OPS.shadingFill]);
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject, OPS.paintJpegXObject]);

  let vector = 0, images = 0;
  for (const fn of ops.fnArray) {
    if (vectorOps.has(fn)) vector++;
    else if (imageOps.has(fn)) images++;
  }
  return { vector, images, total: ops.fnArray.length };
}

/** Whole-document metadata, gathered before any page work. */
export async function inspect(doc) {
  const meta = await doc.getMetadata().catch(() => null);

  // Sample a few pages rather than only the first: title pages are often a logo and
  // three words, which is far too little to judge the document's language on.
  let sample = "";
  for (let n = 1; n <= Math.min(doc.numPages, 3); n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    sample += items.map((i) => i.str ?? "").join(" ");
    page.cleanup();
  }

  const { lang, dir } = detectLanguage(sample);

  return {
    pages: doc.numPages,
    title: meta?.info?.Title || "",
    producer: meta?.info?.Producer || "",
    // A page with no text is a scan; the raster layer will carry it, but the text
    // layer will be empty and the output will not be searchable without OCR.
    scanned: sample.trim().length < 30,
    hasRTL: RTL_SCRIPT.test(sample),
    lang,
    dir,
  };
}

function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
