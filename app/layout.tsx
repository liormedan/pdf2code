import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { directionOf } from "@/src/i18n/config.ts";
import "./globals.css";

export async function generateMetadata() {
  const t = await getTranslations("app");
  return {
    title: t("name"),
    description: t("tagline"),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();

  // Direction is derived from the locale, never configured per screen — so adding a
  // right-to-left language needs no layout changes anywhere.
  return (
    <html lang={locale} dir={directionOf(locale)} suppressHydrationWarning>
      <head>
        {/* Applied before first paint so nobody sees a white flash. Inline because a
            deferred script is, by definition, too late.

            Dark is the default: with nothing stored, the app opens dark whatever the
            operating system prefers. Following the OS is still available, but it is now
            a choice someone makes rather than the fallback — which is why "system" is
            written to storage instead of clearing it. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t?(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)):true;document.documentElement.classList.toggle('dark',d);}catch(e){document.documentElement.classList.add('dark');}})();`,
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
