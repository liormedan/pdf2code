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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "@/i18n/provider";
import { pickDocuments, type EngineStatus } from "@/lib/engine";
import { isTypingTarget } from "@/lib/utils";
import EngineDown from "@/components/engine-down";
import PageView from "@/components/page-view";
import { wordEngineError } from "@/lib/engine-words";
import { keepViewing } from "@/lib/viewer";
import {
  applyPlan,
  compressPlan,
  emptyPlan,
  exportPlanImages,
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
export default function WorkbenchPanel({
  status,
  shown,
}: {
  status: EngineStatus;
  /**
   * Whether the panel is the one on screen. It stays mounted behind the other modes so
   * a mode switch loses nothing, and while hidden it must not answer the keyboard.
   */
  shown: boolean;
}) {
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

  /**
   * Say what went wrong, in the reader's language, and keep the rest for the log.
   *
   * `String(failure)` used to go straight to the screen: PDFium's English, an engine
   * code, once a path. The code picks the sentence; the raw text goes to the console,
   * which the engine log already mirrors. A cancel says nothing at all.
   */
  const report = useCallback(
    (failure: unknown) => {
      const raw = String(failure);
      console.error(raw);
      const worded = wordEngineError(raw);
      if (worded) setError(t(worded.key, worded.params));
    },
    [t],
  );

  // page image, keyed `source#page`. Rendered by the engine to a scratch directory and
  // read back one at a time, so a three-hundred-page document does not arrive at once.
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const thumbPaths = useRef<Map<string, string>>(new Map());
  const fetching = useRef(false);

  const [query, setQuery] = useState("");
  /** The query whose results are on screen, lower-cased. Null before anything ran. */
  const [ran, setRan] = useState<string | null>(null);
  /**
   * Extracted page text, keyed `source#page`.
   *
   * State and not a ref, because the matches are **derived** from it rather than stored
   * beside it. Stored, they went stale the moment the plan changed: deleting a matched
   * page left the count unchanged, and merging a second document left it describing only
   * the first. Derived, every one of those corrects itself for free.
   */
  const [texts, setTexts] = useState<Map<string, string>>(new Map());

  /**
   * Which entry of the plan the page view is showing.
   *
   * A `uid` and never an index. The plan moves under the viewer constantly — reorder,
   * delete, keep-only, undo — and an index carried across any of those points at a
   * different page afterwards. `keepViewing` is the whole rule, and it is tested in
   * `viewer.test.ts` rather than by clicking, because "the viewer showed the wrong page"
   * is the kind of fault people notice once and never trust the tool after.
   */
  const [viewed, setViewed] = useState<string | null>(null);
  const lastPlan = useRef<Leaf[]>([]);
  useEffect(() => {
    setViewed((current) => keepViewing(lastPlan.current, plan.present, current));
    lastPlan.current = plan.present;
  }, [plan.present]);

  const running = busy !== null;

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

          opened.push({
            path: document.path,
            name: document.name,
            dir,
            // Everything the probe returned, not just the page count. What it costs to
            // keep is four fields; what it costs to drop is a scanned document that
            // opens looking ordinary.
            pages: probe.pages,
            scanned: probe.scanned,
            rtl: probe.rtl,
            chars: probe.chars,
            fonts: probe.fonts,
          });
          for (let page = 1; page <= probe.pages; page += 1) {
            leaves.push(leafOf(document.path, page));
          }
        }

        if (replace) {
          setDocs(opened);
          setSelected(new Set());
          dispatch({ type: "set", plan: leaves });
          // A different document: the extracted text is about something nobody is looking
          // at any more, and a search over it answers nothing. Both are dropped, so the
          // count disappears rather than becoming a confident zero.
          setTexts(new Map());
          setQuery("");
          setRan(null);
        } else {
          // Merging keeps both. The pages already searched keep their answer, and the
          // ones just added show up as unread — which is the case `unsearched` exists
          // for, and throwing the query away here would have hidden it.
          setDocs((current) => [...current, ...opened]);
          dispatch({ type: "append", leaves });
        }
      } catch (failure) {
        report(failure);
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
      const id = pageKey(leaf);
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
        const id = pageKey(leaf);
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
      // Clicking a page is how somebody says "this one", so it opens in the viewer too.
      // Separate gestures for "select" and "look at" would be one gesture too many.
      setViewed(uid);
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

  /**
   * The strip keeps the page on screen in view.
   *
   * It marked the viewed page — a ring, `aria-current`, "shown now" in the name — and
   * never moved to it, so after a jump to page twenty the marker sat somewhere below the
   * fold. `nearest` rather than `center`: a page already visible does not move at all,
   * and scrolling the run by hand does not make the strip lurch on every page boundary.
   * No animation for anyone who asked for none.
   */
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!viewed) return;
    const card = stripRef.current?.querySelector<HTMLElement>(`[data-uid="${viewed}"]`);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: still ? "auto" : "smooth" });
  }, [viewed]);
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
        // The refusal from either side of the boundary: the chosen file is one of the
        // sources. It is a question rather than a failure, so it is asked rather than
        // reported — and answered with `overwrite`, which is the one thing the gate lets
        // through for a save.
        if (message.includes("overwrite") || message.includes("SOURCE_OVERWRITE")) {
          setOverwriteAsk(path);
        } else {
          report(failure);
        }
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

  /**
   * Export the plan as images.
   *
   * One call with the plan, where this used to be a call per document with that
   * document's page numbers — sorted, and with duplicates removed. All three of those
   * were the user's own arrangement being undone on the way out: the order they dragged
   * the pages into, the page they kept twice, and every rotation, since a page number
   * carries no angle. What came out did not match what was on screen.
   */
  const exportImages = useCallback(async () => {
    const dir = await pickExportDir();
    if (!dir) return;
    setBusy(t("workbenchExporting"));
    setError(null);
    try {
      const result = await exportPlanImages(plan.present, dir, 2, "png", (event) =>
        setProgress({ page: event.page, pages: event.pages }),
      );
      setNote(t("workbenchExported", { count: result.images.length, path: dir }));
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [plan.present, t]);

  /**
   * Compress the document the plan describes.
   *
   * **Not `docs[0]`, which is what this used to do.** Deleting two hundred pages and
   * pressing compress produced the original file, at its original size, with every page
   * still in it — and the only sign was a saving figure that did not match. A workbench
   * whose output ignores the workbench is worse than one that refuses.
   *
   * **And not staged here, which is what this did next.** The window built the plan into
   * `staged.pdf` and handed the engine that file, so everything the engine could check
   * was about the copy: it measured the result against the staged size and reported
   * "0% saved" on a file it had more than doubled, and it refused only to write over the
   * staged copy — the save dialog could name the original. The engine takes the plan now
   * and does all of that against the sources, and the Rust gate refuses any output that
   * is an opened document before the engine is asked. What is left here is to say what
   * happened in the reader's language.
   */
  const compress = useCallback(async () => {
    const first = docs[0];
    if (!first) return;
    const path = await pickSavePath(`${first.name.replace(/\.pdf$/i, "")}-smaller.pdf`);
    if (!path) return;

    // Asked here as well, so the answer is immediate — but not only here. The rule is
    // kept by the Rust gate and the engine, which cannot be skipped by a click.
    if (docs.some((doc) => samePath(doc.path, path))) {
      setError(t("engineErrorSourceOverwrite"));
      return;
    }

    setBusy(t("workbenchCompressing"));
    setError(null);
    try {
      const scratch = await workbenchDir(`c-${Date.now().toString(36)}`);
      const result = await compressPlan(plan.present, path, scratch);
      setNote(
        t("workbenchCompressed", {
          saved: Math.round(result.saved / 1024),
          percent: Math.round((result.saved / Math.max(1, result.before)) * 100),
        }),
      );
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(null);
    }
  }, [docs, plan.present, t]);

  /**
   * Extract whatever the plan holds and has not been read yet.
   *
   * **This no longer decides anything.** It fills the text cache; the matches below are
   * derived from that cache and the plan, so they answer for the plan as it is now rather
   * than as it was when somebody pressed the button.
   */
  const search = useCallback(async () => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      setRan(null);
      return;
    }

    setBusy(t("workbenchSearching"));
    setError(null);
    try {
      const found = new Map(texts);
      for (const document of docs) {
        const wanted = pagesOf(document.path).filter(
          (page) => !found.has(`${document.path}#${page}`),
        );
        if (wanted.length === 0) continue;
        // The same extraction the converter uses, which is why Hebrew comes back in
        // reading order rather than reversed — situation 5, in a smaller place.
        for (const page of await pageText(document.path, wanted)) {
          found.set(`${document.path}#${page.page}`, page.lines.join("\n").toLowerCase());
        }
      }
      setTexts(found);
      setRan(needle);
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(null);
    }
  }, [query, docs, pagesOf, texts, t]);

  /** Which pages hold the query — recomputed whenever the plan or the text changes. */
  const matches = useMemo(() => {
    if (!ran) return null;
    return new Set(
      plan.present
        .filter((leaf) => (texts.get(pageKey(leaf)) ?? "").includes(ran))
        .map((leaf) => leaf.uid),
    );
  }, [ran, texts, plan.present]);

  /**
   * Pages in the plan whose text nobody has read.
   *
   * A document merged in after a search is exactly this, and saying "4 matches" over a
   * plan where sixty pages were never looked at is a true number that answers the wrong
   * question. Shown, with the search still there to press again.
   */
  const unsearched = useMemo(
    () => (ran ? plan.present.filter((leaf) => !texts.has(pageKey(leaf))).length : 0),
    [ran, texts, plan.present],
  );

  const nothing = plan.present.length === 0;
  const some = selected.size > 0;

  // Shortcuts for the six operations that already have buttons above. Placed before the
  // early return below so the hook still runs when the engine is down — React does not
  // allow a hook to appear only on some renders.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shown || running || isTypingTarget(event.target)) return;
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
      } else if (meta && event.code === "KeyO" && !event.shiftKey) {
        // The same key the converter uses to add documents, doing the workbench's version
        // of it: open when nothing is open, add when something is. The shell leaves this
        // key alone while the workbench is showing.
        event.preventDefault();
        void load(nothing);
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
  }, [shown, running, nothing, some, selected, plan.past.length, plan.future.length, saveAs, selectAll, load]);

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
          // Was `docs.length !== 1`, because it compressed the first source and could not
          // say anything sensible about two. It compresses the plan now, and a plan is
          // one document however many files it draws from.
          disabled={running || nothing}
        >
          <Minimize2 className="size-4" />
          {t("workbenchCompress")}
        </Button>
      </div>

      {/* --- what is actually open ------------------------------------------------------
          The probe was always called and only its page count was kept. These four fields
          arrived with it and cost nothing to show, and one of them — `scanned` — is the
          difference between a search that looks broken and one that says why it cannot
          answer. */}
      {docs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-divider px-4 py-1.5">
          {docs.map((document) => (
            <span
              key={document.path}
              className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <FileText className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate font-medium">{document.name}</span>
              <span className="tabular shrink-0">
                {t("workbenchDocPages", { pages: document.pages })}
              </span>
              {document.scanned ? (
                <Badge variant="outline" className="border-warning px-1.5 py-0 text-[10px] text-warning">
                  {t("workbenchDocScanned")}
                </Badge>
              ) : (
                <>
                  {/* Only claimed when characters were actually seen. A sampled page with
                      no Hebrew on it is not proof the document has none, so the absence
                      of this badge says nothing and is not worded as if it did. */}
                  {document.rtl > 0 ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{t("workbenchDocRtl")}</Badge> : null}
                  {document.fonts.length > 0 ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {t("workbenchDocFonts", { count: document.fonts.length })}
                    </Badge>
                  ) : null}
                </>
              )}
            </span>
          ))}
        </div>
      ) : null}

      {/* A scanned document is not a broken one, and the difference has to be said before
          somebody presses Find and reads zero as a defect. */}
      {docs.some((document) => document.scanned) ? (
        <p className="border-b border-warning/40 bg-warning-muted px-4 py-2 text-xs text-warning">
          {t("workbenchScannedExplained")}
        </p>
      ) : null}

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
            <span
              className="tabular text-[11px] text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {t("workbenchMatches", { count: matches.size })}
              {/* Pages the plan gained after the search ran. Saying "4 matches" over a
                  plan where sixty pages were never read is a true number answering a
                  question nobody asked. */}
              {unsearched > 0 ? ` · ${t("workbenchUnsearched", { count: unsearched })}` : ""}
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
        // Two shapes. Wide: the strip is a column beside the page. Narrow: it is a short row
        // above it, and the page gets the height — the first version split the height
        // between them, and on a 720×800 window the page was sixty-five pixels tall.
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[11rem_1fr] lg:grid-rows-none">
          {/* The strip. One column now rather than a grid filling the window: a grid is
              good for sorting and bad for reading, and reading is the thing the workbench
              could not do at all. Dragging is unchanged — it was always index-based, and a
              single column makes the drop position less ambiguous rather than more. */}
          <div ref={stripRef} className="max-h-32 min-h-0 overflow-auto lg:max-h-none">
          <ul className="flex flex-row gap-2 lg:flex-col">
            {plan.present.map((leaf, index) => (
              <li
                key={leaf.uid}
                data-uid={leaf.uid}
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
                // Three states a card can be in, and they answer different questions: is
                // it selected (an operation will affect it), does it match a search, and is
                // it the one on screen. The last gets a ring rather than a border colour,
                // so a page can be both viewed and selected without one hiding the other.
                className={`w-28 shrink-0 rounded-lg border p-1.5 transition-colors lg:w-auto lg:shrink ${
                  selected.has(leaf.uid)
                    ? "border-primary bg-accent/50"
                    : matches?.has(leaf.uid)
                      ? "border-warning"
                      : "border-divider"
                } ${leaf.uid === viewed ? "ring-2 ring-primary" : ""} ${
                  dropAt === index ? "ring-2 ring-primary/50" : ""
                }`}
              >
                {/* The name is on the button and not below it. Everything inside is a
                    picture — an `<img alt="">` or a spinner — so without this the button
                    reached the accessibility tree with no name at all: "button, pressed",
                    and no way to know which page. WCAG 4.1.2.

                    The number, the source and the angle are in the label; **whether it is
                    selected is not**, because `aria-pressed` already carries that and a
                    screen reader would otherwise say it twice. */}
                <button
                  type="button"
                  onClick={(event) => click(leaf.uid, event)}
                  aria-pressed={selected.has(leaf.uid)}
                  aria-current={leaf.uid === viewed ? "true" : undefined}
                  // Composed rather than one string with empty slots: a single message
                  // with placeholders would read "page 3 of 35, , 0°" in the common case.
                  aria-label={[
                    t("workbenchPageCard", { index: index + 1, total: plan.present.length }),
                    docs.length > 1 ? short(leaf.source) : null,
                    leaf.rotate ? t("workbenchPageTurned", { degrees: leaf.rotate }) : null,
                    leaf.uid === viewed ? t("workbenchPageShown") : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  className="block w-full cursor-pointer"
                >
                  {/* Square on purpose: a page turned a quarter turn swaps its width
                      and height, and in a square box neither can overflow. */}
                  <span className="flex h-16 w-full items-center justify-center overflow-hidden rounded bg-muted/40 lg:h-24">
                    {thumbs.get(pageKey(leaf)) ? (
                      <img
                        src={thumbs.get(pageKey(leaf))}
                        alt=""
                        style={{ transform: `rotate(${leaf.rotate}deg)` }}
                        className="max-h-14 max-w-14 shadow-sm transition-transform lg:max-h-20 lg:max-w-20"
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
            className={`mt-2 hidden rounded-lg border border-dashed px-2 py-2 text-center text-[10px] text-muted-foreground lg:block ${
              dropAt === plan.present.length ? "border-primary" : "border-divider"
            }`}
          >
            {t("workbenchDropEnd")}
          </div>
          </div>

          {/* The page, at a size somebody can read. The point of the sprint. */}
          <PageView
            plan={plan.present}
            docs={docs}
            viewed={viewed}
            onView={setViewed}
            running={running}
            shown={shown}
          />
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
/**
 * Whether two spellings name one file, as far as a string can tell.
 *
 * Slashes either way and case-blind, which is what Windows means by "the same path".
 * Good enough to answer at once; the Rust side does it properly, by resolving both.
 */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

const short = (path: string) => path.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") ?? path;

/**
 * What identifies a page across the caches — thumbnails and extracted text both.
 *
 * The source and the page, not the `uid`: a uid belongs to one entry in the plan, and the
 * same page taken twice is two entries holding one image and one piece of text.
 */
const pageKey = (leaf: Leaf) => `${leaf.source}#${leaf.page}`;
