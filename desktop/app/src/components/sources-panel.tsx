import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FilePlus2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/provider";
import { describeDocument, HUNG, isDesktop, pickDocuments, type PickedDocument } from "@/lib/engine";
import type { QueueItem } from "@/lib/use-conversions";

/**
 * The documents waiting to be converted, and the two ways they get here.
 *
 * Dropping files on the window is the one that matters — it is how anybody with more
 * than three documents actually works. Tauri reports the drop as a window event carrying
 * paths, and each path is handed to `describe_document`, which refuses anything that is
 * not a readable PDF. That refusal is on the Rust side deliberately: a drag and drop can
 * carry a folder, a spreadsheet or a shortcut, and the engine should never be handed one.
 */
export default function SourcesPanel({
  items,
  onAdd,
  onRemove,
  onClearFinished,
  busy,
}: {
  items: QueueItem[];
  onAdd: (documents: PickedDocument[]) => void;
  onRemove: (key: string) => void;
  onClearFinished: () => void;
  busy: boolean;
}) {
  const t = useTranslations("desktop");
  const [over, setOver] = useState(false);
  // How many files the last drop refused. Cleared as soon as anything else happens,
  // because it describes one action rather than a state of the queue.
  const [refused, setRefused] = useState(0);

  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;
    let gone = false;

    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === "over") {
          setOver(true);
          return;
        }
        if (event.payload.type === "leave") {
          setOver(false);
          return;
        }

        setOver(false);
        const described = await Promise.all(
          event.payload.paths.map((path) => describeDocument(path)),
        );
        const accepted = described.filter((d): d is PickedDocument => d !== null);

        // Anything that was not a readable PDF comes back null. Saying so matters:
        // dropping eleven files and seeing nine appear, with no explanation, reads as
        // the app losing two of them.
        setRefused(described.length - accepted.length);
        onAdd(accepted);
      })
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      });

    return () => {
      gone = true;
      unlisten?.();
    };
  }, [onAdd]);

  const choose = useCallback(async () => {
    setRefused(0);
    onAdd(await pickDocuments());
  }, [onAdd]);

  const finished = items.some((item) => item.state !== "waiting");

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col gap-3 p-4 transition-colors ${
        over ? "bg-accent/60" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void choose()} disabled={busy}>
          <FilePlus2 className="size-4" />
          {t("sourcesAdd")}
        </Button>
        {finished ? (
          <Button size="sm" variant="ghost" onClick={onClearFinished} disabled={busy}>
            <Trash2 className="size-4" />
            {t("sourcesClear")}
          </Button>
        ) : null}
      </div>

      {refused > 0 ? (
        <p className="text-[11px] text-warning">{t("sourcesRefused", { count: refused })}</p>
      ) : null}

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
          <p className="text-sm text-muted-foreground">{t("sourcesEmpty")}</p>
          <p className="text-xs text-muted-foreground/80">{t("sourcesHint")}</p>
          {/* Shown only when there is nothing at all, which is the one moment a
              sentence about what this does is welcome rather than in the way. */}
          <p className="mt-2 text-[11px] text-muted-foreground/70">{t("sourcesFirstRun")}</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-start gap-2 rounded-lg border border-divider px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{item.document.name}</span>
                <span className="tabular block text-[11px] text-muted-foreground">
                  {kb(item.document.size)} · {t(`state${cap(item.state)}`)}
                  {item.took !== null ? ` · ${item.took.toFixed(1)}s` : ""}
                </span>
                {/* A failure that only says "failed" sends somebody to a log they do
                    not have. The engine's reason is short, and it is the only clue. */}
                {item.error ? (
                  <span className="block text-[11px] text-destructive">
                    {reasonFor(t, item.error)}
                  </span>
                ) : null}
              </span>
              {item.state === "waiting" && !busy ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 shrink-0"
                  aria-label={t("sourcesRemove")}
                  onClick={() => onRemove(item.key)}
                >
                  <X className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The sentence for a failed item.
 *
 * The engine sends a code; this picks the wording. A raw error string is a last resort
 * rather than the norm — it is the engine's log voice, and it is in English whatever the
 * window is running in.
 */
function reasonFor(
  t: (key: string, params?: Record<string, string | number>) => string,
  error: string,
): string {
  if (error.includes(HUNG)) return t("itemHung");
  const split = error.indexOf("|");
  if (split > 0) {
    const tag = error.slice(0, split);
    if (tag.startsWith("item")) return t(tag, { detail: error.slice(split + 1) });
  }
  return t("itemFailed", { message: error });
}

const kb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
