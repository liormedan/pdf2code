/**
 * The converter's text layer, rendered from the converter's own numbers.
 *
 * Every span here is one the shipping converter emitted for this document, at the offset,
 * size, weight and direction it chose. It is drawn the way the generated stylesheet draws
 * it in background mode — `color: transparent`, absolutely positioned, line-height 1,
 * whitespace preserved — so the glyphs the viewer reads are the raster's, and these boxes
 * sit exactly on top of them.
 *
 * That is not a shortcut, it is the honest picture: this is what the two-layer output
 * genuinely is. It also means the boxes cannot be faked into lining up. If a span were in
 * the wrong place, the outline would sit off the word and the video would show it.
 *
 * Span widths are never computed here. Each box is sized by laying out the real string in
 * the real font, which is the only way to get it right.
 */
import page1 from "./report1.json";

export interface Span {
  left: number;
  top: number;
  size: number;
  family: string;
  bold: boolean;
  rtl: boolean;
  text: string;
}

export const SPANS = page1.spans as Span[];
export const PAGE = { width: page1.width, height: page1.height };

/** The headline revenue figure — the element scene 2 reaches into and changes. */
export const HERO_SPAN = SPANS.findIndex((s) => s.text === "12.4M");

export function TextLayer({
  /** 0 → no outlines, 1 → the sweep has crossed the whole page. */
  sweep = 0,
  /** Span index that stays outlined after the sweep has passed. */
  hold = -1,
  /** New text for the hero span. Set once the code edit lands; covers the raster beneath. */
  heroText,
}: {
  sweep?: number;
  hold?: number;
  heroText?: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: PAGE.width,
        height: PAGE.height,
        // The JSON is in the PDF's own points; the raster behind it is rendered at 2x.
        transform: "scale(2)",
        transformOrigin: "0 0",
      }}
    >
      {SPANS.map((span, i) => {
        // Each outline arrives a little after the one before it, so the page comes apart
        // as a sweep rather than switching state all at once. Eight spans are lit at a
        // time; the rest have either not been reached or have already been passed.
        const reached = sweep * (SPANS.length + 10) - i;
        const rising = Math.max(0, Math.min(1, reached));
        const falling = Math.max(0, Math.min(1, 1 - (reached - 8) / 6));
        const ring = Math.max(i === hold ? 1 : 0, rising * falling);

        const edited = i === HERO_SPAN && heroText !== undefined;

        return (
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
              // Transparent by default: the raster underneath is what is being read. The
              // one edited span turns solid and paints over the pixels it replaces.
              color: edited ? "#17150f" : "transparent",
              background: edited
                ? "#faf8f3"
                : ring > 0.02
                  ? `rgba(92,195,168,${0.18 * ring})`
                  : undefined,
              outline: ring > 0.02 ? `1px solid rgba(13,107,91,${0.85 * ring})` : undefined,
              outlineOffset: 1,
            }}
          >
            {edited ? heroText : span.text}
          </span>
        );
      })}
    </div>
  );
}
