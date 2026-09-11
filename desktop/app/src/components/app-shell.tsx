import { useCallback, useEffect, useState } from "react";
import { FileText, FolderClock, Settings, Settings2, ShieldCheck, Wrench } from "lucide-react";
import { Logo } from "@/components/logo";
import ThemeToggle from "@/components/theme-toggle";
import LanguageSwitcher from "@/components/language-switcher";
import ConvertPanel from "@/components/convert-panel";
import SourcesPanel from "@/components/sources-panel";
import ProjectsPanel from "@/components/projects-panel";
import WorkbenchPanel from "@/components/workbench-panel";
import SettingsPanel from "@/components/settings-panel";
import IntroCard from "@/components/intro-card";
import PreviewScreen from "@/components/preview-screen";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/provider";
import {
  engineStatus,
  isDesktop,
  onStatus,
  pickDocuments,
  type EngineStatus,
  type PickedDocument,
} from "@/lib/engine";
import { useConversions, type ConversionSettings } from "@/lib/use-conversions";
import { getSettings } from "@/lib/settings";
import { cn, isTypingTarget } from "@/lib/utils";

/**
 * The window.
 *
 * Not a port of the web app's shell. That one was a sidebar and a topbar around a router
 * — a dashboard with pages. This has no router and no pages: one window, three regions
 * all visible at once, because the work is a pipeline rather than a set of destinations.
 * Documents come in on the right, settings and progress in the middle, history on the
 * left — or mirrored, since the direction follows the language.
 *
 * The queue lives here because all three regions read it. Sources shows what is waiting,
 * the middle shows what is running, and projects is written by it as each one finishes.
 *
 * **Two modes, not two windows.** The workbench edits the document itself and the
 * converter turns it into code; they share nothing but the engine, and showing both at
 * once would be six panels for two unrelated jobs. Switching is a header control rather
 * than a route, because there is still no router and adding one for two screens would
 * buy nothing but a URL nobody can see.
 */
export default function AppShell() {
  const t = useTranslations("desktop");
  const tApp = useTranslations("app");
  const status = useEngineStatus();

  const [mode, setMode] = useState<"convert" | "workbench" | "settings">("convert");
  // Null until the Rust side answers, so the first-run card cannot flash on a machine
  // that dismissed it a year ago.
  const [showIntro, setShowIntro] = useState(false);
  /**
   * The conversion being read full-window, if any.
   *
   * Not a header mode: a fourth tab that is empty until somebody converts something is a
   * tab that is usually clutter. This is a place you arrive at from a result and leave
   * with one button, which is what "open the page" always meant.
   */
  const [reading, setReading] = useState<{ dir: string; files: string[] } | null>(null);

  /**
   * Go to a header mode.
   *
   * Reading a conversion covers whichever mode is underneath it, so pressing a header
   * button while it is open has to close it. Without this the button lights up, the mode
   * changes, and the screen does not — which is indistinguishable from a broken control.
   * Every way of changing mode goes through here, keyboard included, so there is one
   * place where that stays true.
   */
  const go = useCallback((next: "convert" | "workbench" | "settings") => {
    setReading(null);
    setMode(next);
  }, []);

  /** The mode the header should show as pressed: none of them, while reading. */
  const showing = reading ? null : mode;

  const [settings, setSettings] = useState<ConversionSettings>({
    formats: ["html"],
    background: true,
  });

  // The remembered defaults. Read once: checkboxes that reset on every launch were the
  // most-felt of the three settings that had nowhere to live.
  useEffect(() => {
    let live = true;
    void getSettings().then((stored) => {
      if (!live) return;
      setSettings({ formats: stored.formats, background: stored.background });
      setShowIntro(!stored.seenIntro);
    });
    return () => {
      live = false;
    };
  }, []);

  // Bumped when a conversion is recorded, so the history reloads without polling.
  const [recorded, setRecorded] = useState(0);
  const onRecorded = useCallback(() => setRecorded((n) => n + 1), []);

  const queue = useConversions(settings, onRecorded);

  const reRun = useCallback(
    (document: PickedDocument) => queue.add([document]),
    [queue],
  );

  // Global shortcuts: switch modes, add documents, run, cancel. Never fires while
  // somebody is typing — a search box in the workbench and inputs in settings both live
  // under this listener, and "1" ending up in a text field because it also switched modes
  // is the failure that ad-hoc key handling produces.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isTypingTarget(event.target)) return;

      if (event.code === "Digit1") {
        event.preventDefault();
        go("convert");
      } else if (event.code === "Digit2") {
        event.preventDefault();
        go("workbench");
      } else if (event.code === "Digit3") {
        event.preventDefault();
        go("settings");
      } else if (event.code === "KeyO" && !event.shiftKey && mode !== "workbench") {
        // Shift+Ctrl+O is delivery-panel's "open the output folder" — this is the plain
        // one, "add a document", and the two must not collide.
        //
        // Not in the workbench, which handles it itself. It used to fire here whatever
        // was showing, so Ctrl+O in the workbench opened a dialog and put the chosen file
        // into the conversion queue — in another mode, with nothing on screen to say so.
        event.preventDefault();
        void pickDocuments().then((picked) => picked.length && queue.add(picked));
      } else if (event.code === "Enter") {
        const waiting = queue.items.filter((item) => item.state === "waiting").length;
        if (waiting > 0 && !queue.running && status.state === "up") {
          event.preventDefault();
          void queue.run();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, status.state, mode]);

  // Escape cancels a running conversion. Its own listener: Escape has no modifier, and a
  // modifier-gated handler above should not also have to reason about the one shortcut
  // that is a bare key.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.code !== "Escape" || isTypingTarget(event.target) || !queue.running) return;
      queue.cancel();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [queue]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-divider px-5 py-3">
        <Logo name={tApp("name")} />
        <div className="flex items-center gap-1">
          <nav className="me-2 flex items-center gap-0.5 rounded-lg border border-divider p-0.5">
            <Button
              size="sm"
              variant={showing === "convert" ? "secondary" : "ghost"}
              aria-pressed={showing === "convert"}
              onClick={() => go("convert")}
            >
              <Settings2 className="size-4" />
              {t("modeConvert")}
            </Button>
            <Button
              size="sm"
              variant={showing === "workbench" ? "secondary" : "ghost"}
              aria-pressed={showing === "workbench"}
              onClick={() => go("workbench")}
            >
              <Wrench className="size-4" />
              {t("modeWorkbench")}
            </Button>
            <Button
              size="icon"
              variant={showing === "settings" ? "secondary" : "ghost"}
              aria-pressed={showing === "settings"}
              aria-label={t("modeSettings")}
              title={t("modeSettings")}
              onClick={() => go("settings")}
            >
              <Settings className="size-4" />
            </Button>
          </nav>
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      {/* The workbench is always mounted and merely hidden when another mode shows.
          Rendering it conditionally meant Ctrl+1 and then Ctrl+2 unmounted it — the
          document, the plan, an hour of reordering, gone without a word, under a footer
          that promises nothing is lost. `hidden` keeps the state and takes the panel out
          of layout, the tab order and the accessibility tree; the panel itself stops
          listening to keys while it is hidden, so R in the converter turns no pages.

          A flex column, unlike the settings main below it. The workbench scrolls inside
          itself — the page run and the strip each have their own scroll box — and a
          scroll box only scrolls if something above it has a definite height to hand
          down. As a block this main handed down nothing, the region grew to fit its
          content, and the viewer's "viewport" was measured at 33,974 pixels tall: every
          page was on screen at once, so every page was rendered at once. */}
      <main className="flex min-h-0 flex-1 flex-col p-5" hidden={showing !== "workbench"}>
        <Region icon={Wrench} title={t("workbench")} fill>
          {isDesktop() ? (
            <WorkbenchPanel status={status} shown={showing === "workbench"} />
          ) : (
            <Empty line={t("engineNotInApp")} />
          )}
        </Region>
      </main>

      {reading ? (
        <main className="flex min-h-0 flex-1 flex-col p-0">
          <PreviewScreen dir={reading.dir} files={reading.files} onBack={() => setReading(null)} />
        </main>
      ) : mode === "settings" ? (
        <main className="min-h-0 flex-1 p-5">
          <Region icon={Settings} title={t("settings")}>
            <SettingsPanel settings={settings} onSettings={setSettings} />
          </Region>
        </main>
      ) : mode === "workbench" ? null : (
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
      {showIntro && isDesktop() ? <IntroCard onDone={() => setShowIntro(false)} /> : null}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_1fr_1fr]">
        <Region icon={FileText} title={t("sources")}>
          {isDesktop() ? (
            <SourcesPanel
              items={queue.items}
              onAdd={queue.add}
              onRemove={queue.remove}
              onClearFinished={queue.clearFinished}
              busy={queue.running}
            />
          ) : (
            <Empty line={t("engineNotInApp")} />
          )}
        </Region>

        <Region icon={Settings2} title={t("convert")}>
          {isDesktop() ? (
            <ConvertPanel
              status={status}
              settings={settings}
              onSettings={setSettings}
              items={queue.items}
              running={queue.running}
              onRun={() => void queue.run()}
              onCancel={queue.cancel}
              onRead={setReading}
            />
          ) : (
            <Empty line={t("engineNotInApp")} />
          )}
        </Region>

        <Region icon={FolderClock} title={t("projects")}>
          {isDesktop() ? (
            <ProjectsPanel reloadKey={recorded} onReRun={reRun} busy={queue.running} />
          ) : (
            <Empty line={t("projectsEmpty")} />
          )}
        </Region>
      </div>
      </main>
      )}

      {/* The one claim the whole product rests on, kept on screen rather than in a
          marketing page the buyer already closed. */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-divider px-5 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
          {t("local")}
        </span>
        <span className="tabular">
          {t("engineTitle")}:{" "}
          {status.state === "up"
            ? `${t("engineUp")} — Python ${status.python}`
            : t("engineDownReason", { reason: status.reason })}
        </span>
      </footer>
    </div>
  );
}

/**
 * The engine's state, asked for once and then followed.
 *
 * Both halves are needed. The event alone would miss an engine that came up before this
 * component mounted — the normal case, since Rust starts it during setup — and the query
 * alone would never notice it dying afterwards.
 */
function useEngineStatus(): EngineStatus {
  const [status, setStatus] = useState<EngineStatus>({ state: "down", reason: "starting" });

  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;

    void engineStatus().then((s) => {
      if (live) setStatus(s);
    });

    void onStatus((s) => {
      if (live) setStatus(s);
    }).then((unlisten) => {
      if (live) stop = unlisten;
      else unlisten();
    });

    return () => {
      live = false;
      stop?.();
    };
  }, []);

  return status;
}

function Region({
  icon: Icon,
  title,
  children,
  fill = false,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
  /** Take the whole of a flex-column parent, so children that scroll have a height to scroll in. */
  fill?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-h-0 flex-col rounded-xl border border-divider bg-card",
        fill && "flex-1",
      )}
    >
      <h2 className="flex items-center gap-2 border-b border-divider px-4 py-2.5 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ line, note }: { line: string; note?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-sm text-muted-foreground">{line}</p>
      {note ? <p className="text-xs text-muted-foreground/80">{note}</p> : null}
    </div>
  );
}
