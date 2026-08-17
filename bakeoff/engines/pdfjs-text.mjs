// Engine: pure HTML/CSS reconstruction from pdf.js text content.
//
// No canvas. Every glyph run becomes an absolutely-positioned <span> carrying its own
// font size, family and rotation. The output is real markup — editable, restyleable,
// diffable — but it carries only text: vector art, background images and rules are lost.
//
// This is the honest test of "can we produce HTML a developer would actually want?"

import { Util } from "../../node_modules/pdfjs-dist/build/pdf.mjs";

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy)$/i;

// pdf.js reports font names like "g_d0_f1"; the styles map carries the real family.
// When it can't resolve an embedded face it hands back a bare generic instead — which
// is itself a fidelity finding worth seeing, so pass it through untouched.
function familyOf(styles, fontName) {
  const family = styles?.[fontName]?.fontFamily;
  if (!family) return "sans-serif";
  if (GENERIC.test(family)) return family;
  // Real family name: quote it and keep a generic fallback behind it.
  const fallback = /serif/i.test(family) && !/sans/i.test(family) ? "serif" : "sans-serif";
  return `"${family}", ${fallback}`;
}

export default {
  id: "pdfjs-text",
  label: "pdf.js — positioned HTML",
  note: "Real editable markup. Text only: vector graphics and background art are dropped.",

  async render(page, mount, { scale }) {
    const viewport = page.getViewport({ scale });
    const { items, styles } = await page.getTextContent();

    const wrap = document.createElement("div");
    wrap.className = "page-wrap reconstructed";
    wrap.style.width = `${viewport.width}px`;
    wrap.style.height = `${viewport.height}px`;

    let chars = 0;

    for (const item of items) {
      if (!item.str || !item.str.trim()) continue;

      // Map PDF user space to viewport pixels.
      const tx = Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      if (fontHeight <= 0) continue;

      const span = document.createElement("span");
      span.textContent = item.str;
      // Let the browser resolve bidi per run — critical for Hebrew and Arabic.
      span.dir = "auto";

      const angle = Math.atan2(tx[1], tx[0]);
      span.style.cssText = [
        "position:absolute",
        `left:${tx[4].toFixed(2)}px`,
        `top:${(tx[5] - fontHeight).toFixed(2)}px`,
        `font-size:${fontHeight.toFixed(2)}px`,
        `font-family:${familyOf(styles, item.fontName)}`,
        "white-space:pre",
        "transform-origin:0 0",
        angle ? `transform:rotate(${angle}rad)` : "",
      ].filter(Boolean).join(";");

      wrap.append(span);
      chars += item.str.length;
    }

    mount.append(wrap);

    return {
      bytes: new Blob([wrap.outerHTML]).size,
      chars,
      kind: "HTML + CSS",
    };
  },
};
