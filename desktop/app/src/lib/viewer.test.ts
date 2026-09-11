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
import { keepViewing, latest, MOST_AT_ONCE, offsets, pageBox, pagesInView, rungFor, step, viewedAt } from "./viewer.ts";
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

  test("fit to width fills the room, and actual size ignores it", () => {
    const room = { width: 800, height: 600 };
    const page = { width: 400, height: 800 };
    const fit = pageBox("width", 1, room, page, 0);
    strictEqual(fit.shown.width, 800, "the page fills the room's width");
    strictEqual(fit.image.width, 800, "and upright, the element is that wide too");

    strictEqual(pageBox("actual", 1, room, page, 0).image.width, 400);
    strictEqual(pageBox("width", 2, room, page, 0).shown.width, 1600);
  });

  test("a page turned a quarter still fits the room it was fitted to", () => {
    // The failure this exists for: the element's width is the page's height once turned,
    // so sizing the element to the room made the *height* fill it and the width overflow.
    // A portrait page turned sideways ran off the edge with no way back to it.
    const room = { width: 800, height: 600 };
    const tall = { width: 400, height: 800 };

    const turned = pageBox("width", 1, room, tall, 90);
    strictEqual(turned.shown.width, 800, "what is on screen is still 800 wide");
    strictEqual(turned.image.width, 400, "which means the element itself is half that");
    strictEqual(turned.image.height, 800, "and the element's height is what fills the room");
    strictEqual(turned.shown.height, 400);

    // 270° is the same shape as 90°, and −90° is 270°.
    deepStrictEqual(pageBox("width", 1, room, tall, 270).shown, turned.shown);
    deepStrictEqual(pageBox("width", 1, room, tall, -90).shown, turned.shown);
    // Half a turn is the same shape as none.
    deepStrictEqual(pageBox("width", 1, room, tall, 180).shown, pageBox("width", 1, room, tall, 0).shown);
  });

  test("fit to page never exceeds the room, upright or turned", () => {
    const room = { width: 800, height: 600 };
    const tall = { width: 400, height: 800 };

    for (const rotate of [0, 90, 180, 270]) {
      const { shown } = pageBox("page", 1, room, tall, rotate);
      strictEqual(shown.width <= room.width + 0.001, true, `width at ${rotate}°: ${shown.width}`);
      strictEqual(shown.height <= room.height + 0.001, true, `height at ${rotate}°: ${shown.height}`);
    }

    // Upright the height binds: 600 tall, so 300 wide.
    strictEqual(pageBox("page", 1, room, tall, 0).shown.width, 300);
    // Turned, the page is 800×400 on screen and the width binds exactly.
    strictEqual(pageBox("page", 1, room, tall, 90).shown.width, 800);
  });

  test("the element keeps the page's own proportions whatever the rotation", () => {
    const page = { width: 400, height: 800 };
    for (const rotate of [0, 90, 180, 270]) {
      const { image } = pageBox("width", 1, { width: 800, height: 600 }, page, rotate);
      strictEqual(
        Math.round((image.height / image.width) * 1000),
        2000,
        `the image is stretched at ${rotate}°`,
      );
    }
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

describe("scrolling a document rather than paging one", () => {
  const heights = [1000, 1000, 500, 1000];
  const GAP = 16;

  test("pages stack with one gap between them", () => {
    const { tops, total } = offsets(heights, GAP);
    deepStrictEqual(tops, [0, 1016, 2032, 2548]);
    // Three gaps between four pages, and none after the last.
    strictEqual(total, 1000 + 1000 + 500 + 1000 + 3 * GAP);
  });

  test("the page you are on is the one under the middle of the window", () => {
    // Top of the document, an 800-tall window: the middle is at 400, inside page one.
    strictEqual(pagesInView(heights, GAP, 0, 800).current, 0);
    // The middle sits at scrollTop + 400. Page two starts at 1016, so the change happens
    // as the middle crosses it and not a pixel earlier.
    strictEqual(pagesInView(heights, GAP, 615, 800).current, 0, "middle at 1015");
    strictEqual(pagesInView(heights, GAP, 616, 800).current, 1, "middle at 1016");
  });

  test("a page whose top is barely visible is not yet the page you are on", () => {
    // The failure this prevents: counting the first page that touches the top, which
    // flips the number back and forth over a single pixel at the join.
    const justPeeking = 1016 - 790;
    strictEqual(pagesInView(heights, GAP, justPeeking, 800).current, 0);
  });

  test("what is rendered is what is on screen, plus one either side", () => {
    deepStrictEqual(pagesInView(heights, GAP, 0, 800).near, [0, 1]);
    // Backwards costs the same as forwards: somebody hunting a figure they passed is
    // doing the same work as somebody reading on.
    deepStrictEqual(pagesInView(heights, GAP, 3200, 800).near, [2, 3]);
  });

  test("every page on screen is rendered, however many fit", () => {
    // The failure this prevents: rendering the current page and its neighbours only. A
    // tall window shows four pages, and the fourth would have sat there as an empty box
    // with no way for the reader to make it fill.
    const all = pagesInView(heights, GAP, 0, 4000, 1).near;
    deepStrictEqual(all, [0, 1, 2, 3]);
    // Still bounded by what is on screen and not by the document's length: at most the
    // pages showing, plus one either side. Five hundred pages load four, not five hundred.
    const long = Array.from({ length: 500 }, () => 1000);
    strictEqual(pagesInView(long, GAP, 0, 800, 1).near.length, 2, "one page showing, none before it");
    strictEqual(pagesInView(long, GAP, 100_000, 800, 1).near.length, 4, "two showing, one either side");
  });

  test("a viewport that claims to show the whole document does not get it", () => {
    // What happened in the real app, not a hypothetical: the scroll box had no height to
    // scroll in, so it reported its content height as its viewport, and a 35-page document
    // was asked for in full — 35 concurrent renders, of which PDFium survived one.
    const long = Array.from({ length: 35 }, () => 955);
    const whole = offsets(long, GAP).total;
    const { current, near } = pagesInView(long, GAP, 0, whole, 1);
    strictEqual(current, 17, "the middle of a whole-document viewport is the middle page");
    strictEqual(near.length, MOST_AT_ONCE + 2, "capped, plus one either side");
    strictEqual(near.includes(current), true, "and the cap is kept around the current page");
    // The cap is not reached by an honest viewport, which is the point of setting it high.
    strictEqual(pagesInView(long, GAP, 0, 2000, 1).near.length, 4);
    // And it still does not run off the end of a short document.
    deepStrictEqual(pagesInView([955, 955, 955], GAP, 0, whole, 1).near, [0, 1, 2]);
  });

  test("an empty document has no current page and nothing to render", () => {
    deepStrictEqual(pagesInView([], GAP, 0, 800), { current: -1, near: [] });
    deepStrictEqual(offsets([], GAP), { tops: [], total: 0 });
  });
});
