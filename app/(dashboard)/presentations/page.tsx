import { getTranslations } from "next-intl/server";
import { pptxEnabled } from "@/src/lib/pricing.ts";
import { slidesConfig } from "@/src/lib/google-slides.ts";
import Converter from "../convert/Converter";

/**
 * Presentations get their own route rather than a tab inside the PDF screen.
 *
 * The two intakes differ in a way worth seeing before you hand a document over: a PDF
 * and a Google Slides deck are read in the browser, while a PowerPoint file is uploaded
 * to be converted. A URL of its own also means the screen can be linked to, and that
 * PowerPoint can be absent — rather than present and dead — where it cannot run.
 */
export default async function PresentationsPage() {
  const t = await getTranslations("convert");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">{t("deckTitle")}</h1>
        {/* Only promise what this deployment can actually do. With neither intake
            configured the card below explains the situation, and a cheerful line about
            Google exporting decks would simply be untrue. */}
        {(pptxEnabled() || slidesConfig() !== null) && (
          <p className="max-w-[62ch] text-sm text-muted-foreground">
            {t(pptxEnabled() ? "deckIntroWithPptx" : "deckIntro")}
          </p>
        )}
      </div>
      <Converter mode="presentation" />
    </div>
  );
}
