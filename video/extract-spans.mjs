// Pulls page 1's text layer out of a page the converter actually produced.
//
// The video shows real spans at their real offsets, so every number on screen is the
// converter's own. Re-run this if the fixture output is regenerated.
import { readFileSync, writeFileSync } from "node:fs";

const [SOURCE, OUT, W, H] = process.argv.slice(2);
const html = readFileSync(SOURCE, "utf8");

const open = html.indexOf(String.fromCharCode(100)+'ata-page="1"');
const start = html.indexOf(">", open) + 1;
const end = html.indexOf("</section>", start);
if (open < 0 || end < 0) throw new Error("page 1 not found");
const body = html.slice(start, end);

const decode = (s) =>
  s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"')
   .replaceAll("&#39;", "'").replaceAll("&amp;", "&");

// The style attribute is a flat "prop:value;prop:value" list, so splitting beats matching.
const props = (style) =>
  Object.fromEntries(
    style.split(";").map((pair) => {
      const at = pair.indexOf(":");
      return [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
    }),
  );

const px = (v) => (v ? parseFloat(v) : 0);

const spans = [];
for (const chunk of body.split("<span ").slice(1)) {
  const styleStart = chunk.indexOf('"') + 1;
  const styleEnd = chunk.indexOf('"', styleStart);
  const p = props(chunk.slice(styleStart, styleEnd));
  // The converter marks direction per run, not per page: a Hebrew label carries dir="rtl"
  // and a bare figure does not. Carrying that through keeps the text layer honest.
  const head = chunk.slice(0, chunk.indexOf(">"));
  const rtl = head.includes('dir="rtl"');
  const textStart = chunk.indexOf(">") + 1;
  const textEnd = chunk.indexOf("</span>");
  spans.push({
    left: px(p.left),
    top: px(p.top),
    size: px(p["font-size"]),
    family: p["font-family"] || "serif",
    bold: p["font-weight"] === "700" || p["font-weight"] === "bold",
    rtl,
    text: decode(chunk.slice(textStart, textEnd)),
  });
}

writeFileSync(OUT, JSON.stringify({ width: Number(W), height: Number(H), spans }));
console.log(spans.length + " spans");
for (const s of spans.slice(3, 6)) console.log(`  ${s.left},${s.top} ${s.size}px bold=${s.bold} "${s.text.slice(0, 44)}"`);
