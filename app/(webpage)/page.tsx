import Link from "next/link";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE, readSession } from "@/src/lib/auth.ts";

/**
 * The webpage: what the address shows someone who has never been here.
 *
 * A skeleton for now — the structural split is what this change is for, and the
 * argument itself lands next. See docs/site-plan.md §4 for the order that argument
 * has to make, and for the three things it is not allowed to promise.
 *
 * Someone already signed in is not thrown at the app. They may have come to read the
 * page; the only difference is which door the button opens.
 */
export default async function Webpage() {
  const t = await getTranslations("webpage");

  const store = await cookies();
  const signedIn = (await readSession(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET)) !== null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-20">
      <div className="flex items-center gap-2.5">
        {/* The mark is inlined rather than imported from lucide. The icon barrel does
            not tree-shake into this route's chunk, and one glyph is not worth 161kB on
            the only page a stranger loads. */}
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" className="size-4.5" aria-hidden="true">
            <path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            <path d="m5 11-3 3 3 3" />
            <path d="m9 17 3-3-3-3" />
          </svg>
        </span>
        <span className="font-semibold tracking-tight">{t("brand")}</span>
      </div>

      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {t("headline")}
        </h1>
        <p className="max-w-[54ch] text-base leading-relaxed text-muted-foreground">
          {t("subhead")}
        </p>
      </div>

      {/* Plain links, styled. The Button component is a client component, and a page
          with no interactivity should not ship one to say "sign in". */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={signedIn ? "/dashboard" : "/login"}
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t(signedIn ? "openApp" : "getStarted")}
        </Link>
        {!signedIn && (
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("signIn")}
          </Link>
        )}
      </div>
    </main>
  );
}
