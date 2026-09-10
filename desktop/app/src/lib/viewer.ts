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
 * The width in CSS pixels a page should occupy.
 *
 * `page` fits the whole sheet, which needs the height as well and therefore the page's own
 * ratio — a landscape page fitted to width would still overflow downwards. A quarter turn
 * swaps that ratio, which is why the rotation is an argument here rather than something
 * the caller is trusted to have applied.
 */
export function fitWidth(
  fit: Fit,
  zoom: number,
  room: { width: number; height: number },
  page: { width: number; height: number },
  rotate: number,
): number {
  const turned = rotate % 180 !== 0;
  const w = turned ? page.height : page.width;
  const h = turned ? page.width : page.height;

  if (fit === "actual") return w * zoom;
  if (fit === "width") return room.width * zoom;
  // Fit the whole page: whichever of the two constraints bites first.
  return Math.min(room.width, (room.height * w) / Math.max(1, h)) * zoom;
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
