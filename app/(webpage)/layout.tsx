/**
 * The public side of the site.
 *
 * A route group of its own, deliberately: the dashboard's layout wraps everything in
 * ActivityProvider and PendingFileProvider, and the webpage needs neither. This is the
 * one page a stranger loads, so what it does not pull in matters as much as what it
 * shows — nothing here may reach the converter, pdf.js or Firebase, directly or through
 * a component that imports them.
 */
export default function WebpageLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}
