"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Activity, FileType2, LayoutDashboard, LogOut, Settings, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { signOut } from "@/src/actions/preferences";

const ITEMS = [
  { href: "/", key: "overview", icon: LayoutDashboard },
  { href: "/convert", key: "convert", icon: Wand2 },
  { href: "/activity", key: "activity", icon: Activity },
  { href: "/settings", key: "settings", icon: Settings },
];

export default function AppNav({ onNavigate }) {
  const t = useTranslations("nav");
  const tApp = useTranslations("app");
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex items-center gap-2.5 rounded-md px-2 py-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <FileType2 className="size-4" aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold tracking-tight">{tApp("name")}</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1" aria-label={t("toggleSidebar")}>
        {ITEMS.map(({ href, key, icon: Icon }) => {
          // "/" would otherwise match every route, so it alone is compared exactly.
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {t(key)}
            </Link>
          );
        })}
      </nav>

      <form action={signOut}>
        <Button
          type="submit"
          variant="ghost"
          className="w-full justify-start gap-3 px-3 text-muted-foreground"
        >
          <LogOut className="size-4" aria-hidden="true" />
          {t("signOut")}
        </Button>
      </form>
    </div>
  );
}
