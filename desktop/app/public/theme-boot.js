/**
 * The theme, applied before the first paint.
 *
 * This is a file rather than an inline <script> for one reason: the Content Security
 * Policy in tauri.conf.json sets `script-src 'self'`, with no `unsafe-inline` and no
 * hash exception. An inline block would be blocked outright — and the honest fix is to
 * move the code, not to widen the policy that protects a window rendering markup built
 * from documents nobody vetted.
 *
 * It runs from <head>, so it beats the body to the screen and a dark install never
 * flashes white on startup.
 */
(function () {
  try {
    // Dark unless something else was chosen — the rule theme-toggle.tsx also applies.
    var choice = localStorage.getItem("theme") || "dark";
    var dark =
      choice === "dark" ||
      (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {
    // A WebView with site data blocked throws on localStorage. A window that opens in
    // the wrong theme is a far smaller failure than one that does not open.
  }
})();
