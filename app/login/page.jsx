import { getTranslations } from "next-intl/server";
import { FileType2 } from "lucide-react";
import AccessForm from "./AccessForm";

export default async function LoginPage() {
  const t = await getTranslations("login");
  const tApp = await getTranslations("app");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <FileType2 className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{tApp("name")}</h1>
          <p className="text-sm text-muted-foreground text-balance">{t("subtitle")}</p>
        </div>

        {/* Read on the server so the button is absent from the production bundle
            entirely, rather than shipped and hidden with CSS. */}
        <AccessForm devLoginAvailable={process.env.NODE_ENV !== "production"} />
      </div>
    </main>
  );
}
