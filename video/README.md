# The explainer film

A 94-second film about the product, in Hebrew and English, built with Remotion. It renders
to `out/` and ships to the site as `../public/explainer.mp4`.

Nothing in here is a mockup. The page on screen is a real PDF, rasterised by pdf.js *during
the render*, and the code beside it is what `src/converter/index.ts` actually emitted for
that file. If the converter regresses, this film stops matching it — which is the correct
behaviour.

## Getting it running on a new machine

```bash
npm install          # in the repo root, first — setup reads pdf.js out of its node_modules
cd video
npm install
npm run setup        # rebuilds everything the repo deliberately does not carry
npm run studio       # live editing on http://localhost:3311
```

`npm run setup` prints each PDF, copies the pdf.js runtime, re-runs the converter, tightens
the takes and fills `public/`. It needs Chrome at the path named in `setup.mjs`.

## What is committed, and what is not

Committed: `src/`, `docs/`, `assets/report.html`, the scripts, and **`audio/original/`** —
the raw recordings. Those cost credits and no re-record is bit-identical, so they are the
one thing here that cannot be regenerated.

Ignored: `out/`, `public/`, `node_modules/`, the tightened takes and the converter's output.
All of it comes back from `npm run setup`.

## Rendering

```bash
npm run render Film    out/he.mp4      # Hebrew, 94s
npm run render Film-en out/en.mp4      # English, 94s
```

Every scene is also registered on its own (`Scene3`, `C1-en`, …) so a single beat can be
reviewed without rendering the film. The `-en` scene compositions render silent, which is
how the English layout was checked before any English narration existed.

Finish with loudness — it is the most-skipped step and the reason a video sounds weak next
to everything else in a feed:

```bash
ffmpeg -i out/he.mp4 -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:v copy -c:a aac -b:a 192k out/master.mp4
```

Two passes is better: measure first with `print_format=json`, then feed the measured values
back in. `-14 LUFS` is the target.

## How the timing works

This is the part worth understanding before changing anything.

**The narration decides the length of the picture, never the reverse.** Each take is
recorded, tightened (`node tighten.mjs 1.1 0.15` — tempo 1.1, every gap rebuilt to 0.15s),
then measured with `ffprobe` and `silencedetect`. The offset in `src/Film.tsx` is solved so
that a *particular word* lands on a *particular frame* — the drag in scene 1, the code edit
in scene 2, the layers closing in scene 3. Those pairings are written next to each entry.

Hebrew and English carry separate offsets because the two takes say the decisive word at
different moments. A shared offset would be a shared guess.

**The seam between part A and part B is invisible on purpose.** `SceneA4` ends with the page
at `OPEN_SCALE` / `OPEN_ORIGIN_Y`, the exact transform `Scene1` opens on, so the two frames
either side of that cut are the same image. Verified, not assumed:

```bash
npm run still -- Film out/a.png --frame=944
npm run still -- Film out/b.png --frame=945
ffmpeg -i out/a.png -i out/b.png -lavfi psnr -f null -    # average:inf
```

Those constants are exported from `Scene1.tsx` rather than duplicated, because two copies of
a number like that drift apart the first time either is touched.

## Things the film deliberately does not say

- **No presentations.** Production carries the line "PowerPoint files are not supported yet",
  `pptxEnabled()` reads an env var that is not set, and the Slides path needs three keys that
  are not configured. The film says PDF and only PDF. When that ships it is one line of
  narration and one line on screen.
- **No claim about mobile.** The output keeps the original page size and does not reflow —
  that is in the product's own limits — so no shot implies otherwise.
- **No output languages that do not exist.** A scene listing Vue, Svelte and Python as "being
  weighed" was removed at the client's request.
- **The layer labels are precise.** pdf.js rasterises glyphs too, so the raster layer carries
  the words as pixels and the text layer carries them again as text. The labels say that,
  rather than the tidier and wrong "graphics behind, text in front".

## The document stays Hebrew in both cuts

That looks like an oversight and is the opposite. A Hebrew document coming through with its
text intact and marked right-to-left is the hardest thing the converter does, and it is worth
more to an English-speaking viewer as a demonstration than a second English document would be
as a convenience. The English narration in scene 2 says so out loud, so nobody wonders why
the code panel is full of Hebrew.
