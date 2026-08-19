// A record that a conversion happened.
//
// Not the document, not the output, not a word of what was inside either. The whole
// point of the product is that a file never leaves the machine it was opened on, and
// that stays true — what is kept here is the sort of thing a receipt says.
//
// A project is a *document*, not an event. Converting the same deck every week would
// otherwise pile up identical rows; instead the row stays put and lastConvertedAt moves.
// That needs an identity, and only one source has a real one: a Slides deck lives in
// Drive and keeps its file id. A local file has nothing stable, so its name and size are
// recorded and compared when someone picks a file again.

import type { OutputFormat } from "@/src/converter/types.ts";
import type { SourceKind } from "./pricing.ts";

export interface Project {
  id: string;
  /** The document's name — or a generic string, when the account asked us not to keep it. */
  name: string;
  kind: SourceKind;
  /** Slides only. The one source that can be fetched again later. */
  driveFileId?: string;
  /** What the person selected, for matching the file if they pick it again. */
  sourceSize?: number;
  pages: number;
  formats: OutputFormat[];
  background: boolean;
  outputBytes: number;
  /** Epoch milliseconds, so the shape survives JSON without a Timestamp on either side. */
  createdAt: number;
  lastConvertedAt: number;
  runCount: number;
  archived: boolean;
}

/** What the browser sends when a conversion finishes. Everything else is decided server-side. */
export interface ProjectDraft {
  name: string;
  kind: SourceKind;
  driveFileId?: string;
  sourceSize?: number;
  pages: number;
  formats: OutputFormat[];
  background: boolean;
  outputBytes: number;
}

/** Stands in for a name we were asked not to keep. */
export const ANONYMOUS_NAME = "Document";

const FORMATS: OutputFormat[] = ["html", "react"];
const KINDS: SourceKind[] = ["pdf", "pptx", "slides"];

/**
 * Read a draft out of an untrusted body.
 *
 * Returns null rather than throwing on anything unexpected: this is a boundary, and the
 * caller's job is to answer 400, not to distinguish between the many ways a request can
 * be wrong.
 */
export function readDraft(body: unknown): ProjectDraft | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const kind = b.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as SourceKind)) return null;

  const name = typeof b.name === "string" ? b.name.trim().slice(0, 300) : "";
  if (!name) return null;

  const formats = Array.isArray(b.formats)
    ? b.formats.filter((f): f is OutputFormat => typeof f === "string" && FORMATS.includes(f as OutputFormat))
    : [];
  if (!formats.length) return null;

  const count = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

  const pages = count(b.pages);
  const outputBytes = count(b.outputBytes);
  if (pages === null || outputBytes === null) return null;

  const sourceSize = count(b.sourceSize);
  const driveFileId =
    typeof b.driveFileId === "string" && b.driveFileId.trim() ? b.driveFileId.trim().slice(0, 200) : undefined;

  return {
    name,
    kind: kind as SourceKind,
    // A file id on anything but a Slides deck is meaningless, and it is what upserts key
    // on — so it is dropped rather than trusted.
    driveFileId: kind === "slides" ? driveFileId : undefined,
    sourceSize: sourceSize ?? undefined,
    pages,
    formats,
    background: b.background === true,
    outputBytes,
  };
}

/** The month `usage` counts against, as Firestore stores it. */
export const usageMonth = (at: Date): string => at.toISOString().slice(0, 7);
