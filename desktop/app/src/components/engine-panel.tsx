import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "@/i18n/provider";
import {
  engineCall,
  engineCancel,
  newJobId,
  onProgress,
  type EngineStatus,
  type Progress as EngineProgress,
} from "@/lib/engine";

/**
 * The probe that stands in for conversion until there is conversion.
 *
 * It runs the engine's `sleep` op, which does nothing slowly and in steps. That is
 * deliberately the least interesting work imaginable, because the things being tested
 * are the ones that break regardless of what the work is: progress that arrives *while*
 * a job runs rather than in a burst at the end, and a cancel that lands while a worker
 * thread is busy. Both already pass on the Python side; this is the other half of the
 * chain — through Rust, into the window.
 *
 * It says on screen that nothing converts yet, rather than looking like a feature.
 */
export default function EnginePanel({ status }: { status: EngineStatus }) {
  const t = useTranslations("desktop");

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  // The listener has to see the current job to filter for it, and re-subscribing on
  // every job would drop events in the gap. A ref keeps one subscription honest.
  const active = useRef<string | null>(null);
  active.current = jobId;

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    void onProgress((p) => {
      if (p.id === active.current) setProgress(p);
    }).then((unlisten) => {
      // Unmounted before the subscription resolved: unsubscribe immediately rather
      // than leak a listener into the next mount.
      if (cancelled) unlisten();
      else stop = unlisten;
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const run = useCallback(async () => {
    setOutcome(null);
    setProgress(null);

    const started = performance.now();
    const id = await newJobId();
    setJobId(id);

    try {
      await engineCall(id, "sleep", { steps: 40, seconds: 0.05, phase: "extract" });
      setOutcome(t("engineDone", { seconds: ((performance.now() - started) / 1000).toFixed(1) }));
    } catch (error) {
      // A cancel comes back as a rejection like any other failure, because the engine
      // does not know why it was stopped. The window does, so it words it properly.
      const message = String(error);
      setOutcome(message.includes("CANCELLED") ? t("engineCancelled") : t("engineFailed", { message }));
    } finally {
      setJobId(null);
      setProgress(null);
    }
  }, [t]);

  const stop = useCallback(() => {
    if (jobId) void engineCancel(jobId);
  }, [jobId]);

  const running = jobId !== null;
  const pages = progress?.pages ?? 0;
  const page = progress?.page ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-4 p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("engineProbeTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("engineProbeLead")}</p>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void run()} disabled={running || status.state !== "up"}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {t("engineRun")}
        </Button>
        {running ? (
          <Button size="sm" variant="outline" onClick={stop}>
            <Square className="size-4" />
            {t("engineCancel")}
          </Button>
        ) : null}
      </div>

      {running ? (
        <div className="space-y-1.5">
          {/* Progress is absent until the first event, and an empty bar at that moment
              is more honest than a full one. */}
          <Progress value={pages > 0 ? (page / pages) * 100 : 0} />
          <p className="tabular text-xs text-muted-foreground">
            {t("engineRunning", { page, pages })}
          </p>
        </div>
      ) : null}

      {outcome ? <p className="text-xs text-muted-foreground">{outcome}</p> : null}

      {status.state === "up" ? (
        <p className="mt-auto text-xs text-muted-foreground/80">
          Python {status.python} · {status.ops.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
