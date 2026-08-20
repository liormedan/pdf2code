/**
 * The assembly, in two languages.
 *
 * One place holds every scene length and every narration offset, so the film cannot disagree
 * with itself about where a scene starts. Lengths are the measured ones — each was set after
 * its take was recorded and read with ffprobe, not before.
 *
 * Both languages share the pictures, the beats and the document. What differs is the words:
 * the strings on screen come from src/copy.tsx, and the narration, its length and its offset
 * are per language here. That last part is not tidiness — an offset exists to put a
 * particular word on a particular frame, and the English take says that word at a different
 * moment than the Hebrew one does. A shared offset would be a shared guess.
 *
 * The cuts are hard. Two of them are doing real work and must stay hard:
 *
 *   A4 → Scene1  the same page at the same size in the same place. A4 lands on the exact
 *                transform scene 1 opens on, so the two frames either side of this cut are
 *                the same picture and the join is invisible.
 *
 *   Scene1 → Scene2  the page settled at 0.57 in both. Same trick, smaller stakes.
 *
 * Everywhere else a scene opens on movement, and cutting into movement reads as continuous
 * where cutting into stillness reads as a stop.
 */
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Scene1 } from "./Scene1";
import { Scene2 } from "./Scene2";
import { Scene3 } from "./Scene3";
import { Scene4 } from "./Scene4";
import { Scene5 } from "./Scene5";
import { Scene6 } from "./Scene6";
import { SceneA1, SceneA2, SceneA4 } from "./PartA";
import { SceneC1 } from "./PartC";
import { CopyProvider, EN, HE, type Copy } from "./copy";

export type Lang = "he" | "en";

export const COPY: Record<Lang, Copy> = { he: HE, en: EN };

/** Per language: how long the scene runs, which take plays, and when it starts. */
export interface Cut {
  frames: number;
  voice: string;
  offset: number;
}

export interface SceneSpec {
  id: string;
  cuts: Record<Lang, Cut>;
  render: (frames: number) => React.ReactNode;
}

/**
 * Part A — the introduction.
 *
 * Hebrew offsets were re-derived after the takes were tightened (tempo 1.1, gaps rebuilt to
 * 0.15s); none survived that change unaltered.
 *
 *   he a1  6.79s  second sentence at 1.99s → the subhead, frame 96
 *   he a2  6.92s  last sentence at 5.25s → the lit column, frame 200
 *   he a3  3.76s  one sentence over the four situations; it does not read them out
 *   he a4  1.33s  the handoff; the picture carries the rest of the scene alone
 *
 * The English offsets were derived the same way as the Hebrew ones: record, tighten with the
 * same settings, read the sentence boundaries with silencedetect, and solve for the offset
 * that puts the right word on the right frame. Every English take fits inside the scene
 * length its Hebrew counterpart already set, so the two cuts run to the same 93.8 seconds.
 *
 * A3 is Scene5, moved here from part B. The four situations answer "when would I want this",
 * which is introduction material. Putting the entry back in PART_B undoes this.
 */
export const PART_A: SceneSpec[] = [
  {
    id: "A1",
    cuts: {
      he: { frames: 280, voice: "a1b-Brian", offset: 36 },
      en: { frames: 280, voice: "en-a1-Brian", offset: 38 },
    },
    render: () => <SceneA1 />,
  },
  {
    id: "A2",
    cuts: {
      he: { frames: 295, voice: "a2b-Brian", offset: 43 },
      en: { frames: 295, voice: "en-a2-Brian", offset: 20 },
    },
    render: () => <SceneA2 />,
  },
  {
    id: "A3",
    cuts: {
      he: { frames: 220, voice: "a3b-Brian", offset: 40 },
      en: { frames: 220, voice: "en-a3-Brian", offset: 40 },
    },
    render: () => <Scene5 />,
  },
  {
    id: "A4",
    cuts: {
      he: { frames: 150, voice: "a4-Brian", offset: 20 },
      en: { frames: 150, voice: "en-a4-Brian", offset: 20 },
    },
    render: (f) => <SceneA4 frames={f} />,
  },
];

/**
 * Part B — inside the product.
 *
 *   he s1  5.62s  turn at 3.35s → the drag, frame 168
 *   he s2  4.26s  turn at 2.71s → the code panel, frame 200
 *   he s3  9.22s  "ביחד" at 6.14s → the layers closing, frame 266
 *   he s4  7.63s  "וכל זה קורה בדפדפן" at 4.30s → the line about it, frame 178
 */
export const PART_B: SceneSpec[] = [
  {
    id: "Scene1",
    cuts: {
      he: { frames: 300, voice: "s1-Brian", offset: 68 },
      en: { frames: 300, voice: "en-s1-Brian", offset: 105 },
    },
    render: () => <Scene1 />,
  },
  {
    id: "Scene2",
    cuts: {
      he: { frames: 360, voice: "s2-Brian", offset: 119 },
      en: { frames: 360, voice: "en-s2-Brian", offset: 118 },
    },
    render: () => <Scene2 />,
  },
  {
    id: "Scene3",
    cuts: {
      he: { frames: 400, voice: "s3-Brian", offset: 82 },
      en: { frames: 400, voice: "en-s3-Brian", offset: 73 },
    },
    render: () => <Scene3 />,
  },
  {
    id: "Scene4",
    cuts: {
      he: { frames: 320, voice: "s4-Brian", offset: 49 },
      en: { frames: 320, voice: "en-s4-Brian", offset: 27 },
    },
    render: () => <Scene4 />,
  },
];

/**
 * Part C — the closing act.
 *
 *   he c1  6.64s  "אלה שלושת הדברים" at 2.26s → the limits arriving, frame 100
 *   he s6  3.60s  the free allowance, on the last beat of the film
 *
 * C2 is Scene6, moved out of part B. It closed a two-act film; the film now has three acts
 * and the close belongs at the end of the third — which is also where the brief asked for the
 * free allowance to land.
 */
export const PART_C: SceneSpec[] = [
  {
    id: "C1",
    cuts: {
      he: { frames: 280, voice: "c1-Brian", offset: 32 },
      en: { frames: 280, voice: "en-c1-Brian", offset: 18 },
    },
    render: () => <SceneC1 />,
  },
  {
    id: "C2",
    cuts: {
      he: { frames: 210, voice: "s6-Brian", offset: 36 },
      en: { frames: 210, voice: "en-s6-Brian", offset: 36 },
    },
    render: () => <Scene6 />,
  },
];

export const ALL = [...PART_A, ...PART_B, ...PART_C];

export const total = (scenes: SceneSpec[], lang: Lang) =>
  scenes.reduce((sum, s) => sum + s.cuts[lang].frames, 0);

/**
 * A reel, with narration or without it.
 *
 * `silent` exists for layout checks. English strings run longer than Hebrew ones and can
 * overflow a card that fits comfortably in Hebrew, and that has to be visible before any
 * audio exists to render against.
 */
export function Reel({
  scenes,
  lang,
  silent = false,
}: {
  scenes: SceneSpec[];
  lang: Lang;
  silent?: boolean;
}) {
  let at = 0;

  return (
    <CopyProvider copy={COPY[lang]}>
      <AbsoluteFill>
        {scenes.map((scene) => {
          const cut = scene.cuts[lang];
          const from = at;
          at += cut.frames;

          return (
            <Sequence key={scene.id} from={from} durationInFrames={cut.frames}>
              {scene.render(cut.frames)}
              {silent ? null : (
                <Sequence from={cut.offset}>
                  <Audio src={staticFile(`audio/${cut.voice}.mp3`)} />
                </Sequence>
              )}
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </CopyProvider>
  );
}
