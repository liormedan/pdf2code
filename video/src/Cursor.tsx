/**
 * A pointer, drawn rather than filmed.
 *
 * Screen recordings of a cursor come out at the recording's own scale and never match a
 * 1920-wide frame; this one is a shape, so it stays crisp and can be put exactly where a
 * beat needs it.
 */
export function Cursor({
  x,
  y,
  pressed = false,
  size = 46,
}: {
  x: number;
  y: number;
  pressed?: boolean;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{
        position: "absolute",
        left: x,
        top: y,
        // The tip is the hotspot, so the shape hangs from the coordinate rather than
        // being centred on it.
        transform: `scale(${pressed ? 0.88 : 1})`,
        transformOrigin: "0 0",
        filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.55))",
        pointerEvents: "none",
      }}
    >
      <path
        d="M4 2.5 L4 19 L8.4 15.1 L11.2 21.2 L14.1 19.9 L11.3 13.9 L17.2 13.6 Z"
        fill="#ffffff"
        stroke="#17150f"
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
    </svg>
  );
}
