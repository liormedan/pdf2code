/**
 * A result lands on the run that asked for it. Run with `npm run test`.
 */

import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert/strict";
import { describe, test } from "node:test";
import { applyPatch, nextRun } from "./queue.ts";

type Item = { key: string; run: number; state: string; result: string | null };

describe("routing a conversion result", () => {
  test("a result reaches the entry that asked for it", () => {
    const run = nextRun();
    const items: Item[] = [{ key: "a.pdf", run, state: "running", result: null }];
    const after = applyPatch(items, "a.pdf", run, { state: "done", result: "out/a-1" });
    deepStrictEqual(after, [{ key: "a.pdf", run, state: "done", result: "out/a-1" }]);
    notStrictEqual(after, items, "a change is a new list");
  });

  test("a late result does not land on a newer entry with the same key", () => {
    // The sequence: convert a.pdf, remove it mid-run, drop a.pdf in again. The second
    // entry has the first one's key. The first one's result arrives.
    const first = nextRun();
    const second = nextRun();
    const items: Item[] = [{ key: "a.pdf", run: second, state: "waiting", result: null }];
    const after = applyPatch(items, "a.pdf", first, { state: "done", result: "out/a-1" });
    strictEqual(after, items, "nothing matched, so nothing changed — not even the array");
    strictEqual(after[0]!.state, "waiting");
    strictEqual(after[0]!.result, null);
  });

  test("a cancelled run's late answer is ignored the same way", () => {
    const run = nextRun();
    const items: Item[] = [];
    strictEqual(applyPatch(items, "a.pdf", run, { state: "cancelled" }), items);
  });

  test("runs are never reused", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) seen.add(nextRun());
    strictEqual(seen.size, 1000);
  });
});
