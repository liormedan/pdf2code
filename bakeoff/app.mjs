// Sprint 0 bake-off harness.
//
// Left pane is the reference: pdf.js rasterises the page, which is ground truth for
// what the document is supposed to look like. Right pane is whichever candidate engine
// is selected. The question the harness exists to answer is simply: how far apart are they?

import * as pdfjs from "../node_modules/pdfjs-dist/build/pdf.mjs";
import canvasEngine from "./engines/pdfjs-canvas.mjs";
import textEngine from "./engines/pdfjs-text.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = "../node_modules/pdfjs-dist/build/pdf.worker.mjs";

const ENGINES = [canvasEngine, textEngine];

const el = (id) => document.getElementById(id);
const ui = {
  fixtures: el("fixtures"), engine: el("engine"), scale: el("scale"),
  prev: el("prev"), next: el("next"), pageLabel: el("pageLabel"), toggleText: el("toggleText"),
  docbar: el("docbar"), refView: el("refView"), candView: el("candView"),
  refStats: el("refStats"), candStats: el("candStats"), candName: el("candName"),
};

const state = { doc: null, name: null, pageNum: 1, showText: false };

const kb = (n) => `${(n / 1024).toFixed(n < 1024 * 10 ? 1 : 0)} KB`;

for (const e of ENGINES) {
  ui.engine.append(new Option(e.label, e.id));
}
const currentEngine = () => ENGINES.find((e) => e.id === ui.engine.value) ?? ENGINES[0];

async function loadFixtureList() {
  const items = await (await fetch("/api/fixtures")).json();
  ui.fixtures.innerHTML = "";

  if (!items.length) {
    ui.fixtures.innerHTML = `<div class="msg">No PDFs in <code>/fixtures</code>.<br><br>Run <code>npm run fixtures</code>, or drop your own files in there.</div>`;
    return;
  }

  for (const { name, size } of items) {
    const b = document.createElement("button");
    b.className = "fixture";
    b.innerHTML = `<div class="nm"></div><div class="meta">${kb(size)}</div>`;
    b.querySelector(".nm").textContent = name;
    b.onclick = () => openFixture(name);
    ui.fixtures.append(b);
  }
}

function markActive(name) {
  for (const b of ui.fixtures.querySelectorAll(".fixture")) {
    b.setAttribute("aria-current", String(b.querySelector(".nm").textContent === name));
  }
}

async function openFixture(name) {
  state.name = name;
  state.pageNum = 1;
  markActive(name);
  ui.docbar.textContent = "loading…";
  ui.refView.innerHTML = ui.candView.innerHTML = `<div class="msg">loading…</div>`;

  try {
    state.doc?.destroy();
    state.doc = await pdfjs.getDocument({ url: `/fixtures/${encodeURIComponent(name)}` }).promise;
  } catch (err) {
    state.doc = null;
    ui.docbar.textContent = "";
    ui.refView.innerHTML = `<div class="msg error">Failed to open:\n${err.message}</div>`;
    ui.candView.innerHTML = `<div class="msg">—</div>`;
    return;
  }

  await describeDoc();
  await renderPage();
}

// A quick probe of page 1 tells us the thing that matters most for engine choice:
// whether the document carries a real text layer or is just pixels.
async function describeDoc() {
  const doc = state.doc;
  const page = await doc.getPage(1);
  const { items } = await page.getTextContent();
  const ops = await page.getOperatorList();

  const chars = items.reduce((n, i) => n + (i.str?.length ?? 0), 0);
  const imageOps = ops.fnArray.filter((f) =>
    f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject).length;
  const hasRTL = items.some((i) => /[֐-ࣿ]/.test(i.str ?? ""));
  const meta = await doc.getMetadata().catch(() => null);

  const bits = [
    `${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`,
    chars > 30
      ? `<span class="good">text layer: ${chars} chars on p1</span>`
      : `<span class="flag">no text layer on p1 — scanned, needs OCR</span>`,
    `${ops.fnArray.length} draw ops`,
    imageOps ? `${imageOps} image${imageOps === 1 ? "" : "s"}` : "no images",
    hasRTL ? `<span class="flag">RTL script detected</span>` : "",
    meta?.info?.Producer ? `producer: ${meta.info.Producer.slice(0, 40)}` : "",
  ].filter(Boolean);

  ui.docbar.innerHTML = bits.join(" &nbsp;·&nbsp; ");
}

async function renderPage() {
  const doc = state.doc;
  if (!doc) return;

  const scale = Number(ui.scale.value);
  const engine = currentEngine();
  ui.candName.textContent = engine.label;
  ui.candName.title = engine.note;
  ui.pageLabel.textContent = `${state.pageNum} / ${doc.numPages}`;
  ui.prev.disabled = state.pageNum <= 1;
  ui.next.disabled = state.pageNum >= doc.numPages;

  ui.refView.innerHTML = ui.candView.innerHTML = `<div class="msg">rendering…</div>`;
  ui.refStats.textContent = ui.candStats.textContent = "";

  const page = await doc.getPage(state.pageNum);

  // Render both panes concurrently — a slow or stalled reference raster should never
  // hold up the candidate, which is the side we are actually here to judge.
  const reference = (async () => {
    const t = performance.now();
    ui.refView.innerHTML = "";
    const stats = await canvasEngine.render(page, ui.refView, { scale });
    ui.refStats.textContent = `${(performance.now() - t).toFixed(0)} ms · ${stats.chars} chars`;
    applyTextLayerVisibility();
  })().catch((err) => {
    ui.refView.innerHTML = `<div class="msg error">Reference render failed:\n${err.message}</div>`;
  });

  const candidate = (async () => {
    const t = performance.now();
    ui.candView.innerHTML = "";
    const stats = await engine.render(page, ui.candView, { scale });
    const ms = performance.now() - t;
    ui.candStats.textContent = `${ms.toFixed(0)} ms · ${kb(stats.bytes)} · ${stats.chars} chars · ${stats.kind}`;
  })().catch((err) => {
    ui.candView.innerHTML = `<div class="msg error">Engine failed:\n${err.message}</div>`;
  });

  await Promise.all([reference, candidate]);
}

function applyTextLayerVisibility() {
  for (const l of ui.refView.querySelectorAll(".text-layer")) {
    l.classList.toggle("show", state.showText);
  }
}

ui.prev.onclick = () => { state.pageNum--; renderPage(); };
ui.next.onclick = () => { state.pageNum++; renderPage(); };
ui.engine.onchange = renderPage;
ui.scale.onchange = renderPage;
ui.toggleText.onclick = () => {
  state.showText = !state.showText;
  ui.toggleText.textContent = state.showText ? "Hide text layer" : "Show text layer";
  applyTextLayerVisibility();
};

document.addEventListener("keydown", (e) => {
  if (e.target.matches("select, input")) return;
  if (e.key === "ArrowLeft" && !ui.prev.disabled) ui.prev.click();
  if (e.key === "ArrowRight" && !ui.next.disabled) ui.next.click();
});

loadFixtureList();
