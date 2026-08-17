// Pricing tiers.
//
// Shared by the UI (to quote before upload) and, later, by the server that creates the
// checkout session. The server must recompute from its own page count rather than trust
// a number posted by the browser — this module exists so both sides use one table.

export const CURRENCY = "USD";

export const TIERS = [
  { upTo: 5, price: 4.99, label: "1–5 pages" },
  { upTo: 20, price: 9.99, label: "6–20 pages" },
  { upTo: 50, price: 19.99, label: "21–50 pages" },
];

export const OVERAGE = { from: 50, base: 19.99, perPage: 0.35 };

export const MAX_PAGES = 300;
export const MAX_BYTES = 25 * 1024 * 1024;

/** @returns {{ price: number, label: string, tier: string }} */
export function quote(pages) {
  const n = Math.max(1, Math.floor(pages || 0));

  const tier = TIERS.find((t) => n <= t.upTo);
  if (tier) return { price: tier.price, label: tier.label, tier: tier.label };

  const extra = n - OVERAGE.from;
  const price = Math.round((OVERAGE.base + extra * OVERAGE.perPage) * 100) / 100;
  return { price, label: `${n} pages`, tier: "50+ pages" };
}

export const formatPrice = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY }).format(n);

/** Reject files we cannot serve before the user pays for them. */
export function validateFile(file) {
  if (!file) return "Choose a PDF to convert.";
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return `“${file.name}” is not a PDF.`;
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > MAX_BYTES) {
    return `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}
