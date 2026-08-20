/**
 * Every composition, at one frame rate.
 *
 * Two languages, three parts each, plus every scene on its own so a single beat can be
 * rendered and reviewed without waiting for the whole thing.
 *
 * The `-en-silent` scene compositions are not spare — they are how the English layout gets
 * checked before a word of English narration exists. English strings run longer than Hebrew
 * ones and can overflow a card that fits comfortably in Hebrew; that has to be caught by
 * looking, not by hoping.
 *
 * durationInFrames is derived from the scene tables rather than typed here, because a scene
 * that grows and a composition length that does not is how Remotion ends up cutting the end
 * off a film without saying anything.
 */
import { Composition } from "remotion";
import { FPS, HEIGHT, WIDTH } from "./theme";
import { ALL, PART_A, PART_B, PART_C, Reel, total, type Lang, type SceneSpec } from "./Film";
import { TAKES, Voiced } from "./Voiced";

const PARTS: { id: string; scenes: SceneSpec[] }[] = [
  { id: "Film", scenes: ALL },
  { id: "PartA", scenes: PART_A },
  { id: "PartB", scenes: PART_B },
  { id: "PartC", scenes: PART_C },
];

const LANGS: Lang[] = ["he", "en"];

/** Hebrew keeps the bare ids, so every existing render command still means what it did. */
const suffix = (lang: Lang) => (lang === "he" ? "" : "-en");

export const RemotionRoot: React.FC = () => (
  <>
    {LANGS.flatMap((lang) =>
      PARTS.map((part) => (
        <Composition
          key={`${part.id}${suffix(lang)}`}
          id={`${part.id}${suffix(lang)}`}
          component={() => <Reel scenes={part.scenes} lang={lang} />}
          durationInFrames={total(part.scenes, lang)}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
      )),
    )}

    {LANGS.flatMap((lang) =>
      ALL.map((scene) => (
        <Composition
          key={`${scene.id}${suffix(lang)}`}
          id={`${scene.id}${suffix(lang)}`}
          component={() => <Reel scenes={[scene]} lang={lang} silent={lang === "en"} />}
          durationInFrames={scene.cuts[lang].frames}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
      )),
    )}

    {Object.entries(TAKES).map(([name, take]) => (
      <Composition
        key={name}
        id={`Scene1-${name}`}
        component={Voiced}
        defaultProps={{ take }}
        durationInFrames={300}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    ))}
  </>
);
