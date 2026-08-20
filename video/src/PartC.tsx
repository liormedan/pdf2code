/**
 * Part C — the closing act.
 *
 * Parts A and B say what this is and show it working. What is left over is what a person
 * still needs before they will try it: what it refuses to do, and how to start. The free
 * allowance lands on the last frame of the last beat, which is where the brief asked for it.
 *
 * There was a third beat here listing output languages that are being weighed — Vue, Svelte,
 * Python. It is gone at the client's request. Nothing else in the film promises a language
 * that does not ship today.
 *
 * C1 is the limits, taken word for word from messages/he.json. Putting them in a promotional
 * film is a deliberate choice: all three are already on the public page, so hiding them here
 * would only mean the viewer discovers them thirty seconds later with less goodwill. It also
 * settles the presentations question honestly — the film says plainly that PowerPoint is not
 * supported yet, rather than claiming it is.
 *
 * C2 is Scene6, moved out of part B. It was the close of a two-act film; now the film has
 * three acts and the close belongs at the end of the third.
 */
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, UI_FONT } from "./theme";
import { useCopy } from "./copy";

/* --------------------------------------------------------------------- C1 · what it will not do */

export function SceneC1() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const copy = useCopy();

  const title = spring({ frame: frame - 6, fps, config: { damping: 200, mass: 1 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.background,
        fontFamily: UI_FONT,
        direction: copy.dir,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AbsoluteFill
        style={{
          background: "radial-gradient(54% 52% at 50% 46%, rgba(255,255,255,0.05), transparent 72%)",
        }}
      />

      <div
        style={{
          fontSize: 46,
          fontWeight: 700,
          color: C.foreground,
          marginBottom: 52,
          opacity: title,
          transform: `translateY(${interpolate(title, [0, 1], [16, 0])}px)`,
        }}
      >
        {copy.limitsTitle}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 26, width: 1080 }}>
        {copy.limits.map((limit, i) => {
          const arrive = spring({
            // The take names them at 2.84s; at this scene offset that is frame 105.
            frame: frame - (100 + i * 34),
            fps,
            config: { damping: 200, mass: 1 },
          });

          return (
            <div
              key={limit}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                fontSize: 31,
                lineHeight: 1.5,
                color: C.muted,
                background: C.card,
                border: `1px solid ${C.divider}`,
                borderRadius: 12,
                padding: "24px 30px",
                opacity: arrive,
                transform: `translateY(${interpolate(arrive, [0, 1], [18, 0])}px)`,
              }}
            >
              {/* A rule rather than a cross. These are boundaries, not failures. */}
              <span style={{ width: 22, height: 2, background: C.warning, flex: "0 0 auto" }} />
              {limit}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
