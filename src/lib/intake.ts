// Getting a document to the converter.
//
// The engine reads one thing: PDF bytes. Everything a user can bring — a PDF, a
// PowerPoint file, a Google Slides deck — arrives here and leaves as those bytes, so
// nothing downstream has to know where the document came from.
//
// The three routes are not equivalent, and the difference is a privacy one rather than
// a technical one:
//
//   pdf     read locally. Never leaves the machine.
//   slides  exported by Google straight to this tab. Never touches our server.
//   pptx    sent to our server, converted by LibreOffice, deleted immediately.
//
// Only the third involves an upload, which is why prepare() reports the route it took —
// the interface says so plainly rather than letting the user assume.

import { baseNameOf, detectKind, type SourceKind } from "./pricing.ts";

export interface PreparedDocument {
  kind: SourceKind;
  /** The name the user knows the document by. */
  name: string;
  /** That name without its extension — used for the title, the component and the ZIP. */
  baseName: string;
  /** PDF bytes. For a PDF source, the file's own. */
  bytes: Uint8Array;
  /** Size of what the user selected, which is not the size of `bytes` for a PPTX. */
  sourceSize: number;
  /** True when the bytes passed through our server to get here. */
  uploaded: boolean;
}

export class IntakeError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "IntakeError";
    this.code = code;
  }
}

export type IntakeStage = "reading" | "uploading" | "importing";

interface PrepareOptions {
  onStage?: (stage: IntakeStage) => void;
  signal?: AbortSignal;
}

/**
 * A fresh copy of a prepared document's bytes.
 *
 * pdf.js transfers the buffer it is given to its worker, which detaches it — the
 * second reader would find an empty array. Since a document is opened more than once
 * (probe, conversion, preview), every reader gets its own copy.
 */
export const bytesFor = (doc: PreparedDocument): Uint8Array => new Uint8Array(doc.bytes);

/**
 * Adopt a deck Google exported for us.
 *
 * It arrives already converted, so there is nothing to prepare — but it still becomes a
 * PreparedDocument, because everything downstream should keep seeing one shape.
 */
export function fromSlides(name: string, bytes: Uint8Array): PreparedDocument {
  return {
    kind: "slides",
    name,
    baseName: baseNameOf(name) || "presentation",
    bytes,
    sourceSize: bytes.length,
    uploaded: false,
  };
}

/** Turn whatever the user picked into PDF bytes the converter can open. */
export async function prepare(file: File, options: PrepareOptions = {}): Promise<PreparedDocument> {
  const { onStage, signal } = options;
  const kind = detectKind(file);
  if (!kind) throw new IntakeError(`“${file.name}” is not a PDF or a PowerPoint file.`, "UNSUPPORTED");

  onStage?.("reading");
  const source = new Uint8Array(await file.arrayBuffer());

  const base = {
    name: file.name,
    baseName: baseNameOf(file.name) || "document",
    sourceSize: file.size,
  };

  if (kind === "pdf") {
    return { ...base, kind, bytes: source, uploaded: false };
  }

  onStage?.("uploading");
  return { ...base, kind, bytes: await convertPresentation(source, signal), uploaded: true };
}

/** Hand a presentation to the server and take back a PDF. */
async function convertPresentation(source: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch("/api/presentation", {
      method: "POST",
      // A raw body, not a form: there is exactly one field, and multipart would only
      // add a parser between the file and LibreOffice.
      headers: { "Content-Type": "application/octet-stream" },
      // .buffer, not the view: BodyInit's ArrayBufferView case is pinned to ArrayBuffer.
      // These bytes were copied out of the file, so the buffer holds exactly them.
      body: source.buffer as ArrayBuffer,
      signal: signal ?? null,
    });
  } catch (err) {
    if (signal?.aborted) throw new IntakeError("Cancelled", "CANCELLED");
    throw new IntakeError(
      "The presentation could not be sent for conversion. Check your connection and try again.",
      "NETWORK",
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    throw new IntakeError(
      body?.message ?? "This presentation could not be converted.",
      body?.code ?? `HTTP_${response.status}`,
    );
  }

  const pdf = new Uint8Array(await response.arrayBuffer());
  if (!pdf.length) throw new IntakeError("The converted presentation came back empty.", "EMPTY");
  return pdf;
}
