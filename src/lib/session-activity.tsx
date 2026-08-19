"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { OutputFormat } from "@/src/converter/types.ts";
import type { SourceKind } from "./pricing.ts";
import type { Quota } from "./plans.ts";
import type { Project, ProjectDraft } from "./projects.ts";

export interface ActivityEntry {
  id: string;
  at: number;
  name: string;
  /** Where the document came from. Decides what re-running it can even mean. */
  kind: SourceKind;
  /** Set only for a Slides deck — the one source that can be fetched again unaided. */
  driveFileId?: string;
  /** What was picked last time, for recognising the file if it has to be picked again. */
  sourceSize?: number;
  pages: number;
  formats: OutputFormat[];
  background: boolean;
  bytes: number;
}

export interface ActivityTotals {
  conversions: number;
  pages: number;
  bytes: number;
}

interface ActivityContextValue {
  entries: ActivityEntry[];
  record: (draft: ProjectDraft) => void;
  rename: (id: string, name: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  totals: ActivityTotals;
  /** This month's allowance, as the server counts it. Null until the first load. */
  quota: Quota | null;
  /** True until the first load finishes, so a screen can tell empty from not-yet-known. */
  loading: boolean;
}

/**
 * Conversion history, kept with the account.
 *
 * It used to live in React state and nowhere else, so closing the tab left nothing
 * behind. That was the right default while there were no accounts; now that there are,
 * a history that evaporates on refresh is a bug rather than a promise — and the promise
 * that actually matters is untouched, because a project record holds a name, a page
 * count and a date, never the document.
 *
 * The name is the sensitive part of that record, which is why `keepFileNames` exists and
 * why it is applied on the server when the row is written. See src/lib/projects.ts.
 *
 * The shape below is deliberately the one the screens already consumed, so moving the
 * storage changed no screen.
 */
const ActivityContext = createContext<ActivityContextValue | null>(null);

const asEntry = (p: Project): ActivityEntry => ({
  id: p.id,
  at: p.lastConvertedAt,
  name: p.name,
  kind: p.kind,
  driveFileId: p.driveFileId,
  sourceSize: p.sourceSize,
  pages: p.pages,
  formats: p.formats,
  background: p.background,
  bytes: p.outputBytes,
});

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) return;
      const body = await response.json() as { projects?: Project[]; quota?: Quota };
      setEntries((body.projects ?? []).map(asEntry));
      if (body.quota) setQuota(body.quota);
    } catch {
      // An unreachable server should leave the last known list on screen rather than
      // blanking it — nothing here is worth interrupting a conversion for.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const record = useCallback<ActivityContextValue["record"]>((draft) => {
    // Shown immediately under a temporary id, then replaced by what the server actually
    // stored — which may carry a different name, if this account keeps none.
    const optimistic: ActivityEntry = {
      id: `pending-${crypto.randomUUID()}`,
      at: Date.now(),
      name: draft.name,
      kind: draft.kind,
      driveFileId: draft.driveFileId,
      sourceSize: draft.sourceSize,
      pages: draft.pages,
      formats: draft.formats,
      background: draft.background,
      bytes: draft.outputBytes,
    };
    setEntries((current) => [optimistic, ...current]);

    void (async () => {
      try {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        // A refusal carries the quota that caused it, so the interface can say why
        // rather than only that something went wrong.
        const body = await response.json().catch(() => null) as { quota?: Quota } | null;
        if (body?.quota) setQuota(body.quota);
        if (!response.ok) throw new Error(String(response.status));
        await load();
      } catch {
        // Drop the optimistic row rather than leave a conversion listed that was never
        // saved: a list that lies about what survived is worse than a short one.
        setEntries((current) => current.filter((e) => e.id !== optimistic.id));
      }
    })();
  }, [load]);

  /**
   * Apply a change locally first, then confirm it with the server.
   *
   * Every one of these is a direct manipulation of a row the person is looking at, so a
   * round trip before anything moves reads as a broken button. A failure puts the list
   * back the way the server has it rather than leaving a lie on screen.
   */
  const mutate = useCallback(async (
    optimistic: (current: ActivityEntry[]) => ActivityEntry[],
    request: () => Promise<Response>,
  ) => {
    setEntries(optimistic);
    try {
      const response = await request();
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      await load();
    }
  }, [load]);

  const rename = useCallback((id: string, name: string) => mutate(
    (current) => current.map((e) => (e.id === id ? { ...e, name } : e)),
    () => fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  ), [mutate]);

  const archive = useCallback((id: string) => mutate(
    (current) => current.filter((e) => e.id !== id),
    () => fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    }),
  ), [mutate]);

  const remove = useCallback((id: string) => mutate(
    (current) => current.filter((e) => e.id !== id),
    () => fetch(`/api/projects/${id}`, { method: "DELETE" }),
  ), [mutate]);

  const clear = useCallback(async () => {
    const response = await fetch("/api/projects", { method: "DELETE" });
    if (response.ok) setEntries([]);
  }, []);

  const totals = useMemo<ActivityTotals>(
    () => ({
      conversions: entries.length,
      pages: entries.reduce((n, e) => n + e.pages, 0),
      bytes: entries.reduce((n, e) => n + e.bytes, 0),
    }),
    [entries],
  );

  const value = useMemo(
    () => ({ entries, record, rename, archive, remove, clear, totals, quota, loading }),
    [entries, record, rename, archive, remove, clear, totals, quota, loading],
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity(): ActivityContextValue {
  const context = useContext(ActivityContext);
  if (!context) throw new Error("useActivity must be used inside ActivityProvider");
  return context;
}
