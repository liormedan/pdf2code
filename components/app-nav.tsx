"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Activity, FileType2, LayoutDashboard, LogOut, Presentation, Settings, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FIREBASE_ENABLED, firebaseAuth } from "@/src/lib/firebase/client.ts";

// One entry per source, because the two differ in whether the document leaves the
// browser — a distinction that belongs in front of the choice, not behind it.
const ITEMS = [
  { href: "/dashboard", key: "overview", icon: LayoutDashboard },
  { href: "/convert", key: "pdf", icon: Wand2 },
  { href: "/presentations", key: "presentations", icon: Presentation },
  { href: "/activity", key: "activity", icon: Activity },
  { href: "/settings", key: "settings", icon: Settings },
];

export default function AppNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const tApp = useTranslations("app");
  const router = useRouter();

  /**
   * Sign out of both halves.
   *
   * Clearing our cookie alone would leave the Firebase SDK still holding the account
   * in this browser, and the next visit to the sign-in screen would quietly restore it.
   */
  async function signOut() {
    if (FIREBASE_ENABLED) {
      const { signOut: firebaseSignOut } = await import("firebase/auth");
      await firebaseSignOut(firebaseAuth()).catch(() => {});
    }
    await fetch("/api/session", { method: "DELETE" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link
        href="/dashboard"
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

      <Button
        type="button"
        variant="ghost"
        className="w-full justify-start gap-3 px-3 text-muted-foreground"
        onClick={signOut}
      >
        <LogOut className="size-4" aria-hidden="true" />
        {t("signOut")}
      </Button>
    </div>
  );
}
