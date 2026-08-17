"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActivity } from "@/src/lib/session-activity";
import { useFormat } from "@/src/lib/format.ts";

export default function ActivityPage() {
  const t = useTranslations("activity");
  const tOverview = useTranslations("overview");
  const tConvert = useTranslations("convert");
  const format = useFormat();
  const { entries, clear } = useActivity();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        {entries.length > 0 && (
          <Button variant="outline" size="sm" className="ms-auto" onClick={clear}>
            {t("clear")}
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="space-y-1.5 py-10 text-center">
            <p className="text-sm font-semibold">{tOverview("emptyTitle")}</p>
            <p className="mx-auto max-w-[52ch] text-sm text-balance text-muted-foreground">
              {tOverview("emptyBody")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* A table on a phone becomes a horizontal scroll nobody discovers, so the
                container scrolls rather than the page. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-start">
                    {["file", "pages", "output", "size", "when"].map((key) => (
                      <th
                        key={key}
                        scope="col"
                        className="px-4 py-2.5 text-start font-mono text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
                      >
                        {t(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="max-w-64 truncate px-4 py-3 font-medium" title={entry.name}>
                        {entry.name}
                      </td>
                      <td className="tabular px-4 py-3 text-muted-foreground">
                        {tConvert("pageCount", { count: entry.pages })}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap gap-1">
                          {entry.formats.map((f) => (
                            <Badge key={f} variant="secondary" className="font-mono text-[10px]">
                              {f}
                            </Badge>
                          ))}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 font-mono text-xs text-muted-foreground">
                        {(entry.bytes / 1024).toFixed(0)} KB
                      </td>
                      <td className="tabular px-4 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {format.dateTime(entry.at, { hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
