import { useEffect, useState } from "react";
import { FileText, FolderClock, Settings2, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import ThemeToggle from "@/components/theme-toggle";
import LanguageSwitcher from "@/components/language-switcher";
import EnginePanel from "@/components/engine-panel";
import { useTranslations } from "@/i18n/provider";
import { engineStatus, isDesktop, onStatus, type EngineStatus } from "@/lib/engine";

/**
 * The window.
 *
 * Not a port of the web app's shell. That one was a sidebar and a topbar around a router
 * — a dashboard with pages. This has no router and no pages: one window, three regions
 * that are all visible at once, because the work here is a pipeline (pick files, set
 * options, look at what came out) rather than a set of destinations.
 *
 * Three columns from `lg` up and a single stack below it. A desktop window can be
 * dragged narrow, and three 200px columns are worse than one readable one.
 *
 * Two of the three regions are still empty states, and the status bar reports what the
 * engine is actually doing rather than what we would like it to be doing.
 */
export default function AppShell() {
  const t = useTranslations("desktop");
  const tApp = useTranslations("app");
  const status = useEngineStatus();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-divider px-5 py-3">
        <Logo name={tApp("name")} />
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 lg:grid-cols-[1fr_1fr_1fr]">
        <Region icon={FileText} title={t("sources")}>
          <Empty line={t("sourcesEmpty")} note={t("sourcesHint")} />
        </Region>

        <Region icon={Settings2} title={t("convert")}>
          {/* The middle region is where conversion will live. Until it does, it holds
              the probe that proves the path to the engine is real — and says so. */}
          {isDesktop() ? <EnginePanel status={status} /> : <Empty line={t("engineNotInApp")} />}
        </Region>

        <Region icon={FolderClock} title={t("projects")}>
          <Empty line={t("projectsEmpty")} />
        </Region>
      </main>

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
 * component mounted — which is the normal case, since Rust starts it during setup — and
 * the query alone would never notice it dying afterwards.
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
