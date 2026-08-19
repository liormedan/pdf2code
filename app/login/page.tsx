import { getTranslations } from "next-intl/server";
import { LogoMark } from "@/components/logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FIREBASE_ENABLED } from "@/src/lib/firebase/client.ts";
import AccountForm from "./AccountForm";
import DevSignIn from "./DevSignIn";

/**
 * One screen, one thing to prove: that you hold an account.
 *
 * A shared beta code used to come first. Removing it means anyone who reaches this URL
 * can create an account, which is the intended trade — who may sign in is now Firebase
 * Authentication's decision, and is configured there rather than here.
 */
export default async function LoginPage() {
  const t = await getTranslations("login");
  const tApp = await getTranslations("app");

  // Read on the server so the button is absent from the production bundle entirely,
  // rather than shipped and hidden with CSS.
  const devLoginAvailable = process.env.NODE_ENV !== "production";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <LogoMark className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{tApp("name")}</h1>
          <p className="text-sm text-balance text-muted-foreground">{t("accountSubtitle")}</p>
        </div>

        {FIREBASE_ENABLED ? (
          <AccountForm />
        ) : (
          <Alert variant="destructive">
            <AlertDescription>{t("accountsUnavailable")}</AlertDescription>
          </Alert>
        )}

        {devLoginAvailable && <DevSignIn />}
      </div>
    </main>
  );
}
