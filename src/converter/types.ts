// The conversion domain model.
//
// Everything downstream — the HTML generator, the React generator, the preview, the
// test suites — consumes these shapes, so they are declared once here rather than
// re-described at each boundary.

/** A run of glyphs sharing one font and one transform, positioned in CSS pixels. */
export interface TextRun {
  text: string;
  /** Left edge at scale 1. */
  x: number;
  /** Top edge at scale 1. */
  y: number;
  /** Advance width reported by pdf.js. */
  width: number;
  /** Font size in pixels. */
  size: number;
  /** Rotation in radians; 0 for the overwhelming majority of runs. */
  angle: number;
  /** Key into the page's font table. */
  font: string;
  /** Whether the run contains right-to-left script. */
  rtl: boolean;
}

/** A font resolved to something a browser can actually render. */
export interface FontDescription {
  /** Ready-to-use CSS stack, e.g. `'Alef', sans-serif`. Single-quoted deliberately. */
  family: string;
  weight: number;
  style: "normal" | "italic";
  /** The generic the stack falls back to. */
  generic: string;
  /** The embedded name with its subset prefix stripped, e.g. `Alef-Regular`. */
  name: string;
  vertical?: boolean;
  ascent?: number;
  descent?: number;
}

/** How much of a page is painted rather than typed — decides whether it needs a raster. */
export interface PageStats {
  vector: number;
  images: number;
  total: number;
}

export interface PageModel {
  number: number;
  width: number;
  height: number;
  runs: TextRun[];
  fonts: Record<string, FontDescription>;
  stats: PageStats;
}

export type Direction = "ltr" | "rtl";

export interface DocumentInfo {
  pages: number;
  title: string;
  producer: string;
  /** No text layer on the sampled pages — the output will not be searchable. */
  scanned: boolean;
  hasRTL: boolean;
  lang: string;
  dir: Direction;
}

export type WarningCode =
  | "SCANNED"
  | "GRAPHICS_DROPPED"
  | "TRUNCATED"
  | "NO_OFFSCREEN_CANVAS";

/**
 * Warnings carry a code and its parameters, not a sentence: the converter also runs in
 * Node tests where there is no locale, so the interface decides the wording. `message`
 * is an English fallback for callers without a translator.
 */
export interface ConversionWarning {
  code: WarningCode;
  params: Record<string, string | number>;
  message: string;
}

export type OutputFormat = "html" | "react";

export interface ConvertOptions {
  formats?: OutputFormat[];
  /** Rasterise non-text content into a background layer. */
  background?: boolean;
  /** Resolution multiplier for the raster. */
  backgroundScale?: number;
  title?: string;
  componentName?: string;
  /** 0 means no limit. */
  maxPages?: number;
  /** Renders a page to a data: URI. Omit for text-only output. */
  rasterize?: (page: PdfPageProxy, scale: number) => Promise<string | null>;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: { readonly aborted: boolean };
}

export interface ConversionProgress {
  page: number;
  pages: number;
  phase: "extract" | "render" | "generate";
}

export interface ConversionResult {
  info: DocumentInfo & { converted: number };
  pages: PageModel[];
  /** Per-page background data URIs, aligned with `pages`. */
  backgrounds: (string | null)[];
  /** Filename to contents. */
  files: Record<string, string>;
  warnings: ConversionWarning[];
}

// pdf.js ships its own types, but importing them here would pull the browser build
// into Node-only modules. These are the surfaces this code actually touches.

export interface PdfPageProxy {
  pageNumber: number;
  getViewport(params: { scale: number }): { width: number; height: number; transform: number[] };
  getTextContent(): Promise<{ items: PdfTextItem[]; styles: Record<string, PdfTextStyle> }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  commonObjs: { get(name: string): { name?: string; data?: Uint8Array } | null };
  render(params: Record<string, unknown>): { promise: Promise<void> };
  cleanup(): void;
}

export interface PdfTextItem {
  str?: string;
  transform: number[];
  width?: number;
  height?: number;
  fontName: string;
}

export interface PdfTextStyle {
  fontFamily?: string;
  ascent?: number;
  descent?: number;
  vertical?: boolean;
}

export interface PdfDocumentProxy {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
  getMetadata(): Promise<{ info?: Record<string, string> }>;
  destroy(): Promise<void>;
}

/** The subset of the pdf.js module object the converter needs. */
export interface PdfjsModule {
  Util: { transform(a: number[], b: number[]): number[] };
  OPS: Record<string, number>;
}
