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
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/provider";
import { engineStatus, isDesktop, onStatus, type EngineStatus, type PickedDocument } from "@/lib/engine";
import { useConversions, type ConversionSettings } from "@/lib/use-conversions";
import { getSettings } from "@/lib/settings";

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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-divider px-5 py-3">
        <Logo name={tApp("name")} />
        <div className="flex items-center gap-1">
          <nav className="me-2 flex items-center gap-0.5 rounded-lg border border-divider p-0.5">
            <Button
              size="sm"
              variant={mode === "convert" ? "secondary" : "ghost"}
              aria-pressed={mode === "convert"}
              onClick={() => setMode("convert")}
            >
              <Settings2 className="size-4" />
              {t("modeConvert")}
            </Button>
            <Button
              size="sm"
              variant={mode === "workbench" ? "secondary" : "ghost"}
              aria-pressed={mode === "workbench"}
              onClick={() => setMode("workbench")}
            >
              <Wrench className="size-4" />
              {t("modeWorkbench")}
            </Button>
            <Button
              size="icon"
              variant={mode === "settings" ? "secondary" : "ghost"}
              aria-pressed={mode === "settings"}
              aria-label={t("modeSettings")}
              title={t("modeSettings")}
              onClick={() => setMode("settings")}
            >
              <Settings className="size-4" />
            </Button>
          </nav>
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      {mode === "settings" ? (
        <main className="min-h-0 flex-1 p-5">
          <Region icon={Settings} title={t("settings")}>
            <SettingsPanel settings={settings} onSettings={setSettings} />
          </Region>
        </main>
      ) : mode === "workbench" ? (
        <main className="min-h-0 flex-1 p-5">
          <Region icon={Wrench} title={t("workbench")}>
            {isDesktop() ? <WorkbenchPanel status={status} /> : <Empty line={t("engineNotInApp")} />}
          </Region>
        </main>
      ) : (
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
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-h-0 flex-col rounded-xl border border-divider bg-card"
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
