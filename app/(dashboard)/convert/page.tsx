import { getTranslations } from "next-intl/server";
import Converter from "./Converter";

export default async function ConvertPage() {
  const t = await getTranslations("convert");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">{t("pdfTitle")}</h1>
        <p className="max-w-[62ch] text-sm text-muted-foreground">{t("pdfIntro")}</p>
      </div>
      <Converter mode="pdf" />
    </div>
  );
}
