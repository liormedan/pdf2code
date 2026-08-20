/**
 * Rasterising a real page of a real PDF, inside the render.
 *
 * The video does not use screenshots of the product. It runs the same library the
 * product runs — pdf.js, the copy from the app's own node_modules — over the same fixture
 * the converter is tested against. What appears on screen is therefore the document, not
 * a picture of the document, and it cannot quietly drift away from what the app produces.
 *
 * Remotion renders in Chrome, so this is an ordinary browser workload; the only care
 * needed is holding the frame until the page has actually painted, which is what
 * delayRender is for.
 */
import { useEffect, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

/** Webpack must not try to resolve the pdf.js entry — it is served, not bundled. */
const loadPdfjs = async () => {
  const mod = await import(/* webpackIgnore: true */ staticFile("pdf.mjs"));
  mod.GlobalWorkerOptions.workerSrc = staticFile("pdf.worker.mjs");
  return mod;
};

export interface Raster {
  src: string;
  width: number;
  height: number;
}

/**
 * @param file  name of a PDF in public/
 * @param page  1-based page number
 * @param scale multiplier over the page's own point size. 2 renders a 960pt slide at
 *              exactly 1920px, which is the frame — no resampling anywhere.
 */
export function usePdfRaster(file: string, page = 1, scale = 2): Raster | null {
  const [raster, setRaster] = useState<Raster | null>(null);
  const [handle] = useState(() => delayRender(`rasterising ${file} page ${page}`));

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const doc = await pdfjs.getDocument(staticFile(file)).promise;
        const target = await doc.getPage(page);
        const viewport = target.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        await target.render({ canvasContext: context, viewport }).promise;

        if (!live) return;
        setRaster({ src: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height });
        continueRender(handle);
      } catch (error) {
        // Failing loudly beats rendering ninety frames of empty grey and finding out in
        // the edit that the hero shot never had a document in it.
        continueRender(handle);
        throw error;
      }
    })();

    return () => {
      live = false;
    };
  }, [file, page, scale, handle]);

  return raster;
}
