"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileText, Layers, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActivity } from "@/src/lib/session-activity";
import { useFormat } from "@/src/lib/format.ts";

export default function OverviewPage() {
  const t = useTranslations("overview");
  const tConvert = useTranslations("convert");
  const format = useFormat();
  const { entries, totals } = useActivity();

  const stats = [
    { key: "statConversions", value: format.number(totals.conversions), icon: Layers },
    { key: "statPages", value: format.number(totals.pages), icon: FileText },
    { key: "statSaved", value: `${(totals.bytes / 1024).toFixed(0)} KB`, icon: Upload },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map(({ key, value, icon: Icon }) => (
          <Card key={key}>
            <CardContent className="space-y-1 py-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className="size-3.5" aria-hidden="true" />
                <span className="font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase">
                  {t(key)}
                </span>
              </div>
              <p className="tabular text-2xl font-semibold">{value}</p>
              <p className="text-xs text-muted-foreground">{t("thisSession")}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Upload className="size-7 text-primary" aria-hidden="true" />
          <p className="text-base font-semibold">{t("quickConvert")}</p>
          <Button asChild variant="outline" size="sm">
            <Link href="/convert">{t("quickConvertHint")}</Link>
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {t("recent")}
        </h2>

        {entries.length === 0 ? (
          <Card>
            <CardContent className="space-y-1.5 py-8 text-center">
              <p className="text-sm font-semibold">{t("emptyTitle")}</p>
              {/* The limitation stated as what it is — the product's actual promise. */}
              <p className="mx-auto max-w-[52ch] text-sm text-balance text-muted-foreground">
                {t("emptyBody")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-divider p-0">
              {entries.slice(0, 5).map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
                  <span className="tabular font-mono text-xs text-muted-foreground">
                    {tConvert("pageCount", { count: entry.pages })}
                  </span>
                  <span className="tabular font-mono text-xs text-muted-foreground">
                    {format.dateTime(entry.at, { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
