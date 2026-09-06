import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import OutputPreview from "@/components/output-preview";
import { useTranslations } from "@/i18n/provider";
import {
  engineCall,
  engineCancel,
  newJobId,
  onProgress,
  outputDir,
  pickDocument,
  type ConversionResult,
  type EngineStatus,
  type PickedDocument,
  type Probe,
  type Progress as EngineProgress,
  type Warning,
} from "@/lib/engine";

/**
 * Pick a document, look at it, convert it.
 *
 * This replaces the sleep probe that stood in for conversion through sprints 2 and 3.
 * The shape is the same because the shape was the point: a job with progress arriving
 * while it runs and a cancel that lands mid-flight. Only the work changed.
 *
 * Two things it deliberately does not do. It does not read the file — the path comes
 * from a picker on the Rust side, and the engine is the only thing that opens it. And
 * it does not receive the output: `convert` returns file *names*, because a hundred and
 * fifty rasterised pages through the IPC pipe is tens of megabytes of base64 for no
 * reason. See desktop/architecture.md §2.
 */
export default function ConvertPanel({ status }: { status: EngineStatus }) {
  const t = useTranslations("desktop");

  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState<"probing" | "converting" | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  // One subscription for the life of the panel; re-subscribing per job would drop
  // events in the gap between them.
  const active = useRef<string | null>(null);
  active.current = jobId;

  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;

    void onProgress((p) => {
      if (p.id === active.current) setProgress(p);
    }).then((unlisten) => {
      if (gone) unlisten();
      else stop = unlisten;
    });

    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  const choose = useCallback(async () => {
    const picked = await pickDocument();
    if (!picked) return; // cancelled, which is an answer rather than a failure

    setDocument(picked);
    setProbe(null);
    setResult(null);
    setOutcome(null);
    setBusy("probing");

    try {
      const id = await newJobId();
      setProbe(await engineCall<Probe>(id, "probe", { path: picked.path }));
    } catch (error) {
      setOutcome(t("convertFailed", { message: String(error) }));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const run = useCallback(async () => {
    if (!document) return;

    setResult(null);
    setOutcome(null);
    setProgress(null);
    setBusy("converting");

    const started = performance.now();
    const id = await newJobId();
    setJobId(id);

    try {
      const out = await outputDir(document.path);
      const converted = await engineCall<ConversionResult>(id, "convert", {
        path: document.path,
        out,
        formats: ["html", "react"],
        background: true,
      });
      setResult(converted);
      setOutcome(
        t("convertDone", {
          seconds: ((performance.now() - started) / 1000).toFixed(1),
          files: converted.files.length,
        }),
      );
    } catch (error) {
      const message = String(error);
      // The engine reports a cancel as an error because it does not know why it was
      // stopped. The window does.
      setOutcome(
        message.includes("CANCELLED") ? t("convertCancelled") : t("convertFailed", { message }),
      );
    } finally {
      setJobId(null);
      setBusy(null);
      setProgress(null);
    }
  }, [document, t]);

  const stop = useCallback(() => {
    if (jobId) void engineCancel(jobId);
  }, [jobId]);

  const converting = busy === "converting";
  const pages = progress?.pages ?? 0;
  const page = progress?.page ?? 0;
  const phase = progress ? t(`convertPhase${cap(progress.phase)}`) : "";

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void choose()} disabled={busy !== null}>
          <FileText className="size-4" />
          {t("convertPick")}
        </Button>

        <Button
          size="sm"
          onClick={() => void run()}
          disabled={!document || busy !== null || status.state !== "up"}
        >
          {converting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {t("convertRun")}
        </Button>

        {converting ? (
          <Button size="sm" variant="outline" onClick={stop}>
            <Square className="size-4" />
            {t("engineCancel")}
          </Button>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {busy === "probing"
          ? t("convertProbing")
          : document && probe
            ? t("convertPicked", { name: document.name, pages: probe.pages })
            : document
              ? document.name
              : t("convertNothing")}
      </p>

      {converting ? (
        <div className="space-y-1.5">
          {/* Empty until the first event: an empty bar is more honest than a full one. */}
          <Progress value={pages > 0 ? (page / pages) * 100 : 0} />
          <p className="tabular text-xs text-muted-foreground">
            {t("convertProgress", { phase, page, pages })}
          </p>
        </div>
      ) : null}

      {outcome ? <p className="text-xs">{outcome}</p> : null}

      {result ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t("convertOut")}</p>
          {/* The path is shown, not opened. Opening a folder needs a shell permission
              this app deliberately does not have. */}
          <p className="font-mono break-all text-[11px]">{result.out}</p>
          {result.warnings.map((warning) => (
            <p key={warning.code} className="text-warning">
              {wording(t, warning)}
            </p>
          ))}
        </div>
      ) : null}

      {result?.files.includes("index.html") ? (
        <OutputPreview dir={result.out} file="index.html" />
      ) : null}
    </div>
  );
}

/** The engine sends a code and parameters; the window owns the sentence. */
function wording(t: (key: string, params?: Record<string, string | number>) => string, w: Warning) {
  switch (w.code) {
    case "SCANNED":
      return t("convertScanned");
    case "TRUNCATED":
      return t("convertTruncated", w.params);
    case "GRAPHICS_DROPPED":
      return t("convertGraphics", w.params);
    case "UNMAPPED_GLYPHS":
      return t("convertUnmapped", w.params);
    default:
      // A code we have no wording for is still worth showing, in the engine's English.
      return w.message;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
