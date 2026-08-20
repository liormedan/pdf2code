/**
 * Scene 5 — the four situations.
 *
 * The wording is lifted from messages/he.json rather than rewritten for the video, so the
 * page a viewer lands on says the same thing in the same words. Copy that drifts between
 * an ad and the product it advertises is a small dishonesty that costs trust for nothing.
 *
 * The narration over this does not read the cards out. Four cards on screen with a voice
 * reciting them is the same information twice; the line written to this picture says the
 * thing the cards cannot.
 */
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, UI_FONT } from "./theme";
import { useCopy } from "./copy";



export function Scene5() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const copy = useCopy();

  return (
    <AbsoluteFill style={{ backgroundColor: C.background, fontFamily: UI_FONT, direction: copy.dir }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(60% 58% at 50% 46%, rgba(255,255,255,0.05), transparent 72%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 34,
          padding: "150px 130px",
          alignContent: "center",
        }}
      >
        {copy.cases.map((item, i) => {
          const arrive = spring({
            frame: frame - (14 + i * 26),
            fps,
            config: { damping: 200, mass: 1 },
          });

          return (
            <div
              key={item.title}
              style={{
                background: C.card,
                border: `1px solid ${C.divider}`,
                borderRadius: 16,
                padding: "34px 38px",
                opacity: arrive,
                transform: `translateY(${interpolate(arrive, [0, 1], [30, 0])}px)`,
                boxShadow: "0 20px 50px rgba(0,0,0,0.38)",
              }}
            >
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: C.primary,
                  marginBottom: 12,
                  letterSpacing: 0.4,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <div style={{ fontSize: 33, fontWeight: 700, color: C.foreground, marginBottom: 14 }}>
                {item.title}
              </div>
              <div style={{ fontSize: 23, lineHeight: 1.6, color: C.muted }}>{item.body}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
