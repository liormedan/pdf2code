import { getLocale, getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LOCALES } from "@/src/i18n/config.mjs";
import LocaleChoice from "./LocaleChoice";
import ThemeToggle from "@/components/theme-toggle";

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const locale = await getLocale();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t("appearance")}</p>
            <p className="text-xs text-muted-foreground">{t("appearanceHint")}</p>
          </div>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 py-5">
          <div>
            <p className="text-sm font-semibold">{t("language")}</p>
            <p className="max-w-[56ch] text-xs text-muted-foreground">{t("languageHint")}</p>
          </div>
          <LocaleChoice locales={LOCALES} current={locale} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex gap-3 py-5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">{t("storage")}</p>
            <p className="max-w-[58ch] text-xs leading-relaxed text-muted-foreground">
              {t("storageHint")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
