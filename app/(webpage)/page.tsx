import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { SESSION_COOKIE, readSession } from "@/src/lib/auth.ts";
import { FREE } from "@/src/lib/plans.ts";
import { LOCALES } from "@/src/i18n/config.ts";
import { Logo, LogoMark } from "@/components/logo";

/**
 * The entry page: one viewport, no scrolling, and everything a stranger needs.
 *
 * The first attempt at "one screen" solved the wrong problem. It fit by *cutting* — the
 * film, the reasons and the use cases moved to /about, and what remained was a headline
 * and a button on a page that felt empty on a large monitor and said too little on any
 * monitor. A page that must not scroll and must not be thin has one honest answer: stop
 * treating the viewport as a column, and treat it as a deck. Five panels, one visible at
 * a time, chosen from a rail.
 *
 * The rail sits on the inline-start edge, which is the right in Hebrew and the left in
 * English. That is not a Hebrew-specific decision dressed up as a general one — it is the
 * same rule the rest of the app follows, and it puts the menu where the reader's eye
 * already starts.
 *
 * The order is the argument, not the sitemap: what it is, watch it happen, why you would
 * want it, who it is for, how it works. Persuasion before mechanism.
 *
 * Still no client JavaScript. The switching is five radio inputs and a `:has()` rule —
 * which means it survives scripting being off, needs no hydration, and costs nothing on
 * first paint. `@supports not selector(:has(*))` leaves the first panel open on a browser
 * too old for it, so the failure mode is "sees less", never "sees nothing".
 *
 * The two old rules still hold. Nothing heavy may enter: no icon library, no client
 * component, nothing from the converter. And nothing untrue may be said — the free
 * allowance is read from the plan the server enforces, and the limits panel is as
 * prominent as the reasons panel.
 */

/** The deck, in the order a reader should meet it. */
const TABS = [
  { id: "what", key: "tabWhat" },
  { id: "film", key: "tabFilm" },
  { id: "why", key: "tabWhy" },
  { id: "who", key: "tabWho" },
  { id: "how", key: "tabHow" },
] as const;

/**
 * The switching, as stylesheet.
 *
 * Generated from TABS so a sixth panel costs one array entry. Every interpolated value is
 * a literal from the array above — none of it is user input, and none of it can be.
 */
const DECK_CSS = `
[data-panel]{display:none;min-height:0}
${TABS.map(
  ({ id }) => `
#deck:has(#tab-${id}:checked) [data-panel="${id}"]{display:flex}
#deck:has(#tab-${id}:checked) [data-tab="${id}"]{background:var(--accent);color:var(--accent-foreground);font-weight:600}
#deck:has(#tab-${id}:checked) [data-tab="${id}"]::before{opacity:1;transform:scaleY(1)}
#deck:has(#tab-${id}:focus-visible) [data-tab="${id}"]{outline:2px solid var(--ring);outline-offset:2px}`,
).join("")}
@supports not selector(:has(*)){[data-panel="what"]{display:flex}}
`;

export default async function Webpage() {
  const t = await getTranslations("webpage");
  const locale = await getLocale();

  const store = await cookies();
  const signedIn = (await readSession(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET)) !== null;
  const target = signedIn ? "/dashboard" : "/login";

  return (
    // dvh, not vh: on mobile browsers vh counts the chrome that slides away, so 100vh
    // is taller than the window and guarantees the scrollbar this page exists to avoid.
    <div className="grid h-[100dvh] grid-rows-[auto_1fr_auto] overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: DECK_CSS }} />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-[clamp(0.6rem,1.8vh,1rem)]">
        <Logo name={t("brand")} />
        <div className="flex items-center gap-[clamp(0.75rem,2vw,1.25rem)] text-[clamp(0.75rem,1.5vh,0.875rem)]">
          <LocaleSwitch current={locale} />
          {/* /about is no longer "how it works" — the deck holds that now. What is left
              there is the long form: the roadmap, the outputs and what people voted for. */}
          <Link href="/about" className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline">
            {t("aboutLink")}
          </Link>
          {/* The invitation follows the reader across every panel. On the opening panel it
              is also present at full size — this one is the safety net, not the ask. */}
          <Link
            href={target}
            className="inline-flex h-[clamp(2rem,4.4vh,2.4rem)] items-center rounded-lg bg-primary px-[clamp(0.75rem,2vw,1.1rem)] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {signedIn ? t("openApp") : t("ctaShort")}
          </Link>
        </div>
      </header>

      {/* min-h-0 lets this row actually shrink; without it a grid track refuses to go
          below its content and the page scrolls anyway. */}
      <main
        id="deck"
        className="mx-auto grid w-full max-w-6xl min-h-0 grid-rows-[auto_1fr] gap-[clamp(0.75rem,2.4vh,1.5rem)] px-6 md:grid-cols-[max-content_1fr] md:grid-rows-1 md:gap-[clamp(1rem,3vw,2.5rem)]"
      >
        {/* Absolutely positioned, so these never become grid tracks — but still focusable,
            still announced, still arrow-key navigable, because they are real radios. */}
        {TABS.map((tab, i) => (
          <input
            key={tab.id}
            type="radio"
            name="deck"
            id={`tab-${tab.id}`}
            defaultChecked={i === 0}
            className="sr-only"
          />
        ))}

        <nav
          aria-label={t("deckNav")}
          className="flex gap-1 overflow-x-auto md:flex-col md:justify-center md:gap-[clamp(0.15rem,0.6vh,0.4rem)] md:overflow-visible md:border-e md:pe-[clamp(0.75rem,1.6vw,1.5rem)]"
        >
          {TABS.map((tab) => (
            <label
              key={tab.id}
              htmlFor={`tab-${tab.id}`}
              data-tab={tab.id}
              className="relative cursor-pointer rounded-lg px-3 py-[clamp(0.3rem,1.1vh,0.6rem)] text-[clamp(0.75rem,1.6vh,0.9375rem)] whitespace-nowrap text-muted-foreground transition-colors select-none hover:bg-accent/60 hover:text-foreground before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:origin-center before:scale-y-0 before:rounded-full before:bg-primary before:opacity-0 before:transition-transform"
            >
              {t(tab.key)}
            </label>
          ))}
        </nav>

        <div className="min-h-0">
          <WhatPanel t={t} target={target} label={signedIn ? t("openApp") : t("getStarted")} />
          <FilmPanel t={t} />
          <WhyPanel t={t} />
          <WhoPanel t={t} />
          <HowPanel t={t} />
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2.5 px-6 py-[clamp(0.5rem,1.5vh,0.9rem)] text-[clamp(0.68rem,1.4vh,0.75rem)] text-muted-foreground">
        <LogoMark className="size-3.5 shrink-0" />
        <span className="text-pretty">{t("footerNote")}</span>
        <Link href="/about" className="ms-auto underline-offset-4 transition-colors hover:text-foreground hover:underline">
          {t("aboutLink")}
        </Link>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------- panels */

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * Every panel is the same box: full height, column, and free to shrink.
 *
 * The overflow rule is the honest part. On every viewport this page is designed for the
 * content fits and no scrollbar appears — measured, not assumed. But a 360×530 phone has
 * roughly the height of a business card, and at some point the choice is between letting
 * a panel scroll inside itself and silently cutting the bottom off. Scrolling loses the
 * promise; clipping loses the sentence. The page itself still never scrolls.
 */
const PANEL = "h-full min-h-0 flex-col overflow-y-auto overscroll-contain";

/** The opening claim, the proof beside it, and the ask. */
function WhatPanel({ t, target, label }: { t: T; target: string; label: string }) {
  return (
    <section
      data-panel="what"
      className={`${PANEL} justify-center gap-[clamp(1rem,3.5vh,2.5rem)] lg:grid lg:grid-cols-[1.05fr_1fr] lg:items-center`}
    >
      <div className="flex flex-col gap-[clamp(0.6rem,1.8vh,1.15rem)]">
        <h1 className="text-[clamp(1.6rem,4.4vh+0.8vw,2.6rem)] leading-[1.12] font-semibold tracking-tight text-balance">
          {t("headline")}
        </h1>
        <p className="max-w-[50ch] text-[clamp(0.9rem,1.8vh,1.0625rem)] leading-relaxed text-muted-foreground text-pretty">
          {t("subhead")}
        </p>
        <div className="flex flex-col gap-[clamp(0.35rem,1.1vh,0.65rem)]">
          <Link
            href={target}
            className="inline-flex h-[clamp(2.6rem,5.6vh,3.1rem)] w-fit items-center justify-center rounded-lg bg-primary px-[clamp(1.25rem,3vw,2rem)] text-[clamp(0.875rem,1.8vh,1rem)] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {label}
          </Link>
          {/* The number comes from the plan the server actually enforces, so the page
              cannot drift into promising an allowance nobody honours. */}
          <p className="text-[clamp(0.7rem,1.4vh,0.75rem)] text-muted-foreground">
            {t("ctaNote", { count: FREE.conversions })}
          </p>
        </div>
      </div>
      <BeforeAfter t={t} />
    </section>
  );
}

/**
 * The film.
 *
 * preload="none" is what lets a 4.4 MB file sit on the page a stranger waits for: nothing
 * is fetched until play is pressed, so the 71 KB poster is the whole cost. object-contain
 * inside a shrinking box keeps it inside one screen on a short window instead of pushing
 * the panel past the fold.
 */
function FilmPanel({ t }: { t: T }) {
  return (
    <section data-panel="film" className={`${PANEL} gap-[clamp(0.5rem,1.6vh,1rem)]`}>
      <PanelHead t={t} title="videoTitle" lead="videoLead" />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <video
          controls
          preload="none"
          playsInline
          poster="/explainer.jpg"
          className="max-h-full max-w-full rounded-xl border bg-black"
        >
          <source src="/explainer.mp4" type="video/mp4" />
          {t("videoFallback")}
        </video>
      </div>
    </section>
  );
}

/** The reasons — and, deliberately beside them, the limits. */
function WhyPanel({ t }: { t: T }) {
  return (
    <section data-panel="why" className={`${PANEL} justify-center gap-[clamp(0.75rem,2.4vh,1.5rem)]`}>
      <PanelHead t={t} title="whyTitle" />
      <div className="grid gap-x-[clamp(1rem,2.5vw,2rem)] gap-y-[clamp(0.75rem,2.2vh,1.35rem)] sm:grid-cols-3">
        <Reason t={t} title="privacyTitle" body="privacyBody" />
        <Reason t={t} title="rtlTitle" body="rtlBody" />
        <Reason t={t} title="outputTitle" body="outputBody" />
      </div>
      <div className="rounded-xl border border-dashed p-[clamp(0.7rem,2vh,1.1rem)]">
        <h3 className="text-[clamp(0.78rem,1.6vh,0.9375rem)] font-semibold tracking-tight">{t("limitsTitle")}</h3>
        {/* A list, not a paragraph. Three unrelated constraints joined by spaces read as
            one run-on sentence, and stating them plainly builds more trust than burying
            them would — which is why they sit on the persuasion panel, not a footnote. */}
        <ul className="mt-[clamp(0.3rem,1vh,0.5rem)] grid gap-[clamp(0.2rem,0.8vh,0.4rem)] text-[clamp(0.72rem,1.5vh,0.8125rem)] leading-snug text-muted-foreground sm:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <li key={n} className="flex gap-2">
              <span aria-hidden="true" className="mt-[0.45em] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
              <span className="text-pretty">{t(`limit${n}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Who would want this. Four situations, not four personas. */
function WhoPanel({ t }: { t: T }) {
  return (
    <section data-panel="who" className={`${PANEL} justify-center gap-[clamp(0.75rem,2.4vh,1.5rem)]`}>
      <PanelHead t={t} title="useCasesTitle" />
      <div className="grid gap-x-[clamp(1rem,2.5vw,2.5rem)] gap-y-[clamp(0.75rem,2.4vh,1.5rem)] sm:grid-cols-2">
        {[1, 2, 3, 4].map((n) => (
          <Reason key={n} t={t} title={`case${n}Title`} body={`case${n}Body`} />
        ))}
      </div>
    </section>
  );
}

/** The mechanism, last: nobody buys the how before they want the what. */
function HowPanel({ t }: { t: T }) {
  return (
    <section data-panel="how" className={`${PANEL} justify-center gap-[clamp(0.75rem,2.4vh,1.5rem)]`}>
      <PanelHead t={t} title="howTitle" lead="howLead" />
      <div className="grid gap-[clamp(0.5rem,1.6vh,0.85rem)] sm:grid-cols-3">
        <LayerCard t={t} title="layerRasterTitle" body="layerRasterBody" figure={<RasterFigure />} />
        <LayerCard t={t} title="layerTextTitle" body="layerTextBody" figure={<TextFigure />} />
        <LayerCard t={t} title="layerResultTitle" body="layerResultBody" figure={<ResultFigure />} accent />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- pieces */

function PanelHead({ t, title, lead }: { t: T; title: string; lead?: string }) {
  return (
    <div className="flex flex-col gap-[clamp(0.2rem,0.8vh,0.5rem)]">
      <h2 className="text-[clamp(1.05rem,2.6vh,1.5rem)] font-semibold tracking-tight text-balance">{t(title)}</h2>
      {lead && (
        <p className="max-w-[62ch] text-[clamp(0.78rem,1.6vh,0.9375rem)] leading-relaxed text-muted-foreground text-pretty">
          {t(lead)}
        </p>
      )}
    </div>
  );
}

/** A titled paragraph. h3, because the panel heading above it is the h2. */
function Reason({ t, title, body }: { t: T; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-[clamp(0.15rem,0.6vh,0.4rem)]">
      <h3 className="text-[clamp(0.82rem,1.7vh,1rem)] font-semibold tracking-tight text-pretty">{t(title)}</h3>
      <p className="max-w-[46ch] text-[clamp(0.72rem,1.55vh,0.875rem)] leading-relaxed text-muted-foreground text-pretty">
        {t(body)}
      </p>
    </div>
  );
}

function LayerCard({
  t,
  title,
  body,
  figure,
  accent = false,
}: {
  t: T;
  title: string;
  body: string;
  figure: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-[clamp(0.35rem,1.2vh,0.7rem)] rounded-xl border p-[clamp(0.5rem,1.6vh,0.85rem)] ${
        accent ? "border-primary/40 bg-accent/40" : "bg-card"
      }`}
    >
      {/* The figures are decorative, and on a phone the three cards stack — which put this
          panel 2px past the fold, the one thing this page may not do. Below sm they go. */}
      <div className="hidden h-[clamp(3rem,9vh,5.5rem)] items-center justify-center rounded-lg bg-background sm:flex">
        {figure}
      </div>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[clamp(0.75rem,1.6vh,0.875rem)] font-semibold">{t(title)}</h3>
        <p className="text-[clamp(0.68rem,1.45vh,0.78rem)] leading-relaxed text-muted-foreground text-pretty">{t(body)}</p>
      </div>
    </div>
  );
}

/** Language, as a form: the app's dropdown is a client component and this page has none. */
function LocaleSwitch({ current }: { current: string }) {
  return (
    <form action="/api/locale" method="post" className="flex items-center gap-2">
      {/* Named in its own language, because that is the word someone is scanning for. */}
      {LOCALES.filter((l) => l.code !== current).map((l) => (
        <button
          key={l.code}
          type="submit"
          name="locale"
          value={l.code}
          className="text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {l.name}
        </button>
      ))}
    </form>
  );
}

/**
 * The same document twice: a picture of words, and words.
 *
 * Drawn rather than screenshotted, and labelled as a comparison — a mock dressed as a
 * screenshot would be a claim about output nobody has seen. The selection on the right is
 * the whole product in one detail.
 */
function BeforeAfter({ t }: { t: T }) {
  const lines = [t("sample1"), t("sample2"), t("sample3")];
  const pad = "p-[clamp(0.55rem,1.7vh,0.95rem)]";

  return (
    <div className="grid min-h-0 gap-[clamp(0.5rem,1.4vh,0.75rem)] sm:grid-cols-2">
      <figure className={`flex min-h-0 flex-col gap-2 rounded-xl border bg-card ${pad}`}>
        <figcaption className="font-mono text-[clamp(0.55rem,1.2vh,0.65rem)] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {t("figureBefore")}
        </figcaption>
        {/* Bars, not words: in a PDF the text is part of the picture. */}
        <div
          className={`flex min-h-0 flex-1 flex-col justify-center gap-[clamp(0.35rem,1vh,0.6rem)] rounded-lg bg-background ${pad}`}
          aria-hidden="true"
        >
          <div className="h-[clamp(0.4rem,1vh,0.7rem)] w-2/5 rounded bg-muted-foreground/40" />
          <div className="flex flex-col gap-[clamp(0.25rem,0.7vh,0.4rem)]">
            <div className="h-[clamp(0.3rem,0.7vh,0.5rem)] w-full rounded bg-muted-foreground/25" />
            <div className="h-[clamp(0.3rem,0.7vh,0.5rem)] w-11/12 rounded bg-muted-foreground/25" />
            <div className="h-[clamp(0.3rem,0.7vh,0.5rem)] w-3/5 rounded bg-muted-foreground/25" />
          </div>
        </div>
        <span className="text-[clamp(0.62rem,1.3vh,0.72rem)] text-muted-foreground">{t("figureBeforeNote")}</span>
      </figure>

      <figure className={`flex min-h-0 flex-col gap-2 rounded-xl border border-primary/40 bg-accent/30 ${pad}`}>
        <figcaption className="font-mono text-[clamp(0.55rem,1.2vh,0.65rem)] font-semibold tracking-[0.14em] text-primary uppercase">
          {t("figureAfter")}
        </figcaption>
        <div
          className={`flex min-h-0 flex-1 flex-col justify-center gap-[clamp(0.3rem,0.9vh,0.6rem)] rounded-lg bg-background ${pad}`}
        >
          <p className="text-[clamp(0.72rem,1.6vh,0.875rem)] font-semibold">{t("sampleTitle")}</p>
          <div className="flex flex-col gap-[clamp(0.1rem,0.4vh,0.25rem)] text-[clamp(0.62rem,1.35vh,0.75rem)] leading-relaxed text-muted-foreground">
            {lines.map((line, i) => (
              <p key={line} className={i === 1 ? "rounded-sm bg-primary/25 text-foreground" : undefined}>
                {line}
              </p>
            ))}
          </div>
        </div>
        <span className="text-[clamp(0.62rem,1.3vh,0.72rem)] text-muted-foreground">{t("figureAfterNote")}</span>
      </figure>
    </div>
  );
}

/* Inline figures for the two-layer explanation. Abstract on purpose. */

const SHEET = "M6 3h32a3 3 0 0 1 3 3v46a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z";

function RasterFigure() {
  return (
    <svg viewBox="0 0 44 58" className="h-full max-h-20 w-auto" aria-hidden="true">
      <path d={SHEET} className="fill-muted stroke-border" strokeWidth="1.5" />
      <circle cx="16" cy="20" r="6" className="fill-muted-foreground/40" />
      <path d="M9 42l9-11 7 8 5-5 6 8z" className="fill-muted-foreground/30" />
    </svg>
  );
}

function TextFigure() {
  return (
    <svg viewBox="0 0 44 58" className="h-full max-h-20 w-auto" aria-hidden="true">
      <path d={SHEET} className="fill-muted stroke-border" strokeWidth="1.5" />
      {[14, 21, 28, 35, 42].map((y, i) => (
        <rect key={y} x="9" y={y} width={i % 3 === 2 ? 14 : 26} height="3" rx="1.5" className="fill-muted-foreground/50" />
      ))}
    </svg>
  );
}

function ResultFigure() {
  return (
    <svg viewBox="0 0 44 58" className="h-full max-h-20 w-auto" aria-hidden="true">
      <path d={SHEET} className="fill-card stroke-primary/50" strokeWidth="1.5" />
      <circle cx="16" cy="19" r="5" className="fill-primary/25" />
      <path d="M9 40l8-9 6 7 4-4 6 6z" className="fill-primary/20" />
      {/* The selection is the point: the words are still words. */}
      <rect x="9" y="46" width="26" height="4" rx="1" className="fill-primary/30" />
      <rect x="9" y="46.5" width="26" height="3" rx="1.5" className="fill-primary" />
    </svg>
  );
}
