/**
 * Scene 1 — the document is one object.
 *
 * The beat this has to land without a word being said: a PDF page is not a set of things
 * you can reach into, it is a single flat artifact. So the shot opens close on a real page
 * looking exactly as good as a PDF looks — that part is not a straw man — pulls back until
 * it reads as a *file*, and then tries to take hold of one number in it. The whole page
 * comes with it, rigid, and springs back untouched.
 *
 * What is deliberately NOT claimed: that a PDF's text cannot be selected, or that it
 * cannot be shown on a phone. PDF does both fine, and a video that overstates the problem
 * gets disbelieved on the parts that are true.
 *
 * No titles and no narration yet, by design — the words get written to this picture rather
 * than the picture built to fit words already written.
 */
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "./theme";
import { Cursor } from "./Cursor";
import { usePdfRaster } from "./pdf";

/**
 * The frame part A has to land on.
 *
 * Scene 1 opens held close on the top of the page. Part A ends by putting a page in exactly
 * this position at exactly this size, so the last frame of one and the first frame of the
 * other are the same picture and the join disappears. Exported rather than duplicated,
 * because two copies of a number like this drift apart the first time either is touched.
 */
export const OPEN_SCALE = 1.15;
export const OPEN_ORIGIN_Y = 488;

/** The headline revenue figure, at the offset the converter itself reports for it. */
const TARGET = { x: 518, y: 248 };

export function Scene1() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const raster = usePdfRaster("report.pdf", 1, 2);

  // Beat 1 — held close on the top of the page, drifting almost imperceptibly.
  const drift = interpolate(frame, [0, 60], [0, -14], { extrapolateRight: "clamp" });

  // Beat 2 — pull back until the whole page is in frame and reads as a file on a surface.
  const wide = spring({ frame: frame - 48, fps, config: { damping: 200, mass: 1.1 } });
  const scale = interpolate(wide, [0, 1], [OPEN_SCALE, 0.57]);
  const originY = interpolate(wide, [0, 1], [OPEN_ORIGIN_Y, 0]) + drift * (1 - wide);
  const grounded = wide;

  // Beat 3 — the pointer arrives at the number somebody would want to change.
  const approach = spring({ frame: frame - 112, fps, config: { damping: 200, mass: 1.5 } });

  // Beat 4 — the drag. The pointer pulls, the entire page follows as one piece, it is let
  // go, and it springs back precisely where it was. Nothing has changed. That is the shot.
  const grip = spring({ frame: frame - 168, fps, config: { damping: 200, mass: 0.7 } });
  const release = spring({ frame: frame - 224, fps, config: { damping: 9, mass: 0.9, stiffness: 80 } });
  const pull = grip * (1 - release);
  const pressed = frame >= 168 && frame < 224;

  const dragX = pull * -128;
  const dragY = pull * -38;
  const tilt = pull * -1.35;

  const rasterW = raster?.width ?? 1190;
  const rasterH = raster?.height ?? 1684;

  // Point in the PDF's own coordinate space to a point in the frame.
  const at = (ptX: number, ptY: number) => ({
    x: 960 + (ptX * 2 - rasterW / 2) * scale,
    y: 540 + (ptY * 2 - rasterH / 2) * scale + originY,
  });

  const anchor = at(TARGET.x, TARGET.y);
  const cursorX = interpolate(approach, [0, 1], [2060, anchor.x]) + dragX;
  const cursorY = interpolate(approach, [0, 1], [1010, anchor.y]) + dragY;

  return (
    <AbsoluteFill style={{ backgroundColor: C.background }}>
      {/* A pool of light for the page to sit in once it has pulled back. */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(62% 58% at 50% 48%, rgba(255,255,255,0.07), transparent 72%)",
          opacity: grounded,
        }}
      />

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        {raster ? (
          <Img
            src={raster.src}
            style={{
              width: rasterW,
              height: rasterH,
              transform: `translate(${dragX}px, ${originY + dragY}px) scale(${scale}) rotate(${tilt}deg)`,
              boxShadow: `0 ${30 * grounded}px ${74 * grounded}px rgba(0,0,0,${0.6 * grounded})`,
            }}
          />
        ) : null}
      </AbsoluteFill>

      <Cursor x={cursorX} y={cursorY} pressed={pressed} />
    </AbsoluteFill>
  );
}
