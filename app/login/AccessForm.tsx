"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * The first of the two gates: the shared beta code.
 *
 * Passing it does not sign anyone in — it only reveals the account form. The developer
 * bypass lives beside this component rather than inside it, because it skips both.
 */
export default function AccessForm() {
  const t = useTranslations("login");
  const router = useRouter();
  const params = useSearchParams();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function requestAccess(payload: { code: string }) {
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

      // Passing the gate lands on this same screen, now showing the sign-in step; the
      // requested destination rides along in the query for the account form to use.
      const next = params.get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      router.replace(target ? `/login?next=${encodeURIComponent(target)}` : "/login");
      router.refresh();
    } catch {
      setError(t("genericError"));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
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

    </form>
  );
}
