/**
 * Scene 3 — the two layers, pulled apart.
 *
 * This is the only scene that explains a mechanism, and it has one job: make it obvious why
 * the result can look identical to the original and still be text.
 *
 * The thing it would be easy to lie about, and does not: the raster is NOT a picture of the
 * page with its words removed. pdf.js renders everything, glyphs included, so the back plane
 * carries the words as pixels. The front plane carries the same words again, as text. That
 * duplication IS the design — the front layer is invisible in normal use and exists so the
 * words can be selected, searched, translated and edited. The labels say exactly that rather
 * than the tidier "graphics behind, text in front", which would be wrong.
 *
 * The planes separate on the diagonal rather than in depth. Sibling elements each get their
 * own 3D context, so translateZ does not sort them against each other and the first attempt
 * put the raster on top of the layer it was supposed to sit behind. An offset cannot fail
 * that way.
 */
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, UI_FONT } from "./theme";
import { usePdfRaster } from "./pdf";
import { SPANS } from "./TextLayer";
import { useCopy } from "./copy";

const SCALE = 0.32;
/** The stack sits left of centre so the labels have a column of their own. */
const STACK_X = -200;

export function Scene3() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const raster = usePdfRaster("report.pdf", 1, 2);
  const copy = useCopy();

  const apart = spring({ frame: frame - 24, fps, config: { damping: 200, mass: 1.4 } });
  const rejoin = spring({ frame: frame - 262, fps, config: { damping: 200, mass: 1.3 } });
  const split = apart * (1 - rejoin);

  // The front layer is solid only while the layers are apart, and only so it can be seen.
  // It returns to transparent as they close, because transparent is what it actually is.
  const inked = interpolate(frame, [190, 214, 262, 300], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const rasterW = raster?.width ?? 1190;
  const rasterH = raster?.height ?? 1684;

  // The tilt puts part of the raster nearer the camera than the text plane, and a 3D
  // rendering context sorts by that rather than by document order. An explicit stacking
  // order keeps the layer named "in front" actually in front.
  const plane = (dx: number, dy: number, z: number): React.CSSProperties => ({
    position: "absolute",
    zIndex: z,
    left: "50%",
    top: "50%",
    width: rasterW,
    height: rasterH,
    marginLeft: -rasterW / 2,
    marginTop: -rasterH / 2,
    transform:
      `translate(${STACK_X + dx * split}px, ${dy * split}px)` +
      ` rotateY(${-16 * split}deg) rotateX(${6 * split}deg) scale(${SCALE})`,
  });

  const label = (top: number, colour: string): React.CSSProperties => ({
    position: "absolute",
    right: 90,
    top,
    width: 660,
    fontFamily: UI_FONT,
    direction: copy.dir,
    textAlign: copy.dir === "rtl" ? "right" : "left",
    color: colour,
    opacity: split,
  });

  return (
    <AbsoluteFill style={{ backgroundColor: C.background }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(58% 56% at 42% 48%, rgba(255,255,255,0.07), transparent 72%)",
        }}
      />

      <AbsoluteFill style={{ perspective: 2400 }}>
        {/* Behind: everything the page looks like, as pixels — words included. */}
        <div style={{ ...plane(150, 160, 1), boxShadow: "0 34px 80px rgba(0,0,0,0.7)", background: "#fff" }}>
          {raster ? <Img src={raster.src} style={{ width: "100%", height: "100%" }} /> : null}
        </div>

        {/* In front: the same words a second time, as text. */}
        <div style={plane(-150, -160, 2)}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `rgba(31,34,37,${0.82 * split})`,
              border: `2px solid rgba(92,195,168,${0.55 * split})`,
              boxShadow: `0 34px 80px rgba(0,0,0,${0.6 * split})`,
            }}
          />
          <div style={{ position: "absolute", inset: 0, transform: "scale(2)", transformOrigin: "0 0" }}>
            {SPANS.map((span, i) => (
              <span
                key={i}
                dir={span.rtl ? "rtl" : undefined}
                style={{
                  position: "absolute",
                  left: span.left,
                  top: span.top,
                  fontSize: span.size,
                  fontFamily: span.family,
                  fontWeight: span.bold ? 700 : 400,
                  whiteSpace: "pre",
                  lineHeight: 1,
                  transformOrigin: "0 0",
                  color: `rgba(233,231,224,${inked})`,
                }}
              >
                {span.text}
              </span>
            ))}
          </div>
        </div>
      </AbsoluteFill>

      <div style={label(286, C.accentFg)}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>{copy.layers.text.title}</div>
        <div style={{ fontSize: 25, lineHeight: 1.55, color: C.muted, marginTop: 10 }}>
          {copy.layers.text.body}
        </div>
      </div>

      <div style={label(724, C.foreground)}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>{copy.layers.raster.title}</div>
        <div style={{ fontSize: 25, lineHeight: 1.55, color: C.muted, marginTop: 10 }}>
          {copy.layers.raster.body}
        </div>
      </div>
    </AbsoluteFill>
  );
}
