/**
 * The generated component, shown verbatim.
 *
 * These three lines are copied out of assets/converted-QuarterlyReport.jsx exactly as the
 * converter wrote them — the offsets, the font stack, the weight, and the `dir="rtl"` that
 * appears on the Hebrew label and not on the figure beside it, because direction is decided
 * per run rather than per page. Nothing here is prettified for the camera. Long lines soft
 * wrap the way an editor wraps them.
 *
 * Colours come from the product's dark palette so the code reads as part of the same
 * world as everything else in the film.
 */
import { C, MONO_FONT } from "./theme";

const TOKEN = /("(?:[^"\\]|\\.)*")|(\{|\}|<|>|\/>|<\/)|([A-Za-z][\w.-]*)(?==)|(\b\d+(?:\.\d+)?\b)|(\bspan\b)/g;

const COLOURS = {
  string: "#e9e7e0",
  punct: "#7f8a90",
  attr: C.warning,
  number: "#f0907a",
  tag: C.primary,
  plain: "#c9c7bf",
} as const;

function tokenize(line: string) {
  const parts: { text: string; colour: string }[] = [];
  let last = 0;

  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: line.slice(last, at), colour: COLOURS.plain });

    const colour = m[1]
      ? COLOURS.string
      : m[2]
        ? COLOURS.punct
        : m[3]
          ? COLOURS.attr
          : m[4]
            ? COLOURS.number
            : COLOURS.tag;

    parts.push({ text: m[0], colour });
    last = at + m[0].length;
  }

  if (last < line.length) parts.push({ text: line.slice(last), colour: COLOURS.plain });
  return parts;
}

/** The figure's own line, with whatever value is currently in it. */
export const heroLine = (value: string) =>
  `<span style={{ left: 482.81, top: 238.25, fontSize: 19, fontFamily: "'Segoe UI', sans-serif", fontWeight: 700 }}>{"${value}"}</span>`;

export const CONTEXT_LINES = [
  `<span style={{ left: 511.73, top: 223.5, fontSize: 7.5, fontFamily: "'Segoe UI', sans-serif" }} dir="rtl">{"הכנסות"}</span>`,
  `<span style={{ left: 468.56, top: 238.25, fontSize: 19, fontFamily: "'Segoe UI', sans-serif", fontWeight: 700 }}>{"₪"}</span>`,
];

export function CodePanel({
  value,
  /** 0 → the figure's line is unmarked, 1 → fully marked as the line being changed. */
  highlight = 0,
  width,
}: {
  value: string;
  highlight?: number;
  width: number;
}) {
  const lines = [
    { text: CONTEXT_LINES[0], hero: false },
    { text: CONTEXT_LINES[1], hero: false },
    { text: heroLine(value), hero: true },
  ];

  return (
    <div
      style={{
        width,
        background: C.sidebar,
        border: `1px solid ${C.divider}`,
        borderRadius: 14,
        padding: "26px 30px",
        fontFamily: MONO_FONT,
        fontSize: 17,
        lineHeight: 1.85,
        direction: "ltr",
        textAlign: "left",
        boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ color: C.muted, fontSize: 13, marginBottom: 14, letterSpacing: 0.3 }}>
        QuarterlyReport.jsx
      </div>

      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            position: "relative",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            // A hanging indent so a wrapped line still reads as one line of code.
            paddingLeft: 18,
            textIndent: -18,
            marginBottom: 10,
            background: line.hero ? `rgba(92,195,168,${0.14 * highlight})` : undefined,
            boxShadow: line.hero && highlight > 0.02
              ? `inset 3px 0 0 rgba(92,195,168,${highlight})`
              : undefined,
            borderRadius: 4,
          }}
        >
          {tokenize(line.text).map((part, j) => (
            <span key={j} style={{ color: part.colour }}>
              {part.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
