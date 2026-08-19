import Link from "next/link";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE, readSession } from "@/src/lib/auth.ts";
import { FREE } from "@/src/lib/plans.ts";
import { PLANNED, SHIPPED } from "@/src/lib/outputs.ts";

/**
 * The webpage: what the address shows someone who has never been here.
 *
 * Two rules hold this file together, and both are load-bearing rather than stylistic.
 *
 * Nothing heavy may enter. This is the only page a stranger waits for, and it renders
 * at 162 B because it imports no icon library, no client component and nothing from the
 * converter. A single icon from lucide-react put 161 kB in this chunk when the skeleton
 * was written — the barrel does not tree-shake into this route group. Icons are inlined
 * SVG, controls are styled links, and anything from components/ui/ gets measured before
 * it comes in. See docs/site-plan.md §5.
 *
 * Nothing untrue may be said. The claims here are checked against what the product does
 * today, not what it is planned to do: PowerPoint is listed under what the tool cannot
 * do, and "never leaves your browser" is stated for the PDF route, which is the only
 * route this page describes. When that stops being true the sentence changes first.
 */
export default async function Webpage({ searchParams }: { searchParams: Promise<{ noted?: string; interest?: string }> }) {
  const t = await getTranslations("webpage");
  const { noted, interest } = await searchParams;

  const store = await cookies();
  const signedIn = (await readSession(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET)) !== null;

  return (
    <div className="mx-auto max-w-3xl px-6">
      <header className="flex items-center justify-between gap-4 py-6">
        <span className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Mark />
          </span>
          <span className="font-semibold tracking-tight">{t("brand")}</span>
        </span>
        <Link href={signedIn ? "/dashboard" : "/login"} className="text-sm text-muted-foreground hover:text-foreground">
          {signedIn ? t("openApp") : t("navSignIn")}
        </Link>
      </header>

      <main className="space-y-20 pb-24">
        <section className="space-y-6 pt-10">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t("headline")}
          </h1>
          <p className="max-w-[56ch] text-lg leading-relaxed text-muted-foreground">
            {t("subhead")}
          </p>
          <div className="space-y-2.5">
            <CallToAction signedIn={signedIn} primary={signedIn ? t("openApp") : t("getStarted")} secondary={t("signIn")} />
            {/* The number comes from the plan the server actually enforces, so the
                page cannot drift into promising an allowance nobody honours. */}
            <p className="text-xs text-muted-foreground">{t("ctaNote", { count: FREE.conversions })}</p>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-semibold tracking-tight">{t("useCasesTitle")}</h2>
          <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {[1, 2, 3, 4].map((n) => (
              <Point key={n} title={t(`case${n}Title`)} body={t(`case${n}Body`)} />
            ))}
          </div>
        </section>

        {/* The two layers, first and largest: it is the one claim a converter that
            exports an image cannot make, so it carries the page. */}
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
                  {/* A form, not a button with a handler: this page ships no client
                      JavaScript, and it should still work with scripting off. */}
                  <form action="/api/interest" method="post" className="mt-auto">
                    <input type="hidden" name="target" value={o.id} />
                    <button
                      type="submit"
                      className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {t("notify")}
                    </button>
                  </form>
                </div>
              ))}
            </Group>
          </div>
        </section>

        <section className="grid gap-8 sm:grid-cols-2">
          <Point title={t("privacyTitle")} body={t("privacyBody")} />
          <Point title={t("rtlTitle")} body={t("rtlBody")} />
          <Point
            title={t("limitsTitle")}
            body={[t("limit1"), t("limit2"), t("limit3")].join(" ")}
          />
        </section>

        <section className="space-y-5 rounded-xl border bg-card p-8">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">{t("closingTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("closingBody")}</p>
          </div>
          <CallToAction signedIn={signedIn} primary={signedIn ? t("openApp") : t("getStarted")} secondary={t("signIn")} />
        </section>
      </main>

      <footer className="border-t py-6 text-xs text-muted-foreground">
        {t("footerNote")}
      </footer>
    </div>
  );
}

/** The invitation. Primary everywhere it appears, and the same destination each time. */
function CallToAction({ signedIn, primary, secondary }: { signedIn: boolean; primary: string; secondary: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={signedIn ? "/dashboard" : "/login"}
        className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {primary}
      </Link>
      {!signedIn && (
        <Link
          href="/login"
          className="inline-flex h-11 items-center justify-center rounded-md px-5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {secondary}
        </Link>
      )}
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

/** Message keys are derived from the catalogue, so adding an output touches one list. */
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

function Point({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="max-w-[46ch] text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/* Inline figures. Deliberately abstract: a page with a drawing on it, a page with text
   on it, and the two together — enough to carry the idea without pretending to be a
   screenshot of a document nobody has seen. */

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

function Mark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="size-4.5" aria-hidden="true">
      <path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m5 11-3 3 3 3" />
      <path d="m9 17 3-3-3-3" />
    </svg>
  );
}
