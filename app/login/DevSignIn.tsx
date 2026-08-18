"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Skip both gates at once, in development only.
 *
 * It sits beside whichever step is showing rather than inside one of the forms,
 * because it replaces both of them: /api/access with `dev` opens the beta gate and
 * mints an identity, so a machine with no Firebase project can still run the app.
 *
 * The button not existing in production is the lesser guard. The real one is in the
 * route handler, which refuses the developer path whenever NODE_ENV is production —
 * hiding a control that still answers is not a gate at all.
 */
export default function DevSignIn() {
  const t = useTranslations("login");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dev: true }),
      });
      if (!response.ok) return;
      router.replace("/");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-dashed border-border pt-4">
      <Button
        type="button"
        variant="outline"
        className="w-full border-warning/50 text-warning hover:bg-warning-muted hover:text-warning"
        disabled={pending}
        onClick={signIn}
      >
        <Wrench className="size-4" aria-hidden="true" />
        {t("devSignIn")}
      </Button>
      {/* Says why it is safe rather than just that it exists — the next person to read
          this screen should not have to go find out. */}
      <p className="text-center text-[11px] text-muted-foreground">{t("devSignInNote")}</p>
    </div>
  );
}
