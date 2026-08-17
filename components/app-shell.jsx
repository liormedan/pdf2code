"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import AppNav from "@/components/app-nav";
import ThemeToggle from "@/components/theme-toggle";
import LanguageSwitcher from "@/components/language-switcher";

/**
 * Sidebar plus topbar.
 *
 * The sidebar is a permanent column from `lg` up and a dismissable overlay below it —
 * a dashboard on a phone that keeps a 240px rail has no room left for the work.
 */
export default function AppShell({ children }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A navigation that leaves the menu open on top of the destination feels broken.
  useEffect(() => setOpen(false), [pathname]);

  // Escape should close it, and a locked body should not scroll behind the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-e border-sidebar-border bg-sidebar lg:block">
        <div className="sticky top-0 h-screen">
          <AppNav />
        </div>
      </aside>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 start-0 z-50 w-64 border-e border-sidebar-border bg-sidebar lg:hidden">
            <AppNav onNavigate={() => setOpen(false)} />
          </aside>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-divider bg-background/90 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={t("toggleSidebar")}
            aria-expanded={open}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </Button>

          <div className="ms-auto flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
