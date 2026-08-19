"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toHtml } from "@/src/converter/html.ts";
import { loadPdfjs, openPdf } from "@/src/lib/pdf-client.ts";
import { bytesFor, type PreparedDocument } from "@/src/lib/intake.ts";
import type { ConversionResult } from "@/src/converter/types.ts";

type Mode = "compare" | "output" | "code";

interface SheetProps {
  width: number;
  height: number;
  children: (scale: number) => ReactNode;
}

const MODES: Mode[] = ["compare", "output", "code"];

/**
 * How much of a file is laid out before the viewer asks first.
 *
 * Not a cap on what you can see — the rest is one button away, and Copy always takes
 * the whole file regardless of what is on screen. It exists because page backgrounds
 * are inlined as data URIs, so a graphics-heavy document produces a single HTML file
 * of many megabytes, and laying that out as text would lock the tab up for minutes.
 */
const CODE_LIMIT = 200_000;

/**
 * A viewer for the conversion result.
 *
 * Everything shown is the real artifact, never an approximation: the rendered page is
 * built from the same HTML the ZIP contains, and the code tab shows those exact files.
 * Compare mode puts the source page beside it, because the only question that matters
 * is whether the two match.
 */
export default function OutputPreview({ result, original }: { result: ConversionResult; original: PreparedDocument | null }) {
  const t = useTranslations("preview");
  const [mode, setMode] = useState<Mode>("compare");
  const [index, setIndex] = useState(0);
  const [activeFile, setActiveFile] = useState<string>(() => Object.keys(result.files)[0] ?? "");

  const total = result.pages.length;
  const page = result.pages[Math.min(index, total - 1)]!;

  useEffect(() => {
    if (index > total - 1) setIndex(0);
  }, [total, index]);

  const html = toHtml([page], {
    title: `Page ${page.number}`,
    backgrounds: [result.backgrounds?.[index] ?? null],
    lang: result.info.lang,
    dir: result.info.dir,
    responsive: false,
    // The frame is already exactly page-sized, so the viewer's grey surround would
    // only show as a band across the top and push the page out of alignment with the
    // original beside it.
    bare: true,
  });

  const source = result.files[activeFile] ?? "";
  const [expanded, setExpanded] = useState(false);
  const clipped = source.length > CODE_LIMIT && !expanded;

  // Switching files starts over: what you chose to expand says nothing about the next
  // file, which may be a hundred times the size.
  useEffect(() => setExpanded(false), [activeFile]);

  return (
    <div className="overflow-hidden rounded-xl border border-divider bg-muted">
      <div className="flex items-center gap-3 border-b border-divider bg-card px-3 py-2">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            {MODES.map((m) => (
              <TabsTrigger key={m} value={m} title={t(`${m}Hint`)}>
                {t(m)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <span className="tabular ms-auto font-mono text-xs whitespace-nowrap text-muted-foreground">
          {mode === "code"
            ? `${(source.length / 1024).toFixed(1)} KB`
            : `${Math.round(page.width)} × ${Math.round(page.height)} px · ${
                result.backgrounds?.[index] ? t("withGraphics") : t("textOnly")
              }`}
        </span>

        {mode === "code" && <CopyButton text={source} />}
      </div>

      {mode === "code" ? (
        <div>
          <div className="flex gap-1.5 overflow-x-auto border-b border-divider bg-card px-3 py-2">
            {Object.keys(result.files).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setActiveFile(name)}
                aria-current={name === activeFile}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 font-mono text-[11.5px] whitespace-nowrap transition-colors",
                  name === activeFile
                    ? "border-primary/40 bg-accent text-accent-foreground"
                    : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {name}
              </button>
            ))}
          </div>
          {/* A plain scroll container, not the ScrollArea primitive: that one sizes its
              viewport with height:100%, which resolves to nothing against a parent that
              only has a max-height — so the content was clipped with no way to scroll
              to the rest of it. max-height plus overflow needs no such resolution, and
              it keeps native keyboard scrolling and find-in-page working. */}
          <div
            tabIndex={0}
            className="max-h-[60vh] overflow-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <pre className="w-max min-w-full p-4 font-mono text-xs leading-relaxed text-muted-foreground">
              <code>{clipped ? source.slice(0, CODE_LIMIT) : source}</code>
            </pre>

            {clipped && (
              <div className="flex flex-wrap items-center gap-3 border-t border-divider bg-card px-4 py-3">
                <span className="text-xs text-warning">
                  {t("truncated", {
                    shown: Math.round(CODE_LIMIT / 1000),
                    total: Math.round(source.length / 1000),
                  })}
                </span>
                <Button variant="outline" size="sm" className="ms-auto" onClick={() => setExpanded(true)}>
                  {t("showAll")}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={cn(mode === "compare" && "grid md:grid-cols-2")}>
          {mode === "compare" && (
            <Pane label={t("original")}>
              <SourcePage source={original} pageNumber={page.number} width={page.width} height={page.height} fallback={t("renderFailed")} />
            </Pane>
          )}
          <Pane
            label={mode === "compare" ? t("converted") : t("output")}
            accent={mode === "compare"}
            bordered={mode === "compare"}
          >
            <Sheet width={page.width} height={page.height}>
              {(scale) => (
                <iframe
                  title={t("pageOf", { page: page.number, total })}
                  // No allow-same-origin and no allow-scripts: the preview needs
                  // neither, so it gets neither.
                  sandbox=""
                  srcDoc={html}
                  className="pointer-events-none absolute top-0 start-0 origin-top-left border-0 bg-white"
                  style={{ width: page.width, height: page.height, transform: `scale(${scale})` }}
                />
              )}
            </Sheet>
          </Pane>
        </div>
      )}

      {mode !== "code" && total > 1 && (
        <div className="flex items-center justify-center gap-4 border-t border-divider bg-card p-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            aria-label={t("previousPage")}
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <span className="tabular min-w-32 text-center font-mono text-xs text-muted-foreground">
            {t("pageOf", { page: page.number, total })}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            disabled={index === total - 1}
            aria-label={t("nextPage")}
          >
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Copy the whole file, never the part that happens to be laid out.
 *
 * The clipboard is the reason the viewer can clip long files at all: what is on screen
 * is a rendering decision, and this is not affected by it.
 */
function CopyButton({ text }: { text: string }) {
  const t = useTranslations("preview");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const id = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(id);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // Denied permission, or an insecure origin where the API does not exist at all.
      setState("failed");
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={copy}
      disabled={!text}
      aria-live="polite"
      className={cn("gap-1.5", state === "failed" && "border-destructive text-destructive")}
    >
      {state === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {t(state === "copied" ? "copied" : state === "failed" ? "copyFailed" : "copy")}
    </Button>
  );
}

function Pane({ label, accent = false, bordered = false, children }: { label: string; accent?: boolean; bordered?: boolean; children: ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col", bordered && "md:border-e md:border-divider")}>
      <div className="px-3 pt-2">
        <span
          className={cn(
            "font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase",
            accent ? "text-primary" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </div>
      {children}
    </section>
  );
}

/**
 * Scales a fixed-size page to the width actually available. Measured, not guessed —
 * page sizes range from A5 to architectural plans.
 */
function Sheet({ width, height, children }: SheetProps) {
  const stage = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 24) / width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div
      ref={stage}
      className="flex max-h-[56vh] min-h-50 items-start justify-center overflow-auto p-3"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, transparent 0 6px, color-mix(in srgb, var(--foreground) 3%, transparent) 6px 7px)",
      }}
    >
      {scale > 0 && (
        <div
          className="relative flex-none overflow-hidden bg-white shadow-lg"
          style={{ width: width * scale, height: height * scale }}
        >
          {children(scale)}
        </div>
      )}
    </div>
  );
}

/**
 * Renders one page of the source document, for side-by-side comparison.
 *
 * It reads the prepared PDF rather than the file the user picked, which is the same
 * thing for a PDF and the converted deck for a PowerPoint — either way, what sits
 * beside the output is what the converter actually read.
 */
function SourcePage({ source, pageNumber, width, height, fallback }: { source: PreparedDocument | null; pageNumber: number; width: number; height: number; fallback: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let doc: Awaited<ReturnType<typeof openPdf>> | null = null;

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (!source) return;
        doc = await openPdf(bytesFor(source), pdfjs);
        if (cancelled) return;

        const page = await doc.getPage(pageNumber);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: dpr });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        // Reopening per page is cheap next to holding a whole document in memory
        // behind a preview the user may glance at once.
        await doc?.destroy().catch(() => {});
      }
    })();

    return () => { cancelled = true; };
  }, [source, pageNumber]);

  return (
    <Sheet width={width} height={height}>
      {(scale) =>
        failed ? (
          <p className="p-4 font-mono text-xs text-destructive">{fallback}</p>
        ) : (
          <canvas ref={canvasRef} className="block" style={{ width: width * scale, height: height * scale }} />
        )
      }
    </Sheet>
  );
}
