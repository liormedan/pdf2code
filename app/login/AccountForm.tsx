"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { firebaseAuth } from "@/src/lib/firebase/client.ts";

type Mode = "signIn" | "signUp" | "reset";

/** The shortest password we will create an account with. Firebase itself allows six. */
const MIN_PASSWORD = 8;

/**
 * Firebase error codes worth naming.
 *
 * Anything not listed falls back to a generic message rather than showing the user a
 * string like "auth/internal-error" — but the ones here are the difference between a
 * person fixing their own typo and a person giving up.
 */
const ERROR_KEYS: Record<string, string> = {
  "auth/invalid-credential": "errorBadCredentials",
  "auth/invalid-email": "errorBadEmail",
  "auth/user-disabled": "errorDisabled",
  "auth/email-already-in-use": "errorEmailTaken",
  "auth/weak-password": "errorWeakPassword",
  "auth/too-many-requests": "errorTooMany",
  "auth/network-request-failed": "errorNetwork",
  "auth/operation-not-allowed": "errorProviderOff",
  // Every preview deployment gets a hostname that cannot be registered in advance, so
  // this one is expected rather than exceptional — and it points at a setting, not at
  // anything the person signing in did wrong.
  "auth/unauthorized-domain": "errorUnauthorizedDomain",
};

const codeOf = (err: unknown): string =>
  typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";

export default function AccountForm() {
  const t = useTranslations("login");
  const router = useRouter();
  const params = useSearchParams();

  const [mode, setMode] = useState<Mode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Exchange a signed-in Firebase user for this app's session cookie, then move on. */
  async function openSession(idToken: string) {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error ?? t("genericError"));
    }

    // Only ever a same-site path — an absolute URL here would be an open redirect.
    const next = params.get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    router.replace(target);
    router.refresh();
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      const code = codeOf(err);
      // Closing the Google popup is a decision, not a failure to report.
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;

      const key = ERROR_KEYS[code];
      setError(key ? t(key) : err instanceof Error && err.message ? err.message : t("genericError"));
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  const withEmail = () => run(async () => {
    const auth = firebaseAuth();
    const { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } =
      await import("firebase/auth");

    if (mode === "signUp") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
      // Forced refresh: the token minted a moment ago predates the display name, and
      // the server reads the name from the token when it creates the user's record.
      await openSession(await credential.user.getIdToken(true));
      return;
    }

    const credential = await signInWithEmailAndPassword(auth, email, password);
    await openSession(await credential.user.getIdToken());
  });

  const withGoogle = () => run(async () => {
    const auth = firebaseAuth();
    const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
    const credential = await signInWithPopup(auth, new GoogleAuthProvider());
    await openSession(await credential.user.getIdToken());
  });

  const sendReset = () => run(async () => {
    const { sendPasswordResetEmail } = await import("firebase/auth");
    await sendPasswordResetEmail(firebaseAuth(), email);
    // Said the same way whether or not the address is registered: a different answer
    // would turn this box into a way to test which emails have accounts here.
    setNotice(t("resetSent"));
    setMode("signIn");
  });

  const canSubmit = mode === "reset"
    ? !!email
    : !!email && password.length >= MIN_PASSWORD;

  return (
    <div className="space-y-5">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "reset") sendReset();
          else withEmail();
        }}
      >
        {mode === "signUp" && (
          <div className="space-y-2">
            <Label htmlFor="account-name">{t("nameLabel")}</Label>
            <Input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder={t("namePlaceholder")}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="account-email">{t("emailLabel")}</Label>
          <Input
            id="account-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
            required
            aria-invalid={!!error}
          />
        </div>

        {mode !== "reset" && (
          <div className="space-y-2">
            <Label htmlFor="account-password">{t("passwordLabel")}</Label>
            <Input
              id="account-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signUp" ? "new-password" : "current-password"}
              minLength={MIN_PASSWORD}
              required
              aria-invalid={!!error}
              aria-describedby={mode === "signUp" ? "password-hint" : undefined}
            />
            {mode === "signUp" && (
              <p id="password-hint" className="text-xs text-muted-foreground">
                {t("passwordHint", { min: MIN_PASSWORD })}
              </p>
            )}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={pending || !canSubmit}>
          {pending
            ? t("submitting")
            : t(mode === "signUp" ? "createAccount" : mode === "reset" ? "sendReset" : "signIn")}
        </Button>
      </form>

      {mode !== "reset" && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">{t("or")}</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={withGoogle}>
            {t("withGoogle")}
          </Button>
        </>
      )}

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        {mode === "signIn" ? (
          <>
            <button type="button" className="text-primary hover:underline" onClick={() => setMode("signUp")}>
              {t("toSignUp")}
            </button>
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => setMode("reset")}>
              {t("toReset")}
            </button>
          </>
        ) : (
          <button type="button" className="text-primary hover:underline" onClick={() => setMode("signIn")}>
            {t("toSignIn")}
          </button>
        )}
      </div>
    </div>
  );
}
