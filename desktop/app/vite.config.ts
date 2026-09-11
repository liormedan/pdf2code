import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * Vite, configured for a window rather than a website.
 *
 * The `@` alias points at `src/`, which is what lets the sixteen shadcn components move
 * over from the web app untouched: they import `@/lib/utils` and `@/components/ui/...`,
 * and both resolve here exactly as they did under Next.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },

  // Tauri drives this server and shows its own error window, so failing loudly on a
  // taken port beats silently moving to another one the Rust side is not pointed at.
  //
  // 1447 and not 1420: 1420 is every Tauri project's default, and another project on
  // this machine sat on it — with `strictPort` that meant this one could not start, and
  // with `cargo run` alone it meant the window loaded the other project's page. A port
  // that is nobody's default collides with nobody. The Rust side names the same number
  // in tauri.conf.json; the two must agree.
  server: { port: 1447, strictPort: true },

  // Tauri decides the target, not browserslist: the WebView is Edge on Windows and
  // WebKit elsewhere, both of which are far ahead of the default baseline.
  build: {
    target: "esnext",
    // The debug build keeps sourcemaps so a stack trace in the packaged app is
    // readable; the release build drops them rather than ship our sources.
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },

  // A native app has no reason to ask the network anything at startup.
  clearScreen: false,
});
