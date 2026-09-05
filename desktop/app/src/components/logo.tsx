/**
 * The mark: two layers, offset.
 *
 * It draws the thing the product actually does rather than a generic document glyph.
 * Every converted page here is a raster layer carrying the graphics with real text
 * positioned over it, and that is the whole argument the webpage makes — so the logo is
 * two overlapping sheets, the one behind plain and the one in front carrying lines of
 * text. At 16px it reads as layers; at 200px it still reads as layers.
 *
 * No imports on purpose. This renders inside a server component on the public page,
 * where an icon library would cost more than every other byte on it combined.
 */
export function LogoMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {/* The layer behind: what the page looks like. */}
      <rect x="3" y="2" width="14" height="17" rx="2.5" className="fill-current opacity-25" />
      {/* The layer in front: what the page says, still readable. */}
      <rect x="7" y="5" width="14" height="17" rx="2.5" className="fill-background stroke-current" strokeWidth="1.6" />
      <path d="M10.5 10.5h7M10.5 13.5h7M10.5 16.5h4" className="stroke-current" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Mark plus name, for headers. */
export function Logo({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <LogoMark />
      </span>
      <span className="font-semibold tracking-tight">{name}</span>
    </span>
  );
}
