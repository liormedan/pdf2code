import { useState } from "react";
import { ArrowRight, ExternalLink, FileCode2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import OutputPreview from "@/components/output-preview";
import { useTranslations } from "@/i18n/provider";
import { openPath } from "@/lib/deliver";

/**
 * The converted document, filling the window.
 *
 * There has been a preview since sprint 4, but it lived inside the conversion panel —
 * one column of three, so about a third of the width. That is the right size for
 * confirming a conversion worked and the wrong size for reading what came out of it,
 * which is why "open the page" meant leaving for a browser.
 *
 * **Opening it here removes a whole class of failure.** Handing a path to the operating
 * system depends on the default handler for `.html`, on that program resolving the path,
 * and on nothing between us and it changing its mind. None of that is involved in
 * rendering the file we just wrote in a frame we control.
 *
 * The browser stays as a second button, and deliberately: this product's claim is that
 * the output is a standalone page that opens anywhere. Being able to prove that in a real
 * browser is worth a click, and a preview of our own is not evidence for it.
 */
export default function PreviewScreen({
  dir,
  files,
  onBack,
}: {
  dir: string;
  files: string[];
  onBack: () => void;
}) {
  const t = useTranslations("desktop");
  const showable = files.filter((name) => /\.(html?|jsx|tsx)$/i.test(name));
  const [shown, setShown] = useState(showable[0] ?? "index.html");
  const [problem, setProblem] = useState<string | null>(null);

  const separator = dir.includes("\\") ? "\\" : "/";
  const openOutside = () => {
    setProblem(null);
    openPath(`${dir}${separator}${shown}`).catch((error) => setProblem(String(error)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          {/* An arrow that follows the text: in Hebrew "back" points the other way. */}
          <ArrowRight className="size-4 rtl:rotate-0 ltr:rotate-180" />
          {t("previewBack")}
        </Button>

        {showable.length > 1 ? (
          <div className="flex items-center gap-0.5 rounded-lg border border-divider p-0.5">
            {showable.map((name) => (
              <Button
                key={name}
                size="sm"
                variant={name === shown ? "secondary" : "ghost"}
                aria-pressed={name === shown}
                onClick={() => setShown(name)}
              >
                {/\.html?$/i.test(name) ? (
                  <FileText className="size-4" />
                ) : (
                  <FileCode2 className="size-4" />
                )}
                {name}
              </Button>
            ))}
          </div>
        ) : null}

        <span className="flex-1" />

        <Button size="sm" variant="outline" onClick={openOutside}>
          <ExternalLink className="size-4" />
          {t("previewInBrowser")}
        </Button>
      </div>

      {problem ? (
        <p role="alert" className="text-[11px] text-destructive">
          {problem}
        </p>
      ) : null}

      {/* The preview component owns the sandbox and the source view; this screen only
          decides how much room it gets, which turns out to be the part that mattered. */}
      <OutputPreview dir={dir} file={shown} />

      <p className="font-mono text-[11px] break-all text-muted-foreground">{dir}</p>
    </div>
  );
}
