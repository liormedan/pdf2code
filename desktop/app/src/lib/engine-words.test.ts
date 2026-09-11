/**
 * The engine says a code; the reader gets a sentence in their language; the log gets
 * the rest. Run with `npm run test`.
 */

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, test } from "node:test";
import { codeOf, wordEngineError } from "./engine-words.ts";

describe("wording an engine failure", () => {
  test("reads the code off the front, however the rejection was wrapped", () => {
    strictEqual(codeOf("UNREADABLE: no such file: a.pdf"), "UNREADABLE");
    strictEqual(codeOf("Error: UNREADABLE: no such file: a.pdf"), "UNREADABLE");
    strictEqual(codeOf("SOURCE_OVERWRITE: that is one of the documents"), "SOURCE_OVERWRITE");
    strictEqual(codeOf("refused: nobody chose that place to write to"), null);
    strictEqual(codeOf("TypeError: Cannot read properties of undefined"), null);
  });

  test("never hands the raw text to the reader", () => {
    // PDFium's own words, with a path in them — exactly what used to reach the screen.
    const raw = "Error: INTERNAL: PdfiumError('Failed to load document') C:\\Users\\x\\secret.pdf";
    const worded = wordEngineError(raw);
    strictEqual(worded?.key, "engineErrorInternal");
    strictEqual(JSON.stringify(worded).includes("secret"), false);
  });

  test("a cancel is not an error", () => {
    strictEqual(wordEngineError("Error: CANCELLED: cancelled"), null);
  });

  test("each code the engine can send has a sentence", () => {
    for (const [code, key] of ([
      ["UNREADABLE", "engineErrorUnreadable"],
      ["ENCRYPTED", "engineErrorEncrypted"],
      ["UNWRITABLE", "engineErrorUnwritable"],
      ["SOURCE_OVERWRITE", "engineErrorSourceOverwrite"],
      ["ENGINE_HUNG", "engineErrorHung"],
      ["BAD_REQUEST", "engineErrorRefused"],
      ["INTERNAL", "engineErrorInternal"],
    ] as const)) {
      strictEqual(wordEngineError(`Error: ${code}: detail`)?.key, key, code);
    }
  });

  test("not-smaller carries the two sizes, in kilobytes", () => {
    // The case that was measured: a 1.54 MB original rewritten to 3.58 MB.
    deepStrictEqual(wordEngineError("Error: NOT_SMALLER: 1544031 3582085"), {
      key: "engineErrorNotSmaller",
      params: { before: 1508, after: 3498 },
    });
  });
});
