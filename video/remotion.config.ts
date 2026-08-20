import { Config } from "@remotion/cli/config";

Config.setEntryPoint("src/index.ts");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// pdf.js paints the page into a canvas during the render, so the browser needs a real
// GL path rather than the software fallback.
Config.setChromiumOpenGlRenderer("angle");
