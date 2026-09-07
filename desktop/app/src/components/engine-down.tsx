import { useCallback, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/provider";
import { restartEngine } from "@/lib/engine";

/**
 * What the window says when the engine is not there, and the one button that can fix it.
 *
 * Both the converter and the workbench refuse to work without an engine, and both used to
 * say so and stop — the advice was "close the app and open it again", which works and is a
 * strange thing to ask of somebody already sitting in front of a screen with buttons on
 * it. Restarting the engine is a subprocess being killed and spawned; the window does not
 * need to go with it.
 *
 * The status this renders against is not passed back from the restart. The Rust side
 * emits a status event when the new engine announces itself, and the shell is already
 * listening — so the panel comes back on its own, the same way it does when the engine
 * comes up at launch.
 */
export default function EngineDown() {
  const t = useTranslations("desktop");
  const [restarting, setRestarting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const restart = useCallback(async () => {
    setRestarting(true);
    setFailed(null);
    try {
      const status = await restartEngine();
      // An engine that comes back down came back with a reason, and the reason is more
      // useful than the fact.
      if (status.state !== "up") setFailed(status.reason);
    } catch (error) {
      setFailed(String(error));
    } finally {
      setRestarting(false);
    }
  }, []);

  return (
    // `alert` rather than `status`: the engine going down changes what every button in
    // the window will do next, and finding that out on the next click is finding it out
    // too late.
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-warning/40 bg-warning-muted px-3 py-2"
    >
      <p className="text-xs text-warning">{t("engineDownHelp")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void restart()} disabled={restarting}>
          {restarting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCw className="size-4" />
          )}
          {t("engineRestart")}
        </Button>
        {failed ? <span className="text-[11px] text-warning">{failed}</span> : null}
      </div>
    </div>
  );
}
