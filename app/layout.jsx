import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { directionOf } from "@/src/i18n/config.mjs";
import "./globals.css";

export async function generateMetadata() {
  const t = await getTranslations("app");
  return {
    title: t("name"),
    description: t("tagline"),
  };
}

export default async function RootLayout({ children }) {
  const locale = await getLocale();

  // Direction is derived from the locale, never configured per screen — so adding a
  // right-to-left language needs no layout changes anywhere.
  return (
    <html lang={locale} dir={directionOf(locale)} suppressHydrationWarning>
      <head>
        {/* Applied before first paint so a dark-mode user never sees a white flash.
            Inline because a deferred script is, by definition, too late. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider>
          {children}
          <Toaster position={directionOf(locale) === "rtl" ? "bottom-left" : "bottom-right"} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
