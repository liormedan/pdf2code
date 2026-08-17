"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES } from "@/src/i18n/config.mjs";
import { setLocale } from "@/src/actions/preferences";

export default function LanguageSwitcher() {
  const t = useTranslations("nav");
  const current = useLocale();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("language")} disabled={pending}>
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale.code}
            onSelect={() => startTransition(() => setLocale(locale.code))}
            className={locale.code === current ? "bg-accent text-accent-foreground" : undefined}
          >
            {/* Each language names itself — people scan for their own word, not ours. */}
            <span lang={locale.code}>{locale.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
