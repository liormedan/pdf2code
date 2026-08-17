"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Layers, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useActivity } from "@/src/lib/session-activity";
import { usePendingFile } from "@/src/lib/pending-file";
import { validateFile } from "@/src/lib/pricing.ts";
import { useFormat } from "@/src/lib/format.ts";

export default function OverviewPage() {
  const t = useTranslations("overview");
  const tConvert = useTranslations("convert");
  const format = useFormat();
  const { entries, totals } = useActivity();
  const { put } = usePendingFile();
  const router = useRouter();

  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragDepth = useRef(0);

  // This card says "drop a PDF to start", so it has to actually accept one. It hands
  // the file to the converter rather than converting here — one implementation, one
  // place — and navigates so the drop lands where the work happens.
  const accept = useCallback((file: File) => {
    const problem = validateFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    put(file);
    router.push("/convert");
  }, [put, router]);

  // A counter, not a boolean: dragleave fires for every child element the pointer
  // crosses, so a naive flag flickers the zone off while it is still inside.
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const dropped = e.dataTransfer?.files?.[0];
      if (dropped) accept(dropped);
    };
    const onOver = (e: DragEvent) => e.preventDefault();

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [accept]);

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

      <Card className={cn("border-dashed transition-colors", dragging && "border-primary bg-accent")}>
        <CardContent className="p-0">
          <input
            id="overview-input"
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && accept(e.target.files[0])}
          />
          <Label
            htmlFor="overview-input"
            className="flex cursor-pointer flex-col items-center gap-3 px-6 py-10 text-center"
          >
            <Upload className="size-7 text-primary" aria-hidden="true" />
            <span className="text-base font-semibold">
              {dragging ? tConvert("dropHere") : t("quickConvert")}
            </span>
          </Label>
          <div className="flex justify-center pb-6">
            <Button asChild variant="outline" size="sm">
              <Link href="/convert">{t("quickConvertHint")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

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
