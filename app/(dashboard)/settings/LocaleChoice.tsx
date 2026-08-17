"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { setLocale } from "@/src/actions/preferences";
import type { LocaleEntry } from "@/src/i18n/config.ts";

export default function LocaleChoice({ locales, current }: { locales: LocaleEntry[]; current: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {locales.map((locale) => {
        const active = locale.code === current;
        return (
          <button
            key={locale.code}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={pending}
            onClick={() => startTransition(() => { void setLocale(locale.code); })}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60",
              active
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border hover:border-muted-foreground",
            )}
          >
            {active && <Check className="size-3.5" aria-hidden="true" />}
            {/* Each language names itself, tagged so the browser picks the right font. */}
            <span lang={locale.code}>{locale.name}</span>
          </button>
        );
      })}
    </div>
  );
}
