"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Download, Loader2, Presentation, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { createJob, buildZip, downloadBlob, type Job, type JobState } from "@/src/lib/conversion-service.ts";
import { loadPdfjs, openPdf, PdfOpenError } from "@/src/lib/pdf-client.ts";
import { bytesFor, fromSlides, prepare, IntakeError, type IntakeStage, type PreparedDocument } from "@/src/lib/intake.ts";
import { pickPresentation, slidesConfig, SlidesError } from "@/src/lib/google-slides.ts";
import { validateFile, acceptAttribute, detectKind, pptxEnabled, MAX_PAGES, MAX_BYTES } from "@/src/lib/pricing.ts";
import { useActivity } from "@/src/lib/session-activity";
import { usePendingFile } from "@/src/lib/pending-file";
import type { ConversionResult, ConversionWarning, OutputFormat } from "@/src/converter/types.ts";
import OutputPreview from "./OutputPreview";

const FORMATS: OutputFormat[] = ["html", "react"];

// Fixed at build time, since the configuration is inlined then. A deployment without
// Google credentials never shows the button rather than offering one that cannot work.
const SLIDES_ENABLED = slidesConfig() !== null;

/** What we learn from a quick probe of page 1, before any conversion runs. */
interface DocProbe {
  pages: number;
  scanned: boolean;
  tooLong: boolean;
}

export default function Converter() {
  const t = useTranslations("convert");
  const tWarn = useTranslations("warnings");
  const { record } = useActivity();
  const { take } = usePendingFile();

  const [source, setSource] = useState<PreparedDocument | null>(null);
  const [doc, setDoc] = useState<DocProbe | null>(null);
  // Null when nothing is in flight; otherwise which part of intake is running, because
  // "reading a file" and "converting a deck on the server" deserve different words.
  const [stage, setStage] = useState<IntakeStage | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formats, setFormats] = useState<OutputFormat[]>(["html"]);
  const [background, setBackground] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [job, setJob] = useState<JobState>({
    status: "idle", progress: 0, message: "", result: null, error: null,
  });

  const jobRef = useRef<Job | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const recorded = useRef<ConversionResult | null>(null);

  if (!jobRef.current) jobRef.current = createJob({ onChange: setJob });
  const job$ = jobRef.current;

  const busy = job.status === "reading" || job.status === "processing";

  /**
   * Take in a document, however it was obtained.
   *
   * A PowerPoint file becomes a PDF on the server and a Slides deck is exported by
   * Google; by the time `obtain` resolves, all three routes have converged on PDF
   * bytes, and everything from the probe onwards is the same work.
   */
  const accept = useCallback(async (obtain: () => Promise<PreparedDocument>) => {
    setFileError(null);
    setSource(null);
    setDoc(null);
    setStage("reading");
    job$.reset();

    try {
      const ready = await obtain();

      const pdfjs = await loadPdfjs();
      const pdf = await openPdf(bytesFor(ready), pdfjs);
      const page = await pdf.getPage(1);
      const { items } = await page.getTextContent();
      const chars = items.reduce((n, i) => n + (i.str?.length ?? 0), 0);

      setSource(ready);
      setDoc({ pages: pdf.numPages, scanned: chars < 30, tooLong: pdf.numPages > MAX_PAGES });
      await pdf.destroy();
    } catch (err) {
      // Backing out of Google's dialog is a decision, not an error to report back.
      const cancelled =
        (err instanceof SlidesError || err instanceof IntakeError) && err.code === "CANCELLED";
      if (!cancelled) {
        setFileError(
          err instanceof IntakeError || err instanceof SlidesError || err instanceof PdfOpenError
            ? err.message
            : t("failed"),
        );
      }
      setSource(null);
    } finally {
      setStage(null);
    }
  }, [t]);

  const inspectFile = useCallback((nextFile: File) => {
    // The one rejection a user is actually likely to hit gets said in their language.
    // validateFile answers in English for the rest, which is a gap worth closing when
    // its messages move to codes the way conversion warnings already have.
    if (detectKind(nextFile) === "pptx" && !pptxEnabled()) {
      setFileError(t("pptxUnavailable", { name: nextFile.name }));
      setSource(null);
      setDoc(null);
      return;
    }

    const problem = validateFile(nextFile);
    if (problem) {
      setFileError(problem);
      setSource(null);
      setDoc(null);
      return;
    }
    return accept(() => prepare(nextFile, { onStage: setStage }));
  }, [accept, t]);

  const importSlides = useCallback(() => accept(async () => {
    setStage("importing");
    const picked = await pickPresentation();
    return fromSlides(picked.name, picked.bytes);
  }), [accept]);

  // A counter, not a boolean: dragleave fires for every child element the pointer
  // crosses, so a naive flag flickers the drop zone off while it is still inside.
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const dropped = e.dataTransfer?.files?.[0];
      if (dropped) inspectFile(dropped);
    };
    const onOver = (e: DragEvent) => e.preventDefault();

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [inspectFile]);

  // A file dropped on the overview is waiting here. take() clears it, so a reload
  // lands on an empty converter rather than silently re-opening the last document.
  useEffect(() => {
    const handedOver = take();
    if (handedOver) inspectFile(handedOver);
  }, [take, inspectFile]);

  const baseName = source?.baseName ?? "document";

  // Log each finished conversion once, not on every re-render that follows it.
  useEffect(() => {
    if (job.status !== "done" || !job.result || recorded.current === job.result) return;
    recorded.current = job.result;
    record({
      name: source?.name ?? baseName,
      pages: job.result.info.converted,
      formats: [...formats],
      bytes: Object.values(job.result.files).reduce((n, c) => n + c.length, 0),
    });
  }, [job, source, baseName, formats, record]);

  function toggleFormat(id: OutputFormat) {
    setFormats((current) =>
      current.includes(id)
        ? current.length === 1 ? current : current.filter((f) => f !== id)
        : [...current, id],
    );
  }

  const start = () => {
    // The control that calls this only renders once a file has been probed, but the
    // type does not know that — and a guard is cheaper than an assertion that lies.
    if (!source) return;
    return job$.start(source, {
      formats,
      background,
      title: baseName,
      componentName: toComponentName(baseName),
      maxPages: MAX_PAGES,
    });
  };

  function clearAll() {
    job$.reset();
    setSource(null);
    setDoc(null);
    setFileError(null);
    recorded.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      {!source && !stage && (
        <Card
          className={cn(
            "border-dashed transition-colors",
            dragging ? "border-primary bg-accent" : "hover:border-primary/60",
          )}
        >
          <CardContent className="p-0">
            <input
              ref={inputRef}
              id="pdf-input"
              type="file"
              accept={acceptAttribute()}
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && inspectFile(e.target.files[0])}
            />
            <Label
              htmlFor="pdf-input"
              className={cn(
                "flex cursor-pointer flex-col items-center gap-1.5 px-6 text-center",
                SLIDES_ENABLED ? "pt-14 pb-8" : "py-14",
              )}
            >
              <Upload className="mb-2 size-7 text-primary" aria-hidden="true" />
              <span className="text-base font-semibold">
                {dragging ? t("dropHere") : t(pptxEnabled() ? "chooseFile" : "choosePdf")}
              </span>
              <span className="text-sm font-normal text-muted-foreground">{t("dragHint")}</span>
              <span className="tabular mt-1 font-mono text-xs font-normal text-muted-foreground">
                {t("limits", { megabytes: MAX_BYTES / 1024 / 1024, pages: MAX_PAGES })}
              </span>
            </Label>
            {/* Outside the Label: anything inside it opens the file picker instead. */}
            {SLIDES_ENABLED && (
              <div className="flex justify-center pb-10">
                <Button variant="outline" size="sm" onClick={importSlides}>
                  <Presentation className="size-4" aria-hidden="true" />
                  {t("importSlides")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {fileError && (
        <Alert variant="destructive">
          <AlertDescription>{fileError}</AlertDescription>
        </Alert>
      )}

      {source && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 py-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" title={source.name}>{source.name}</p>
              <p className="tabular font-mono text-xs text-muted-foreground">
                {`${doc ? t("pageCount", { count: doc.pages }) + " · " : ""}${(source.sourceSize / 1024 / 1024).toFixed(1)} MB`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={clearAll} disabled={busy}>
              {t("chooseAnother")}
            </Button>
          </CardContent>
        </Card>
      )}

      {source?.uploaded && (
        <Alert>
          <AlertTitle>{t("uploadedTitle")}</AlertTitle>
          <AlertDescription>{t("uploadedBody")}</AlertDescription>
        </Alert>
      )}
      {doc?.scanned && (
        <Alert>
          <AlertTitle>{t("scannedTitle")}</AlertTitle>
          <AlertDescription>{t("scannedBody")}</AlertDescription>
        </Alert>
      )}
      {doc?.tooLong && (
        <Alert>
          <AlertTitle>{t("tooLongTitle", { count: doc.pages })}</AlertTitle>
          <AlertDescription>{t("tooLongBody", { limit: MAX_PAGES })}</AlertDescription>
        </Alert>
      )}

      {doc && job.status !== "done" && (
        <Card>
          <CardContent className="space-y-6 py-5">
            <fieldset className="space-y-2.5">
              <legend className="font-mono text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {t("outputLabel")}
              </legend>
              <div className="flex flex-wrap gap-2.5">
                {FORMATS.map((id) => {
                  const on = formats.includes(id);
                  return (
                    <label
                      key={id}
                      className={cn(
                        "relative flex min-w-35 cursor-pointer flex-col rounded-lg border px-4 py-2.5 transition-colors",
                        on ? "border-primary bg-accent" : "hover:border-muted-foreground",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleFormat(id)}
                        disabled={busy}
                        className="sr-only"
                      />
                      <span className="text-sm font-semibold">
                        {t(id === "html" ? "formatHtml" : "formatReact")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t(id === "html" ? "formatHtmlHint" : "formatReactHint")}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-2.5">
              <legend className="font-mono text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {t("fidelityLabel")}
              </legend>
              <div className="flex items-start gap-3">
                <Switch
                  id="keep-graphics"
                  checked={background}
                  onCheckedChange={setBackground}
                  disabled={busy}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="keep-graphics" className="text-sm font-semibold">
                    {t("keepGraphics")}
                  </Label>
                  <p className="max-w-[54ch] text-xs leading-relaxed text-muted-foreground">
                    {t(background ? "keepGraphicsOn" : "keepGraphicsOff")}
                  </p>
                </div>
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-4">
              {busy ? (
                <>
                  <div className="min-w-52 flex-1 space-y-1.5">
                    <Progress value={Math.round(job.progress * 100)} />
                    <p className="tabular font-mono text-xs text-muted-foreground">{job.message}</p>
                  </div>
                  <Button variant="outline" onClick={() => job$.cancel()}>
                    {t("cancel")}
                  </Button>
                </>
              ) : (
                <Button onClick={start}>{t("start")}</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {job.status === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>{t("failed")}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{job.error?.message}</span>
            <Button variant="outline" size="sm" onClick={start}>{t("tryAgain")}</Button>
          </AlertDescription>
        </Alert>
      )}

      {job.status === "done" && job.result && (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 py-4">
              <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {t("converted", { count: job.result.info.converted })}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {Object.keys(job.result.files).map((name) => (
                    <Badge key={name} variant="secondary" className="font-mono text-[10.5px]">
                      {name}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <OutputPreview result={job.result} original={source} />

          {job.result.warnings.map((w) => (
            <Alert key={w.code}>
              <AlertDescription>{translateWarning(tWarn, w)}</AlertDescription>
            </Alert>
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() =>
                job.result && downloadBlob(buildZip(job.result, baseName), `${baseName}-converted.zip`)
              }
            >
              <Download className="size-4" aria-hidden="true" />
              {t("download")}
            </Button>
            <Button variant="outline" onClick={clearAll}>{t("convertAnother")}</Button>
          </div>
        </div>
      )}

      {stage && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t(stage === "uploading" ? "converting" : stage === "importing" ? "importing" : "reading")}
        </p>
      )}
    </div>
  );
}

/**
 * The converter reports what happened as a code plus parameters, because it also runs
 * in Node tests where there is no locale. Falling back to its English `message` means
 * a warning we forgot to translate still says something true.
 */
function translateWarning(t: (key: string, params?: Record<string, string | number>) => string, warning: ConversionWarning) {
  try {
    return t(warning.code, warning.params ?? {});
  } catch {
    return warning.message;
  }
}

/** "my report v2" -> "MyReportV2", falling back when nothing usable survives. */
function toComponentName(name: string): string {
  const cleaned = String(name)
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w[0] ?? "").toUpperCase() + w.slice(1))
    .join("");
  return /^[A-Za-z]/.test(cleaned) ? cleaned : "PdfDocument";
}
