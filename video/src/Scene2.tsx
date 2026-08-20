/**
 * Scene 2 — the same page, now made of parts.
 *
 * Scene 1 took hold of a number and the whole page came with it. This scene opens on that
 * same page, in the same position, at the same size — the continuity is the argument — and
 * then the page comes apart into the sixty-six spans the converter actually found in it.
 * The camera moves in on the one that would not move, the generated component opens beside
 * it, the value is changed in the code, and the page changes.
 *
 * The outlines are not drawn on. They are the real text layer laid over the raster with
 * transparent glyphs, which is precisely what the converted page is. If a span were in the
 * wrong place, its box would sit off the word and this shot would expose it.
 */
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "./theme";
import { usePdfRaster } from "./pdf";
import { HERO_SPAN, TextLayer } from "./TextLayer";
import { CodePanel } from "./CodePanel";

const OLD_VALUE = "12.4M";
const NEW_VALUE = "13.1M";

// Where the code is retyped, and where the page catches up with it.
const CUT_START = 232;
const TYPE_START = 240;
const TYPE_END = 252;

/** Wide is where scene 1 left the page; close puts the figure beside the code. */
const WIDE = { scale: 0.57, tx: 0, ty: 0 };
const CLOSE = { scale: 0.86, tx: 412, ty: 194 };

export function Scene2() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const raster = usePdfRaster("report.pdf", 1, 2);

  // The page comes apart, span by span.
  const sweep = interpolate(frame, [40, 132], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // In on the figure, then back out at the end to show it is still the same document.
  const push = spring({ frame: frame - 104, fps, config: { damping: 200, mass: 1.3 } });
  const pullOut = spring({ frame: frame - 318, fps, config: { damping: 200, mass: 1.3 } });
  const closeness = push * (1 - pullOut);

  const scale = interpolate(closeness, [0, 1], [WIDE.scale, CLOSE.scale]);
  const tx = interpolate(closeness, [0, 1], [WIDE.tx, CLOSE.tx]);
  const ty = interpolate(closeness, [0, 1], [WIDE.ty, CLOSE.ty]);

  // The component slides in from the reading-end of the frame, and leaves the same way.
  const panelIn = spring({ frame: frame - 168, fps, config: { damping: 200, mass: 1.1 } });
  const panelOut = spring({ frame: frame - 312, fps, config: { damping: 200, mass: 1 } });
  const panel = panelIn * (1 - panelOut);

  const highlight = interpolate(frame, [200, 224], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // The old value is cleared, then the new one typed in its place.
  const kept = Math.round(
    interpolate(frame, [CUT_START, TYPE_START], [OLD_VALUE.length, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const typed = Math.round(
    interpolate(frame, [TYPE_START, TYPE_END], [0, NEW_VALUE.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const codeValue = frame < TYPE_START ? OLD_VALUE.slice(0, kept) : NEW_VALUE.slice(0, typed);

  // The page catches up the moment the value in the code is whole again.
  const heroText = frame >= TYPE_END ? NEW_VALUE : undefined;

  return (
    <AbsoluteFill style={{ backgroundColor: C.background }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(62% 58% at 50% 48%, rgba(255,255,255,0.07), transparent 72%)",
        }}
      />

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            position: "relative",
            width: raster?.width ?? 1190,
            height: raster?.height ?? 1684,
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            boxShadow: "0 30px 74px rgba(0,0,0,0.6)",
            background: "#ffffff",
          }}
        >
          {raster ? <Img src={raster.src} style={{ width: "100%", height: "100%" }} /> : null}
          <TextLayer sweep={sweep} hold={sweep >= 1 ? HERO_SPAN : -1} heroText={heroText} />
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          left: 60,
          top: 352,
          opacity: panel,
          transform: `translateX(${interpolate(panel, [0, 1], [-90, 0])}px)`,
        }}
      >
        <CodePanel value={codeValue} highlight={highlight} width={760} />
      </div>
    </AbsoluteFill>
  );
}
