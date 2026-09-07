import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  FileDown,
  FilePlus2,
  FileText,
  Images,
  Loader2,
  Minimize2,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "@/i18n/provider";
import { pickDocuments, type EngineStatus } from "@/lib/engine";
import { isTypingTarget } from "@/lib/utils";
import EngineDown from "@/components/engine-down";
import {
  applyPlan,
  compressDocument,
  emptyPlan,
  exportPageImages,
  leafOf,
  pageText,
  pickExportDir,
  pickSavePath,
  planReducer,
  probeDocument,
  readImage,
  renderThumbnails,
  workbenchDir,
  type Doc,
  type Leaf,
} from "@/lib/workbench";

/**
 * The workbench: pages of a document, laid out and rearranged.
 *
 * **One list on screen and one list in the engine.** Every control here edits the same
 * plan — rotate writes a field, reorder moves an entry, delete leaves one out, "keep
 * only these" is a shorter list, and opening a second document appends to it. That is
 * why there is no Merge button and no Split button: those are shapes this list takes,
 * and a button per shape would be six ways to get the same refusals wrong.
 *
 * **Nothing is written until somebody chooses where.** The plan is a description; the
 * source files on disk are untouched until Save opens a native dialog. That is also the
 * only way a path becomes writable at all — see workbench.rs.
 */
export default function WorkbenchPanel({ status }: { status: EngineStatus }) {
  const t = useTranslations("desktop");

  const [docs, setDocs] = useState<Doc[]>([]);
  const [plan, dispatch] = useReducer(planReducer, emptyPlan);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ page: number; pages: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** A save that would land on one of the sources, waiting for a yes. */
  const [overwriteAsk, setOverwriteAsk] = useState<string | null>(null);

  // page image, keyed `source#page`. Rendered by the engine to a scratch directory and
  // read back one at a time, so a three-hundred-page document does not arrive at once.
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const thumbPaths = useRef<Map<string, string>>(new Map());
  const fetching = useRef(false);

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Set<string> | null>(null);
  const texts = useRef<Map<string, string>>(new Map());

  const running = busy !== null;
  const key = (leaf: Leaf) => `${leaf.source}#${leaf.page}`;

  // --- opening documents ----------------------------------------------------------
  const load = useCallback(
    async (replace: boolean) => {
      const picked = await pickDocuments();
      if (picked.length === 0) return;

      setError(null);
      setNote(null);
      const opened: Doc[] = [];
      const leaves: Leaf[] = [];

      try {
        for (const document of picked) {
          setBusy(t("workbenchReading", { name: document.name }));
          const probe = await probeDocument(document.path);

          // A slot rather than the path: it becomes a directory name on the Rust side,
          // and that side accepts letters, digits and dashes only.
          const slot = `d-${Date.now().toString(36)}-${opened.length}`;
          const dir = await workbenchDir(slot);

          setBusy(t("workbenchRendering", { name: document.name }));
          const rendered = await renderThumbnails(document.path, dir, 170, (event) =>
            setProgress({ page: event.page, pages: event.pages }),
          );
          for (const thumb of rendered) {
            thumbPaths.current.set(`${document.path}#${thumb.page}`, thumb.path);
          }

          opened.push({ path: document.path, name: document.name, pages: probe.pages, dir });
          for (let page = 1; page <= probe.pages; page += 1) {
            leaves.push(leafOf(document.path, page));
          }
        }

        if (replace) {
          setDocs(opened);
          setSelected(new Set());
          dispatch({ type: "set", plan: leaves });
        } else {
          setDocs((current) => [...current, ...opened]);
          dispatch({ type: "append", leaves });
        }
        setMatches(null);
      } catch (failure) {
        setError(String(failure));
      } finally {
        setBusy(null);
        setProgress(null);
      }
    },
    [t],
  );

  // --- the page images, fetched in the order they are shown --------------------------
  useEffect(() => {
    if (fetching.current) return;
    const missing = plan.present.filter((leaf) => {
      const id = key(leaf);
      return thumbPaths.current.has(id) && !thumbs.has(id);
    });
    if (missing.length === 0) return;

    fetching.current = true;
    let live = true;

    void (async () => {
      // In batches, so a long document paints as it arrives rather than in one jump at
      // the end — and so five hundred pages are not five hundred renders of the grid.
      let batch = new Map<string, string>();
      for (const leaf of missing) {
        if (!live) break;
        const id = key(leaf);
        try {
          batch.set(id, await readImage(thumbPaths.current.get(id) as string));
        } catch {
          // A thumbnail that will not load is a missing picture, not a failed edit.
          batch.set(id, "");
        }
        if (batch.size >= 8) {
          const done = batch;
          batch = new Map();
          setThumbs((current) => merge(current, done));
        }
      }
      if (live && batch.size > 0) {
        const done = batch;
        setThumbs((current) => merge(current, done));
      }
      fetching.current = false;
    })();

    return () => {
      live = false;
      fetching.current = false;
    };
  }, [plan.present, thumbs]);

  // --- selection --------------------------------------------------------------------
  const lastClicked = useRef<string | null>(null);

  const click = useCallback(
    (uid: string, event: React.MouseEvent) => {
      const plainList = plan.present;
      setSelected((current) => {
        if (event.shiftKey && lastClicked.current) {
          const from = plainList.findIndex((leaf) => leaf.uid === lastClicked.current);
          const to = plainList.findIndex((leaf) => leaf.uid === uid);
          if (from >= 0 && to >= 0) {
            const [start, end] = from < to ? [from, to] : [to, from];
            const next = new Set(current);
            for (const leaf of plainList.slice(start, end + 1)) next.add(leaf.uid);
            return next;
          }
        }
        if (event.ctrlKey || event.metaKey) {
          const next = new Set(current);
          if (next.has(uid)) next.delete(uid);
          else next.add(uid);
          return next;
        }
        // A plain click on the only selected page clears it, which is how somebody
        // gets back to "nothing selected" without hunting for a button.
        return current.size === 1 && current.has(uid) ? new Set() : new Set([uid]);
      });
      lastClicked.current = uid;
    },
    [plan.present],
  );

  const selectAll = useCallback(
    () => setSelected(new Set(plan.present.map((leaf) => leaf.uid))),
    [plan.present],
  );

  // Keep the selection honest: a page that was deleted or undone away is not selected.
  useEffect(() => {
    setSelected((current) => {
      const alive = new Set(plan.present.map((leaf) => leaf.uid));
      if ([...current].every((uid) => alive.has(uid))) return current;
      return new Set([...current].filter((uid) => alive.has(uid)));
    });
  }, [plan.present]);

  // --- dragging to reorder ------------------------------------------------------------
  const dragging = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  // --- saving ---------------------------------------------------------------------------
  const suggested = useMemo(() => {
    const first = docs[0];
    if (!first) return "document.pdf";
    return `${first.name.replace(/\.pdf$/i, "")}-edited.pdf`;
  }, [docs]);

  const save = useCallback(
    async (path: string, overwrite: boolean) => {
      setBusy(t("workbenchSaving"));
      setError(null);
      try {
        const result = await applyPlan(plan.present, path, overwrite);
        setOverwriteAsk(null);
        setNote(t("workbenchSaved", { pages: result.pages, path: result.out }));
      } catch (failure) {
        const message = String(failure);
        // The engine's own refusal: the chosen file is one of the sources. It is a
        // question rather than a failure, so it is asked rather than reported.
        if (message.includes("overwrite")) setOverwriteAsk(path);
        else setError(message);
      } finally {
        setBusy(null);
      }
    },
    [plan.present, t],
  );

  const saveAs = useCallback(async () => {
    const path = await pickSavePath(suggested);
    if (path) await save(path, false);
  }, [suggested, save]);

  // --- the rest of the workbench ----------------------------------------------------------
  const pagesOf = useCallback(
    (source: string) =>
      [...new Set(plan.present.filter((l) => l.source === source).map((l) => l.page))].sort(
        (a, b) => a - b,
      ),
    [plan.present],
  );

  const exportImages = useCallback(async () => {
    const dir = await pickExportDir();
    if (!dir) return;
    setBusy(t("workbenchExporting"));
    setError(null);
    try {
      let count = 0;
      for (const document of docs) {
        const pages = pagesOf(document.path);
        if (pages.length === 0) continue;
        const result = await exportPageImages(document.path, dir, pages);
        count += result.images.length;
      }
      setNote(t("workbenchExported", { count, path: dir }));
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(null);
    }
  }, [docs, pagesOf, t]);

  const compress = useCallback(async () => {
    const source = docs[0];
    if (!source) return;
    const path = await pickSavePath(`${source.name.replace(/\.pdf$/i, "")}-smaller.pdf`);
    if (!path) return;

    setBusy(t("workbenchCompressing"));
    setError(null);
    try {
      const result = await compressDocument(source.path, path);
      // What it actually saved, including when that is nothing. A button that promises
      // compression and reports the same number is worse than no button.
      setNote(
        result.saved > 0
          ? t("workbenchCompressed", {
              saved: Math.round(result.saved / 1024),
              percent: Math.round((result.saved / Math.max(1, result.before)) * 100),
            })
          : t("workbenchCompressedNothing"),
      );
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(null);
    }
  }, [docs, t]);

  const search = useCallback(async () => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      setMatches(null);
      return;
    }

    setBusy(t("workbenchSearching"));
    setError(null);
    try {
      for (const document of docs) {
        const wanted = pagesOf(document.path).filter(
          (page) => !texts.current.has(`${document.path}#${page}`),
        );
        if (wanted.length === 0) continue;
        // The same extraction the converter uses, which is why Hebrew comes back in
        // reading order rather than reversed — situation 5, in a smaller place.
        for (const found of await pageText(document.path, wanted)) {
          texts.current.set(
            `${document.path}#${found.page}`,
            found.lines.join("\n").toLowerCase(),
          );
        }
      }
      setMatches(
        new Set(
          plan.present
            .filter((leaf) => (texts.current.get(key(leaf)) ?? "").includes(needle))
            .map((leaf) => leaf.uid),
        ),
      );
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(null);
    }
  }, [query, docs, pagesOf, plan.present, t]);

  const nothing = plan.present.length === 0;
  const some = selected.size > 0;

  // Shortcuts for the six operations that already have buttons above. Placed before the
  // early return below so the hook still runs when the engine is down — React does not
  // allow a hook to appear only on some renders.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (running || isTypingTarget(event.target)) return;
      const meta = event.ctrlKey || event.metaKey;

      if (meta && event.code === "KeyZ" && !event.shiftKey) {
        if (plan.past.length === 0) return;
        event.preventDefault();
        dispatch({ type: "undo" });
      } else if (meta && (event.code === "KeyY" || (event.code === "KeyZ" && event.shiftKey))) {
        if (plan.future.length === 0) return;
        event.preventDefault();
        dispatch({ type: "redo" });
      } else if (meta && event.code === "KeyA" && !nothing) {
        event.preventDefault();
        selectAll();
      } else if (meta && event.code === "KeyS" && !nothing) {
        event.preventDefault();
        void saveAs();
      } else if (!meta && some && (event.code === "Delete" || event.code === "Backspace")) {
        event.preventDefault();
        dispatch({ type: "remove", uids: selected });
      } else if (!meta && some && event.code === "KeyR") {
        event.preventDefault();
        dispatch({ type: "rotate", uids: selected, turn: event.shiftKey ? -90 : 90 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, nothing, some, selected, plan.past.length, plan.future.length, saveAs, selectAll]);

  if (status.state !== "up") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm">
          <EngineDown />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* --- what you can do to the pages ------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-divider px-4 py-2">
        <Button size="sm" variant="outline" onClick={() => void load(true)} disabled={running}>
          <FileText className="size-4" />
          {t("workbenchOpen")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void load(false)}
          disabled={running || nothing}
        >
          <FilePlus2 className="size-4" />
          {t("workbenchAdd")}
        </Button>

        <Divider />

        <Tool
          label={t("workbenchRotateLeft")}
          icon={RotateCcw}
          disabled={running || !some}
          onClick={() => dispatch({ type: "rotate", uids: selected, turn: -90 })}
        />
        <Tool
          label={t("workbenchRotateRight")}
          icon={RotateCw}
          disabled={running || !some}
          onClick={() => dispatch({ type: "rotate", uids: selected, turn: 90 })}
        />
        <Tool
          label={t("workbenchDelete")}
          icon={Trash2}
          disabled={running || !some}
          onClick={() => dispatch({ type: "remove", uids: selected })}
        />
        <Tool
          label={t("workbenchKeep")}
          icon={Scissors}
          disabled={running || !some}
          onClick={() => dispatch({ type: "keep", uids: selected })}
        />

        <Divider />

        <Tool
          label={t("workbenchUndo")}
          icon={Undo2}
          disabled={running || plan.past.length === 0}
          onClick={() => dispatch({ type: "undo" })}
        />
        <Tool
          label={t("workbenchRedo")}
          icon={Redo2}
          disabled={running || plan.future.length === 0}
          onClick={() => dispatch({ type: "redo" })}
        />

        <Divider />

        <Button size="sm" onClick={() => void saveAs()} disabled={running || nothing}>
          <Save className="size-4" />
          {t("workbenchSave")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void exportImages()}
          disabled={running || nothing}
        >
          <Images className="size-4" />
          {t("workbenchExport")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void compress()}
          disabled={running || docs.length !== 1}
        >
          <Minimize2 className="size-4" />
          {t("workbenchCompress")}
        </Button>
      </div>

      {/* --- finding a page by what is written on it ---------------------------------- */}
      {!nothing ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-divider px-4 py-1.5">
          <div className="flex min-w-52 flex-1 items-center gap-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
              placeholder={t("workbenchSearchHint")}
              className="h-7 text-xs"
              disabled={running}
            />
            <Button size="sm" variant="ghost" onClick={() => void search()} disabled={running}>
              {t("workbenchSearchRun")}
            </Button>
          </div>
          {matches ? (
            <span className="tabular text-[11px] text-muted-foreground">
              {t("workbenchMatches", { count: matches.size })}
            </span>
          ) : null}
          <span className="tabular text-[11px] text-muted-foreground">
            {t("workbenchCount", { pages: plan.present.length, docs: docs.length })}
            {some ? ` · ${t("workbenchSelected", { count: selected.size })}` : ""}
          </span>
          <Button size="sm" variant="ghost" onClick={selectAll} disabled={running}>
            <Copy className="size-3.5" />
            {t("workbenchSelectAll")}
          </Button>
        </div>
      ) : null}

      {/* --- what happened ------------------------------------------------------------- */}
      {busy ? (
        <div className="space-y-1 border-b border-divider px-4 py-2" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {busy}
          </p>
          {progress ? (
            <Progress value={(progress.page / Math.max(1, progress.pages)) * 100} />
          ) : null}
        </div>
      ) : null}

      {overwriteAsk ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning-muted px-4 py-2">
          <p className="flex-1 text-xs text-warning">{t("workbenchOverwriteAsk")}</p>
          <Button size="sm" variant="outline" onClick={() => void save(overwriteAsk, true)}>
            {t("workbenchOverwriteYes")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOverwriteAsk(null)}>
            {t("workbenchOverwriteNo")}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="border-b border-divider px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {note ? (
        <p
          role="status"
          aria-live="polite"
          className="border-b border-divider px-4 py-2 text-xs break-all text-muted-foreground"
        >
          {note}
        </p>
      ) : null}

      {/* --- the pages ------------------------------------------------------------------ */}
      {nothing ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-8 text-center">
          <p className="text-sm text-muted-foreground">{t("workbenchEmpty")}</p>
          <p className="max-w-md text-xs text-muted-foreground/80">{t("workbenchEmptyHint")}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {plan.present.map((leaf, index) => (
              <li
                key={leaf.uid}
                draggable={!running}
                onDragStart={() => {
                  dragging.current = leaf.uid;
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropAt(index);
                }}
                onDragEnd={() => {
                  dragging.current = null;
                  setDropAt(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging.current) dispatch({ type: "move", uid: dragging.current, to: index });
                  dragging.current = null;
                  setDropAt(null);
                }}
                className={`rounded-lg border p-1.5 transition-colors ${
                  selected.has(leaf.uid)
                    ? "border-primary bg-accent/50"
                    : matches?.has(leaf.uid)
                      ? "border-warning"
                      : "border-divider"
                } ${dropAt === index ? "ring-2 ring-primary/50" : ""}`}
              >
                <button
                  type="button"
                  onClick={(event) => click(leaf.uid, event)}
                  aria-pressed={selected.has(leaf.uid)}
                  className="block w-full cursor-pointer"
                >
                  {/* Square on purpose: a page turned a quarter turn swaps its width
                      and height, and in a square box neither can overflow. */}
                  <span className="flex h-36 w-full items-center justify-center overflow-hidden rounded bg-muted/40">
                    {thumbs.get(key(leaf)) ? (
                      <img
                        src={thumbs.get(key(leaf))}
                        alt=""
                        style={{ transform: `rotate(${leaf.rotate}deg)` }}
                        className="max-h-32 max-w-32 shadow-sm transition-transform"
                      />
                    ) : (
                      <Loader2
                        className="size-4 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>

                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className="tabular min-w-0 truncate text-[11px] text-muted-foreground">
                    {index + 1}
                    {docs.length > 1 ? ` · ${short(leaf.source)}` : ""}
                    {leaf.rotate ? ` · ${leaf.rotate}°` : ""}
                  </span>
                  <span className="flex shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-5"
                      aria-label={t("workbenchEarlier")}
                      disabled={running || index === 0}
                      onClick={() => dispatch({ type: "nudge", uid: leaf.uid, by: -1 })}
                    >
                      <ChevronUp className="size-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-5"
                      aria-label={t("workbenchLater")}
                      disabled={running || index === plan.present.length - 1}
                      onClick={() => dispatch({ type: "nudge", uid: leaf.uid, by: 1 })}
                    >
                      <ChevronDown className="size-3" />
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {/* Dropping past the last card is how a page gets moved to the end. */}
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDropAt(plan.present.length);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging.current)
                dispatch({ type: "move", uid: dragging.current, to: plan.present.length });
              dragging.current = null;
              setDropAt(null);
            }}
            className={`mt-3 rounded-lg border border-dashed px-4 py-3 text-center text-[11px] text-muted-foreground ${
              dropAt === plan.present.length ? "border-primary" : "border-divider"
            }`}
          >
            {t("workbenchDropEnd")}
          </div>
        </div>
      )}

      <p className="flex shrink-0 items-center gap-1.5 border-t border-divider px-4 py-1.5 text-[11px] text-muted-foreground">
        <FileDown className="size-3 shrink-0" aria-hidden="true" />
        {t("workbenchUntouched")}
      </p>
    </div>
  );
}

function Tool({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof RotateCw;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} disabled={disabled} title={label}>
      <Icon className="size-4" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Button>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-divider" aria-hidden="true" />;

/**
 * How many page images are kept in memory at once.
 *
 * Measured rather than guessed: five hundred and twenty thumbnails of a real document
 * weigh 1.8 MB on disk and 2.4 MB as the base64 the window actually holds. So this is not
 * the tight budget it was filed as — six hundred is roughly three megabytes, which is
 * nothing, and the cap exists for the document nobody has tried yet rather than for the
 * ones we measured. A five-thousand-page book would otherwise ask the WebView to hold
 * twenty-three.
 */
const THUMBNAIL_CAP = 600;

/**
 * Add newly loaded images, dropping the oldest once the cap is reached.
 *
 * Insertion order is eviction order, which is right here because images are fetched in
 * the order the pages are shown: the ones dropped first are the ones furthest from what
 * anybody is looking at. A dropped thumbnail is re-fetched when it is scrolled back to —
 * five milliseconds of work, against a map that grows without limit.
 */
function merge(current: Map<string, string>, loaded: Map<string, string>): Map<string, string> {
  const next = new Map([...current, ...loaded]);
  if (next.size <= THUMBNAIL_CAP) return next;

  const drop = next.size - THUMBNAIL_CAP;
  let dropped = 0;
  for (const id of next.keys()) {
    if (dropped >= drop) break;
    // Never evict something this batch just loaded — it is about to be rendered.
    if (loaded.has(id)) continue;
    next.delete(id);
    dropped += 1;
  }
  return next;
}

/** Just the file name, for a card that has to say which document it came from. */
const short = (path: string) => path.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") ?? path;
