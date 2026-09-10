import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  ScanLine,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/i18n/provider";
import { engineCancel } from "@/lib/engine";
import { latest, pageBox, rungFor, step, viewedAt, type Fit } from "@/lib/viewer";
import { readImage, renderPages, workbenchDir, type Doc, type Leaf } from "@/lib/workbench";

/**
 * One page of the document, at a size somebody can actually read.
 *
 * **This is the whole of sprint מ1.** The workbench has shown pages since sprint 6, but at
 * 128 pixels — the right size for confirming a page exists and the wrong size for deciding
 * anything about it. Every operation the workbench offers, delete this page and turn that
 * one and move the third, was being performed on a grey smudge, and on a Hebrew document
 * the smudge is all there was.
 *
 * **The page on screen is the entry in the plan, not a page of the file.** The plan can
 * reorder, duplicate, trim and undo underneath the viewer, so it follows a `uid` and never
 * an index — the difference is `keepViewing` in `viewer.ts`, and it is the thing most worth
 * getting right here. Deleting page three while reading page seven must leave page seven on
 * screen, not the page that inherited its position.
 *
 * **Rendered at a rung, rotated in CSS.** Turning a page is instant and free that way,
 * where re-rendering would cost the 39–503 ms a page takes. The raster is the page as it
 * sits in the file; the quarter turns the plan adds are a transform on top, exactly as the
 * page strip has always done it.
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
  const [image, setImage] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  /**
   * The rendered page's own proportions, learned from the render rather than assumed.
   *
   * `Leaf` says which page of which file and how far it is turned; it does not carry a
   * size, because a plan is a description and two entries may point at pages of different
   * shapes. Fit-to-page needs the ratio, so it comes back with the image — and until the
   * first page has been drawn, fit-to-width is the only mode that can mean anything.
   */
  const [shape, setShape] = useState<{ width: number; height: number } | null>(null);

  const at = useMemo(() => viewedAt(plan, viewed), [plan, viewed]);
  const doc = docs.find((item) => item.path === at?.leaf.source);

  /**
   * The room the page has, measured rather than assumed.
   *
   * Fit-to-width is a statement about this box, and the box changes when the window
   * resizes, when the strip is scrolled, and when a message appears above it. A
   * `ResizeObserver` is the only thing that sees all three.
   *
   * **A callback ref and not an effect**, which is the whole reason this was broken once.
   * With no document open this component returns early and the scroll box does not exist,
   * so an effect with empty dependencies ran against `null`, attached nothing, and never
   * ran again — the box stayed at zero width, the render below returned early forever, and
   * the viewer sat on "rendering the page…" for a page it had never started. A callback ref
   * fires when the element actually arrives, which is the event that matters.
   */
  const watching = useRef<ResizeObserver | null>(null);
  const room = useCallback((element: HTMLDivElement | null) => {
    watching.current?.disconnect();
    watching.current = null;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    watching.current = observer;
    // Measured once immediately as well: the observer's first callback is a frame away,
    // and a frame of zero width is a frame of deciding not to render anything.
    const rect = element.getBoundingClientRect();
    setBox({ width: rect.width, height: rect.height });
  }, []);
  useEffect(() => () => watching.current?.disconnect(), []);

  /** One render in flight; a newer one cancels the older and drops its answer. */
  const want = useMemo(() => latest((id) => void engineCancel(id)), []);

  /** Cached by source, page and rung — a page already drawn at this size is not redrawn. */
  const cache = useRef<Map<string, string>>(new Map());
  const dirs = useRef<Map<string, string>>(new Map());
  const ratioKey = useRef<string>("");

  /**
   * The element's size, and the box it takes once turned.
   *
   * Two numbers, because a rotation makes them differ: the `<img>` is set to `image` and
   * the wrapper reserves `shown`. Sizing the element to the room and rotating it was the
   * bug — at 90° the element's width becomes the page's height on screen, so fitting to
   * width made the *height* fill the room and the page ran off the side.
   */
  const layout =
    at && box.width > 0 && shape
      ? pageBox(fit, zoom, box, shape, at.leaf.rotate)
      : null;
  const shownWidth = layout?.shown.width ?? (at && box.width > 0 ? box.width * zoom : 0);

  useEffect(() => {
    if (!at || !doc || box.width === 0) return;
    const rung = rungFor(shownWidth || box.width, 1, window.devicePixelRatio || 1);
    const key = `${at.leaf.source}#${at.leaf.page}@${rung}`;

    const cached = cache.current.get(key);
    if (cached) {
      setImage(cached);
      setProblem(null);
      return;
    }
    // A different page may be a different shape, and fitting the new one to the old
    // ratio would size it wrongly for exactly as long as the render takes.
    if (ratioKey.current !== `${at.leaf.source}#${at.leaf.page}`) setShape(null);
    ratioKey.current = `${at.leaf.source}#${at.leaf.page}`;
    // Nothing cached at this size. Keep the previous page on screen while the new one is
    // drawn rather than blanking: a flash of nothing between two pages reads as a fault.
    setDrawing(true);
    let live = true;

    void (async () => {
      try {
        // One directory per document and rung, so the 170px strip and a 2400px page cannot
        // write over each other — `thumbnails` names its files after the page number alone.
        const slot = `v-${rung}-${Math.abs(hash(at.leaf.source))}`;
        let dir = dirs.current.get(slot);
        if (!dir) {
          dir = await workbenchDir(slot);
          dirs.current.set(slot, dir);
        }

        const { id, done } = await renderPages(at.leaf.source, dir, rung, [at.leaf.page]);
        const made = await want(id, () => done);
        if (!live || made === null) return;

        const drawn = made[0];
        if (!drawn) return;
        const data = await readImage(drawn.path);
        if (!live) return;

        setShape({ width: drawn.width, height: drawn.height });
        cache.current.set(key, data);
        trim(cache.current);
        setImage(data);
        setProblem(null);
      } catch (failure) {
        if (live) setProblem(String(failure));
      } finally {
        if (live) setDrawing(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [at?.leaf.uid, at?.leaf.source, at?.leaf.page, doc, shownWidth, box.width, want]);

  const go = useCallback((by: number) => onView(step(plan, viewed, by)), [plan, viewed, onView]);

  // Page turning and zoom, on the keys a reader reaches for. Never while typing — the page
  // number field lives in this toolbar, and `4` there must be a digit and not a page turn.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.code === "PageDown") go(1);
      else if (event.code === "PageUp") go(-1);
      else if (event.code === "Home") onView(plan[0]?.uid ?? null);
      else if (event.code === "End") onView(plan[plan.length - 1]?.uid ?? null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onView, plan]);

  if (!at) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-divider">
        <p className="text-xs text-muted-foreground">{t("viewerEmpty")}</p>
      </div>
    );
  }

  const total = plan.length;
  // Before the first render there is no shape, so the page is guessed at a common ratio
  // and corrected the moment it arrives. Guessing is only for the placeholder's size.
  const element = layout?.image ?? {
    width: Math.max(40, shownWidth),
    height: Math.max(40, shownWidth) * 1.4,
  };
  const frame = layout?.shown ?? element;

  return (
    // `min-w-0` is load-bearing. A grid or flex child's automatic minimum is its content,
    // so at 100% on a large page the scroll box below would stop scrolling and stretch the
    // whole column instead — squeezing the page strip and pushing the window sideways.
    // Measured: a 4800px-wide page made the container 4841px rather than scrolling inside
    // its 1282.
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={t("viewerPrevious")}
          disabled={at.index === 0}
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
          disabled={at.index === total - 1}
          onClick={() => go(1)}
        >
          <ChevronLeft className="size-4 ltr:rotate-180" />
        </Button>

        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="sr-only">{t("viewerGoToPage")}</span>
          <Input
            type="number"
            min={1}
            max={total}
            value={at.index + 1}
            onChange={(event) => {
              const wanted = Number(event.target.value);
              if (Number.isFinite(wanted)) onView(plan[Math.min(total, Math.max(1, wanted)) - 1]?.uid ?? null);
            }}
            className="tabular h-7 w-14 text-xs"
            dir="ltr"
          />
          <span className="tabular whitespace-nowrap">{t("viewerOfTotal", { total })}</span>
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

        {/* A scanned page renders perfectly and carries no text. Said here, next to the
            page, because the strip at the top of the workbench is about the document and
            this is the moment somebody wonders why they cannot select a word. */}
        {doc?.scanned ? (
          <span className="flex items-center gap-1 text-[11px] text-warning">
            <ScanLine className="size-3.5 shrink-0" aria-hidden="true" />
            {t("viewerScanned")}
          </span>
        ) : null}
        {drawing || running ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>

      {problem ? (
        <p role="alert" className="text-[11px] text-destructive">
          {problem}
        </p>
      ) : null}

      <div
        ref={room}
        // `dir="ltr"`: a scroll box is a viewport, not text. Under RTL the horizontal
        // scroll origin flips and a page wider than its box opens showing its right edge.
        dir="ltr"
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-divider bg-muted/30 p-3"
      >
        <div className="flex min-h-full items-start justify-center">
          {image ? (
            // A rotation does not change what an element occupies in the layout, so a
            // quarter-turned page would be clipped by a box still shaped for it upright.
            // The wrapper is given the turned dimensions and the image is centred in it.
            <div
              style={{
                width: `${Math.round(frame.width)}px`,
                height: `${Math.round(frame.height)}px`,
              }}
              // Centred by flex rather than by `left-1/2` and a translate. Centring is
              // direction-neutral, but `left` is not: under RTL the logical form resolves
              // to `right` and the same translate then pushes the page off its own box.
              // `check-a11y` refused the physical property, and it was right to.
              className="flex shrink-0 items-center justify-center"
            >
              <img
                src={image}
                alt={t("viewerPageAlt", { index: at.index + 1, total })}
                style={{
                  width: `${Math.round(element.width)}px`,
                  height: `${Math.round(element.height)}px`,
                  transform: `rotate(${at.leaf.rotate}deg)`,
                }}
                className="max-w-none shrink-0 bg-white shadow-sm"
              />
            </div>
          ) : (
            // Only claims to be rendering when it is. The first version said "rendering
            // the page…" whenever there was no image, so a viewer that had never started
            // looked exactly like a viewer that was working — which is how a dead render
            // path went unnoticed until somebody opened a document.
            <p className="py-10 text-xs text-muted-foreground">
              {drawing ? t("viewerDrawing") : t("viewerNothingYet")}
            </p>
          )}
        </div>
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
 * How many full-size pages are held at once.
 *
 * Twelve, not six hundred. A page at 1400 wide is 18–526 KB as the base64 the window
 * actually holds — measured — where a thumbnail is about ten, so the strip's cap and this
 * one are answering different questions with the same word. Twelve covers a reader turning
 * pages in either direction and costs a few megabytes at worst.
 */
const PAGE_CAP = 12;

function trim(cache: Map<string, string>) {
  while (cache.size > PAGE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}
