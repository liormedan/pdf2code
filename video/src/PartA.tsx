/**
 * Part A — the introduction.
 *
 * Four beats: hello and what this is, why it is worth wanting, when it applies, and then
 * the handoff into the demonstration.
 *
 * On what it says it converts. The brief asked for "PDF and presentations". Production says
 * otherwise — the live page carries the line "PowerPoint files are not supported yet",
 * `pptxEnabled()` reads an env var that is not set, and the Google Slides path needs three
 * keys that are not configured either. So A1 says PDF and only PDF. The moment presentations
 * ship, this is one line of narration and one line on screen.
 *
 * A3 is Scene5, reused rather than reimplemented. The four situations are introduction
 * material — they answer "when would I want this" — and they were sitting in part B where
 * they arrived after the demonstration had already made the case. Moving them here is why
 * part B no longer has a scene 5. One line in Film.tsx puts it back.
 *
 * A4 is the join: it ends with a page at OPEN_SCALE / OPEN_ORIGIN_Y, the exact transform
 * scene 1 opens on, so the last frame of part A and the first frame of part B are the same
 * picture and no caption has to announce a part two.
 */
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, UI_FONT } from "./theme";
import { usePdfRaster } from "./pdf";
import { OPEN_ORIGIN_Y, OPEN_SCALE } from "./Scene1";
import { useCopy } from "./copy";

function LogoMark({ size = 116 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={size} height={size} aria-hidden="true">
      <rect x="3" y="2" width="14" height="17" rx="2.5" fill={C.primary} opacity="0.28" />
      <rect x="7" y="5" width="14" height="17" rx="2.5" fill={C.background} stroke={C.primary} strokeWidth="1.6" />
      <path d="M10.5 10.5h7M10.5 13.5h7M10.5 16.5h4" stroke={C.primary} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------------------------------------- A1 · hello, and what this is */

export function SceneA1() {
  const frame = useCurrentFrame();
  const copy = useCopy();
  const { fps } = useVideoConfig();

  const mark = spring({ frame: frame - 6, fps, config: { damping: 200, mass: 1.1 } });
  const name = spring({ frame: frame - 26, fps, config: { damping: 200, mass: 1 } });
  const line = spring({ frame: frame - 96, fps, config: { damping: 200, mass: 1 } });

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
          background: "radial-gradient(48% 46% at 50% 42%, rgba(92,195,168,0.11), transparent 70%)",
        }}
      />

      <div style={{ opacity: mark, transform: `scale(${interpolate(mark, [0, 1], [0.86, 1])})` }}>
        <LogoMark />
      </div>

      <div
        style={{
          fontSize: 78,
          fontWeight: 700,
          letterSpacing: -1.5,
          color: C.foreground,
          marginTop: 24,
          direction: "ltr",
          opacity: name,
          transform: `translateY(${interpolate(name, [0, 1], [16, 0])}px)`,
        }}
      >
        PDF to Code
      </div>

      {/* The product's own subhead, word for word from messages/he.json. */}
      <div
        style={{
          fontSize: 30,
          color: C.muted,
          marginTop: 30,
          maxWidth: 1080,
          textAlign: "center",
          lineHeight: 1.55,
          opacity: line,
          transform: `translateY(${interpolate(line, [0, 1], [14, 0])}px)`,
        }}
      >
        {copy.subhead}
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------------------ A2 · why */


function Column({
  title,
  verbs,
  lit,
  at,
}: {
  title: string;
  verbs: string[];
  lit: boolean;
  at: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const arrive = spring({ frame: frame - at, fps, config: { damping: 200, mass: 1 } });

  return (
    <div
      style={{
        flex: "0 0 380px",
        opacity: arrive,
        transform: `translateY(${interpolate(arrive, [0, 1], [22, 0])}px)`,
      }}
    >
      <div
        style={{
          fontSize: 22,
          letterSpacing: 2,
          color: lit ? C.accentFg : C.muted,
          marginBottom: 26,
        }}
      >
        {title}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {verbs.map((verb, i) => {
          const each = spring({ frame: frame - (at + 14 + i * 13), fps, config: { damping: 200 } });
          return (
            <div
              key={verb}
              style={{
                fontSize: 40,
                fontWeight: lit ? 700 : 400,
                color: lit ? C.foreground : C.muted,
                opacity: each * (lit ? 1 : 0.65),
              }}
            >
              {verb}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SceneA2() {
  const copy = useCopy();

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
          background: "radial-gradient(54% 52% at 50% 48%, rgba(255,255,255,0.05), transparent 72%)",
        }}
      />

      <div style={{ display: "flex", gap: 120, alignItems: "flex-start" }}>
        {/* The lit column waits for the line that names it. "שינוי בקוד לוקח דקה" begins
            187 frames into the take, which lands on frame 200 at this offset. */}
        <Column title={copy.asDocument.title} verbs={copy.asDocument.verbs} lit={false} at={40} />
        <div style={{ width: 1, alignSelf: "stretch", background: C.divider }} />
        <Column title={copy.asCode.title} verbs={copy.asCode.verbs} lit at={200} />
      </div>
    </AbsoluteFill>
  );
}

/* ----------------------------------------------------------------------- A4 · the handoff */

export function SceneA4({ frames }: { frames: number }) {
  const frame = useCurrentFrame();
  const raster = usePdfRaster("report.pdf", 1, 2);

  // A page comes forward and settles into the exact frame part B opens on. The landing has
  // to complete on the final frame, not before it, or the join reads as a pause.
  const land = interpolate(frame, [10, frames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  const scale = interpolate(land, [0, 1], [0.34, OPEN_SCALE]);
  const originY = interpolate(land, [0, 1], [0, OPEN_ORIGIN_Y]);

  return (
    <AbsoluteFill style={{ backgroundColor: C.background }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        {raster ? (
          <Img
            src={raster.src}
            style={{
              width: raster.width,
              height: raster.height,
              transform: `translateY(${originY}px) scale(${scale})`,
              // Scene 1 opens with no shadow at all, so this has to be gone by the last
              // frame or the cut will flash.
              boxShadow: `0 ${30 * (1 - land)}px ${70 * (1 - land)}px rgba(0,0,0,${0.6 * (1 - land)})`,
            }}
          />
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
