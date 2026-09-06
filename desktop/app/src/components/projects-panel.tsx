import { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/provider";
import { describeDocument, type PickedDocument } from "@/lib/engine";
import { forgetProject, listProjects, sourceState, type Project } from "@/lib/projects";

/**
 * What has been converted, and what it would take to do it again.
 *
 * The store keeps paths, never contents — so a project is a claim about a file that was
 * somewhere at some point, and the interesting question is whether that claim still
 * holds. Two ways it can fail, and they need different answers: the file is gone, or the
 * file is there and is no longer the same file. Converting the second one silently would
 * produce output that does not match what this list says it is.
 *
 * Size is what tells them apart. A hash would be certain, and would also mean reading
 * every document in the list to draw it.
 */
export default function ProjectsPanel({
  reloadKey,
  onReRun,
  busy,
}: {
  /** Bumped by the queue after a conversion is recorded. */
  reloadKey: number;
  onReRun: (document: PickedDocument) => void;
  busy: boolean;
}) {
  const t = useTranslations("desktop");
  const [projects, setProjects] = useState<Project[]>([]);
  const [states, setStates] = useState<Record<number, { exists: boolean; changed: boolean }>>({});

  const load = useCallback(async () => {
    const rows = await listProjects();
    setProjects(rows);

    const checked = await Promise.all(
      rows.map(async (p) => [p.id, await sourceState(p.source, p.size)] as const),
    );
    setStates(Object.fromEntries(checked.map(([id, s]) => [id, s])));
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const reRun = useCallback(
    async (project: Project) => {
      const described = await describeDocument(project.source);
      if (described) onReRun(described);
    },
    [onReRun],
  );

  const forget = useCallback(
    async (id: number) => {
      await forgetProject(id);
      await load();
    },
    [load],
  );

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="text-sm text-muted-foreground">{t("projectsEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          {t("projectsRefresh")}
        </Button>
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
        {projects.map((project) => {
          const state = states[project.id];
          const missing = state && !state.exists;
          const changed = state?.changed ?? false;

          return (
            <li
              key={project.id}
              className="flex items-start gap-2 rounded-lg border border-divider px-2.5 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{project.name}</span>
                <span className="tabular block text-[11px] text-muted-foreground">
                  {project.pages} · {project.formats} · {when(project.convertedAt)}
                </span>
                {missing ? (
                  <span className="block text-[11px] text-warning">{t("projectsMissing")}</span>
                ) : changed ? (
                  <span className="block text-[11px] text-warning">{t("projectsChanged")}</span>
                ) : null}
              </span>

              <span className="flex shrink-0 gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={t("projectsReRun")}
                  disabled={busy || missing}
                  onClick={() => void reRun(project)}
                >
                  <RotateCw className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={t("projectsForget")}
                  onClick={() => void forget(project.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Coarse on purpose: nobody reads a conversion history to the minute. */
function when(seconds: number): string {
  const date = new Date(seconds * 1000);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
