import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import map from "../../system-map.json";
import { words, type Key, type Lang } from "./strings";
import { TONE, type Selection, type SprintStatus, type SystemMap } from "./model";

/**
 * The system map: what pdf2code is made of, and where it stands.
 *
 * **A developer tool, and it lives outside the product on purpose.** This was a fourth tab
 * inside pdf2code for about a day, which was a mistake with a clear shape: it put a 560 kB
 * 3D library, twenty-two developer strings and a navigation path to an internal status
 * board into an installer a customer pays for and a security team reviews. None of that is
 * a feature of a PDF converter. The map is worth having and worth having *here*, where the
 * people who read it are.
 *
 * **It is not drawn — it is generated.** `../sync-system-map.mjs` reads the five documents
 * that already hold the truth, and `npm run map:check` fails when the two drift apart. A
 * diagram maintained by hand is a second place for status to live, and the pretty one is
 * the one people believe.
 *
 * **The list is the interface and the canvas is the illustration.** Every process, part,
 * sprint and decision below is a real button: reachable by Tab, readable by a screen
 * reader, and laid out by the writing direction. The canvas is `aria-hidden`, because it
 * cannot be any of those and decorating it with ARIA would only claim it is. That standard
 * did not relax when this stopped being a shipped feature — a tool the team reads every
 * day is exactly the wrong place to start making exceptions.
 */
const Scene = lazy(() => import("./scene"));

const data = map as unknown as SystemMap;

export default function App() {
  /**
   * The interface language, and with it the direction.
   *
   * Set on `<html>` rather than on a wrapper, because `dir` has to reach the scrollbars
   * and the projected labels over the canvas, and both of those live outside React's tree.
   */
  const [lang, setLang] = useState<Lang>("he");
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  }, [lang]);

  const t = useMemo(() => words(lang), [lang]);
  const [selected, setSelected] = useState<Selection | null>(null);

  /**
   * Whether the person asked their machine to stop moving things.
   *
   * Watched rather than read once: the setting can change while the app is open, and a
   * scene that keeps animating until the next launch is the same failure as not having
   * checked at all.
   */
  const [still, setStill] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setStill(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const detail = useMemo(() => describe(data, selected, t), [selected, t]);

  return (
    <div className="flex h-screen flex-col gap-3 overflow-hidden bg-background p-5 text-foreground">
      {/* Said on the page and not only in the README. Somebody will screenshot this and
          paste it into a thread, and the screenshot should carry what it is. */}
      <p className="shrink-0 rounded-md border border-warning/40 bg-warning-muted px-2 py-1 text-[11px] text-warning">
        {t("devOnly")}
      </p>

      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-sm font-semibold">{t("title")}</h1>
        <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
        <span className="flex-1" />
        <p className="tabular text-xs text-muted-foreground">
          {t("progress", {
            reached: data.progress.reached,
            done: data.progress.done,
            total: data.progress.total,
          })}
        </p>
        <button
          type="button"
          onClick={() => setLang(lang === "he" ? "en" : "he")}
          className="rounded-md border border-divider px-2 py-0.5 text-[11px] hover:bg-accent/50"
        >
          {t("language")}
        </button>
      </header>

      {/* Colour repeats what the words already say; it never carries a state on its own. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {(["done", "partly", "blocked", "open"] as const).map((state) => (
          <li key={state} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={`size-2 rounded-full ${TONE[state].dot}`} aria-hidden="true" />
            {t(`state_${state}` as Key)}
          </li>
        ))}
      </ul>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-h-0 flex-col gap-3">
          <Suspense
            fallback={
              <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-divider">
                <p className="text-xs text-muted-foreground">{t("loading")}</p>
              </div>
            }
          >
            <Scene map={data} selected={selected} onSelect={setSelected} still={still} />
          </Suspense>

          <p className="text-[11px] text-muted-foreground">{t("canvasNote")}</p>
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-auto">
          <Section title={t("processes")}>
            {data.processes.map((process) => (
              <div key={process.id} className="space-y-1">
                <Row
                  label={`${process.name} · ${process.nameEn}`}
                  hint={process.path}
                  tone="done"
                  chosen={selected?.kind === "process" && selected.id === process.id}
                  onClick={() => setSelected({ kind: "process", id: process.id })}
                />
                <ul className="ms-3 space-y-0.5 border-s border-divider ps-2">
                  {process.parts.map((part) => (
                    <li key={part.name}>
                      <Row
                        small
                        label={part.name}
                        tone="done"
                        chosen={
                          selected?.kind === "part" &&
                          selected.id === process.id &&
                          selected.part === part.name
                        }
                        onClick={() =>
                          setSelected({ kind: "part", id: process.id, part: part.name })
                        }
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>

          <Section title={t("sprints")}>
            {data.sprints.map((sprint) => (
              <Row
                key={sprint.number}
                label={`${sprint.number}. ${sprint.name}`}
                hint={t(`state_${sprint.status}` as Key)}
                tone={sprint.status}
                chosen={selected?.kind === "sprint" && selected.id === String(sprint.number)}
                onClick={() => setSelected({ kind: "sprint", id: String(sprint.number) })}
              />
            ))}
          </Section>

          <Section title={t("decisions")}>
            {data.decisions.open.map((decision) => (
              <Row
                key={decision.index}
                label={decision.title}
                hint={
                  decision.moot
                    ? t("decisionMoot")
                    : decision.blocks.length > 0
                      ? t("decisionBlocks", { list: decision.blocks.join(", ") })
                      : t("decisionOpen")
                }
                tone={decision.moot ? "open" : decision.blocks.length > 0 ? "blocked" : "partly"}
                chosen={selected?.kind === "decision" && selected.id === String(decision.index)}
                onClick={() => setSelected({ kind: "decision", id: String(decision.index) })}
              />
            ))}
          </Section>

          <Section title={t("forbidden")}>
            <ul className="space-y-1.5">
              {data.forbidden.map((item) => (
                <li key={item.what} className="text-[11px] leading-relaxed">
                  <span className="font-medium text-destructive">{item.what}</span>
                  <span className="text-muted-foreground"> — {item.why}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      {/* The inspector. `aria-live` because selection can also come from the canvas, and a
          panel that changed silently would leave a screen-reader user with no sign it had. */}
      <aside
        role="region"
        aria-live="polite"
        aria-label={t("inspector")}
        className="max-h-56 shrink-0 overflow-auto rounded-lg border border-divider bg-card p-3"
      >
        {detail ? (
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold" dir="auto">
              {detail.title}
            </h3>
            {detail.lines.map((line, index) => (
              <p key={index} dir="auto" className="text-[11px] leading-relaxed text-muted-foreground">
                {line}
              </p>
            ))}
            {detail.files.length > 0 ? (
              <ul className="space-y-0.5 pt-1">
                {detail.files.map((file) => (
                  <li key={file} dir="ltr" className="font-mono text-[10px] text-muted-foreground">
                    {file}
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-md border border-divider px-2 py-1 text-[11px] hover:bg-accent/50"
            >
              {t("clear")}
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">{t("pickSomething")}</p>
        )}
      </aside>

      <p className="shrink-0 text-[10px] text-muted-foreground">
        {t("generatedFrom", { count: data.sources.length })}
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-semibold text-muted-foreground">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  tone,
  chosen,
  onClick,
  small,
}: {
  label: string;
  hint?: string;
  tone: SprintStatus;
  chosen: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={chosen}
      className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-start ${
        small ? "text-[10px]" : "text-[11px]"
      } ${chosen ? "border-primary bg-accent/50" : "border-transparent hover:border-divider"}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${TONE[tone].dot}`} aria-hidden="true" />
      <span dir="auto" className="min-w-0 flex-1 truncate">
        {label}
      </span>
      {hint ? (
        <span dir="auto" className="shrink-0 text-[10px] text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </button>
  );
}

/**
 * What the inspector shows for a selection.
 *
 * Every line comes out of the generated map, so nothing here can say more than the
 * documents do. When a selection names something the map does not hold, the answer is
 * nothing rather than an empty-looking panel of headings.
 */
function describe(
  system: SystemMap,
  selection: Selection | null,
  t: ReturnType<typeof words>,
): { title: string; lines: string[]; files: string[] } | null {
  if (!selection) return null;

  if (selection.kind === "process") {
    const process = system.processes.find((item) => item.id === selection.id);
    if (!process) return null;
    return {
      title: `${process.name} · ${process.nameEn}`,
      lines: [process.is, process.isNot, process.stack.join(" · ")],
      files: [process.path],
    };
  }

  if (selection.kind === "part") {
    const process = system.processes.find((item) => item.id === selection.id);
    const part = process?.parts.find((item) => item.name === selection.part);
    if (!process || !part) return null;
    return { title: part.name, lines: [part.does], files: [part.file] };
  }

  if (selection.kind === "sprint") {
    const sprint = system.sprints.find((item) => String(item.number) === selection.id);
    if (!sprint) return null;
    const blocker = system.blockers.find((item) => item.id === sprint.blockedOn);
    const waiting = system.waitingOnYou.find((item) => item.sprint === sprint.number);
    return {
      title: `${sprint.number}. ${sprint.name} · ${sprint.weight}%`,
      lines: [
        ...sprint.items.done.slice(0, 4).map((item) => `✓ ${item}`),
        ...sprint.items.open.slice(0, 4).map((item) => `· ${item}`),
        ...sprint.items.deferred.map((item) => `↷ ${item}`),
        ...(blocker ? [`⛔ ${blocker.name} — ${blocker.detail} (${blocker.who})`] : []),
        ...(waiting ? [`👤 ${waiting.need}`] : []),
      ],
      files: [],
    };
  }

  const decision = system.decisions.open.find((item) => String(item.index) === selection.id);
  if (!decision) return null;
  return {
    title: decision.title,
    lines: [
      decision.moot
        ? t("decisionMootWhy")
        : decision.blocks.length > 0
          ? t("decisionBlocks", { list: decision.blocks.join(", ") })
          : t("decisionOpen"),
    ],
    files: ["desktop/decisions.md"],
  };
}
