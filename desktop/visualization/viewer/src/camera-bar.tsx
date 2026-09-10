import type { Selection } from "./model";
import type { words } from "./strings";

/**
 * Six places to stand and three ways to zoom, as buttons.
 *
 * **Because dragging is not navigation everywhere.** On a narrow screen the orbit control
 * is switched off — a drag there is usually somebody trying to scroll the page, and a
 * model that spins when you meant to scroll is worse than one that holds still. That left
 * a 3D picture with no way into it, which is the defect this bar closes: every viewpoint
 * dragging could reach is a button, and the buttons work at every width.
 *
 * They are not a lesser substitute. A named place — *the shell*, *the engine* — is easier
 * to reach deliberately than the same view found by spinning, and it says what it is
 * while you look for it. The bar is shown at every width for that reason, rather than
 * appearing only when the screen is small and reading as an apology.
 *
 * Each one selects, so the highlight and the inspector follow the camera. Moving the view
 * and saying what you are now looking at should not be two separate acts.
 */
export default function CameraBar({
  t,
  selected,
  onSelect,
  onZoom,
  zoom,
  compact,
}: {
  t: ReturnType<typeof words>;
  selected: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onZoom: (next: number) => void;
  zoom: number;
  compact: boolean;
}) {
  /** The six viewpoints. `null` is the wide shot, which is the absence of a focus. */
  const PLACES: { key: string; label: string; selection: Selection | null }[] = [
    { key: "overview", label: t("cameraOverview"), selection: null },
    { key: "you", label: t("cameraYou"), selection: { kind: "end", id: "you" } },
    { key: "window", label: t("cameraWindow"), selection: { kind: "process", id: "window" } },
    { key: "shell", label: t("cameraShell"), selection: { kind: "process", id: "shell" } },
    { key: "engine", label: t("cameraEngine"), selection: { kind: "process", id: "engine" } },
    { key: "output", label: t("cameraOutput"), selection: { kind: "end", id: "output" } },
  ];

  const here = (selection: Selection | null) =>
    selection === null
      ? selected === null
      : selected?.kind === selection.kind && selected.id === selection.id;

  const ring = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  return (
    <div
      role="group"
      aria-label={t("camera")}
      className={`flex flex-wrap items-center gap-1 rounded-lg border border-divider p-1 ${
        // Prominent where it is the only way in; quieter where dragging also works.
        compact ? "border-primary/60 bg-accent/20" : ""
      }`}
    >
      <span className="px-1 text-[10px] font-semibold text-muted-foreground">{t("camera")}</span>

      {PLACES.map((place) => (
        <button
          key={place.key}
          type="button"
          aria-pressed={here(place.selection)}
          onClick={() => onSelect(place.selection)}
          className={`rounded-md px-2 py-1 text-[11px] ${ring} ${
            here(place.selection)
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/40"
          }`}
        >
          {place.label}
        </button>
      ))}

      <span className="mx-0.5 h-4 w-px bg-divider" aria-hidden="true" />

      {/* Zoom is a scale on the view's own distance rather than a free camera dolly, so
          every viewpoint stays framed on what it was chosen to frame. Clamped, because a
          model you have zoomed past is a model you cannot get back to without the reset. */}
      <button
        type="button"
        onClick={() => onZoom(Math.max(0.5, +(zoom * 0.8).toFixed(3)))}
        disabled={zoom <= 0.5}
        className={`rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent/40 disabled:opacity-40 ${ring}`}
      >
        {t("zoomIn")}
      </button>
      <button
        type="button"
        onClick={() => onZoom(Math.min(2, +(zoom * 1.25).toFixed(3)))}
        disabled={zoom >= 2}
        className={`rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent/40 disabled:opacity-40 ${ring}`}
      >
        {t("zoomOut")}
      </button>
      <button
        type="button"
        onClick={() => {
          onZoom(1);
          onSelect(null);
        }}
        className={`rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent/40 ${ring}`}
      >
        {t("zoomReset")}
      </button>
    </div>
  );
}
