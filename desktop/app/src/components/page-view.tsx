import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minus, Plus, ScanLine, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/i18n/provider";
import { engineCancel } from "@/lib/engine";
import { offsets, pageBox, pagesInView, rungFor, step, viewedAt, type Fit } from "@/lib/viewer";
import { readImage, renderPages, workbenchDir, type Doc, type Leaf } from "@/lib/workbench";

/** The space between two pages in the run, in CSS pixels. */
const GAP = 16;

/**
 * The document, scrolled.
 *
 * **This is the whole of sprint מ1.** The workbench has shown pages since sprint 6, at 128
 * pixels — the right size for confirming a page exists and the wrong size for deciding
 * anything about it. Every operation it offers, delete this page and turn that one and move
 * the third, was being done to a grey smudge, and on a Hebrew document the smudge was all
 * there was.
 *
 * **One run of pages, not one page at a time.** The first version showed a single page and
 * turned it with buttons; scrolling past the bottom of a page is how people actually move
 * through a document. Every entry in the plan reserves a box of the right height whether or
 * not it has been drawn, so the scrollbar tells the truth about the document's length from
 * the first frame and nothing jumps as images arrive.
 *
 * **Only what is on screen is drawn.** `pagesInView` decides, counting the pages actually
 * showing rather than the current one and its neighbours — a tall window shows four, and
 * rendering three leaves a visible hole the reader cannot fill. Five hundred pages
 * therefore cost about four renders.
 *
 * **The page on screen is an entry in the plan, not a page of the file.** The plan can
 * reorder, duplicate, trim and undo underneath this, so it follows a `uid` and never an
 * index. That rule is `keepViewing` in `viewer.ts`, tested rather than clicked.
 */
export default function PageView({
  plan,
  docs,
  viewed,
  onView,
  running,
}: {
  plan: Leaf[];
  docs: Doc[];
  viewed: string | null;
  onView: (uid: string | null) => void;
  /** A conversion or a save is using the engine; a render now would queue behind it. */
  running: boolean;
}) {
  const t = useTranslations("desktop");

  const [fit, setFit] = useState<Fit>("width");
  const [zoom, setZoom] = useState(1);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(0);

  /**
   * The page shape, learned from the first render rather than assumed.
   *
   * `Leaf` says which page of which file and how far it is turned; it carries no size,
   * because a plan is a description. One shape stands for the whole run: documents are
   * overwhelmingly uniform, and the alternative is measuring every page before the first
   * can be laid out — the whole document rendered to show its first line.
   */
  const [shape, setShape] = useState<{ width: number; height: number } | null>(null);

  /** Drawn pages, keyed `source#page@rung`. */
  const [images, setImages] = useState<Map<string, string>>(new Map());

  const at = useMemo(() => viewedAt(plan, viewed), [plan, viewed]);
  const scanned = docs.some((item) => item.scanned);
  const count = plan.length;

  // --- the room, measured -----------------------------------------------------------------
  //
  // A callback ref and not an effect. With no document open this component rendered nothing
  // to observe, so an effect with empty dependencies ran once against `null`, attached
  // nothing and never ran again — the width stayed at zero and no page was ever drawn.
  const scroller = useRef<HTMLDivElement | null>(null);
  const watching = useRef<ResizeObserver | null>(null);
  const roomRef = useCallback((element: HTMLDivElement | null) => {
    watching.current?.disconnect();
    watching.current = null;
    scroller.current = element;
    if (!element) return;

    // A fresh object only when the size actually differs. `box` feeds the reserved heights,
    // which feed the list of pages to draw, so handing back an equal-but-new object on every
    // observer callback would restart that work for a resize that never happened.
    const measure = (width: number, height: number) =>
      setBox((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (rect) measure(rect.width, rect.height);
    });
    observer.observe(element);
    watching.current = observer;
    const rect = element.getBoundingClientRect();
    measure(rect.width, rect.height);
  }, []);
  useEffect(() => () => watching.current?.disconnect(), []);

  // --- how big each page is, and where it sits ----------------------------------------------
  const boxes = useMemo(
    () =>
      plan.map((leaf) =>
        box.width > 0 && shape
          ? pageBox(fit, zoom, box, shape, leaf.rotate)
          : {
              image: { width: 0, height: 0 },
              // Before anything has been drawn the shape is unknown, so the reserved boxes
              // use a common portrait ratio. They are corrected the moment a page lands.
              shown: { width: box.width, height: box.width * 1.4 },
            },
      ),
    [plan, box, shape, fit, zoom],
  );
  const heights = useMemo(() => boxes.map((one) => one.shown.height), [boxes]);
  const { tops, total } = useMemo(() => offsets(heights, GAP), [heights]);

  const near = useMemo(
    () => pagesInView(heights, GAP, scrollTop, box.height || 1, 1).near,
    [heights, scrollTop, box.height],
  );
  // The same pages by value, as something that compares by value. `near` is a fresh array
  // whenever the plan is handed down as a fresh array, and the drawing effect must not read
  // that as a new set of pages to draw.
  const nearKey = near.join(",");
  const rung =
    box.width > 0 ? rungFor(boxes[0]?.shown.width || box.width, 1, window.devicePixelRatio || 1) : 0;

  // --- drawing what is on screen --------------------------------------------------------------
  /**
   * Renders in flight, by cache key. `""` until the engine hands back an id.
   *
   * A map rather than one at a time. A scrolling reader legitimately wants three or four
   * pages coming at once, and a single-flight queue would cancel each as the next was asked
   * for and finish none. What still gets cancelled is a page that scrolled out of range
   * before it arrived — the waste that matters, because the engine stops drawing something
   * nobody will look at.
   *
   * **The key is reserved before the first `await` and not after it.** Registering it once
   * the engine had answered left a window in which the page was in neither this map nor
   * `images`, so every re-render during that window asked for the same page again. Measured
   * in the harness: one twenty-page plan, several hundred renders in under two seconds, and
   * not one of them cancellable — nothing had been registered to cancel.
   */
  const jobs = useRef<Map<string, string>>(new Map());
  const dirs = useRef<Map<string, string>>(new Map());
  const wanted = useRef<Set<string>>(new Set());

  /**
   * Whether this component is still on the page — and nothing narrower than that.
   *
   * The drawing effect used to keep a `live` flag that its cleanup set false, so a render
   * that finished after the effect had re-run threw its image away. But the effect re-runs
   * whenever the room changes width, and the room changes width **during the first render
   * of every document**: the run's height is set, the scrollbar appears, the width shrinks
   * by its size. So the first two pages of every document were drawn by the engine, read
   * back, and dropped — with the reservation gone and nothing left to ask again. Found in
   * the app with the pages on disk and the viewer empty. Whether a result is still wanted
   * is `wanted`'s question; this only answers whether there is anywhere to put it.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (box.width === 0 || rung === 0 || count === 0) return;

    const keys = new Set(
      near.map((index) => {
        const leaf = plan[index]!;
        return `${leaf.source}#${leaf.page}@${rung}`;
      }),
    );
    wanted.current = keys;

    for (const [key, id] of [...jobs.current]) {
      if (keys.has(key)) continue;
      // An empty id is a key reserved a moment ago whose render has not started yet. Dropping
      // it here is enough: the closure that started it finds its reservation gone and cancels
      // the render itself, once there is something to cancel.
      if (id) void engineCancel(id);
      jobs.current.delete(key);
    }

    for (const index of near) {
      const leaf = plan[index];
      if (!leaf) continue;
      const key = `${leaf.source}#${leaf.page}@${rung}`;
      if (images.has(key) || jobs.current.has(key)) continue;
      jobs.current.set(key, "");

      void (async () => {
        setDrawing((n) => n + 1);
        try {
          // A directory per document and rung: `thumbnails` names its files after the page
          // number alone, so the 170px strip and a 1400px page would otherwise collide.
          const slot = `v-${rung}-${Math.abs(hash(leaf.source))}`;
          let dir = dirs.current.get(slot);
          if (!dir) {
            dir = await workbenchDir(slot);
            dirs.current.set(slot, dir);
          }

          const { id, done } = await renderPages(leaf.source, dir, rung, [leaf.page]);
          // The sweep may have dropped the reservation while the engine was being asked.
          if (!jobs.current.has(key)) {
            void engineCancel(id);
            return;
          }
          jobs.current.set(key, id);
          const made = await done;
          jobs.current.delete(key);
          if (!mounted.current || !wanted.current.has(key)) return;

          const drawn = made[0];
          if (!drawn) return;
          const data = await readImage(drawn.path);
          if (!mounted.current || !wanted.current.has(key)) return;

          setShape((current) => current ?? { width: drawn.width, height: drawn.height });
          setImages((current) => remember(current, key, data, wanted.current));
          setProblem(null);
        } catch (failure) {
          jobs.current.delete(key);
          if (mounted.current) setProblem(String(failure));
        } finally {
          // Exactly once per job, whichever way it ended. The sweep deliberately does not
          // touch this count; it only takes the reservation away.
          setDrawing((n) => Math.max(0, n - 1));
        }
      })();
    }
    // `nearKey` and not `near`: the pages wanted, compared by value. See above.
  }, [nearKey, plan, rung, box.width, count, images]);

  // --- scrolling, in both directions ------------------------------------------------------------
  //
  // The reader scrolls and the page number follows; a page is chosen elsewhere and the run
  // scrolls to it. Both, without either triggering the other in a loop — `jumping` marks a
  // scroll this component started so the handler does not report it back as a reader's move.
  const jumping = useRef(false);

  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    setScrollTop(element.scrollTop);
    if (jumping.current) return;

    const { current } = pagesInView(heights, GAP, element.scrollTop, element.clientHeight || 1, 1);
    const leaf = plan[current];
    if (leaf && leaf.uid !== viewed) onView(leaf.uid);
  }, [heights, plan, viewed, onView]);

  useEffect(() => {
    const element = scroller.current;
    if (!element || !at || heights.length === 0) return;
    const top = tops[at.index];
    if (top === undefined) return;

    // Already the page under the middle: scrolling now would fight the reader for nothing.
    const { current } = pagesInView(heights, GAP, element.scrollTop, element.clientHeight || 1, 1);
    if (current === at.index) return;

    jumping.current = true;
    element.scrollTo({ top, behavior: "auto" });
    setScrollTop(top);
    // Released on the next task, because the scroll event this caused arrives first.
    window.setTimeout(() => {
      jumping.current = false;
    }, 0);
  }, [at?.index, tops, heights]);

  const go = useCallback((by: number) => onView(step(plan, viewed, by)), [plan, viewed, onView]);

  // Page turning on the keys a reader reaches for. Never while typing — the page number
  // field is in this toolbar, and `4` there must be a digit and not a page turn.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.code === "PageDown") go(1);
      else if (event.code === "PageUp") go(-1);
      else if (event.code === "Home") onView(plan[0]?.uid ?? null);
      else if (event.code === "End") onView(plan[count - 1]?.uid ?? null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onView, plan, count]);

  return (
    // `min-w-0` is load-bearing. A grid or flex child's automatic minimum is its content, so
    // at 100% on a large page the scroll box would stop scrolling and stretch the whole
    // column instead — squeezing the page strip and pushing the window sideways. Measured: a
    // 4800px-wide page made the container 4841px rather than scrolling inside its 1282.
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={t("viewerPrevious")}
          disabled={!at || at.index === 0}
          onClick={() => go(-1)}
        >
          {/* The arrows point the way the pages go, which follows the writing direction. */}
          <ChevronRight className="size-4 ltr:rotate-180" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={t("viewerNext")}
          disabled={!at || at.index === count - 1}
          onClick={() => go(1)}
        >
          <ChevronLeft className="size-4 ltr:rotate-180" />
        </Button>

        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="sr-only">{t("viewerGoToPage")}</span>
          <Input
            type="number"
            min={1}
            max={Math.max(1, count)}
            value={at ? at.index + 1 : 1}
            onChange={(event) => {
              const asked = Number(event.target.value);
              if (!Number.isFinite(asked)) return;
              onView(plan[Math.min(count, Math.max(1, asked)) - 1]?.uid ?? null);
            }}
            className="tabular h-7 w-14 text-xs"
            dir="ltr"
          />
          <span className="tabular whitespace-nowrap">{t("viewerOfTotal", { total: count })}</span>
        </label>

        <span className="mx-0.5 h-5 w-px bg-divider" aria-hidden="true" />

        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={t("viewerZoomOut")}
          disabled={zoom <= 0.25}
          onClick={() => setZoom((z) => Math.max(0.25, +(z / 1.25).toFixed(3)))}
        >
          <Minus className="size-4" />
        </Button>
        <span className="tabular w-11 text-center text-[11px] text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={t("viewerZoomIn")}
          disabled={zoom >= 4}
          onClick={() => setZoom((z) => Math.min(4, +(z * 1.25).toFixed(3)))}
        >
          <Plus className="size-4" />
        </Button>

        {(
          [
            ["width", t("viewerFitWidth"), Maximize2],
            ["page", t("viewerFitPage"), Square],
          ] as const
        ).map(([mode, label, Icon]) => (
          <Button
            key={mode}
            size="sm"
            variant={fit === mode && zoom === 1 ? "secondary" : "ghost"}
            aria-pressed={fit === mode && zoom === 1}
            onClick={() => {
              setFit(mode);
              setZoom(1);
            }}
          >
            <Icon className="size-3.5" />
            {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={fit === "actual" && zoom === 1 ? "secondary" : "ghost"}
          aria-pressed={fit === "actual" && zoom === 1}
          onClick={() => {
            setFit("actual");
            setZoom(1);
          }}
        >
          {t("viewerActualSize")}
        </Button>

        <span className="flex-1" />

        {/* A scanned page renders perfectly and carries no text. Said next to the page,
            because this is the moment somebody wonders why they cannot select a word. */}
        {scanned ? (
          <span className="flex items-center gap-1 text-[11px] text-warning">
            <ScanLine className="size-3.5 shrink-0" aria-hidden="true" />
            {t("viewerScanned")}
          </span>
        ) : null}
        {drawing > 0 || running ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>

      {problem ? (
        <p role="alert" className="text-[11px] text-destructive">
          {problem}
        </p>
      ) : null}

      <div
        ref={roomRef}
        onScroll={onScroll}
        // `dir="ltr"`: a scroll box is a viewport, not text. Under RTL the horizontal scroll
        // origin flips, and a page wider than its box would open showing its right edge.
        dir="ltr"
        tabIndex={0}
        role="region"
        aria-label={t("viewerRegion")}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-divider bg-muted/30 p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {count === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">{t("viewerEmpty")}</p>
        ) : (
          // The run. Every page reserves its height whether or not it has been drawn, so the
          // scrollbar is honest from the first frame and nothing shifts as images land.
          <div style={{ height: `${Math.round(total)}px` }} className="relative">
            {plan.map((leaf, index) => {
              const one = boxes[index]!;
              const image = images.get(`${leaf.source}#${leaf.page}@${rung}`);
              return (
                <div
                  key={leaf.uid}
                  data-page={index + 1}
                  style={{
                    position: "absolute",
                    insetInlineStart: 0,
                    insetInlineEnd: 0,
                    top: `${Math.round(tops[index] ?? 0)}px`,
                    height: `${Math.round(one.shown.height)}px`,
                  }}
                  className="flex items-center justify-center"
                >
                  {image ? (
                    <img
                      src={image}
                      alt={t("viewerPageAlt", { index: index + 1, total: count })}
                      style={{
                        width: `${Math.round(one.image.width)}px`,
                        height: `${Math.round(one.image.height)}px`,
                        transform: `rotate(${leaf.rotate}deg)`,
                      }}
                      className="max-w-none shrink-0 bg-white shadow-sm"
                    />
                  ) : (
                    // A page that has not been drawn keeps its exact place and says which
                    // page it is, so scrolling fast reads as a document rather than a void.
                    <span
                      style={{
                        width: `${Math.round(one.shown.width)}px`,
                        height: `${Math.round(one.shown.height)}px`,
                      }}
                      className="flex items-center justify-center rounded bg-card text-[11px] text-muted-foreground shadow-sm"
                    >
                      {t("viewerPageAlt", { index: index + 1, total: count })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** A stable, short key for a file path. Only ever used as a directory name. */
function hash(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) | 0;
  }
  return value;
}

/**
 * How many drawn pages are held at once.
 *
 * Twelve, not six hundred. A page at 1400 wide is 18–526 KB as the base64 the window
 * actually holds — measured — where a thumbnail is about ten, so the strip's cap and this
 * one answer different questions with the same word. Twelve covers a reader scrolling in
 * either direction and costs a few megabytes at worst.
 */
const PAGE_CAP = 12;

/**
 * The drawn pages, with one more remembered and the stalest forgotten.
 *
 * **A page on screen is never forgotten, even over the cap.** Evicting one would empty a slot
 * the reader is looking at, which asks for it again, which evicts another — a mill that draws
 * for ever and settles on nothing. At a wide zoom the run on screen can approach the cap on
 * its own, so this is reachable rather than theoretical.
 */
function remember(
  current: Map<string, string>,
  key: string,
  data: string,
  keep: ReadonlySet<string>,
): Map<string, string> {
  const next = new Map(current);
  next.set(key, data);
  for (const oldest of [...next.keys()]) {
    if (next.size <= PAGE_CAP) break;
    if (oldest === key || keep.has(oldest)) continue;
    next.delete(oldest);
  }
  return next;
}
