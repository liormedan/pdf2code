import { useCallback, useEffect, useState } from "react";
import {
  FolderOpen,
  HardDrive,
  Info,
  Keyboard,
  LifeBuoy,
  Loader2,
  Palette,
  Sliders,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import ThemeToggle from "@/components/theme-toggle";
import LanguageSwitcher from "@/components/language-switcher";
import { useTranslations } from "@/i18n/provider";
import { clearOutputRoot, outputRoot, pickOutputRoot } from "@/lib/engine";
import {
  appVersion,
  cleanOldOutput,
  getCredits,
  saveDefaults,
  storageSummary,
  previewReport,
  exportReport,
  type Credit,
  type StorageSummary,
} from "@/lib/settings";
import { humanSize } from "@/lib/deliver";
import { pickSavePath } from "@/lib/workbench";
import { forgetProject, listProjects } from "@/lib/projects";
import type { ConversionSettings } from "@/lib/use-conversions";

/**
 * Everything the app remembers, in one place.
 *
 * It exists because those settings were in three places: the language in the header, the
 * output folder in the conversion panel, and the conversion defaults in checkboxes that
 * reset on every launch. Somebody who set them up once had to set two of them up again
 * the next morning.
 *
 * A mode rather than a modal, matching the workbench. There is still no router, and a
 * dialog would have meant a focus trap, an overlay and an escape key to get three
 * controls on screen.
 */
export default function SettingsPanel({
  settings,
  onSettings,
}: {
  settings: ConversionSettings;
  onSettings: (next: ConversionSettings) => void;
}) {
  const t = useTranslations("desktop");
  const [root, setRoot] = useState<string | null>(null);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [version, setVersion] = useState("");
  const [history, setHistory] = useState(0);
  const [cleared, setCleared] = useState(false);
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanNote, setCleanNote] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState<string | null>(null);

  const loadStorage = useCallback(() => {
    void storageSummary().then(setSummary);
  }, []);

  useEffect(() => {
    void outputRoot().then(setRoot);
    void getCredits().then(setCredits);
    void appVersion().then(setVersion);
    void listProjects().then((rows) => setHistory(rows.length));
    loadStorage();
  }, [loadStorage]);

  // Written through on every change rather than behind a Save button. There is nothing
  // here to get half-right, and a Save button on four controls is a button that only
  // exists to be forgotten.
  const change = useCallback(
    (next: ConversionSettings) => {
      onSettings(next);
      void saveDefaults(next.formats, next.background);
    },
    [onSettings],
  );

  const toggleFormat = useCallback(
    (format: "html" | "react", on: boolean) => {
      const next = on
        ? [...new Set([...settings.formats, format])]
        : settings.formats.filter((f) => f !== format);
      // Never nothing: a conversion that produces no files is a button that looks like it
      // worked and leaves an empty folder behind.
      change({ ...settings, formats: next.length ? next : [format] });
    },
    [settings, change],
  );

  const clearHistory = useCallback(async () => {
    const rows = await listProjects();
    // The rows go; the output on disk stays. Deleting somebody's files because they
    // tidied a list is a surprise, and an irreversible one.
    await Promise.all(rows.map((row) => forgetProject(row.id)));
    setHistory(0);
    setCleared(true);
  }, []);

  // Thirty days, and not a setting: the folders are listed with their age right above the
  // button, so a person deciding whether to press it is looking at the actual numbers
  // rather than tuning a threshold they cannot see the effect of.
  const saveReport = useCallback(async () => {
    const chosen = await pickSavePath("pdf2code-report.txt", "txt");
    if (!chosen) return;
    try {
      setReportNote(t("settingsReportSaved", { path: await exportReport(chosen) }));
    } catch (failure) {
      setReportNote(String(failure));
    }
  }, [t]);

  const clean = useCallback(async () => {
    setCleaning(true);
    setCleanNote(null);
    try {
      const result = await cleanOldOutput(30);
      setCleanNote(
        result.removed > 0
          ? t("settingsStorageCleaned", { count: result.removed, size: humanSize(result.freedBytes) })
          : t("settingsStorageNothingToClean"),
      );
      loadStorage();
    } catch (failure) {
      setCleanNote(String(failure));
    } finally {
      setCleaning(false);
    }
  }, [loadStorage, t]);

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
      <Section icon={Palette} title={t("settingsAppearance")}>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("settingsLanguage")}</span>
            <LanguageSwitcher />
          </span>
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("settingsTheme")}</span>
            <ThemeToggle />
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/80">{t("settingsAppearanceNote")}</p>
      </Section>

      <Separator />

      <Section icon={Sliders} title={t("settingsDefaults")}>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-2">
            <Checkbox
              id="default-html"
              checked={settings.formats.includes("html")}
              onCheckedChange={(on) => toggleFormat("html", on === true)}
            />
            <Label htmlFor="default-html" className="text-xs">
              HTML
            </Label>
          </span>
          <span className="flex items-center gap-2">
            <Checkbox
              id="default-react"
              checked={settings.formats.includes("react")}
              onCheckedChange={(on) => toggleFormat("react", on === true)}
            />
            <Label htmlFor="default-react" className="text-xs">
              React
            </Label>
          </span>
          <span className="flex items-center gap-2">
            <Checkbox
              id="default-graphics"
              checked={settings.background}
              onCheckedChange={(on) => change({ ...settings, background: on === true })}
            />
            <Label htmlFor="default-graphics" className="text-xs">
              {t("convertGraphicsOption")}
            </Label>
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/80">{t("settingsDefaultsNote")}</p>
      </Section>

      <Separator />

      <Section icon={FolderOpen} title={t("settingsOutput")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void pickOutputRoot().then((chosen) => chosen && setRoot(chosen))}
          >
            <FolderOpen className="size-4" />
            {t("convertOutputFolder")}
          </Button>
          {root ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void clearOutputRoot().then(() => setRoot(null))}
            >
              {t("convertOutputReset")}
            </Button>
          ) : null}
        </div>
        <p className="font-mono text-[11px] break-all text-muted-foreground">
          {root ?? t("convertOutputDefault")}
        </p>
      </Section>

      <Separator />

      <Section icon={Trash2} title={t("settingsHistory")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void clearHistory()} disabled={history === 0}>
            <Trash2 className="size-4" />
            {t("settingsClearHistory")}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {cleared ? t("settingsHistoryCleared") : t("settingsHistoryCount", { count: history })}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/80">{t("settingsHistoryNote")}</p>
      </Section>

      <Separator />

      <Section icon={HardDrive} title={t("settingsStorage")}>
        {summary ? (
          <>
            <p className="text-xs text-muted-foreground">
              {t("settingsStorageSummary", {
                size: humanSize(summary.bytes),
                count: summary.folders.length,
              })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => void clean()} disabled={cleaning}>
                {cleaning ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {t("settingsStorageClean")}
              </Button>
              {cleanNote ? (
                <span className="text-[11px] text-muted-foreground">{cleanNote}</span>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground/80">{t("settingsStorageNote")}</p>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground/80">{t("settingsStorageUnavailable")}</p>
        )}
      </Section>

      <Separator />

      <Section icon={Keyboard} title={t("settingsShortcuts")}>
        <ShortcutTable
          rows={[
            ["Ctrl+1 / 2 / 3", "settingsShortcutModes"],
            ["Ctrl+O", "settingsShortcutAdd"],
            ["Ctrl+Enter", "settingsShortcutRun"],
            ["Esc", "settingsShortcutCancel"],
            ["Ctrl+Shift+O", "settingsShortcutOpenFolder"],
          ]}
        />
        <p className="mt-3 text-[11px] font-medium text-muted-foreground">
          {t("settingsShortcutsWorkbench")}
        </p>
        <ShortcutTable
          rows={[
            ["Ctrl+Z / Ctrl+Shift+Z", "settingsShortcutUndoRedo"],
            ["R / Shift+R", "settingsShortcutRotate"],
            ["Delete", "settingsShortcutDelete"],
            ["Ctrl+A", "settingsShortcutSelectAll"],
            ["Ctrl+S", "settingsShortcutSave"],
          ]}
        />
        <p className="text-[11px] text-muted-foreground/80">{t("settingsShortcutsNote")}</p>
      </Section>

      <Separator />

      <Section icon={LifeBuoy} title={t("settingsReport")}>
        <p className="text-[11px] text-muted-foreground/80">{t("settingsReportNote")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void previewReport().then(setReport)}
          >
            <LifeBuoy className="size-4" />
            {t("settingsReportShow")}
          </Button>
          {report !== null ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void saveReport()}
            >
              {t("settingsReportSave")}
            </Button>
          ) : null}
          {reportNote ? (
            <span className="text-[11px] break-all text-muted-foreground">{reportNote}</span>
          ) : null}
        </div>
        {/* Shown before it can be saved, and deliberately in full. A privacy promise
            nobody can check is a promise. */}
        {report !== null ? (
          <pre
            className="max-h-64 overflow-auto rounded-lg border border-divider bg-card p-3 text-start text-[11px]"
            dir="ltr"
          >
            <code>{report}</code>
          </pre>
        ) : null}
      </Section>

      <Separator />

      <Section icon={Info} title={t("settingsAbout")}>
        <p className="text-xs text-muted-foreground">
          {t("settingsVersion", { version: version || "—" })}
        </p>
        <p className="text-[11px] text-muted-foreground/80">{t("settingsCreditsNote")}</p>
        {credits.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {credits.map((credit) => (
                  <tr key={credit.name} className="border-t border-divider">
                    <td className="py-1 pe-3 whitespace-nowrap">{credit.name}</td>
                    <td className="tabular py-1 pe-3 whitespace-nowrap text-muted-foreground">
                      {credit.version}
                    </td>
                    <td className="py-1 pe-3 whitespace-nowrap text-muted-foreground">
                      {credit.license}
                    </td>
                    <td className="py-1 text-muted-foreground/80">{t(`creditRole${cap(credit.role)}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

/** One block of key combo → what it does. Two of these sit side by side under Shortcuts. */
function ShortcutTable({ rows }: { rows: [string, string][] }) {
  const t = useTranslations("desktop");
  return (
    <table className="w-full text-[11px]">
      <tbody>
        {rows.map(([combo, labelKey]) => (
          <tr key={combo} className="border-t border-divider first:border-t-0">
            <td className="py-1 pe-3 font-mono whitespace-nowrap text-muted-foreground">{combo}</td>
            <td className="py-1">{t(labelKey)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Info;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </h3>
      {children}
    </section>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
