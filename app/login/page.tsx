import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { FileType2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GATE_COOKIE, verifySession } from "@/src/lib/auth.ts";
import { FIREBASE_ENABLED } from "@/src/lib/firebase/client.ts";
import AccessForm from "./AccessForm";
import AccountForm from "./AccountForm";
import DevSignIn from "./DevSignIn";

/**
 * Two gates, one screen.
 *
 * The shared beta code comes first and proves only that this browser was let in; the
 * account comes second and is the actual identity. Which step shows is decided here on
 * the server from the gate cookie, so the sign-in form is not even sent to a browser
 * that has not passed the code.
 */
export default async function LoginPage() {
  const t = await getTranslations("login");
  const tApp = await getTranslations("app");

  const store = await cookies();
  const pastGate = await verifySession(store.get(GATE_COOKIE)?.value, process.env.SESSION_SECRET);

  // Read on the server so the button is absent from the production bundle entirely,
  // rather than shipped and hidden with CSS.
  const devLoginAvailable = process.env.NODE_ENV !== "production";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <FileType2 className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{tApp("name")}</h1>
          <p className="text-sm text-balance text-muted-foreground">
            {pastGate ? t("accountSubtitle") : t("subtitle")}
          </p>
        </div>

        {!pastGate ? (
          <AccessForm />
        ) : FIREBASE_ENABLED ? (
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
