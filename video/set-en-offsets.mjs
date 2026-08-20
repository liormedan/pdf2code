// Writes the measured English offsets into src/Film.tsx.
//
// Derived exactly as the Hebrew ones were: record, tighten (tempo 1.1, gap 0.15), read the
// sentence boundaries with silencedetect, and solve for the offset that puts the intended
// word on the intended frame. The comment beside each entry says which word and which frame,
// because an offset with no reason attached is a number nobody can ever safely change.

import { readFileSync, writeFileSync } from "node:fs";

const OFFSETS = [
  ["en-a1-Brian", 38, '"We built a way…" at 1.93s → the subhead, frame 96'],
  ["en-a2-Brian", 20, '"Changing code takes a minute." at 5.99s → the lit column, frame 200'],
  ["en-a3-Brian", 40, "one sentence over the four situations; no beat to hit"],
  ["en-a4-Brian", 20, "the handoff; the picture carries the rest alone"],
  ["en-s1-Brian", 105, '"What you can\'t do…" at 2.09s → the drag, frame 168'],
  ["en-s2-Brian", 118, '"And the Hebrew in it…" at 2.74s → the code panel, frame 200'],
  ["en-s3-Brian", 73, '"Together…" at 6.45s → the layers closing, frame 266'],
  ["en-s4-Brian", 27, '"And all of it happens in your browser." at 4.83s → frame 172'],
  ["en-c1-Brian", 18, '"These are the three things…" at 2.74s → the limits, frame 100'],
  ["en-s6-Brian", 36, "the free allowance; no beat to hit"],
];

let film = readFileSync("src/Film.tsx", "utf8");
const missed = [];

for (const [voice, offset] of OFFSETS) {
  const marker = `voice: "${voice}", offset: `;
  const at = film.indexOf(marker);
  if (at < 0) {
    missed.push(voice);
    continue;
  }
  const from = at + marker.length;
  const end = film.indexOf(" ", from);
  film = film.slice(0, from) + offset + film.slice(end);
}

writeFileSync("src/Film.tsx", film);

if (missed.length) {
  console.error("not found: " + missed.join(", "));
  process.exit(1);
}

for (const [voice, offset, why] of OFFSETS) {
  console.log(`${voice.padEnd(14)} offset ${String(offset).padStart(3)}   ${why}`);
}
