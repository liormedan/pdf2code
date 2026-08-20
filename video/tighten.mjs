// Tightens the narration: quicker delivery, shorter gaps between sentences.
//
// Two separate things, done separately on purpose.
//
// The gaps are rebuilt rather than shrunk. silencedetect gives the spans that are actually
// speech; those are cut out and reassembled with a fixed pause between them, so every gap
// in every take is the same length instead of whatever the engine felt like. Leading
// silence goes entirely — the scene offset is what decides when a take starts, and silence
// baked into the file only fights it.
//
// The pace is atempo, which preserves pitch. Up to about 1.1 it is inaudible as processing;
// past that it starts to sound like processing. ElevenLabs has its own speed control that
// would give more natural prosody, but using it means re-recording every take, and this is
// free and reversible.
//
//   node tighten.mjs [tempo] [gap]

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, copyFileSync, mkdirSync, existsSync } from "node:fs";

const TEMPO = Number(process.argv[2] ?? 1.1);
const GAP = Number(process.argv[3] ?? 0.22);

/** Below this, for at least this long, counts as a pause rather than speech. */
const FLOOR = "-34dB";
const MIN_PAUSE = 0.16;
/** A hair of room either side of a span, so consonants are not clipped. */
const PAD = 0.03;

const ffmpeg = (args) =>
  execFileSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const probe = (file) =>
  Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
      encoding: "utf8",
    }).trim(),
  );

/** The spans that contain speech, derived from the spans that do not. */
function speechSpans(file) {
  // silencedetect reports on stderr, not stdout, so this cannot use the exec helper above —
  // that returns stdout and would hand back an empty string on a perfectly successful run.
  const run = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=${FLOOR}:d=${MIN_PAUSE}`, "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const log = `${run.stdout ?? ""}${run.stderr ?? ""}`;

  const starts = [...log.matchAll(/silence_start: ([0-9.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([0-9.]+)/g)].map((m) => Number(m[1]));
  const duration = probe(file);

  const spans = [];
  let cursor = 0;

  for (let i = 0; i < starts.length; i++) {
    const from = cursor;
    const to = starts[i];
    if (to - from > 0.04) spans.push([Math.max(0, from - PAD), to + PAD]);
    cursor = ends[i] ?? duration;
  }
  if (duration - cursor > 0.04) spans.push([Math.max(0, cursor - PAD), duration]);

  return spans;
}

const SOURCE = "audio";
const BACKUP = "audio/original";
if (!existsSync(BACKUP)) mkdirSync(BACKUP, { recursive: true });

const takes = readdirSync(SOURCE).filter((f) => f.endsWith(".mp3"));

console.log(`tempo ${TEMPO}  gap ${GAP}s\n`);
console.log("take            was     now    gaps");

for (const take of takes) {
  const src = `${SOURCE}/${take}`;
  const keep = `${BACKUP}/${take}`;
  // Keep the untouched recording. Re-running must not compound on its own output.
  if (!existsSync(keep)) copyFileSync(src, keep);

  const spans = speechSpans(keep);
  const before = probe(keep);

  if (spans.length === 0) {
    console.log(`${take.padEnd(15)} — no speech detected, left alone`);
    continue;
  }

  const chains = spans.map(([from, to], i) => {
    const pad = i < spans.length - 1 ? `,apad=pad_dur=${GAP}` : "";
    return `[0:a]atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS${pad}[s${i}]`;
  });

  const labels = spans.map((_, i) => `[s${i}]`).join("");
  const filter = `${chains.join(";")};${labels}concat=n=${spans.length}:v=0:a=1,atempo=${TEMPO}[out]`;

  ffmpeg(["-y", "-i", keep, "-filter_complex", filter, "-map", "[out]", "-b:a", "192k", src]);

  const after = probe(src);
  console.log(
    `${take.padEnd(15)} ${before.toFixed(2)}s  ${after.toFixed(2)}s  ${spans.length - 1}`,
  );
}
