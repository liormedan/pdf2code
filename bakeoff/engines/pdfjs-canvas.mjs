// Engine: pdf.js canvas raster + positioned text layer overlay.
//
// Visual fidelity is by definition perfect (it is the reference raster), and the
// overlaid text layer keeps text selectable and searchable. The trade-off is that
// the output is an image, not markup: nothing about it is editable or restyleable.

import { TextLayer } from "../../node_modules/pdfjs-dist/build/pdf.mjs";

export default {
  id: "pdfjs-canvas",
  label: "pdf.js — canvas + text layer",
  note: "Perfect visuals, selectable text, but output is an image. Not editable markup.",

  async render(page, mount, { scale }) {
    const viewport = page.getViewport({ scale });

    const wrap = document.createElement("div");
    wrap.className = "page-wrap";
    wrap.style.width = `${viewport.width}px`;
    wrap.style.height = `${viewport.height}px`;

    const canvas = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    wrap.append(canvas);

    const textDiv = document.createElement("div");
    textDiv.className = "text-layer";
    wrap.append(textDiv);
    mount.append(wrap);

    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
      transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
    }).promise;

    const textContent = await page.getTextContent();
    const layer = new TextLayer({ textContentSource: textContent, container: textDiv, viewport });
    await layer.render();

    return {
      // A raster page carries no meaningful markup weight, so report the image instead.
      bytes: canvas.width * canvas.height * 4,
      chars: textContent.items.reduce((n, i) => n + (i.str?.length ?? 0), 0),
      kind: "raster + text overlay",
    };
  },
};
