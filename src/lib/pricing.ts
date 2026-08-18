// Pricing tiers.
//
// Shared by the UI (to quote before upload) and, later, by the server that creates the
// checkout session. The server must recompute from its own page count rather than trust
// a number posted by the browser — this module exists so both sides use one table.

export const CURRENCY = "USD";

export interface Tier {
  upTo: number;
  price: number;
  label: string;
}

export interface Quote {
  price: number;
  label: string;
  tier: string;
}

export const TIERS: Tier[] = [
  { upTo: 5, price: 4.99, label: "1–5 pages" },
  { upTo: 20, price: 9.99, label: "6–20 pages" },
  { upTo: 50, price: 19.99, label: "21–50 pages" },
];

export const OVERAGE = { from: 50, base: 19.99, perPage: 0.35 };

export const MAX_PAGES = 300;
export const MAX_BYTES = 25 * 1024 * 1024;

export function quote(pages: number | undefined | null): Quote {
  const n = Math.max(1, Math.floor(pages || 0));

  const tier = TIERS.find((t) => n <= t.upTo);
  if (tier) return { price: tier.price, label: tier.label, tier: tier.label };

  const extra = n - OVERAGE.from;
  const price = Math.round((OVERAGE.base + extra * OVERAGE.perPage) * 100) / 100;
  return { price, label: `${n} pages`, tier: "50+ pages" };
}

export const formatPrice = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY }).format(n);

/**
 * What a source document can be.
 *
 * `pdf` converts in the browser and never leaves the machine. `pptx` cannot: there is
 * no PowerPoint renderer for the browser, so it goes to the server to become a PDF
 * first. `slides` never was a local file — Google exports it straight to the tab. See
 * src/lib/intake.ts, which is where those differences are made explicit.
 *
 * Only the first two are things a file picker can offer, which is why KINDS below
 * describes them and not `slides`.
 */
export type SourceKind = "pdf" | "pptx" | "slides";

interface KindSpec {
  kind: SourceKind;
  /** Extensions, written the way a file picker's `accept` wants them. */
  exts: string[];
  mime: string[];
}

const KINDS: KindSpec[] = [
  { kind: "pdf", exts: [".pdf"], mime: ["application/pdf"] },
  {
    kind: "pptx",
    exts: [".pptx", ".ppt"],
    mime: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint",
    ],
  },
];

/**
 * Classify a file by what it claims to be.
 *
 * A name and a MIME type are the only things available before reading the bytes, and
 * both are claims — this decides which *pipeline* to offer, never whether the content
 * is safe. The bytes are sniffed again where they are actually parsed.
 */
export function detectKind(file: { name?: string; type?: string } | null | undefined): SourceKind | null {
  if (!file) return null;
  const name = file.name ?? "";
  const type = file.type ?? "";
  // lastIndexOf returns -1 for a name with no dot at all, and slice(-1) would then
  // hand back its final character as if it were an extension.
  const dot = name.lastIndexOf(".");
  const ext = dot < 0 ? "" : name.slice(dot).toLowerCase();
  return KINDS.find((k) => k.exts.includes(ext) || (!!type && k.mime.includes(type)))?.kind ?? null;
}

/** Every extension and MIME type the file pickers should offer. */
export const ACCEPT_ATTRIBUTE = KINDS.flatMap((k) => [...k.mime, ...k.exts]).join(",");

/** Strip a known source extension, leaving something usable as a title. */
export const baseNameOf = (name: string): string => name.replace(/\.(pdf|pptx|ppt)$/i, "");

/** Every source extension, for messages that need to list them. */
export const SOURCE_EXTENSIONS = KINDS.flatMap((k) => k.exts);

/** Reject files we cannot serve before the user pays for them. @returns a message, or null when the file is fine. */
export function validateFile(file: File | null | undefined): string | null {
  if (!file) return "Choose a PDF or a PowerPoint file to convert.";
  if (!detectKind(file)) return `“${file.name}” is not a PDF or a PowerPoint file.`;
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > MAX_BYTES) {
    return `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}
