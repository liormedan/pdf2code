/**
 * The two things in the page view that are worth proving rather than clicking.
 *
 *     npm run test
 *
 * **Which page is on screen after the plan changed**, and **what happens to a render that
 * arrives after somebody has turned the page.** Both are pure, both are easy to get subtly
 * wrong, and both fail in the same way when they are wrong: the viewer shows a page that
 * is not the page the workbench thinks it is showing. A document tool that does that once
 * is a document tool nobody trusts again.
 *
 * `node:test` and `--experimental-strip-types`, which Node 22.12 has built in. **No test
 * framework was added.** The rule in conventions.md is licence, then size, then
 * convenience; a dependency that the runtime already replaces does not get past the second.
 * The cost is that `viewer.ts` may not import anything at runtime, which is stated at the
 * top of that file so nobody adds an import and wonders why this stopped running.
 */

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, test } from "node:test";
import { fitWidth, keepViewing, latest, rungFor, step, viewedAt } from "./viewer.ts";
import type { Leaf } from "./workbench.ts";

/** A plan, written the way the reducer builds one. */
const plan = (...spec: [string, number, number?][]): Leaf[] =>
  spec.map(([uid, page, rotate]) => ({ uid, source: "a.pdf", page, rotate: rotate ?? 0 }));

describe("which page stays on screen when the plan moves under it", () => {
  test("reordering keeps the same page, at its new position", () => {
    const before = plan(["p1", 1], ["p2", 2], ["p3", 3]);
    const after = plan(["p3", 3], ["p1", 1], ["p2", 2]);
    strictEqual(keepViewing(before, after, "p2"), "p2");
    strictEqual(viewedAt(after, "p2")?.index, 2);
  });

  test("deleting an earlier page does not change which page is being read", () => {
    const before = plan(["p1", 1], ["p2", 2], ["p3", 3]);
    const after = plan(["p2", 2], ["p3", 3]);
    strictEqual(keepViewing(before, after, "p3"), "p3");
    // The page did not change; its index did. Following the index would have shown p2.
    strictEqual(viewedAt(before, "p3")?.index, 2);
    strictEqual(viewedAt(after, "p3")?.index, 1);
  });

  test("deleting the page being read falls to whatever took its place", () => {
    const before = plan(["p1", 1], ["p2", 2], ["p3", 3]);
    const after = plan(["p1", 1], ["p3", 3]);
    strictEqual(keepViewing(before, after, "p2"), "p3");
  });

  test("deleting the last page falls back rather than off the end", () => {
    const before = plan(["p1", 1], ["p2", 2], ["p3", 3]);
    const after = plan(["p1", 1], ["p2", 2]);
    strictEqual(keepViewing(before, after, "p3"), "p2");
  });

  test("two copies of one source page are two pages, and are told apart", () => {
    // The failure this catches: following `source#page` instead of the uid, which makes
    // the viewer flip between the two copies as if they were the same entry.
    const before = plan(["p1", 4], ["p2", 4]);
    const after = plan(["p2", 4]);
    strictEqual(keepViewing(before, after, "p1"), "p2");
    strictEqual(keepViewing(before, before, "p2"), "p2");
    strictEqual(viewedAt(before, "p1")?.index, 0);
    strictEqual(viewedAt(before, "p2")?.index, 1);
  });

  test("rotating a page keeps it on screen and carries the new angle", () => {
    const before = plan(["p1", 1], ["p2", 2, 0]);
    const after = plan(["p1", 1], ["p2", 2, 90]);
    strictEqual(keepViewing(before, after, "p2"), "p2");
    strictEqual(viewedAt(after, "p2")?.leaf.rotate, 90);
  });

  test("keeping only a selection lands somewhere real, and emptying lands nowhere", () => {
    const before = plan(["p1", 1], ["p2", 2], ["p3", 3]);
    strictEqual(keepViewing(before, plan(["p1", 1]), "p3"), "p1");
    strictEqual(keepViewing(before, [], "p2"), null);
  });

  test("undo puts the page back", () => {
    const full = plan(["p1", 1], ["p2", 2], ["p3", 3]);
    const trimmed = plan(["p1", 1], ["p3", 3]);
    const afterDelete = keepViewing(full, trimmed, "p2");
    strictEqual(afterDelete, "p3");
    // Undo restores the plan; the page that was being read before the delete is back.
    strictEqual(keepViewing(trimmed, full, afterDelete), "p3");
  });

  test("opening a document with nothing viewed starts at the first page", () => {
    strictEqual(keepViewing([], plan(["p1", 1], ["p2", 2]), null), "p1");
  });
});

describe("stepping", () => {
  const three = plan(["p1", 1], ["p2", 2], ["p3", 3]);

  test("moves one at a time and stops at both ends", () => {
    strictEqual(step(three, "p1", 1), "p2");
    strictEqual(step(three, "p3", 1), "p3");
    strictEqual(step(three, "p1", -1), "p1");
  });

  test("an unknown page falls to the first, and an empty plan to nothing", () => {
    strictEqual(step(three, "gone", 1), "p1");
    strictEqual(step([], null, 1), null);
  });
});

describe("how large to render", () => {
  test("the rung is never below what is displayed", () => {
    // Rounding down would show a page rendered narrower than its box: a blurry page.
    strictEqual(rungFor(650, 1), 700);
    strictEqual(rungFor(701, 1), 1000);
    strictEqual(rungFor(1000, 1), 1000);
    strictEqual(rungFor(900, 1.5), 1400);
  });

  test("a scaled display asks for more pixels than its CSS width", () => {
    strictEqual(rungFor(900, 1, 1), 1000);
    strictEqual(rungFor(900, 1, 2), 2000);
  });

  test("beyond the top rung it stops rather than growing without limit", () => {
    // `read_image` refuses over 4 MB. The ladder ends before that becomes the error.
    strictEqual(rungFor(4000, 4), 2400);
  });

  test("fit to width fills the room; actual size ignores it", () => {
    const room = { width: 800, height: 600 };
    const page = { width: 400, height: 800 };
    strictEqual(fitWidth("width", 1, room, page, 0), 800);
    strictEqual(fitWidth("actual", 1, room, page, 0), 400);
    strictEqual(fitWidth("width", 2, room, page, 0), 1600);
  });

  test("fit to page respects the height, and a quarter turn swaps the ratio", () => {
    const room = { width: 800, height: 600 };
    const tall = { width: 400, height: 800 };
    // Upright: height is the binding constraint — 600 * 400/800.
    strictEqual(fitWidth("page", 1, room, tall, 0), 300);
    // Turned: the page is now wider than tall, so the room's width binds instead.
    strictEqual(fitWidth("page", 1, room, tall, 90), 800);
    // Half a turn is the same shape as none.
    strictEqual(fitWidth("page", 1, room, tall, 180), 300);
  });
});

describe("a render that arrives after somebody turned the page", () => {
  /** A job that finishes when told to, so the overtaking is deterministic. */
  const held = <T>() => {
    let release!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  test("the newest result is kept and the overtaken one is dropped", async () => {
    const cancelled: string[] = [];
    const want = latest((id) => cancelled.push(id));

    const first = held<string>();
    const second = held<string>();

    const a = want("job-1", () => first.promise);
    const b = want("job-2", () => second.promise);

    // The second finishes first, then the stale first finishes late.
    second.release("page 2");
    strictEqual(await b, "page 2");
    first.release("page 1");
    strictEqual(await a, null, "the overtaken render must not be painted");
  });

  test("the overtaken job is cancelled at the engine, not merely ignored", () => {
    const cancelled: string[] = [];
    const want = latest((id) => cancelled.push(id));
    void want("job-1", () => new Promise(() => {}));
    void want("job-2", () => new Promise(() => {}));
    deepStrictEqual(cancelled, ["job-1"]);
  });

  test("closing the document cancels what is still rendering", () => {
    const cancelled: string[] = [];
    const want = latest((id) => cancelled.push(id));
    void want("job-1", () => new Promise(() => {}));
    // A close asks for nothing, which supersedes the in-flight page.
    void want("closed", async () => null);
    deepStrictEqual(cancelled, ["job-1"]);
  });

  test("an unopposed render is returned", async () => {
    const want = latest(() => {});
    strictEqual(await want("job-1", async () => "page 1"), "page 1");
  });

  test("a render that throws does not wedge the next one", async () => {
    const want = latest(() => {});
    await want("job-1", async () => {
      throw new Error("engine said no");
    }).catch(() => undefined);
    strictEqual(await want("job-2", async () => "page 2"), "page 2");
  });
});
