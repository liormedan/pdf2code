import { useEffect, useState } from "react";
import { useTranslations } from "@/i18n/provider";
import { readOutput } from "@/lib/engine";

/**
 * Show what came out — inside a sandbox, because we wrote it from a document nobody
 * vetted.
 *
 * The generated page is markup built out of somebody's PDF. Our own injection checks say
 * it is safe, and this frame is what says so a second time: `sandbox` with **no**
 * allow-scripts, no allow-same-origin, no allow-forms. The content cannot run a script,
 * cannot reach our origin, cannot navigate the window, and cannot submit anything. If
 * `escape()` ever regresses, this is the wall the regression hits.
 *
 * `srcdoc` rather than a file URL. It keeps the frame at a unique opaque origin without
 * granting the asset protocol a scope, and it means the only path from disk to the
 * window is `read_output`, which refuses anything outside the conversions directory.
 *
 * The parent CSP applies inside a srcdoc frame, so `script-src 'self'` blocks the
 * responsive fitter our own generator writes. That is fine and slightly pleasing: the
 * preview is sized by the frame, and the one script we author is the one the sandbox
 * proves it can stop.
 */
export default function OutputPreview({ dir, file }: { dir: string; file: string }) {
  const t = useTranslations("desktop");
  const [html, setHtml] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setHtml(null);
    setProblem(null);

    // Joined here rather than on the Rust side so the command keeps one job: read a
    // path, having checked it is inside the conversions directory.
    const separator = dir.includes("\\") ? "\\" : "/";

    void readOutput(`${dir}${separator}${file}`)
      .then((contents) => {
        if (live) setHtml(contents);
      })
      .catch((error) => {
        if (live) setProblem(String(error));
      });

    return () => {
      live = false;
    };
  }, [dir, file]);

  if (problem) {
    return <p className="text-xs text-muted-foreground">{t("previewUnavailable", { reason: problem })}</p>;
  }

  if (html === null) {
    return <p className="text-xs text-muted-foreground">{t("previewLoading")}</p>;
  }

  return (
    <figure className="m-0 flex min-h-0 flex-1 flex-col gap-1.5">
      <iframe
        title={t("previewTitle")}
        // Empty sandbox: every capability withheld. Adding a token here is a decision
        // about untrusted content, not a convenience.
        sandbox=""
        srcDoc={html}
        className="min-h-64 flex-1 rounded-lg border border-divider bg-white"
      />
      <figcaption className="text-[11px] text-muted-foreground">{t("previewSandboxed")}</figcaption>
    </figure>
  );
}
