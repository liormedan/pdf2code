// Does the entry page actually fit in one screen?
//
// "No scrolling" is a claim about specific viewports, so it gets measured at them rather
// than eyeballed at whatever size the window happens to be. A page can look fine on a
// 27-inch monitor and scroll on every laptop in the room.
//
// Usage: node scripts/check-fits.mjs [baseUrl]

const BASE = process.argv[2] ?? "http://localhost:3000";

// Real viewports, not round numbers: the two laptop sizes that dominate, a small
// laptop, and two phones. Heights are the usable area after browser chrome.
const VIEWPORTS = [
  { name: "laptop 1366x768", width: 1366, height: 660 },
  { name: "laptop 1440x900", width: 1440, height: 790 },
  { name: "small laptop 1280x720", width: 1280, height: 610 },
  { name: "tablet 768x1024", width: 768, height: 950 },
  { name: "phone 390x844", width: 390, height: 730 },
  { name: "phone 360x640", width: 360, height: 530 },
];

const response = await fetch(BASE, { headers: { "Accept-Language": "en" } });
if (!response.ok) {
  console.error(`  ${BASE} responded ${response.status}. Is the dev server running?`);
  process.exit(1);
}

console.log(`\n  ONE-SCREEN CHECK — ${BASE}\n`);
console.log("  Measured in a real browser is the only measurement that counts; this");
console.log("  checks the served markup for the structural guarantees instead.\n");

const html = await response.text();

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`    ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// The structural promises the layout depends on. Each of these, missing, produces a
// scrollbar on some viewport — and each has bitten this page at least once.
check("root is exactly one dynamic viewport tall", /h-\[100dvh\]/.test(html),
  "dvh, not vh: mobile vh counts chrome that slides away");
check("root hides overflow", /overflow-hidden/.test(html));
check("rows can shrink below content", (html.match(/min-h-0/g) ?? []).length >= 3,
  `${(html.match(/min-h-0/g) ?? []).length} found; a grid track without it refuses to shrink`);
check("type is sized against viewport height", (html.match(/clamp\([^)]*vh/g) ?? []).length >= 8,
  `${(html.match(/clamp\([^)]*vh/g) ?? []).length} height-aware sizes`);
check("no fixed rem type scale left in the shell",
  !/text-(3xl|4xl|2xl)\b/.test(html.split("<footer")[0] ?? ""),
  "a fixed heading size cannot shrink on a short window");

// The page a stranger waits for must stay light. Script contents are excluded because
// against a dev server they are mostly the HMR client, which is absent in production —
// counting it made this fail on a page that had not grown at all.
const markupOnly = html.replace(/<script[\s\S]*?<\/script>/g, "<script></script>");
const bytes = new TextEncoder().encode(markupOnly).length;
check("markup under 40 kB, excluding scripts", bytes < 40_000, `${(bytes / 1024).toFixed(1)} kB`);

console.log(`
  To measure for real, open ${BASE} and run in the console:

    ({ scrolls: document.documentElement.scrollHeight > innerHeight,
       overflowBy: document.documentElement.scrollHeight - innerHeight })
`);

process.exit(failures === 0 ? 0 : 1);
