/**
 * The page view: which page is on screen, how big it is rendered, and what to throw away.
 *
 * **The whole of sprint מ1 comes down to one question asked correctly.** Until now the
 * workbench showed a grid of 128-pixel thumbnails, so every operation — delete this page,
 * turn that one, move the third — was performed on a grey smudge. Showing a page at a size
 * somebody can read is most of the work; the rest is making sure the page on screen is the
 * page the plan says, after the plan has been reordered, duplicated, trimmed and undone.
 *
 * **Nothing here touches the DOM, and nothing here imports anything at runtime.** That is
 * deliberate rather than tidy: `import type` is erased, so this module runs under
 * `node --experimental-strip-types --test` with no bundler, no aliases and no Tauri — and
 * the two things most likely to be wrong end up tested in `viewer.test.ts` rather than by
 * clicking. The engine call that pairs with this lives in `workbench.ts`, beside the other
 * engine calls, for the same reason.
 */

import type { Leaf } from "@/lib/workbench";

/**
 * Which page keeps being viewed when the plan changes underneath it.
 *
 * **Identity, not position.** Deleting page three while reading page seven should leave
 * page seven on screen, and it is now at index six — so an index carried across a plan
 * change lands on the wrong page every time. The `uid` survives reordering, duplication
 * and undo, and it is the only thing that does: two copies of the same source page are two
 * entries with different uids, and following "source page 4" would flip between them.
 *
 * When the viewed entry is gone, the position it held is the best guess left. Clamped,
 * because deleting the last page has to land somewhere.
 */
export function keepViewing(before: Leaf[], after: Leaf[], viewed: string | null): string | null {
  if (after.length === 0) return null;
  if (viewed === null) return after[0]!.uid;
  if (after.some((leaf) => leaf.uid === viewed)) return viewed;

  const was = before.findIndex((leaf) => leaf.uid === viewed);
  if (was < 0) return after[0]!.uid;
  return after[Math.min(was, after.length - 1)]!.uid;
}

/** The entry being viewed, and where it sits. `null` when the plan is empty. */
export function viewedAt(plan: Leaf[], viewed: string | null): { leaf: Leaf; index: number } | null {
  const index = plan.findIndex((leaf) => leaf.uid === viewed);
  if (index < 0) return null;
  return { leaf: plan[index]!, index };
}

/** Step by one, stopping at the ends rather than wrapping — a document has no page zero. */
export function step(plan: Leaf[], viewed: string | null, by: number): string | null {
  const at = viewedAt(plan, viewed);
  if (!at) return plan[0]?.uid ?? null;
  const next = Math.max(0, Math.min(plan.length - 1, at.index + by));
  return plan[next]!.uid;
}

// ---------------------------------------------------------------------------------------
// How large to render
// ---------------------------------------------------------------------------------------

/**
 * The widths a page is ever rendered at.
 *
 * A ladder rather than a continuous scale, so scrolling the zoom does not queue a hundred
 * renders of nearly the same picture, and so a page already rendered at one rung is reused
 * when the window is nudged. Measured: a page costs 39–503 ms at 1400 wide, which is
 * cheap once and wasteful sixty times.
 *
 * It stops at 2400. `read_image` refuses anything over 4 MB, and the largest page measured
 * at that width was 842 KB — so the ceiling is comfortable rather than tight, and raising
 * it would eventually meet that refusal instead of a warning.
 */
export const RUNGS = [700, 1000, 1400, 2000, 2400] as const;

export type Fit = "width" | "page" | "actual";

/**
 * The rung to render at, given how much room there is and how far in somebody has zoomed.
 *
 * Rounded **up**, never down: a page rendered narrower than it is displayed is a blurry
 * page, and blur on Hebrew type at reading size is the difference between a viewer and a
 * preview. Paying for the next rung up is the cheaper mistake.
 */
export function rungFor(cssWidth: number, zoom: number, pixelRatio = 1): number {
  const wanted = Math.max(1, cssWidth * zoom * pixelRatio);
  return RUNGS.find((rung) => rung >= wanted) ?? RUNGS[RUNGS.length - 1]!;
}

/**
 * How big to draw the page, and how much room it will take once turned.
 *
 * **Two numbers that are only the same while the page is upright**, which is the bug this
 * replaces. The previous version returned "the width the page should occupy" and the
 * component used it as the width of the `<img>` — fine at 0° and 180°, and wrong at 90°,
 * where the element's width becomes the page's *height* on screen. Fitting to width then
 * sized the image so that its height filled the room, and a portrait page turned sideways
 * ran off the edge with no way to see the rest of it.
 *
 * So this returns both: `image` is what the element is set to before it is rotated, and
 * `shown` is the box it occupies afterwards — which is what the wrapper must reserve, or
 * the rotation is clipped rather than laid out.
 */
export function pageBox(
  fit: Fit,
  zoom: number,
  room: { width: number; height: number },
  page: { width: number; height: number },
  rotate: number,
): { image: { width: number; height: number }; shown: { width: number; height: number } } {
  const pw = Math.max(1, page.width);
  const ph = Math.max(1, page.height);
  const turned = ((rotate % 360) + 360) % 360 % 180 !== 0;

  // What one pixel of page width becomes on screen, before zoom.
  const shownW = turned ? ph : pw;
  const shownH = turned ? pw : ph;

  let scale: number;
  if (fit === "actual") {
    scale = 1;
  } else if (fit === "width") {
    scale = room.width / shownW;
  } else {
    // Fit the whole sheet: whichever of the two constraints bites first.
    scale = Math.min(room.width / shownW, Math.max(1, room.height) / shownH);
  }
  scale *= zoom;

  const image = { width: pw * scale, height: ph * scale };
  return { image, shown: { width: shownW * scale, height: shownH * scale } };
}

// ---------------------------------------------------------------------------------------
// One render at a time
// ---------------------------------------------------------------------------------------

/**
 * Run the newest request and abandon the ones it overtook.
 *
 * **The bug this exists to prevent is a page that arrives late and wins.** Turning three
 * pages quickly starts three renders; without this the slowest could finish last and paint
 * a page nobody is looking at any more, which reads as the viewer showing the wrong page —
 * the exact failure that makes people stop trusting a document tool.
 *
 * Superseded work is cancelled at the engine as well as ignored here. Ignoring alone would
 * leave Python rendering pages into a scratch directory for a document that may already be
 * closed, which is the same waste with a slower symptom.
 */
export function latest(cancel: (id: string) => void) {
  let ticket = 0;
  let running: string | null = null;

  return async function want<T>(id: string, work: () => Promise<T>): Promise<T | null> {
    const mine = ++ticket;
    if (running !== null && running !== id) cancel(running);
    running = id;

    let value: T;
    try {
      value = await work();
    } finally {
      if (running === id) running = null;
    }
    // Somebody asked for something else while this was in flight. Its answer is about a
    // page that is no longer on screen, so it is dropped rather than painted.
    return mine === ticket ? value : null;
  };
}

// ---------------------------------------------------------------------------------------
// Scrolling a document rather than paging one
// ---------------------------------------------------------------------------------------

/** Where each page's box starts, and the total run. Pages are stacked with one gap each. */
export function offsets(heights: number[], gap: number): { tops: number[]; total: number } {
  const tops: number[] = [];
  let at = 0;
  for (const height of heights) {
    tops.push(at);
    at += height + gap;
  }
  return { tops, total: Math.max(0, at - gap) };
}

/**
 * Which page a reader is on, and which ones are worth having ready.
 *
 * **The page you are on is the one under the middle of the window**, not the first one
 * touching the top. Scrolling to the join between two pages otherwise flips the number
 * back and forth over a pixel, and a page counter that flickers is worse than one that
 * lags — measuring from the centre puts the change where the eye already thinks it is.
 *
 * `near` is what gets rendered: the current page and `ahead` on each side. Everything else
 * keeps its reserved box and no image, which is what stops a five-hundred-page document
 * from becoming five hundred renders. Reading forwards and reading backwards cost the
 * same, because somebody looking for a figure they passed is doing the same work.
 */
export function pagesInView(
  heights: number[],
  gap: number,
  scrollTop: number,
  viewportHeight: number,
  ahead = 1,
): { current: number; near: number[] } {
  if (heights.length === 0) return { current: -1, near: [] };

  const { tops } = offsets(heights, gap);
  const bottom = (index: number) => tops[index]! + heights[index]!;
  const middle = scrollTop + viewportHeight / 2;

  let current = 0;
  for (let index = 0; index < tops.length; index += 1) {
    if (tops[index]! <= middle) current = index;
    else break;
  }

  // Everything actually on screen, and then one either side.
  //
  // **Not the current page and its neighbours**, which is what this counted first. A tall
  // window shows four pages at once, and rendering three of them left one visible page as
  // an empty box — the reader would see a hole in the middle of the document and have no
  // way to make it fill. Bounded regardless, because only so many pages fit on a screen.
  let first = heights.length - 1;
  let last = 0;
  for (let index = 0; index < heights.length; index += 1) {
    if (bottom(index) >= scrollTop && tops[index]! <= scrollTop + viewportHeight) {
      first = Math.min(first, index);
      last = Math.max(last, index);
    }
  }
  if (first > last) {
    first = current;
    last = current;
  }

  const near: number[] = [];
  for (let index = first - ahead; index <= last + ahead; index += 1) {
    if (index >= 0 && index < heights.length) near.push(index);
  }
  return { current, near };
}
