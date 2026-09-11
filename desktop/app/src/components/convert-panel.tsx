import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import OutputPreview from "@/components/output-preview";
import DeliveryPanel from "@/components/delivery-panel";
import EngineDown from "@/components/engine-down";
import { useTranslations } from "@/i18n/provider";
import {
  clearOutputRoot,
  outputRoot,
  pickOutputRoot,
  type EngineStatus,
  type Warning,
} from "@/lib/engine";
import type { ConversionSettings, QueueItem } from "@/lib/use-conversions";

/**
 * The settings, the button, and what is happening right now.
 *
 * The queue itself lives above this component, because all three regions need it — the
 * sources list shows what is waiting, this shows what is running, and the projects list
 * is written by it. Holding that state here and passing it sideways would leave two of
 * the three lying during a batch.
 */
export default function ConvertPanel({
  status,
  settings,
  onSettings,
  items,
  running,
  onRun,
  onCancel,
  onRead,
}: {
  status: EngineStatus;
  settings: ConversionSettings;
  onSettings: (next: ConversionSettings) => void;
  items: QueueItem[];
  running: boolean;
  onRun: () => void;
  onCancel: () => void;
  /** Open a finished conversion full-window. */
  onRead: (what: { dir: string; files: string[] }) => void;
}) {
  const t = useTranslations("desktop");
  const [root, setRoot] = useState<string | null>(null);
  /** Which output file the preview is showing. Null until somebody picks another. */
  const [picked, setPicked] = useState<string | null>(null);
  const setShown = setPicked;

  useEffect(() => {
    void outputRoot().then(setRoot);
  }, []);

  const chooseRoot = useCallback(async () => {
    const chosen = await pickOutputRoot();
    if (chosen) setRoot(chosen);
  }, []);

  const useDefaultRoot = useCallback(async () => {
    await clearOutputRoot();
    setRoot(null);
  }, []);

  const toggleFormat = useCallback(
    (format: "html" | "react", on: boolean) => {
      const next = on
        ? [...new Set([...settings.formats, format])]
        : settings.formats.filter((f) => f !== format);
      // Never nothing. A conversion that produces no files is a button that looks like
      // it worked and leaves an empty folder behind.
      onSettings({ ...settings, formats: next.length ? next : [format] });
    },
    [settings, onSettings],
  );

  const current = items.find((item) => item.state === "running") ?? null;

  /**
   * Where focus goes when a run starts.
   *
   * The reader clicks Run, Run becomes disabled, and Chromium leaves focus on it — and a
   * focused element that has become disabled receives no key events. Escape, pressed in
   * the most natural sequence there is, went nowhere. Cancel is the one thing left to
   * do while a run is under way, so it takes the focus: Escape works, and so does Enter.
   */
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (running) cancelButton.current?.focus();
  }, [running]);
  const waiting = items.filter((item) => item.state === "waiting").length;
  const lastDone = [...items].reverse().find((item) => item.state === "done") ?? null;

  // What can be shown: the page, and the component as source. A stylesheet and a README
  // are output too, but nobody opens a preview to read a stylesheet.
  const previewable = (lastDone?.result?.files ?? []).filter((name) =>
    /\.(html?|jsx|tsx)$/i.test(name),
  );
  const shown = previewable.includes(picked ?? "") ? picked : (previewable[0] ?? null);

  const pages = current?.progress?.pages ?? 0;
  const page = current?.progress?.page ?? 0;
  const phase = current?.progress ? t(`convertPhase${cap(current.progress.phase)}`) : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-2">
            <Checkbox
              id="format-html"
              checked={settings.formats.includes("html")}
              onCheckedChange={(on) => toggleFormat("html", on === true)}
              disabled={running}
            />
            <Label htmlFor="format-html" className="text-xs">
              HTML
            </Label>
          </span>
          <span className="flex items-center gap-2">
            <Checkbox
              id="format-react"
              checked={settings.formats.includes("react")}
              onCheckedChange={(on) => toggleFormat("react", on === true)}
              disabled={running}
            />
            <Label htmlFor="format-react" className="text-xs">
              React
            </Label>
          </span>
          <span className="flex items-center gap-2">
            <Checkbox
              id="keep-graphics"
              checked={settings.background}
              onCheckedChange={(on) => onSettings({ ...settings, background: on === true })}
              disabled={running}
            />
            <Label htmlFor="keep-graphics" className="text-xs">
              {t("convertGraphicsOption")}
            </Label>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Button size="sm" variant="ghost" onClick={() => void chooseRoot()} disabled={running}>
            <FolderOpen className="size-3.5" />
            {t("convertOutputFolder")}
          </Button>
          <span className="font-mono break-all">{root ?? t("convertOutputDefault")}</span>
          {root ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void useDefaultRoot()}
              disabled={running}
            >
              {t("convertOutputReset")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* A disabled button with no explanation is a dead end. The status bar says the
          engine is down; this says what that means for the thing you were about to do. */}
      {status.state !== "up" ? <EngineDown /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={onRun}
          disabled={running || waiting === 0 || status.state !== "up"}
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {waiting > 1 ? t("convertRunMany", { count: waiting }) : t("convertRun")}
        </Button>

        {running ? (
          <Button ref={cancelButton} size="sm" variant="outline" onClick={onCancel}>
            <Square className="size-4" />
            {t("engineCancel")}
          </Button>
        ) : null}
      </div>

      {current ? (
        // A live region, because a progress bar nobody can see reports nothing. `polite`
        // rather than `assertive`: this changes once per page, and interrupting somebody
        // mid-sentence five hundred times is worse than saying nothing at all.
        <div className="space-y-1.5" role="status" aria-live="polite">
          <p className="truncate text-xs">{current.document.name}</p>
          {/* Empty until the first event: an empty bar is more honest than a full one. */}
          <Progress value={pages > 0 ? (page / pages) * 100 : 0} />
          <p className="tabular text-xs text-muted-foreground">
            {t("convertProgress", { phase, page, pages })}
          </p>
        </div>
      ) : null}

      {lastDone?.result ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>{t("convertOut")}</p>
          {/* Opening the folder needs a permission this app withheld until sprint 1, and
              it is still not the shell plugin: a Rust command that opens paths inside the
              output directories, and refuses a file it could not have written.

              Keyed by the folder it lists, and so is the preview below. Both keep state
              — a file listing, a page — and both cleared it in an effect, which runs after
              the paint. So the first frame after a new result carried the new path with the
              old sizes and the old page under it; on a 150-page document, with the main
              thread busy taking the result in, that frame stayed up long enough to be
              photographed. A new key mounts a new instance with nothing in it, and there
              is no frame in which the two can disagree. */}
          <DeliveryPanel
            key={lastDone.result.out}
            dir={lastDone.result.out}
            onRead={() =>
              lastDone.result &&
              onRead({ dir: lastDone.result.out, files: lastDone.result.files })
            }
          />
          {lastDone.result.warnings.map((warning) => (
            <p key={warning.code} className="text-warning">
              {wording(t, warning)}
            </p>
          ))}
        </div>
      ) : null}

      {previewable.length > 0 && lastDone?.result ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          {previewable.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {previewable.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  variant={name === shown ? "secondary" : "ghost"}
                  aria-pressed={name === shown}
                  onClick={() => setShown(name)}
                >
                  {name}
                </Button>
              ))}
            </div>
          ) : null}
          {shown ? (
            <OutputPreview key={`${lastDone.result.out}#${shown}`} dir={lastDone.result.out} file={shown} />
          ) : null}
        </div>
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
