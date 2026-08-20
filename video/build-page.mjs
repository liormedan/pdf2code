// Builds the shareable page around the film.
//
// The video is inlined as a data URI because a published artifact may not fetch from any
// external host — there is nowhere to put an .mp4 that the page would be allowed to load.
// The master is 15.9 MB, and base64 is a third larger again, which would put the page over
// the 16 MB ceiling; so the page carries a CRF 26 re-encode at 5.5 MB. The master stays on
// disk for anything that needs the full-bitrate file.
//
// Timecodes are computed from the frame counts rather than typed, so they cannot drift out
// of step with the edit. Keep FRAMES in step with PART_A / PART_B in src/Film.tsx.

import { readFileSync, writeFileSync, statSync } from "node:fs";

const SOURCE = "out/full-web.mp4";
const MASTER = "out/pdf2code-full.mp4";
const FPS = 30;

const FRAMES = [
  { part: "א", frames: 280, title: "היי, אנחנו PDF to Code", note: "מי אנחנו ומה בנינו — בשורה אחת, במילים של המוצר עצמו." },
  { part: "א", frames: 295, title: "למה שתרצה את זה", note: "כמסמך אפשר לפתוח, להדפיס ולשלוח. כקוד אפשר לערוך, לתרגם ולהטמיע." },
  { part: "א", frames: 220, title: "מתי זה מתאים", note: "ארבעה מצבים. לא צריך את כולם — מספיק אחד." },
  { part: "א", frames: 150, title: "מסמך אחד קדימה", note: "העמוד נוחת בדיוק על הפריים שחלק ב׳ נפתח בו. שתי התמונות זהות בפיקסל." },
  { part: "ב", frames: 300, title: "המסמך הוא גוש אחד", seam: true, note: "הסמן מושך מספר אחד, וכל העמוד בא איתו — נוקשה, ובחזרה בדיוק למקום." },
  { part: "ב", frames: 360, title: "אותו עמוד, עכשיו חומר", note: "העמוד מתפרק לשישים ושישה חלקים. הקוד נפתח לצידו, והמספר משתנה." },
  { part: "ב", frames: 400, title: "שתי שכבות", note: "ראסטר מאחור, טקסט מלפנים — ההסבר לכך שזה נראה כמו המקור ונשאר טקסט." },
  { part: "ב", frames: 320, title: "מה יוצא מזה", note: "ארבעה קבצים, בגדלים האמיתיים שלהם. וההמרה רצה בדפדפן." },
  { part: "ג", frames: 280, title: "ומה שהוא לא עושה", seam: true, note: "שלוש המגבלות, מילה במילה מהאתר. כולל זו שאומרת שמצגות עדיין לא." },
  { part: "ג", frames: 210, title: "עשרים מסמכים בחודש", note: "הפריים האחרון של הסרט. בלי כרטיס אשראי." },
];

const timecode = (frames) => {
  const total = frames / FPS;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

let at = 0;
const scenes = FRAMES.map((scene) => {
  const row = { ...scene, at: timecode(at) };
  at += scene.frames;
  return row;
});

const SPECS = [
  ["אורך", timecode(at)],
  ["רזולוציה", "1920×1080"],
  ["קצב", "30 fps"],
  ["עוצמה", "−14.2 LUFS"],
  ["התפר א→ב", scenes.find((s) => s.part === "ב").at],
  ["מאסטר", `${(statSync(MASTER).size / 1024 / 1024).toFixed(1)} MB`],
];

const video = readFileSync(SOURCE).toString("base64");

const specRow = ([label, value]) => `      <div class="spec"><dt>${label}</dt><dd>${value}</dd></div>`;

const sceneRow = (s) => `      <li class="scene${s.seam ? " seam" : ""}">
        <span class="tc">${s.at}</span>
        <span class="part">${s.part}</span>
        <div>
          <h3>${s.title}</h3>
          <p>${s.note}</p>
        </div>
      </li>`;

const html = `<title>PDF to Code Explainer</title>
<style>
  /* The palette is the product's own — app/globals.css — because the film is graded to it.
     A viewer who clicks through to pdf2code lands somewhere that looks like what they just
     watched, and the page is not a generic dark shell that could wrap any video. */
  :root {
    --ground: #f5f2ec;
    --surface: #ffffff;
    --stage: #17150f;
    --ink: #17150f;
    --muted: #6b6658;
    --line: #ddd8cc;
    --accent: #0d6b5b;

    --sans: "Segoe UI", "Assistant", "Heebo", system-ui, -apple-system, sans-serif;
    --mono: "Cascadia Code", "Consolas", ui-monospace, "Courier New", monospace;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #1c1f21;
      --surface: #24272a;
      --stage: #121415;
      --ink: #e9e7e0;
      --muted: #a9a89f;
      --line: #3b4045;
      --accent: #5cc3a8;
    }
  }

  :root[data-theme="dark"] {
    --ground: #1c1f21;
    --surface: #24272a;
    --stage: #121415;
    --ink: #e9e7e0;
    --muted: #a9a89f;
    --line: #3b4045;
    --accent: #5cc3a8;
  }

  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--sans);
    line-height: 1.6;
  }

  .page {
    direction: rtl;
    max-width: 1120px;
    margin: 0 auto;
    padding: clamp(28px, 5vw, 64px) clamp(18px, 4vw, 40px) 80px;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }

  header { display: flex; flex-direction: column; gap: 10px; }

  .eyebrow {
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    direction: ltr;
    text-align: right;
  }

  h1 {
    margin: 0;
    font-size: clamp(30px, 4.4vw, 46px);
    font-weight: 700;
    letter-spacing: -0.02em;
    text-wrap: balance;
  }

  header p { margin: 0; color: var(--muted); max-width: 62ch; font-size: 18px; }

  /* The stage is darker than the page in both themes, so the frame reads as a screen
     rather than as an image that happens to be sitting on the background. */
  .stage {
    background: var(--stage);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px;
    overflow: hidden;
  }

  video { display: block; width: 100%; height: auto; border-radius: 6px; background: #000; }

  /* A delivery spec sheet, set in the utility face — the one place digits line up. */
  .specs {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
  }

  .spec { background: var(--surface); padding: 16px 20px; }
  .spec dt { font-size: 12px; color: var(--muted); letter-spacing: 0.04em; }
  .spec dd {
    margin: 6px 0 0;
    font-family: var(--mono);
    font-size: 18px;
    font-variant-numeric: tabular-nums;
    direction: ltr;
    text-align: right;
  }

  h2 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* Timecodes are genuinely sequential, so a time rail carries information rather than
     decorating the list. The part letter is the second column because the film has two
     halves and the seam between them is the thing worth being able to find. */
  .scenes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }

  .scene {
    display: grid;
    grid-template-columns: 62px 26px 1fr;
    gap: 18px;
    padding: 20px 0;
    border-bottom: 1px solid var(--line);
  }

  .scene:last-child { border-bottom: none; }

  .tc {
    font-family: var(--mono);
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
    direction: ltr;
    text-align: right;
    padding-top: 3px;
  }

  .part {
    font-size: 14px;
    color: var(--muted);
    padding-top: 4px;
  }

  .seam { position: relative; }

  .seam::after {
    content: "";
    position: absolute;
    inset-inline: 0;
    top: -1px;
    height: 2px;
    background: var(--accent);
  }

  .scene h3 { margin: 0; font-size: 21px; font-weight: 600; }
  .scene p { margin: 4px 0 0; color: var(--muted); max-width: 66ch; }

  footer {
    border-top: 1px solid var(--line);
    padding-top: 22px;
    color: var(--muted);
    font-size: 15px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 22px;
  }

  footer a { color: var(--accent); }

  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }
</style>

<div class="page">
  <header>
    <div class="eyebrow">part a + part b · h.264 · aac</div>
    <h1>סרטון ההסבר של PDF to Code</h1>
    <p>
      תשעים וארבע שניות בשלושה חלקים. חלק א׳ מציג; חלק ב׳ מדגים; חלק ג׳ אומר מה זה לא עושה ואיך מתחילים.
      התפר ביניהם נמצא ב-${scenes.find((s) => s.part === "ב").at}, ואי אפשר לראות אותו:
      הפריים האחרון של האחד והראשון של השני הם אותה תמונה בדיוק.
    </p>
  </header>

  <div class="stage">
    <video controls preload="metadata" playsinline src="data:video/mp4;base64,${video}"></video>
  </div>

  <dl class="specs">
${SPECS.map(specRow).join("\n")}
  </dl>

  <section>
    <h2>הסצנות</h2>
    <ol class="scenes">
${scenes.map(sceneRow).join("\n")}
    </ol>
  </section>

  <footer>
    <span>קריינות: Brian · ElevenLabs eleven_v3 · עברית</span>
    <span>הורכב ב-Remotion, נורמל ב-ffmpeg</span>
    <span><a href="https://pdf2code.vercel.app">pdf2code.vercel.app</a></span>
  </footer>
</div>
`;

writeFileSync("out/page.html", html);
console.log(`out/page.html — ${(html.length / 1024 / 1024).toFixed(1)} MB · film ${timecode(at)}`);
