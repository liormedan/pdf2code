"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Info, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AccessForm({ devLoginAvailable = false }) {
  const t = useTranslations("login");
  const router = useRouter();
  const params = useSearchParams();

  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  async function requestAccess(payload) {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? t("genericError"));
        setCode("");
        return;
      }

      // Only ever a same-site path — an absolute URL here would be an open redirect.
      const next = params.get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      router.replace(target);
      router.refresh();
    } catch {
      setError(t("genericError"));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    requestAccess({ code });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="access-code">{t("codeLabel")}</Label>
        <Input
          id="access-code"
          name="access-code"
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("codePlaceholder")}
          // Not a password manager entry, and not a username field: this is a shared
          // code, so autofill would be offering the wrong secret.
          autoComplete="off"
          autoFocus
          required
          aria-invalid={!!error}
          aria-describedby={error ? "access-error" : "access-note"}
        />
      </div>

      {error && (
        <Alert variant="destructive" id="access-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={pending || !code}>
        {pending ? t("submitting") : t("submit")}
      </Button>

      {/* Stated plainly, because the failure mode is someone typing a password they
          reuse into a box that was never built to receive one. */}
      <p
        id="access-note"
        className="flex gap-2 rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground"
      >
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>{t("notAPassword")}</span>
      </p>

      {devLoginAvailable && (
        <div className="space-y-2 border-t border-dashed border-border pt-4">
          <Button
            type="button"
            variant="outline"
            className="w-full border-warning/50 text-warning hover:bg-warning-muted hover:text-warning"
            disabled={pending}
            onClick={() => requestAccess({ dev: true })}
          >
            <Wrench className="size-4" aria-hidden="true" />
            {t("devSignIn")}
          </Button>
          {/* Says why it is safe rather than just that it exists — the next person to
              read this screen should not have to go find out. */}
          <p className="text-center text-[11px] text-muted-foreground">{t("devSignInNote")}</p>
        </div>
      )}
    </form>
  );
}
