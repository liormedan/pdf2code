/**
 * Duplicating and moving pages, proven on lists. Run with `npm run test`.
 */

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, test } from "node:test";
import { duplicated, movedToEdge } from "./plan-ops.ts";

type Leaf = { uid: string; page: number; rotate: number };
const leaf = (uid: string, page: number, rotate = 0): Leaf => ({ uid, page, rotate });
const uids = (leaves: Leaf[]) => leaves.map((l) => l.uid);

let minted = 0;
const fresh = (l: Leaf): Leaf => ({ ...l, uid: `c${(minted += 1)}` });

describe("duplicating pages", () => {
  test("a copy lands right after its original, with its rotation", () => {
    const plan = [leaf("a", 1), leaf("b", 2, 90), leaf("c", 3)];
    const next = duplicated(plan, new Set(["b"]), fresh);
    deepStrictEqual(uids(next), ["a", "b", "c1", "c"]);
    strictEqual(next[2]!.page, 2);
    strictEqual(next[2]!.rotate, 90, "the copy is the page as it is, turned and all");
  });

  test("the copy is its own entry", () => {
    // The failure this catches: a copy sharing the original's uid, which React, the
    // selection and the viewer would all treat as the same page.
    const next = duplicated([leaf("a", 1)], new Set(["a"]), fresh);
    strictEqual(next.length, 2);
    strictEqual(new Set(uids(next)).size, 2);
  });

  test("several at once, each after its own original, and nothing else moves", () => {
    const plan = [leaf("a", 1), leaf("b", 2), leaf("c", 3)];
    const next = duplicated(plan, new Set(["a", "c"]), fresh);
    deepStrictEqual(
      next.map((l) => l.page),
      [1, 1, 2, 3, 3],
    );
  });

  test("nothing chosen, nothing copied", () => {
    const plan = [leaf("a", 1)];
    deepStrictEqual(duplicated(plan, new Set(), fresh), plan);
  });
});

describe("moving pages to an end", () => {
  const plan = [leaf("p1", 1), leaf("p2", 2), leaf("p3", 3), leaf("p4", 4), leaf("p5", 5)];

  test("to the start, keeping their order among themselves", () => {
    // Moving each to index zero in turn would give 5, 3 — the order reversed.
    deepStrictEqual(uids(movedToEdge(plan, new Set(["p3", "p5"]), "start")), ["p3", "p5", "p1", "p2", "p4"]);
  });

  test("to the end, and the rest keep their order too", () => {
    deepStrictEqual(uids(movedToEdge(plan, new Set(["p1", "p2"]), "end")), ["p3", "p4", "p5", "p1", "p2"]);
  });

  test("already there is a no-op by value", () => {
    deepStrictEqual(uids(movedToEdge(plan, new Set(["p1"]), "start")), uids(plan));
    deepStrictEqual(uids(movedToEdge(plan, new Set(["p5"]), "end")), uids(plan));
  });

  test("everything chosen changes nothing", () => {
    deepStrictEqual(uids(movedToEdge(plan, new Set(uids(plan)), "end")), uids(plan));
  });
});
