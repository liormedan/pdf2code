import AppShell from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/i18n/provider";

export default function App() {
  return (
    <I18nProvider>
      <AppShell />
      {/* Position follows the reading direction, which the provider writes onto <html>. */}
      <Toaster position="bottom-center" />
    </I18nProvider>
  );
}
