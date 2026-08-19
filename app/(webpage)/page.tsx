import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { SESSION_COOKIE, readSession } from "@/src/lib/auth.ts";
import { FREE } from "@/src/lib/plans.ts";
import { PLANNED, SHIPPED, type OutputId } from "@/src/lib/outputs.ts";
import { LOCALES } from "@/src/i18n/config.ts";
import { adminDb } from "@/src/lib/firebase/admin.ts";
import { Logo, LogoMark } from "@/components/logo";

/**
 * The webpage: what the address shows someone who has never been here.
 *
 * Two rules hold this file together, and both are load-bearing rather than stylistic.
 *
 * Nothing heavy may enter. This is the only page a stranger waits for. It imports no icon
 * library, no client component and nothing from the converter — a single icon from
 * lucide-react put 161 kB in this chunk when the skeleton was written, because the barrel
 * does not tree-shake into this route group. Icons are inlined SVG, and anything that
 * would want a click handler is a form post instead. See docs/site-plan.md §5.
 *
 * Nothing untrue may be said. The claims are checked against what the product does today:
 * PowerPoint sits under what it cannot do, the free allowance is read from the plan the
 * server enforces, and the comparison below is drawn as a diagram rather than dressed up
 * as a screenshot of a conversion nobody has seen.
 */
export default async function Webpage({ searchParams }: { searchParams: Promise<{ noted?: string; interest?: string }> }) {
  const t = await getTranslations("webpage");
  const locale = await getLocale();
  const { noted, interest } = await searchParams;

  const store = await cookies();
  const signedIn = (await readSession(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET)) !== null;
  const votes = await countVotes();

  return (
    <div className="mx-auto max-w-3xl px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <Logo name={t("brand")} />
        <div className="flex items-center gap-4">
          <LocaleSwitch current={locale} />
          <Link href={signedIn ? "/dashboard" : "/login"} className="text-sm text-muted-foreground hover:text-foreground">
            {signedIn ? t("openApp") : t("navSignIn")}
          </Link>
        </div>
      </header>

      <main className="space-y-20 pb-24">
        <section className="space-y-6 pt-8">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t("headline")}
          </h1>
          <p className="max-w-[56ch] text-lg leading-relaxed text-muted-foreground">
            {t("subhead")}
          </p>
          <div className="space-y-2.5">
            <CallToAction signedIn={signedIn} label={signedIn ? t("openApp") : t("getStarted")} secondary={t("signIn")} />
            {/* The number comes from the plan the server actually enforces, so the page
                cannot drift into promising an allowance nobody honours. */}
            <p className="text-xs text-muted-foreground">{t("ctaNote", { count: FREE.conversions })}</p>
          </div>
        </section>

        {/* Proof, as near the top as it can go. The product is a visual transformation
            and the page was explaining it entirely in prose. */}
        <BeforeAfter t={t} />

        <section className="space-y-6">
          <h2 className="text-xl font-semibold tracking-tight">{t("useCasesTitle")}</h2>
          <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {[1, 2, 3, 4].map((n) => (
              <Item key={n} title={t(`case${n}Title`)} body={t(`case${n}Body`)} />
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <div className="space-y-2.5">
            <h2 className="text-xl font-semibold tracking-tight">{t("howTitle")}</h2>
            <p className="max-w-[58ch] text-sm leading-relaxed text-muted-foreground">{t("howLead")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <LayerCard title={t("layerRasterTitle")} body={t("layerRasterBody")} figure={<RasterFigure />} />
            <LayerCard title={t("layerTextTitle")} body={t("layerTextBody")} figure={<TextFigure />} />
            <LayerCard title={t("layerResultTitle")} body={t("layerResultBody")} figure={<ResultFigure />} accent />
          </div>
        </section>

        <section className="space-y-6">
          <div className="space-y-2.5">
            <h2 className="text-xl font-semibold tracking-tight">{t("outputsTitle")}</h2>
            <p className="max-w-[58ch] text-sm leading-relaxed text-muted-foreground">{t("outputsLead")}</p>
          </div>

          {noted && (
            <p className="rounded-lg border border-primary/40 bg-accent/40 px-4 py-3 text-sm">
              {t(signedIn ? "noted" : "notedSignIn")}
            </p>
          )}
          {interest === "failed" && (
            <p className="rounded-lg border border-destructive/40 px-4 py-3 text-sm text-destructive">
              {t("interestFailed")}
            </p>
          )}

          <div className="space-y-4">
            <Group label={t("outputsAvailable")}>
              {SHIPPED.map((o) => (
                <div key={o.id} className="rounded-xl border bg-card p-4">
                  <h3 className="text-sm font-semibold">{t(nameKey(o.id))}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(bodyKey(o.id))}</p>
                </div>
              ))}
            </Group>

            <Group label={t("outputsPlanned")}>
              {PLANNED.map((o) => (
                <div key={o.id} className="flex flex-col rounded-xl border border-dashed p-4">
                  <h3 className="text-sm font-semibold text-muted-foreground">{t(nameKey(o.id))}</h3>
                  <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">{t(bodyKey(o.id))}</p>
                  <div className="mt-auto flex items-center gap-3">
                    {/* A form, not a button with a handler: this page ships no client
                        JavaScript, and it should still work with scripting off. */}
                    <form action="/api/interest" method="post">
                      <input type="hidden" name="target" value={o.id} />
                      <button
                        type="submit"
                        className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {t("notify")}
                      </button>
                    </form>
                    {/* Shown only once it means something — "1 person" is not momentum. */}
                    {(votes[o.id] ?? 0) > 2 && (
                      <span className="tabular font-mono text-xs text-muted-foreground">
                        {t("votes", { count: votes[o.id]! })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </Group>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-semibold tracking-tight">{t("goodToKnowTitle")}</h2>
          <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
            <Item title={t("privacyTitle")} body={t("privacyBody")} />
            <Item title={t("rtlTitle")} body={t("rtlBody")} />
            <div className="space-y-2 sm:col-span-2">
              <h3 className="text-base font-semibold tracking-tight">{t("limitsTitle")}</h3>
              {/* A list, not a paragraph. Three unrelated constraints joined by spaces
                  read as one run-on sentence, and stating them plainly builds more trust
                  than burying them would. */}
              <ul className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
                {[1, 2, 3].map((n) => (
                  <li key={n} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                    <span>{t(`limit${n}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="space-y-5 rounded-xl border bg-card p-8">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">{t("closingTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("closingBody")}</p>
          </div>
          <CallToAction signedIn={signedIn} label={signedIn ? t("openApp") : t("getStarted")} secondary={t("signIn")} />
        </section>
      </main>

      <footer className="flex flex-wrap items-center gap-2.5 border-t py-6 text-xs text-muted-foreground">
        <LogoMark className="size-4" />
        {t("footerNote")}
      </footer>
    </div>
  );
}

/**
 * How many people asked for each unshipped output.
 *
 * Three document reads on a public page: cheap now, and worth caching if the page ever
 * gets busy. A deployment without Firestore shows no counts rather than failing to render
 * the page they are attached to.
 */
async function countVotes(): Promise<Partial<Record<OutputId, number>>> {
  try {
    const snap = await adminDb().collection("interest").get();
    return Object.fromEntries(snap.docs.map((d) => [d.id, Number(d.data()?.votes ?? 0)]));
  } catch {
    return {};
  }
}

/**
 * The invitation, at the size of the thing the page exists for.
 *
 * It was a 44px control with 14px text under a 37px headline and beside 18px body copy —
 * the explanation was louder than the action.
 */
function CallToAction({ signedIn, label, secondary }: { signedIn: boolean; label: string; secondary: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={signedIn ? "/dashboard" : "/login"}
        className="inline-flex h-[3.25rem] items-center justify-center rounded-lg bg-primary px-8 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {label}
      </Link>
      {!signedIn && (
        <Link
          href="/login"
          className="inline-flex h-[3.25rem] items-center justify-center rounded-lg px-5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {secondary}
        </Link>
      )}
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
          className="text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
function BeforeAfter({ t }: { t: (key: string) => string }) {
  const lines = [t("sample1"), t("sample2"), t("sample3")];

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <figure className="space-y-2 rounded-xl border bg-card p-4">
        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <span className="font-mono text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("figureBefore")}
          </span>
          <span className="text-xs text-muted-foreground">{t("figureBeforeNote")}</span>
        </figcaption>
        {/* Bars, not words: in a PDF the text is part of the picture. */}
        <div className="space-y-2.5 rounded-lg bg-background p-4" aria-hidden="true">
          <div className="h-3 w-2/5 rounded bg-muted-foreground/40" />
          <div className="space-y-1.5 pt-1">
            <div className="h-2 w-full rounded bg-muted-foreground/25" />
            <div className="h-2 w-11/12 rounded bg-muted-foreground/25" />
            <div className="h-2 w-3/5 rounded bg-muted-foreground/25" />
          </div>
        </div>
      </figure>

      <figure className="space-y-2 rounded-xl border border-primary/40 bg-accent/30 p-4">
        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <span className="font-mono text-[10.5px] font-semibold tracking-[0.14em] text-primary uppercase">
            {t("figureAfter")}
          </span>
          <span className="text-xs text-muted-foreground">{t("figureAfterNote")}</span>
        </figcaption>
        <div className="space-y-2.5 rounded-lg bg-background p-4">
          <p className="text-sm font-semibold">{t("sampleTitle")}</p>
          <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            {lines.map((line, i) => (
              <p key={line} className={i === 1 ? "rounded-sm bg-primary/25 text-foreground" : undefined}>
                {line}
              </p>
            ))}
          </div>
        </div>
      </figure>
    </section>
  );
}

const nameKey = (id: string) => `out${id[0]!.toUpperCase()}${id.slice(1)}`;
const bodyKey = (id: string) => `${nameKey(id)}Body`;

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h3 className="font-mono text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">{children}</div>
    </div>
  );
}

function LayerCard({ title, body, figure, accent = false }: { title: string; body: string; figure: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`space-y-3 rounded-xl border p-4 ${accent ? "border-primary/40 bg-accent/40" : "bg-card"}`}>
      <div className="flex h-24 items-center justify-center rounded-lg bg-background">{figure}</div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

/** An item inside a section. h3, because the section heading above it is the h2. */
function Item({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-2">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="max-w-[46ch] text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/* Inline figures for the two-layer explanation. Abstract on purpose. */

const SHEET = "M6 3h32a3 3 0 0 1 3 3v46a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z";

function RasterFigure() {
  return (
    <svg viewBox="0 0 44 58" className="h-20 w-auto" aria-hidden="true">
      <path d={SHEET} className="fill-muted stroke-border" strokeWidth="1.5" />
      <circle cx="16" cy="20" r="6" className="fill-muted-foreground/40" />
      <path d="M9 42l9-11 7 8 5-5 6 8z" className="fill-muted-foreground/30" />
    </svg>
  );
}

function TextFigure() {
  return (
    <svg viewBox="0 0 44 58" className="h-20 w-auto" aria-hidden="true">
      <path d={SHEET} className="fill-muted stroke-border" strokeWidth="1.5" />
      {[14, 21, 28, 35, 42].map((y, i) => (
        <rect key={y} x="9" y={y} width={i % 3 === 2 ? 14 : 26} height="3" rx="1.5" className="fill-muted-foreground/50" />
      ))}
    </svg>
  );
}

function ResultFigure() {
  return (
    <svg viewBox="0 0 44 58" className="h-20 w-auto" aria-hidden="true">
      <path d={SHEET} className="fill-card stroke-primary/50" strokeWidth="1.5" />
      <circle cx="16" cy="19" r="5" className="fill-primary/25" />
      <path d="M9 40l8-9 6 7 4-4 6 6z" className="fill-primary/20" />
      {/* The selection is the point: the words are still words. */}
      <rect x="9" y="46" width="26" height="4" rx="1" className="fill-primary/30" />
      <rect x="9" y="46.5" width="26" height="3" rx="1.5" className="fill-primary" />
    </svg>
  );
}
