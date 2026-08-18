// Job state around a conversion.
//
// The UI should never drive pdf.js directly: it needs a job that can be started,
// watched and cancelled, and that reports failure as something explainable rather than
// an exception from three layers down.
//
// On threading — this deliberately runs in the page, not in a Web Worker. pdf.js already
// does its parsing in its own worker, so the expensive part is off the main thread
// regardless; what is left is rasterising (which needs a real canvas) and string
// building (which is fast). Putting the pdf.js *API* inside a second worker fails
// outright, because its font, canvas and filter factories all reach for `document`.
// Every await below yields to the event loop, so progress paints and the tab stays live.

import { zipSync, strToU8 } from "fflate";
import { convert, ConversionError } from "@/src/converter/index.ts";
import type { ConversionResult, ConvertOptions } from "@/src/converter/types.ts";
import { bytesFor, type PreparedDocument } from "./intake.ts";
import { loadPdfjs, openPdf, rasterizePage, PdfOpenError } from "./pdf-client.ts";

export type JobStatus = "idle" | "reading" | "processing" | "done" | "failed" | "cancelled";

export interface JobError {
  code: string;
  message: string;
}

export interface JobState {
  status: JobStatus;
  progress: number;
  message: string;
  result: ConversionResult | null;
  error: JobError | null;
}

export interface Job {
  readonly state: JobState;
  /**
   * Convert an already-prepared document.
   *
   * The job takes PDF bytes rather than a File because by this point a PowerPoint
   * source has already become a PDF — see src/lib/intake.ts. It keeps this module
   * knowing about exactly one format.
   */
  start(doc: PreparedDocument, options: ConvertOptions): Promise<void>;
  cancel(): void;
  reset(): void;
}

const PHASE_LABEL = {
  extract: "Reading page",
  render: "Rendering page",
  generate: "Building output",
} as const;

const FRIENDLY: Record<string, string> = {
  OUT_OF_MEMORY: "This document is too large for your browser to hold in memory. Try turning off “Keep graphics”, which is what consumes most of it.",
  UNKNOWN: "Something went wrong during conversion.",
};

export function createJob({ onChange }: { onChange: (state: JobState) => void }): Job {
  let state: JobState = {
    status: "idle", progress: 0, message: "", result: null, error: null,
  };
  let cancelled = false;
  let runId = 0;

  const set = (patch: Partial<JobState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  return {
    get state() { return state; },

    async start(source, options) {
      const id = ++runId;
      cancelled = false;
      set({ status: "reading", progress: 0, message: "Reading document…", result: null, error: null });

      // A late callback from a superseded or cancelled run must not touch the UI.
      const live = () => id === runId && !cancelled;

      // Its own copy: pdf.js detaches the buffer it is handed, and these bytes are
      // opened again by the preview and by any re-run.
      const data = bytesFor(source);

      try {
        const pdfjs = await loadPdfjs();
        const doc = await openPdf(data, pdfjs);
        if (!live()) { await doc.destroy(); return; }

        set({ status: "processing", progress: 0, message: "Starting…" });

        const result = await convert(doc, pdfjs, {
          ...options,
          rasterize: options.background ? rasterizePage : undefined,
          signal: { get aborted() { return cancelled || id !== runId; } },
          onProgress: ({ page, pages, phase }) => {
            if (!live()) return;
            // Weight generation as the final slice so the bar does not sit at 100%
            // while the document is still being assembled.
            const ratio = phase === "generate"
              ? 1
              : (page - 1 + (phase === "render" ? 0.5 : 0)) / pages;
            set({
              status: "processing",
              progress: Math.min(0.99, ratio * 0.95),
              message: phase === "generate"
                ? PHASE_LABEL.generate
                : `${PHASE_LABEL[phase]} ${page} of ${pages}`,
            });
          },
        });

        await doc.destroy();
        if (!live()) return;

        set({ status: "done", progress: 1, message: "Ready", result });
      } catch (err) {
        if (!live()) return;

        if (err instanceof ConversionError && err.code === "CANCELLED") {
          set({ status: "cancelled", message: "Cancelled", progress: 0 });
          return;
        }

        const message = err instanceof Error ? err.message : "";
        const code = err instanceof PdfOpenError || err instanceof ConversionError
          ? err.code
          : /out of memory|allocation/i.test(message) ? "OUT_OF_MEMORY" : "UNKNOWN";

        set({
          status: "failed",
          error: { code, message: FRIENDLY[code] ?? message ?? FRIENDLY.UNKNOWN! },
        });
      }
    },

    cancel() {
      cancelled = true;
      set({ status: "cancelled", message: "Cancelled", progress: 0 });
    },

    reset() {
      cancelled = true;
      runId++;
      set({ status: "idle", progress: 0, message: "", result: null, error: null });
    },
  };
}

/** Package the generated files into a ZIP, laid out the way the README describes. */
export function buildZip(result: ConversionResult, baseName: string): Blob {
  const tree: Record<string, Uint8Array> = {};

  for (const [name, contents] of Object.entries(result.files)) {
    const folder = name === "index.html" ? "html" : "react";
    tree[`${folder}/${name}`] = strToU8(contents);
  }

  tree["README.txt"] = strToU8(
    `${baseName}\n${"=".repeat(baseName.length)}\n\n` +
    `Converted ${result.info.converted} of ${result.info.pages} page(s).\n\n` +
    `html/index.html   Standalone page — open it in any browser.\n` +
    `react/            Drop-in React component. See react/README.md.\n\n` +
    (result.warnings.length
      ? `Notes\n-----\n${result.warnings.map((w) => `- ${w.message}`).join("\n")}\n`
      : ""),
  );

  return new Blob([zipSync(tree, { level: 6 })], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on a later tick — revoking synchronously races the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
