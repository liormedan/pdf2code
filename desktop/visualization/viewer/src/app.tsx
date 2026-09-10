import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import map from "../../system-map.json";
import { words, type Key, type Lang } from "./strings";
import { TONE, type Selection, type SprintStatus, type SystemMap } from "./model";
import { TOUR, VIEWS, viewById, type ViewId } from "./views";

/**
 * The system map: what pdf2code is made of, and where it stands.
 *
 * **A developer tool, and it lives outside the product on purpose.** This was a fourth tab
 * inside pdf2code for about a day, which was a mistake with a clear shape: it put a 560 kB
 * 3D library, twenty-two developer strings and a navigation path to an internal status
 * board into an installer a customer pays for and a security team reviews. None of that is
 * a feature of a PDF converter.
 *
 * **It is not drawn — it is generated.** `../sync-system-map.mjs` reads the five documents
 * that already hold the truth, and `npm run map:check` fails when the two drift apart.
 *
 * **Five views, and a walk.** The first version was one scene and a free camera, and the
 * honest result of showing it to somebody who had not built it was: *nice, what am I
 * looking at.* A picture with no question attached teaches nothing. Each view here asks
 * one — what is this made of, what happens to a document, what is refused, what can it do,
 * where does it stand — and the tour answers the first one anybody actually has, which is
 * "where do I come into this".
 *
 * **The list is the interface and the canvas is the illustration.** Every process, part,
 * sprint and decision below is a real button: reachable by Tab, readable by a screen
 * reader, and laid out by the writing direction. The canvas is `aria-hidden`, because it
 * cannot be any of those and decorating it with ARIA would only claim it is. That standard
 * did not relax when this stopped being a shipped feature — a tool the team reads every
 * day is the wrong place to start making exceptions.
 */
const Scene = lazy(() => import("./scene"));

/**
 * The focus ring every hand-written button here wears.
 *
 * The browser's default `outline: auto` is about one pixel and, on this dark ground, easy
 * to lose — and the product's own buttons already use a three-pixel ring. Keyboard is the
 * primary way through this tool, so the indicator is the thing least worth economising on.
 */
const RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const data = map as unknown as SystemMap;

export default function App() {
  /**
   * The interface language, and with it the direction.
   *
   * Set on `<html>` rather than on a wrapper, because `dir` has to reach the scrollbars and
   * the projected labels over the canvas, and both of those live outside React's tree.
   */
  const [lang, setLang] = useState<Lang>("he");
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  }, [lang]);

  const t = useMemo(() => words(lang), [lang]);

  const [view, setView] = useState<ViewId>("overview");
  const [selected, setSelected] = useState<Selection | null>(null);
  /** Which step of the walk is on screen, or null when nobody is walking. */
  const [step, setStep] = useState<number | null>(null);

  /**
   * Whether the person asked their machine to stop moving things.
   *
   * Watched rather than read once: the setting can change while the page is open, and a
   * scene that keeps flying the camera until the next reload is the same failure as not
   * having checked at all.
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

  /**
   * Too narrow to orbit in. The presets and the walk do the navigating instead.
   *
   * **A media query and not `window.innerWidth`.** The first version read innerWidth, and
   * in one embedded context it reported `0` — so a perfectly wide window was treated as a
   * phone, orbit was disabled and every label hidden, with nothing on screen to say why.
   * `matchMedia` asks CSS, which is the same authority that decides whether the layout has
   * put the canvas beside the panel or underneath it.
   *
   * 1024px because that is Tailwind's `lg`, which is where `lg:grid-cols-…` below moves
   * the canvas under the list and halves its height. One number, one source, and a
   * breakpoint that cannot drift away from the layout it describes.
   */
  const [compact, setCompact] = useState(
    () => window.matchMedia?.("(max-width: 1023px)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 1023px)");
    if (!query) return;
    const onChange = () => setCompact(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const go = useCallback((next: ViewId) => {
    setView(next);
    setStep(null);
    setSelected(null);
  }, []);

  /**
   * Arrow keys inside the tablist, per the ARIA pattern.
   *
   * **Focus moves with the selection, and only the selected tab is in the Tab order.**
   * The first version had `role="tab"` on five buttons that were all tab stops and never
   * moved focus — tab semantics announced to a screen reader without the behaviour they
   * promise, which is worse than plain buttons, because it tells somebody a keyboard
   * convention applies and then does not honour it.
   *
   * Direction is logical rather than physical: in Hebrew the right arrow means back.
   */
  const onTabKey = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const at = VIEWS.findIndex((item) => item.id === view);
      let next = at;

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const forward = lang === "he" ? event.key === "ArrowLeft" : event.key === "ArrowRight";
        next = (at + (forward ? 1 : -1) + VIEWS.length) % VIEWS.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = VIEWS.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      go(VIEWS[next]!.id);
      // Focus follows in the effect below, not here: the newly selected tab only becomes
      // reachable once React has re-rendered it with `tabIndex` 0.
    },
    [view, lang, go],
  );

  /**
   * Move focus onto the selected tab, but only when focus was already on a tab.
   *
   * **An effect and not `requestAnimationFrame`.** The first attempt scheduled the focus
   * call on the next animation frame — which never arrives in a hidden or backgrounded
   * tab, because rAF is paused there. Selection moved and focus silently did not, which is
   * the worst version of this bug: everything looks right and the keyboard user is
   * stranded. Focus is not animation and has no business on that clock.
   *
   * Guarded on where focus already is, so clicking a tab or arrowing through the walk does
   * not yank it away from whatever the person was on.
   */
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active.getAttribute("role") !== "tab") return;
    document.getElementById(`tab-${view}`)?.focus();
  }, [view]);

  const walkTo = useCallback((index: number) => {
    const at = TOUR[index];
    if (!at) return;
    setStep(index);
    setView(at.view);
    setSelected(at.focus ? ({ kind: "end", id: at.focus } as Selection) : null);
    // The two ends are `end` selections; the three processes are not, and picking the
    // wrong kind would leave the inspector empty on three of five steps.
    if (at.focus && data.processes.some((process) => process.id === at.focus)) {
      setSelected({ kind: "process", id: at.focus });
    }
  }, []);

  /**
   * Escape always, and arrows only while the walk is running.
   *
   * Arrows used to switch views from anywhere, which meant pressing one while a process
   * row had focus jumped the whole page somewhere else — surprising, and it also stole the
   * key from the tablist that is supposed to own it. The walk is a genuine sequence, so
   * there arrows are the obvious control; everywhere else they belong to the tabs.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === "Escape") {
        setSelected(null);
        setStep(null);
        return;
      }
      if (step === null) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

      // Physical keys, logical direction: in Hebrew the right arrow means "back".
      const forward = lang === "he" ? event.key === "ArrowLeft" : event.key === "ArrowRight";
      const next = step + (forward ? 1 : -1);
      if (next >= 0 && next < TOUR.length) walkTo(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, lang, walkTo]);

  const detail = useMemo(() => describe(data, selected, t), [selected, t]);
  const panel = viewById(view).panel;

  return (
    <div className="flex min-h-screen flex-col gap-2.5 bg-background p-4 text-foreground lg:h-screen lg:overflow-hidden">
      {/* Said on the page and not only in the README. Somebody will screenshot this and
          paste it into a thread, and the screenshot should carry what it is. */}
      <p className="shrink-0 rounded-md border border-warning/40 bg-warning-muted px-2 py-1 text-[11px] text-warning">
        {t("devOnly")}
      </p>

      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-sm font-semibold">{t("title")}</h1>
        <p className="hidden text-xs text-muted-foreground sm:block">{t("subtitle")}</p>
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
          className={`rounded-md border border-divider px-2 py-0.5 text-[11px] hover:bg-accent/50 ${RING}`}
        >
          {t("language")}
        </button>
      </header>

      {/* Five questions, as a real tablist. Arrow keys move between them, which is what
          somebody tries after clicking one — and what a row of unrelated buttons would
          not do. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t("views")}
          className="flex flex-wrap items-center gap-0.5 rounded-lg border border-divider p-0.5"
        >
          {VIEWS.map((item) => (
            <button
              key={item.id}
              id={`tab-${item.id}`}
              role="tab"
              type="button"
              aria-selected={step === null && view === item.id}
              aria-controls="map-panel"
              // Roving: one tab stop for the whole set, and the arrows move within it.
              tabIndex={view === item.id ? 0 : -1}
              onKeyDown={onTabKey}
              onClick={() => go(item.id)}
              className={`rounded-md px-2.5 py-1 text-[11px] ${RING} ${
                step === null && view === item.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/40"
              }`}
            >
              {t(`view_${item.id}` as Key)}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => (step === null ? walkTo(0) : setStep(null))}
          aria-pressed={step !== null}
          className={`rounded-md border px-2.5 py-1 text-[11px] ${RING} ${
            step !== null
              ? "border-primary bg-accent text-accent-foreground"
              : "border-primary text-primary hover:bg-accent/40"
          }`}
        >
          {step === null ? t("tourStart") : t("tourStop")}
        </button>

        {selected || view !== "overview" ? (
          <button
            type="button"
            onClick={() => go("overview")}
            className={`rounded-md border border-divider px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent/40 ${RING}`}
          >
            {t("backToOverview")}
          </button>
        ) : null}
      </div>

      {/* The walk. Its own strip rather than a modal: a modal would cover the picture it
          is talking about, and the panel beside it has to stay reachable so nobody is
          trapped in the sequence. */}
      {step !== null ? (
        <div
          role="region"
          aria-live="polite"
          aria-label={t("tour")}
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-primary/50 bg-accent/30 px-3 py-2"
        >
          <span className="tabular shrink-0 text-[11px] font-semibold text-primary">
            {t("tourStep", { at: step + 1, total: TOUR.length })}
          </span>
          <p className="min-w-40 flex-1 text-[11px] leading-relaxed" dir="auto">
            <strong>{t(`tour_${TOUR[step]!.focus}_title` as Key)}</strong>
            {" — "}
            {t(`tour_${TOUR[step]!.focus}_body` as Key)}
          </p>
          <span className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => walkTo(step - 1)}
              disabled={step === 0}
              className={`rounded-md border border-divider px-2 py-1 text-[11px] disabled:opacity-40 ${RING}`}
            >
              {t("previous")}
            </button>
            <button
              type="button"
              onClick={() => (step + 1 < TOUR.length ? walkTo(step + 1) : setStep(null))}
              className={`rounded-md border border-primary bg-primary px-2 py-1 text-[11px] text-primary-foreground ${RING}`}
            >
              {step + 1 < TOUR.length ? t("next") : t("tourDone")}
            </button>
          </span>
        </div>
      ) : null}

      {/*
        Wide: the picture on one side, the list on the other, the inspector across the
        bottom. Narrow: **list, then inspector, then picture** — you pick something and the
        answer is the next thing you read, not something below a five-hundred-pixel
        illustration. The picture is the supplement, so it goes last where space is scarce.

        And the page scrolls normally below `lg` instead of three nested scroll regions
        inside a locked viewport, which squeezed the list down to its heading on a phone.
      */}
      <div
        id="map-panel"
        role="tabpanel"
        aria-labelledby={`tab-${view}`}
        className="flex min-h-0 flex-1 flex-col gap-3 lg:grid lg:grid-cols-[1fr_21rem] lg:grid-rows-[minmax(0,1fr)_auto]"
      >
        <div className="order-3 flex min-h-56 flex-col gap-2 lg:order-none lg:col-start-1 lg:row-start-1">
          <Suspense
            fallback={
              <div className="flex min-h-56 flex-1 items-center justify-center rounded-lg border border-divider">
                <p className="text-xs text-muted-foreground">{t("loading")}</p>
              </div>
            }
          >
            <Scene
              map={data}
              view={view}
              selected={selected}
              onSelect={setSelected}
              still={still}
              compact={compact}
            />
          </Suspense>
          <p className="text-[11px] text-muted-foreground">
            {compact ? t("canvasNoteCompact") : t("canvasNote")}
          </p>
        </div>

        <div className="order-1 flex flex-col gap-3 lg:col-start-2 lg:row-start-1 lg:min-h-0 lg:overflow-auto">
          <p className="rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed" dir="auto">
            {t(`view_${view}_says` as Key)}
          </p>

          {panel === "processes" || panel === "capabilities" ? (
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
                  {panel === "processes" ? (
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
                  ) : null}
                </div>
              ))}
            </Section>
          ) : null}

          {panel === "capabilities" ? (
            <Section title={t("capabilities")}>
              {(["built", "planned", "out-of-scope"] as const).map((state) => (
                <div key={state} className="space-y-0.5">
                  <p className="pt-1 text-[10px] font-semibold text-muted-foreground">
                    {t(`cap_${state}` as Key)}
                  </p>
                  {data.capabilities
                    .filter((capability) => capability.state === state)
                    .map((capability) => (
                      <p
                        key={capability.name}
                        dir="auto"
                        className="flex items-center gap-1.5 ps-1 text-[11px]"
                      >
                        <span
                          className={`size-1.5 shrink-0 rounded-full ${
                            TONE[state === "built" ? "done" : state === "planned" ? "partly" : "open"]
                              .dot
                          }`}
                          aria-hidden="true"
                        />
                        {capability.name}
                      </p>
                    ))}
                </div>
              ))}
            </Section>
          ) : null}

          {panel === "flow" ? (
            <Section title={t("flowTitle")}>
              <ol className="space-y-1">
                {data.flow.map((hop, index) => (
                  <li key={hop.step} className="flex gap-2 text-[11px]" dir="auto">
                    <span className="tabular shrink-0 text-muted-foreground">{index + 1}.</span>
                    <span>{hop.step}</span>
                  </li>
                ))}
              </ol>
              <div className="space-y-1 pt-2">
                {data.links.map((link) => (
                  <p key={link.protocol} className="text-[11px] text-muted-foreground" dir="auto">
                    <span className="font-mono text-foreground">{link.protocol}</span> — {link.detail}
                  </p>
                ))}
              </div>
            </Section>
          ) : null}

          {panel === "forbidden" ? (
            <Section title={t("forbidden")}>
              <ul className="space-y-1.5">
                {data.forbidden.map((item) => (
                  <li key={item.what} className="text-[11px] leading-relaxed" dir="auto">
                    <span className="font-medium text-destructive">{item.what}</span>
                    <span className="text-muted-foreground"> — {item.why}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {panel === "sprints" ? (
            <>
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
            </>
          ) : null}
        </div>

        {/* The inspector. Always present rather than appearing on selection — a panel that
            materialises shifts the layout under the click that summoned it, and a person
            who has not clicked anything still needs to be told that clicking is a thing. */}
        <aside
          role="region"
          aria-live="polite"
          aria-label={t("inspector")}
          className="order-2 shrink-0 overflow-auto rounded-lg border border-divider bg-card p-3 lg:order-none lg:col-span-2 lg:row-start-2 lg:max-h-44"
        >
        {detail ? (
          <div className="space-y-1.5">
            <h2 className="text-xs font-semibold" dir="auto">
              {detail.title}
            </h2>
            {detail.blocks.map((block) => (
              <div key={block.heading}>
                <p className="text-[10px] font-semibold text-muted-foreground">{block.heading}</p>
                <ul className="space-y-0.5">
                  {block.lines.map((line, index) => (
                    <li
                      key={index}
                      dir="auto"
                      className={`text-[11px] leading-relaxed ${
                        block.tone === "refuse" ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {detail.files.length > 0 ? (
              <ul className="pt-0.5">
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
              className={`rounded-md border border-divider px-2 py-1 text-[11px] hover:bg-accent/50 ${RING}`}
            >
              {t("clear")}
            </button>
          </div>
        ) : (
            <p className="text-[11px] text-muted-foreground">{t("pickSomething")}</p>
          )}
        </aside>
      </div>

      <p className="shrink-0 text-[10px] text-muted-foreground">
        {t("generatedFrom", { count: data.sources.length })}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-[11px] font-semibold text-muted-foreground">{title}</h2>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

/**
 * A row in the panel.
 *
 * A `<button>` with `aria-pressed`, not a checkbox and not a styled div: pressing it does
 * not tick anything, it changes what the whole page is showing, and "pressed" is the state
 * that says so. The dot repeats the status the text already gives, so colour is never
 * carrying it alone.
 */
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
      className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-start ${RING} ${
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

interface Detail {
  title: string;
  blocks: { heading: string; lines: string[]; tone?: "refuse" }[];
  files: string[];
}

/**
 * What the inspector shows.
 *
 * **Grouped under headings rather than run together as prose**, because the questions a
 * reader has about a part are separable — what is it, what reaches it, what leaves it,
 * what will it refuse — and a paragraph answers all four at once and none of them well.
 *
 * Everything comes out of the generated map, so nothing here can say more than the
 * documents do. A selection naming something absent returns nothing rather than a panel
 * of empty headings.
 */
function describe(
  system: SystemMap,
  selection: Selection | null,
  t: ReturnType<typeof words>,
): Detail | null {
  if (!selection) return null;

  if (selection.kind === "process") {
    const process = system.processes.find((item) => item.id === selection.id);
    if (!process) return null;
    return {
      title: `${process.name} · ${process.nameEn}`,
      blocks: [
        { heading: t("isHeading"), lines: [process.is, process.stack.join(" · ")] },
        { heading: t("inHeading"), lines: process.inputs },
        { heading: t("outHeading"), lines: process.outputs },
        { heading: t("boundsHeading"), lines: process.boundaries, tone: "refuse" },
      ],
      files: [process.path],
    };
  }

  if (selection.kind === "part") {
    const process = system.processes.find((item) => item.id === selection.id);
    const part = process?.parts.find((item) => item.name === selection.part);
    if (!process || !part) return null;
    return {
      title: part.name,
      blocks: [
        { heading: t("isHeading"), lines: [part.does] },
        { heading: t("partOf"), lines: [`${process.name} · ${process.nameEn}`] },
      ],
      files: [part.file],
    };
  }

  if (selection.kind === "end") {
    return {
      title: t(`end_${selection.id}_title` as Key),
      blocks: [{ heading: t("isHeading"), lines: [t(`end_${selection.id}_body` as Key)] }],
      files: [],
    };
  }

  if (selection.kind === "fence") {
    return {
      title: t("forbidden"),
      blocks: [
        {
          heading: t("boundsHeading"),
          lines: system.forbidden.map((item) => `${item.what} — ${item.why}`),
          tone: "refuse",
        },
      ],
      files: [],
    };
  }

  if (selection.kind === "sprint") {
    const sprint = system.sprints.find((item) => String(item.number) === selection.id);
    if (!sprint) return null;
    const blocker = system.blockers.find((item) => item.id === sprint.blockedOn);
    const waiting = system.waitingOnYou.find((item) => item.sprint === sprint.number);
    const blocks: Detail["blocks"] = [];

    if (sprint.items.done.length > 0) {
      blocks.push({ heading: t("didHeading"), lines: sprint.items.done.slice(0, 5) });
    }
    if (sprint.items.open.length > 0) {
      blocks.push({ heading: t("leftHeading"), lines: sprint.items.open.slice(0, 5) });
    }
    if (sprint.items.deferred.length > 0) {
      blocks.push({ heading: t("movedHeading"), lines: sprint.items.deferred });
    }
    if (blocker || waiting) {
      blocks.push({
        heading: t("needsYouHeading"),
        lines: [
          ...(blocker ? [`${blocker.name} — ${blocker.detail} (${blocker.who})`] : []),
          ...(waiting ? [waiting.need] : []),
        ],
        tone: "refuse",
      });
    }
    return {
      title: `${sprint.number}. ${sprint.name} · ${sprint.weight}% · ${t(`state_${sprint.status}` as Key)}`,
      blocks,
      files: [],
    };
  }

  const decision = system.decisions.open.find((item) => String(item.index) === selection.id);
  if (!decision) return null;
  return {
    title: decision.title,
    blocks: [
      {
        heading: t("stateHeading"),
        lines: [
          decision.moot
            ? t("decisionMootWhy")
            : decision.blocks.length > 0
              ? t("decisionBlocks", { list: decision.blocks.join(", ") })
              : t("decisionOpen"),
        ],
      },
    ],
    files: ["desktop/decisions.md"],
  };
}
