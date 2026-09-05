import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES } from "@/i18n/config";
import { useLocale, useSetLocale, useTranslations } from "@/i18n/provider";

/**
 * Carried over from the web app with one change of substance.
 *
 * There, choosing a language called a server action that wrote a cookie and re-rendered
 * the page — so the switch was a transition with a pending state worth showing. Here it
 * is a state update and a localStorage write, both synchronous, and a spinner for
 * something that finishes in the same frame would be theatre.
 */
export default function LanguageSwitcher() {
  const t = useTranslations("nav");
  const current = useLocale();
  const setLocale = useSetLocale();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("language")}>
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale.code}
            onSelect={() => setLocale(locale.code)}
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
