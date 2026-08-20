/**
 * Scene 1 with a narration take over it.
 *
 * A voice is judged in context or not at all, so each candidate is delivered on the same
 * picture rather than as a bare line of audio.
 *
 * The offsets are measured, not chosen. The line is two sentences — a concession and then
 * the turn — and the turn has to land on the frame where the page refuses to come apart,
 * which is frame 168. ffmpeg's silencedetect gives the gap between the sentences in each
 * take; the offset is whatever puts the second sentence on that frame. The three takes are
 * within a few frames of each other, which is a good sign about the reading rather than a
 * reason to have used one number for all of them.
 */
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Scene1 } from "./Scene1";

export interface VoiceTake {
  /** File in public/audio, without the extension. */
  id: string;
  /** Frames to hold before the take starts, so its second sentence lands on the drag. */
  offset: number;
}

/** Frame on which the page is taken hold of and refuses to come apart. */
export const TURN_FRAME = 168;

export const TAKES: Record<string, VoiceTake> = {
  Brian: { id: "s1-Brian", offset: 44 },
  Sarah: { id: "s1-Sarah", offset: 46 },
  River: { id: "s1-River", offset: 48 },
};

export function Voiced({ take }: { take: VoiceTake }) {
  return (
    <AbsoluteFill>
      <Scene1 />
      <Sequence from={take.offset}>
        <Audio src={staticFile(`audio/${take.id}.mp3`)} />
      </Sequence>
    </AbsoluteFill>
  );
}
