import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FilePlus2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/provider";
import { describeDocument, isDesktop, pickDocuments, type PickedDocument } from "@/lib/engine";
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
        // Anything that was not a PDF comes back null and is dropped silently. Saying
        // "we ignored four of these" would be better; it needs a place to say it, and
        // that place is the empty-state work still open in this sprint.
        onAdd(described.filter((d): d is PickedDocument => d !== null));
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

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm text-muted-foreground">{t("sourcesEmpty")}</p>
          <p className="text-xs text-muted-foreground/80">{t("sourcesHint")}</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-2 rounded-lg border border-divider px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{item.document.name}</span>
                <span className="tabular block text-[11px] text-muted-foreground">
                  {kb(item.document.size)} · {t(`state${cap(item.state)}`)}
                  {item.took !== null ? ` · ${item.took.toFixed(1)}s` : ""}
                </span>
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

const kb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
