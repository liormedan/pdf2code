/**
 * Scene 4 — what comes out.
 *
 * Every file name and every byte count on screen is from the conversion that produced this
 * document's output — the run in assets/, not a plausible-looking list. A viewer who signs
 * up and converts something will get exactly this set of files, which is the reason to show
 * the real one.
 *
 * The privacy line is stated as a fact about where the work happens, not as a promise about
 * what we do with uploads, because there are no uploads to make a promise about.
 */
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO_FONT, UI_FONT } from "./theme";
import { usePdfRaster } from "./pdf";
import { useCopy } from "./copy";

/** The real output of the real conversion. Re-measure if the converter changes. */
/** The real output of the real conversion. Names and sizes are not translated. */
const FILES = [
  { name: "index.html", bytes: 10343 },
  { name: "QuarterlyReport.jsx", bytes: 9741 },
  { name: "QuarterlyReport.css", bytes: 1069 },
  { name: "README.md", bytes: 904 },
];

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function Scene4() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const raster = usePdfRaster("report.pdf", 1, 2);
  const copy = useCopy();

  // The document steps aside and the output it produced comes forward.
  const step = spring({ frame: frame - 18, fps, config: { damping: 200, mass: 1.2 } });

  const pageScale = interpolate(step, [0, 1], [0.5, 0.3]);
  const pageX = interpolate(step, [0, 1], [0, 620]);

  return (
    <AbsoluteFill style={{ backgroundColor: C.background }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(58% 56% at 50% 48%, rgba(255,255,255,0.06), transparent 72%)",
        }}
      />

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: raster?.width ?? 1190,
            height: raster?.height ?? 1684,
            transform: `translateX(${pageX}px) scale(${pageScale})`,
            boxShadow: "0 30px 74px rgba(0,0,0,0.6)",
            background: "#fff",
          }}
        >
          {raster ? <Img src={raster.src} style={{ width: "100%", height: "100%" }} /> : null}
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          left: 120,
          top: 250,
          width: 900,
          direction: copy.dir,
          fontFamily: UI_FONT,
        }}
      >
        {FILES.map((file, i) => {
          const arrive = spring({
            frame: frame - (54 + i * 14),
            fps,
            config: { damping: 200, mass: 0.9 },
          });

          return (
            <div
              key={file.name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 24,
                background: C.card,
                border: `1px solid ${C.divider}`,
                borderRadius: 12,
                padding: "20px 26px",
                marginBottom: 14,
                opacity: arrive,
                transform: `translateY(${interpolate(arrive, [0, 1], [26, 0])}px)`,
                boxShadow: "0 18px 44px rgba(0,0,0,0.35)",
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: MONO_FONT,
                    fontSize: 25,
                    color: C.primary,
                    direction: "ltr",
                    textAlign: copy.dir === "rtl" ? "right" : "left",
                  }}
                >
                  {file.name}
                </div>
                <div style={{ fontSize: 19, color: C.muted, marginTop: 6 }}>{copy.fileNotes[i]}</div>
              </div>
              <div style={{ fontFamily: MONO_FONT, fontSize: 20, color: C.muted, direction: "ltr" }}>
                {kb(file.bytes)}
              </div>
            </div>
          );
        })}

        <div
          style={{
            marginTop: 30,
            fontSize: 25,
            color: C.accentFg,
            opacity: spring({ frame: frame - 172, fps, config: { damping: 200 } }),
          }}
        >
          {copy.outputLine}
        </div>
      </div>
    </AbsoluteFill>
  );
}
