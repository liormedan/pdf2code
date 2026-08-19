"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Archive, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useActivity } from "@/src/lib/session-activity";
import { useFormat } from "@/src/lib/format.ts";
import type { SourceKind } from "@/src/lib/pricing.ts";

type Filter = "all" | SourceKind;

const FILTERS: Filter[] = ["all", "pdf", "slides", "pptx"];

export default function ActivityPage() {
  const t = useTranslations("activity");
  const tOverview = useTranslations("overview");
  const tConvert = useTranslations("convert");
  const format = useFormat();
  const { entries, rename, archive, remove, clear, loading } = useActivity();

  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.kind === filter)),
    [entries, filter],
  );

  // A filter for a source nobody has used is a dead control. Only offer the ones the
  // list can actually be narrowed to.
  const available = useMemo(
    () => FILTERS.filter((f) => f === "all" || entries.some((e) => e.kind === f)),
    [entries],
  );

  // This button used to empty a tab. It now deletes the record for good, so it asks —
  // in place rather than in a dialog, because the question is one word long.
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirmClear() {
    setDeleting(true);
    try {
      await clear();
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        {entries.length > 0 && (
          <span className="ms-auto flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <span className="text-xs text-muted-foreground">{t("clearConfirm")}</span>
                <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
                  {t("clearCancel")}
                </Button>
                <Button
                  size="sm"
                  onClick={confirmClear}
                  disabled={deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t(deleting ? "clearing" : "clearYes")}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                {t("clear")}
              </Button>
            )}
          </span>
        )}
      </div>

      {loading && entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          </CardContent>
        </Card>
      ) : entries.length === 0 ? (
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
            {available.length > 2 && (
              <div className="flex flex-wrap gap-1.5 border-b border-divider px-4 py-2.5">
                {available.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={cn(
                      "rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
                      filter === f
                        ? "border-primary/40 bg-accent text-accent-foreground"
                        : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`filter.${f}`)}
                  </button>
                ))}
              </div>
            )}

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
                    <th scope="col" className="px-4 py-2.5">
                      <span className="sr-only">{t("actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {shown.map((entry) => (
                    <tr key={entry.id}>
                      <td className="max-w-64 px-4 py-3 font-medium">
                        {editing === entry.id ? (
                          <RenameField
                            initial={entry.name}
                            label={t("rename")}
                            onDone={(name) => {
                              setEditing(null);
                              if (name && name !== entry.name) void rename(entry.id, name);
                            }}
                          />
                        ) : (
                          <span className="block truncate" title={entry.name}>{entry.name}</span>
                        )}
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
                      <td className="px-4 py-3">
                        <span className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => setEditing(entry.id)}
                            aria-label={t("rename")}
                            title={t("rename")}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => void archive(entry.id)}
                            aria-label={t("archive")}
                            title={t("archive")}
                          >
                            <Archive className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={() => void remove(entry.id)}
                            aria-label={t("remove")}
                            title={t("remove")}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </span>
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

/**
 * Rename in place.
 *
 * Enter commits, Escape abandons, and losing focus commits too — clicking away from a
 * field you have just typed into means what you typed, not that you changed your mind.
 */
function RenameField({
  initial,
  label,
  onDone,
}: {
  initial: string;
  label: string;
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(initial);

  return (
    <input
      autoFocus
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(value.trim());
        if (e.key === "Escape") onDone(null);
      }}
      className="w-full rounded-md border border-border bg-input px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}
