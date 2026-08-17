// Recovering typography from a PDF.
//
// pdf.js exposes two names per font. getTextContent() gives a CSS *guess* that is almost
// always a bare generic ("sans-serif") and throws the real typeface away. commonObjs
// carries the actual embedded name — "MUFUZY+Alef-Regular", "NimbusRomNo9L-MediItal" —
// once the operator list has been built. We use the latter and map it to a real stack.

const SUBSET_PREFIX = /^[A-Z]{6}\+/;

// Substring signals, most specific first — "CMTT" must beat "CM".
const SERIF = /times|nimbusrom|cmr|cmbx|cmti|georgia|garamond|book|minion|caslon|palatino|cambria|constantia|didot|baskerville|frank|david|narkis/i;
const MONO = /courier|cmtt|sftt|mono|consol|menlo|inconsolata|source ?code/i;
const BOLD = /bold|black|heavy|semibold|demi|medi(?!um ?condensed)|[-_]bd\b/i;
const LIGHT = /light|thin|extralight|ultralight/i;
// PDF font names abbreviate aggressively — the corpus here contains "NimbusRomNo9L-
// ReguItal" and "-MediItal", which a plain /italic/ never matches. The negative
// lookaheads keep "Ital" from firing inside words like "Capitalis".
const ITALIC = /italic|oblique|ital(?![a-z])|obl(?![a-z])|slant/i;

// Families we can name outright, so the browser uses the real face when it has it.
const KNOWN = [
  [/alef/i, "Alef"], [/arial/i, "Arial"], [/helvetica/i, "Helvetica"],
  [/calibri/i, "Calibri"], [/verdana/i, "Verdana"], [/tahoma/i, "Tahoma"],
  [/times/i, "Times New Roman"], [/georgia/i, "Georgia"], [/garamond/i, "Garamond"],
  [/courier/i, "Courier New"], [/cambria/i, "Cambria"], [/segoe/i, "Segoe UI"],
  [/david/i, "David"], [/narkis/i, "Narkisim"], [/frank/i, "FrankRuehl"],
  [/nimbusrom/i, "Times New Roman"], [/^cm(r|bx|ti)/i, "CMU Serif"],
  [/^cmtt|^sftt/i, "CMU Typewriter Text"],
];

/** Strip the subset tag PDFs prepend to embedded fonts ("MUFUZY+Alef" -> "Alef"). */
export function baseName(name) {
  return String(name ?? "").replace(SUBSET_PREFIX, "").trim();
}

/**
 * Turn a PDF font name into a CSS description.
 * Returns { family, weight, style, generic } where family is a ready-to-use stack.
 */
export function describeFont(rawName, cssHint) {
  const name = baseName(rawName);

  // Weight and style live in the name itself, not in any separate PDF field.
  const weight = BOLD.test(name) ? 700 : LIGHT.test(name) ? 300 : 400;
  const style = ITALIC.test(name) ? "italic" : "normal";

  const generic = MONO.test(name) ? "monospace"
    : SERIF.test(name) ? "serif"
    : name ? "sans-serif"
    // Nothing to go on — fall back to whatever pdf.js guessed.
    : (cssHint || "sans-serif");

  // Single quotes, not double: this string ends up inside style="…" in the generated
  // HTML, and double quotes there terminate the attribute and corrupt the document.
  // CSS accepts either, so single quotes cost nothing and remove the hazard entirely.
  const known = KNOWN.find(([re]) => re.test(name))?.[1];
  const quoted = (n) => `'${n.replace(/['"\\]/g, "")}'`;
  const family = known ? `${quoted(known)}, ${generic}`
    : name ? `${quoted(name)}, ${generic}`
    : generic;

  return { family, weight, style, generic, name };
}

/**
 * Resolve every font used on a page to its real embedded identity.
 * Requires page.getOperatorList() to have run — that is what populates commonObjs.
 */
export function resolvePageFonts(page, styles) {
  const out = new Map();

  for (const [fontName, style] of Object.entries(styles ?? {})) {
    let real = null;
    try {
      real = page.commonObjs.get(fontName);
    } catch {
      // Font never loaded (e.g. referenced but unused) — the CSS hint is all we have.
    }
    out.set(fontName, {
      ...describeFont(real?.name ?? "", style?.fontFamily),
      vertical: !!style?.vertical,
      ascent: style?.ascent ?? 0,
      descent: style?.descent ?? 0,
    });
  }

  return out;
}
