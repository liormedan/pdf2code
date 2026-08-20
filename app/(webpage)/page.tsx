import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { SESSION_COOKIE, readSession } from "@/src/lib/auth.ts";
import { FREE } from "@/src/lib/plans.ts";
import { LOCALES } from "@/src/i18n/config.ts";
import { Logo, LogoMark } from "@/components/logo";

/**
 * The entry page: one viewport, no scrolling.
 *
 * The constraint is the design. Everything here is sized against viewport *height* as
 * well as width — `clamp(min, …vh…, max)` rather than a fixed type scale — because a
 * page that must not scroll has to shrink when the window is short, not just when it is
 * narrow. A 1366×768 laptop leaves roughly 660px of usable height, and that is the case
 * this is tuned for; `npm run fits` measures it rather than trusting the eye.
 *
 * Fitting meant choosing. What survives is the claim, the proof and the invitation —
 * the three things a stranger needs to decide. The film, the use cases, the layer
 * explanation and the roadmap moved to /about intact, because cutting them from the
 * product would have been a different decision than cutting them from this screen.
 *
 * The two rules from the old page still hold, and both are load-bearing. Nothing heavy
 * may enter: no icon library, no client component, nothing from the converter — icons
 * are inlined SVG and anything wanting a click handler is a form post. And nothing
 * untrue may be said: the free allowance is read from the plan the server enforces.
 */
export default async function Webpage() {
  const t = await getTranslations("webpage");
  const locale = await getLocale();

  const store = await cookies();
  const signedIn = (await readSession(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET)) !== null;

  return (
    // dvh, not vh: on mobile browsers vh counts the chrome that slides away, so 100vh
    // is taller than the window and guarantees the scrollbar this page exists to avoid.
    <div className="grid h-[100dvh] grid-rows-[auto_1fr_auto] overflow-hidden">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-[clamp(0.75rem,2.2vh,1.25rem)]">
        <Logo name={t("brand")} />
        <div className="flex items-center gap-4 text-sm">
          <LocaleSwitch current={locale} />
          <Link href="/about" className="text-muted-foreground transition-colors hover:text-foreground">
            {t("navAbout")}
          </Link>
          <Link
            href={signedIn ? "/dashboard" : "/login"}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {signedIn ? t("openApp") : t("navSignIn")}
          </Link>
        </div>
      </header>

      {/* min-h-0 lets this row actually shrink; without it a grid track refuses to go
          below its content and the page scrolls anyway. */}
      <main className="mx-auto grid w-full max-w-5xl min-h-0 grid-rows-[1fr_auto] gap-[clamp(1rem,3vh,2rem)] px-6">
        <div className="grid min-h-0 items-center gap-[clamp(1.5rem,4vh,3rem)] lg:grid-cols-[1.05fr_1fr]">
          <div className="flex flex-col gap-[clamp(0.75rem,2vh,1.25rem)]">
            <h1 className="text-[clamp(1.75rem,4.6vh+0.9vw,2.75rem)] leading-[1.08] font-semibold tracking-tight text-balance">
              {t("headline")}
            </h1>
            <p className="max-w-[52ch] text-[clamp(0.95rem,1.9vh,1.125rem)] leading-relaxed text-muted-foreground text-pretty">
              {t("subhead")}
            </p>

            <div className="flex flex-col gap-[clamp(0.4rem,1.2vh,0.75rem)]">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={signedIn ? "/dashboard" : "/login"}
                  className="inline-flex h-[clamp(2.75rem,6vh,3.25rem)] items-center justify-center rounded-lg bg-primary px-[clamp(1.25rem,3vw,2rem)] text-[clamp(0.9rem,1.9vh,1rem)] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {signedIn ? t("openApp") : t("getStarted")}
                </Link>
                <Link
                  href="/about"
                  className="inline-flex h-[clamp(2.75rem,6vh,3.25rem)] items-center justify-center rounded-lg px-4 text-[clamp(0.8rem,1.6vh,0.875rem)] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {t("seeHow")}
                </Link>
              </div>
              {/* The number comes from the plan the server actually enforces, so the page
                  cannot drift into promising an allowance nobody honours. */}
              <p className="text-[clamp(0.7rem,1.4vh,0.75rem)] text-muted-foreground">
                {t("ctaNote", { count: FREE.conversions })}
              </p>
            </div>
          </div>

          {/* The proof. It earns its place on a screen this tight because the product is
              a visual transformation, and one figure says it faster than the paragraph
              that used to sit here. */}
          <BeforeAfter t={t} />
        </div>

        <ul className="grid gap-[clamp(0.5rem,1.5vh,1rem)] sm:grid-cols-3">
          {(["fitPrivacy", "fitRtl", "fitFidelity"] as const).map((key) => (
            <li
              key={key}
              className="flex items-baseline gap-2 text-[clamp(0.72rem,1.5vh,0.8125rem)] leading-snug text-muted-foreground"
            >
              <span aria-hidden="true" className="mt-[0.4em] size-1 shrink-0 rounded-full bg-primary" />
              <span className="text-pretty">{t(key)}</span>
            </li>
          ))}
        </ul>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2.5 px-6 py-[clamp(0.6rem,1.8vh,1rem)] text-[clamp(0.68rem,1.4vh,0.75rem)] text-muted-foreground">
        <LogoMark className="size-3.5 shrink-0" />
        <span className="text-pretty">{t("footerNote")}</span>
      </footer>
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
 * screenshot would be a claim about output nobody has seen. The selection on the right
 * is the whole product in one detail.
 */
function BeforeAfter({ t }: { t: (key: string) => string }) {
  const lines = [t("sample1"), t("sample2"), t("sample3")];
  const pad = "p-[clamp(0.6rem,1.8vh,1rem)]";

  return (
    <section className="grid min-h-0 gap-[clamp(0.5rem,1.4vh,0.75rem)] sm:grid-cols-2">
      <figure className={`flex min-h-0 flex-col gap-2 rounded-xl border bg-card ${pad}`}>
        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="font-mono text-[clamp(0.55rem,1.2vh,0.65rem)] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("figureBefore")}
          </span>
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
        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="font-mono text-[clamp(0.55rem,1.2vh,0.65rem)] font-semibold tracking-[0.14em] text-primary uppercase">
            {t("figureAfter")}
          </span>
        </figcaption>
        <div className={`flex min-h-0 flex-1 flex-col justify-center gap-[clamp(0.3rem,0.9vh,0.6rem)] rounded-lg bg-background ${pad}`}>
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
    </section>
  );
}
