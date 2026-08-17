import { getTranslations } from "next-intl/server";
import Converter from "./Converter";

export default async function ConvertPage() {
  const t = await getTranslations("convert");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
      <Converter />
    </div>
  );
}
