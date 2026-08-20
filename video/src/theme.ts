/**
 * The product's own colours, copied from app/globals.css (.dark).
 *
 * The video is graded to the interface rather than to a stock palette, so a viewer who
 * clicks through lands somewhere that looks like what they just watched. If the product
 * palette changes, change it here too — these are duplicated values, not imported ones,
 * because the video project deliberately does not depend on the app.
 */
export const C = {
  background: "#24272a",
  foreground: "#e9e7e0",
  card: "#2b2f32",
  primary: "#5cc3a8",
  primaryDeep: "#07211b",
  muted: "#a9a89f",
  divider: "#3b4045",
  border: "#85898c",
  sidebar: "#1f2225",
  accent: "#23403a",
  accentFg: "#6fd0b6",
  warning: "#e0b160",
} as const;

/** One frame rate for every composition. Cutting a 24 against a 30 judders. */
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const seconds = (s: number) => Math.round(s * FPS);

/**
 * Hebrew titles get a blurred shadow rather than a stroke.
 *
 * An outline traced around Hebrew letterforms fills the counters of ם, ס and ט and turns
 * them into blocks. A shadow separates the text from whatever is behind it without
 * touching the shapes.
 */
export const HEBREW_SHADOW =
  "0 0 18px rgba(0,0,0,0.65), 0 0 36px rgba(0,0,0,0.45), 0 2px 4px rgba(0,0,0,0.55)";

export const UI_FONT =
  '"Segoe UI", "Assistant", "Heebo", system-ui, -apple-system, sans-serif';
export const MONO_FONT = '"Cascadia Code", "Consolas", ui-monospace, monospace';
