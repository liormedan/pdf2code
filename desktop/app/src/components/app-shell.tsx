import { FileText, FolderClock, Settings2, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import ThemeToggle from "@/components/theme-toggle";
import LanguageSwitcher from "@/components/language-switcher";
import { useTranslations } from "@/i18n/provider";

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
 * Everything below is an empty state on purpose. This is the shell sprint: it opens, it
 * speaks both languages, it installs. Nothing here converts anything, and the status bar
 * says so rather than implying otherwise.
 */
export default function AppShell() {
  const t = useTranslations("desktop");
  const tApp = useTranslations("app");

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
        <Region icon={FileText} title={t("sources")} line={t("sourcesEmpty")} note={t("sourcesHint")} />
        <Region icon={Settings2} title={t("convert")} line={t("convertEmpty")} />
        <Region icon={FolderClock} title={t("projects")} line={t("projectsEmpty")} />
      </main>

      {/* The one claim the whole product rests on, kept on screen rather than in a
          marketing page the buyer already closed. It is also, for now, trivially true:
          nothing here has anywhere to send a file to. */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-divider px-5 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
          {t("local")}
        </span>
        <span className="tabular">
          {t("engineTitle")}: {t("engineNotConnected")} — {t("engineNote")}
        </span>
      </footer>
    </div>
  );
}

function Region({
  icon: Icon,
  title,
  line,
  note,
}: {
  icon: typeof FileText;
  title: string;
  line: string;
  note?: string;
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
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="text-sm text-muted-foreground">{line}</p>
        {note ? <p className="text-xs text-muted-foreground/80">{note}</p> : null}
      </div>
    </section>
  );
}
