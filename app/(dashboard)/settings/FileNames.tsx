"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/**
 * Whether document names are kept alongside the record of a conversion.
 *
 * The server decides what gets written, so this only asks — and turning it off reaches
 * backwards over everything already stored, which the confirmation below says plainly
 * rather than leaving someone to discover.
 */
export default function FileNames() {
  const t = useTranslations("settings");
  const [keep, setKeep] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [scrubbed, setScrubbed] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/preferences");
        if (!response.ok) return;
        const body = await response.json() as { keepFileNames?: boolean };
        setKeep(body.keepFileNames !== false);
      } catch {
        // Leave the control unrendered rather than guessing at a privacy setting.
      }
    })();
  }, []);

  async function change(next: boolean) {
    setSaving(true);
    setScrubbed(null);
    const previous = keep;
    setKeep(next);

    try {
      const response = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepFileNames: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { scrubbed?: number };
      if (body.scrubbed) setScrubbed(body.scrubbed);
    } catch {
      setKeep(previous);
    } finally {
      setSaving(false);
    }
  }

  if (keep === null) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <Label htmlFor="keep-file-names" className="text-sm font-semibold">
            {t("keepFileNames")}
          </Label>
          <p className="max-w-[58ch] text-xs leading-relaxed text-muted-foreground">
            {t(keep ? "keepFileNamesOn" : "keepFileNamesOff")}
          </p>
        </div>
        <Switch id="keep-file-names" checked={keep} disabled={saving} onCheckedChange={change} />
      </div>

      {scrubbed !== null && (
        <p className="text-xs text-primary">{t("namesForgotten", { count: scrubbed })}</p>
      )}
    </div>
  );
}
