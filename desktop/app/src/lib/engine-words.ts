/**
 * From an engine failure to the key of a sentence.
 *
 * The engine returns codes and the window owns the words — that is rule four, and until
 * the first manual pass it was kept everywhere except the two places that showed
 * `String(failure)`: the workbench's error line and the viewer's. Both put PDFium's own
 * English, and on occasion a path, in front of somebody reading Hebrew.
 *
 * So this maps a rejection to a message key, and nothing else. The raw text is for the
 * log, and the caller writes it there; it never reaches a `t()`.
 *
 * **No runtime imports**, so `node --test` can load it — see viewer.ts for the rule.
 */

/** A message key in the `desktop` namespace, or `null` for a cancel, which is not news. */
export type Worded = { key: string; params?: Record<string, string | number> } | null;

/**
 * The code at the front of a rejection, if it has one.
 *
 * `engineCall` rejects with `CODE: message`, the Rust gate with `CODE: message` or with
 * a plain sentence, and a thrown `Error` stringifies as `Error: CODE: message`. All three
 * are answered here; a message with no code at the front has no code.
 */
export function codeOf(raw: string): string | null {
  const match = /^(?:Error:\s*)?([A-Z][A-Z_]+)(?::|\b)/.exec(raw.trim());
  return match?.[1] ?? null;
}

export function wordEngineError(raw: string): Worded {
  const code = codeOf(raw);
  switch (code) {
    case "CANCELLED":
      return null;
    case "UNREADABLE":
      return { key: "engineErrorUnreadable" };
    case "ENCRYPTED":
      return { key: "engineErrorEncrypted" };
    case "UNWRITABLE":
      return { key: "engineErrorUnwritable" };
    case "SOURCE_OVERWRITE":
      return { key: "engineErrorSourceOverwrite" };
    case "NOT_SMALLER": {
      // The engine's message is `before after`, in bytes. Shown in kilobytes because that
      // is the unit the rest of the window uses for a file.
      const [before, after] = raw.replace(/^.*NOT_SMALLER:\s*/, "").split(/\s+/).map(Number);
      return {
        key: "engineErrorNotSmaller",
        params: {
          before: Math.round((before || 0) / 1024),
          after: Math.round((after || 0) / 1024),
        },
      };
    }
    case "ENGINE_HUNG":
      return { key: "engineErrorHung" };
    case "BAD_REQUEST":
      return { key: "engineErrorRefused" };
    default:
      // The Rust gate's "nobody chose that place" and anything internal. Both mean the
      // same thing to the reader: it did not happen, and the log says why.
      return { key: "engineErrorInternal" };
  }
}
