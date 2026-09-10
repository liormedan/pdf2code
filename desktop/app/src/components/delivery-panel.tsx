import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  ExternalLink,
  FileArchive,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/provider";
import {
  copyPath,
  humanSize,
  listOutput,
  openPath,
  revealPath,
  zipOutput,
  type OutFile,
} from "@/lib/deliver";
import { isTypingTarget } from "@/lib/utils";

/**
 * What came out, and four ways to reach it.
 *
 * Until this existed a conversion ended at a path printed on screen — the person could
 * read where their code was and not get to it. That was the largest hole in the product
 * and among the smallest to close, which is why it is the first thing in this sprint.
 *
 * The file list is here rather than in the conversion result because the engine returns
 * **names, not sizes**, and a 40MB `index.html` and a 40KB one are different products.
 * The number is what somebody uses to decide whether to send it to a colleague.
 */
export default function DeliveryPanel({
  dir,
  onRead,
}: {
  dir: string;
  /** Open the converted page full-window, inside the app. */
  onRead: () => void;
}) {
  const t = useTranslations("desktop");
  const [files, setFiles] = useState<OutFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [packed, setPacked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setFiles([]);
    setPacked(null);
    setProblem(null);
    void listOutput(dir)
      .then((found) => {
        if (live) setFiles(found);
      })
      .catch((error) => {
        if (live) setProblem(String(error));
      });
    return () => {
      live = false;
    };
  }, [dir]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setProblem(null);
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      setProblem(String(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  const copy = useCallback(async () => {
    const ok = await copyPath(dir);
    setCopied(ok);
    if (!ok) setProblem(t("deliverCopyFailed"));
    // Long enough to notice, short enough that the button is not stuck saying it.
    else setTimeout(() => setCopied(false), 2000);
  }, [dir, t]);

  // Ctrl/Cmd+Shift+O opens the folder without reaching for the mouse. Bound while this
  // panel is mounted, which is exactly while there is something to open — a shortcut
  // that fires when there is no output would be a shortcut that does nothing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      // `code` rather than `key`: with a Hebrew layout active, `key` is a Hebrew letter
      // and the shortcut would silently stop working in the language we ship for.
      if (event.code !== "KeyO") return;
      event.preventDefault();
      void run(() => openPath(dir));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dir, run]);

  const page = files.find((file) => file.name === "index.html");
  const total = files.reduce((sum, file) => sum + file.size, 0);

  const pack = useCallback(async () => {
    const name = `${dir.split(/[\\/]/).pop() || "conversion"}.zip`;
    const archive = await zipOutput(dir, name);
    // Null means the person closed the dialog, which is not something to report.
    if (archive) setPacked(t("deliverPacked", { path: archive.out, size: humanSize(archive.bytes) }));
  }, [dir, t]);

  return (
    <div className="space-y-2 rounded-lg border border-divider p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {page ? (
          <>
            {/* Reading it here is the primary action now. Handing the path to the
                operating system depends on the default handler for .html and on that
                program resolving the path; rendering the file we just wrote in a frame
                we control depends on neither. */}
            <Button size="sm" onClick={onRead} disabled={busy}>
              <Eye className="size-4" />
              {t("deliverReadHere")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void run(() => openPath(`${sep(dir)}index.html`))}
              disabled={busy}
            >
              <ExternalLink className="size-4" />
              {t("deliverOpenPage")}
            </Button>
          </>
        ) : null}

        <Button
          size="sm"
          variant="outline"
          onClick={() => void run(() => openPath(dir))}
          disabled={busy}
          title={t("deliverOpenFolderShortcut")}
        >
          <FolderOpen className="size-4" />
          {t("deliverOpenFolder")}
        </Button>

        <Button size="sm" variant="ghost" onClick={() => void run(pack)} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FileArchive className="size-4" />}
          {t("deliverZip")}
        </Button>

        <Button size="sm" variant="ghost" onClick={() => void copy()} disabled={busy}>
          {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
          {copied ? t("deliverCopied") : t("deliverCopyPath")}
        </Button>
      </div>

      {/* The path stays visible. Opening a folder is convenient; knowing where it is is
          what somebody needs when they come back tomorrow. */}
      <p className="font-mono text-[11px] break-all text-muted-foreground">{dir}</p>

      {files.length > 0 ? (
        <ul className="space-y-0.5">
          {files.map((file) => (
            <li key={file.name} className="flex items-center justify-between gap-2 text-[11px]">
              <button
                type="button"
                className="min-w-0 truncate text-start font-mono hover:underline"
                title={t("deliverReveal")}
                onClick={() => void run(() => revealPath(`${sep(dir)}${file.name}`))}
              >
                {file.name}
              </button>
              <span className="tabular shrink-0 text-muted-foreground">{humanSize(file.size)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-2 border-t border-divider pt-0.5 text-[11px] text-muted-foreground">
            <span>{t("deliverTotal", { count: files.length })}</span>
            <span className="tabular">{humanSize(total)}</span>
          </li>
        </ul>
      ) : null}

      {/* Both announced. "Copied" and "packed to…" are the only feedback these buttons
          give, and a button whose entire result is a line of text somebody cannot see is
          a button with no result. */}
      {packed ? (
        <p role="status" aria-live="polite" className="text-[11px] break-all text-muted-foreground">
          {packed}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-[11px] text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** The directory with a trailing separator, in whichever kind the path already uses. */
const sep = (dir: string) => (dir.endsWith("\\") || dir.endsWith("/") ? dir : dir + (dir.includes("\\") ? "\\" : "/"));
