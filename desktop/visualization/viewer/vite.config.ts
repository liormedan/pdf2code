import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The viewer's own build. **Nothing here touches the product.**
 *
 * A dev server on 5180 rather than 1420: the app's server is on 1420 with `strictPort`,
 * and a tool that could take the product's port is a tool that breaks the product's
 * launch. This one is `strictPort` too, so if something already has 5180 it says so
 * instead of quietly moving.
 *
 * `fs.allow` reaches one level up because the map lives at `../system-map.json` and the
 * theme tokens are read out of the app's stylesheet — both read-only, both dev-only. The
 * dependency points this way and never back: no file under `desktop/app` imports anything
 * from here, which is what makes "not shipped" a fact about the build rather than a note.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5180, strictPort: true, fs: { allow: [".."] } },
  build: { target: "esnext" },
});
