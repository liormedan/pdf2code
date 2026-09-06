import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/provider";
import { markIntroSeen } from "@/lib/settings";

/**
 * What this is, once.
 *
 * Three sentences on the first launch and never again: what the app does, where the
 * files go, and the claim the whole product rests on. Somebody opening it for the first
 * time otherwise has to convert something to find out where the output lands.
 *
 * Dismissed on this side and remembered on the Rust side, so it does not come back after
 * a WebView clears its storage — which it does, and which would make a one-time card feel
 * like a bug.
 */
export default function IntroCard({ onDone }: { onDone: () => void }) {
  const t = useTranslations("desktop");
  const [going, setGoing] = useState(false);

  const dismiss = () => {
    setGoing(true);
    // The card goes now; the write can take its time. Nobody should watch a disk write
    // to close a greeting.
    void markIntroSeen().finally(onDone);
  };

  return (
    <div className="relative space-y-2 rounded-xl border border-primary/40 bg-accent/40 p-4">
      <Button
        size="icon"
        variant="ghost"
        className="absolute end-2 top-2 size-6"
        aria-label={t("introDismiss")}
        onClick={dismiss}
        disabled={going}
      >
        <X className="size-3.5" />
      </Button>

      <h3 className="pe-8 text-sm font-semibold">{t("introTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("introWhat")}</p>
      <p className="text-xs text-muted-foreground">{t("introWhere")}</p>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
        {t("introLocal")}
      </p>

      <Button size="sm" variant="outline" onClick={dismiss} disabled={going}>
        {t("introGotIt")}
      </Button>
    </div>
  );
}
