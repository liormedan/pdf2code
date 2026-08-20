/**
 * Scene 6 — the close.
 *
 * The mark is the same two offset sheets as components/logo.tsx in the app, redrawn here
 * rather than imported, because the video project deliberately does not depend on the app.
 * If the mark changes there, it has to change here.
 *
 * The free allowance is stated as twenty because that is what FREE.conversions is in
 * src/lib/plans.ts. A number in an advert that has drifted from the number in the code is
 * the kind of thing people find out at signup.
 */
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, UI_FONT } from "./theme";
import { useCopy } from "./copy";

function LogoMark({ size = 132 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={size} height={size} aria-hidden="true">
      <rect x="3" y="2" width="14" height="17" rx="2.5" fill={C.primary} opacity="0.28" />
      <rect
        x="7"
        y="5"
        width="14"
        height="17"
        rx="2.5"
        fill={C.background}
        stroke={C.primary}
        strokeWidth="1.6"
      />
      <path
        d="M10.5 10.5h7M10.5 13.5h7M10.5 16.5h4"
        stroke={C.primary}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Scene6() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const copy = useCopy();

  const mark = spring({ frame: frame - 6, fps, config: { damping: 200, mass: 1.1 } });
  const name = spring({ frame: frame - 26, fps, config: { damping: 200, mass: 1 } });
  const line = spring({ frame: frame - 52, fps, config: { damping: 200, mass: 1 } });
  const url = spring({ frame: frame - 78, fps, config: { damping: 200, mass: 1 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.background,
        fontFamily: UI_FONT,
        alignItems: "center",
        justifyContent: "center",
        direction: copy.dir,
      }}
    >
      <AbsoluteFill
        style={{
          background: "radial-gradient(48% 46% at 50% 44%, rgba(92,195,168,0.10), transparent 70%)",
        }}
      />

      <div
        style={{
          opacity: mark,
          transform: `scale(${interpolate(mark, [0, 1], [0.85, 1])})`,
          marginBottom: 26,
        }}
      >
        <LogoMark />
      </div>

      <div
        style={{
          fontSize: 74,
          fontWeight: 700,
          color: C.foreground,
          letterSpacing: -1,
          opacity: name,
          transform: `translateY(${interpolate(name, [0, 1], [16, 0])}px)`,
          direction: "ltr",
        }}
      >
        PDF to Code
      </div>

      <div
        style={{
          fontSize: 34,
          color: C.muted,
          marginTop: 22,
          opacity: line,
          transform: `translateY(${interpolate(line, [0, 1], [14, 0])}px)`,
        }}
      >
        {copy.allowance}
      </div>

      <div
        style={{
          fontSize: 40,
          fontWeight: 600,
          color: C.primary,
          marginTop: 54,
          opacity: url,
          transform: `translateY(${interpolate(url, [0, 1], [14, 0])}px)`,
          direction: "ltr",
        }}
      >
        pdf2code.vercel.app
      </div>
    </AbsoluteFill>
  );
}
