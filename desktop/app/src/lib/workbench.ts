/**
 * The workbench, as the window sees it.
 *
 * Six features — rotate, reorder, delete, extract, split, merge — and **one idea**: a
 * plan is a list saying which page of which file goes where and how it is turned. The
 * engine builds a document from that list (desktop/engine/pages.py); this file is the
 * same list held in React state, plus undo.
 *
 * Nothing here writes anywhere. A path only becomes writable when a native save dialog
 * or folder picker produces it, which is `pickSavePath` / `pickExportDir` below and
 * `Writable` on the Rust side. The engine refuses an `out` nobody chose.
 */

import { invoke } from "@tauri-apps/api/core";
import { engineCall, isDesktop, newJobId, onProgress, type Probe, type Progress } from "@/lib/engine";

/** One page in the plan. `uid` is ours: React keys and a selection have to survive a move. */
export interface Leaf {
  uid: string;
  source: string;
  page: number;
  /** Quarter turns added to whatever the page already carries. */
  rotate: number;
}

export interface Doc {
  path: string;
  name: string;
  pages: number;
  /** Where this document's thumbnails were rendered. */
  dir: string;
  /**
   * What `probe` said about it.
   *
   * The probe was always called and only `pages` was kept, so the workbench knew a
   * document had no text layer and said nothing — and search over it returned zero with
   * no explanation, which reads as a broken feature rather than an inapplicable one.
   */
  scanned: boolean;
  /** Hebrew or Arabic characters on the sampled page. Zero is not proof of none. */
  rtl: number;
  chars: number;
  fonts: string[];
}

export interface Thumb {
  page: number;
  path: string;
  width: number;
  height: number;
}

export interface PageText {
  page: number;
  lines: string[];
  rtl: boolean;
}

let counter = 0;
export const leafOf = (source: string, page: number, rotate = 0): Leaf => ({
  uid: `p${(counter += 1)}`,
  source,
  page,
  rotate,
});

// ---------------------------------------------------------------------------
// Engine calls. Each mints its own job id, because each is cancellable on its own.
// ---------------------------------------------------------------------------

async function call<T>(op: string, args: unknown, track?: (p: Progress) => void): Promise<T> {
  const id = await newJobId();
  if (!track) return engineCall<T>(id, op, args);

  // Subscribed only while the job runs, and filtered by its id: the window can have more
  // than one thing in flight, and the converter's queue is listening on the same channel.
  const stop = await onProgress((event) => {
    if (event.id === id) track(event);
  });
  try {
    return await engineCall<T>(id, op, args);
  } finally {
    stop();
  }
}

export const probeDocument = (path: string) => call<Probe>("probe", { path });

export const renderThumbnails = (
  path: string,
  out: string,
  width = 170,
  track?: (p: Progress) => void,
) =>
  call<{ thumbnails: Thumb[] }>("thumbnails", { path, out, width }, track).then(
    (r) => r.thumbnails,
  );

/**
 * Render pages of one document into a directory, at one width, cancellably.
 *
 * **The `thumbnails` operation at a bigger number**, and deliberately not a second way to
 * rasterise a page: a page view and a page strip that disagreed about what page four looks
 * like would be two bugs wearing one face. The width is what separates them, and the
 * caller keeps them in separate directories so the files cannot collide.
 *
 * Returns the job id **before** the work, because that is what a cancel names — turning
 * three pages quickly has to be able to abandon the first two.
 */
export async function renderPages(
  path: string,
  out: string,
  width: number,
  pages: number[],
): Promise<{ id: string; done: Promise<Thumb[]> }> {
  const id = await newJobId();
  const done = engineCall<{ thumbnails: Thumb[] }>(id, "thumbnails", {
    path,
    out,
    width,
    pages,
  }).then((result) => result.thumbnails);
  return { id, done };
}

/** Build a document from the plan. Throws when `out` is one of the sources. */
export const applyPlan = (plan: Leaf[], out: string, overwrite = false) =>
  call<{ out: string; pages: number; bytes: number }>("edit", {
    plan: plan.map((leaf) => ({ from: leaf.source, page: leaf.page, rotate: leaf.rotate })),
    out,
    overwrite,
  });

/**
 * Export the plan as images — the plan, not a list of page numbers.
 *
 * The same shape `applyPlan` sends, because these two are the only ways a workbench turns
 * into files and they must not disagree about what the workbench says. The version this
 * replaces took one source and a sorted, de-duplicated list of numbers, which threw away
 * the order, the duplicates and every rotation. See `pages.export_images`.
 */
export const exportPlanImages = (
  plan: Leaf[],
  out: string,
  scale = 2,
  format: "png" | "jpeg" = "png",
  track?: (p: Progress) => void,
) =>
  call<{ images: { page: number; path: string; rotate: number; at: number }[] }>(
    "exportImages",
    {
      plan: plan.map((leaf) => ({ from: leaf.source, page: leaf.page, rotate: leaf.rotate })),
      out,
      scale,
      format,
    },
    track,
  );

export const compressDocument = (path: string, out: string) =>
  call<{ out: string; before: number; after: number; saved: number }>("compress", { path, out });

export const pageText = (path: string, pages: number[]) =>
  call<{ pages: PageText[] }>("text", { path, pages }).then((r) => r.pages);

// ---------------------------------------------------------------------------
// The Rust side: where a file may be written, and how a thumbnail is seen.
// ---------------------------------------------------------------------------

/**
 * The native save dialog. The only thing that makes a file path writable.
 *
 * `ext` picks the filter the dialog offers — pdf for an edited document, zip for a packed
 * conversion. Checked on the Rust side rather than trusted, because it reaches a native
 * API.
 */
export async function pickSavePath(name: string, ext = "pdf"): Promise<string | null> {
  if (!isDesktop()) return null;
  return (await invoke<string | null>("pick_save_path", { name, ext })) ?? null;
}

export async function pickExportDir(): Promise<string | null> {
  if (!isDesktop()) return null;
  return (await invoke<string | null>("pick_export_dir")) ?? null;
}

/** A scratch directory for one document's thumbnails. The slot is checked on the Rust side. */
export function workbenchDir(slot: string): Promise<string> {
  if (!isDesktop()) return Promise.reject(new Error("not running in the app"));
  return invoke<string>("workbench_dir", { slot });
}

/** A thumbnail as a data URI. Refused for anything outside the scratch directory. */
export function readImage(path: string): Promise<string> {
  if (!isDesktop()) return Promise.reject(new Error("not running in the app"));
  return invoke<string>("read_image", { path });
}

/**
 * Remove one file the workbench put in the scratch directory.
 *
 * For the document `compress` builds from the plan before compressing it. Refused for
 * anything outside that directory, and for anything that is not a file.
 */
export function discardScratch(path: string): Promise<void> {
  if (!isDesktop()) return Promise.reject(new Error("not running in the app"));
  return invoke<void>("discard_scratch", { path });
}

// ---------------------------------------------------------------------------
// The plan, with undo. A reducer rather than a pile of setState calls, because undo of
// six separate operations is one thing to get right here and six to get wrong there.
// ---------------------------------------------------------------------------

export interface PlanState {
  past: Leaf[][];
  present: Leaf[];
  future: Leaf[][];
}

export type PlanAction =
  | { type: "set"; plan: Leaf[] }
  | { type: "append"; leaves: Leaf[] }
  | { type: "rotate"; uids: Set<string>; turn: number }
  | { type: "remove"; uids: Set<string> }
  | { type: "keep"; uids: Set<string> }
  | { type: "move"; uid: string; to: number }
  | { type: "nudge"; uid: string; by: number }
  | { type: "undo" }
  | { type: "redo" };

export const emptyPlan: PlanState = { past: [], present: [], future: [] };

/** Deep enough: a leaf is four flat fields, and a plan of five hundred is nothing to copy. */
const remember = (state: PlanState, next: Leaf[]): PlanState => ({
  // Fifty steps. Beyond that somebody wants the original file, not another undo.
  past: [...state.past, state.present].slice(-50),
  present: next,
  future: [],
});

function moved(plan: Leaf[], uid: string, to: number): Leaf[] {
  const from = plan.findIndex((leaf) => leaf.uid === uid);
  if (from < 0) return plan;
  const next = [...plan];
  const [leaf] = next.splice(from, 1);
  if (!leaf) return plan;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, leaf);
  return next;
}

export function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case "set":
      return remember(state, action.plan);

    case "append":
      return remember(state, [...state.present, ...action.leaves]);

    case "rotate":
      return remember(
        state,
        state.present.map((leaf) =>
          action.uids.has(leaf.uid)
            ? { ...leaf, rotate: (((leaf.rotate + action.turn) % 360) + 360) % 360 }
            : leaf,
        ),
      );

    case "remove": {
      const next = state.present.filter((leaf) => !action.uids.has(leaf.uid));
      // A document with no pages is not a document — the engine refuses an empty plan,
      // and refusing here means the refusal arrives before anything was lost.
      return next.length === 0 ? state : remember(state, next);
    }

    case "keep": {
      const next = state.present.filter((leaf) => action.uids.has(leaf.uid));
      return next.length === 0 ? state : remember(state, next);
    }

    case "move":
      return remember(state, moved(state.present, action.uid, action.to));

    case "nudge": {
      const from = state.present.findIndex((leaf) => leaf.uid === action.uid);
      if (from < 0) return state;
      const to = from + action.by;
      if (to < 0 || to >= state.present.length) return state;
      return remember(state, moved(state.present, action.uid, to));
    }

    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future].slice(0, 50),
      };
    }

    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { past: [...state.past, state.present], present: next, future: rest };
    }

    default:
      return state;
  }
}
