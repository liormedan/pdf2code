"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { OutputFormat } from "@/src/converter/types.ts";

export interface ActivityEntry {
  id: string;
  at: number;
  name: string;
  pages: number;
  formats: OutputFormat[];
  bytes: number;
}

export interface ActivityTotals {
  conversions: number;
  pages: number;
  bytes: number;
}

interface ActivityContextValue {
  entries: ActivityEntry[];
  record: (entry: Omit<ActivityEntry, "id" | "at">) => void;
  clear: () => void;
  totals: ActivityTotals;
}

/**
 * Conversion history for the current tab.
 *
 * Held in React state on purpose — not localStorage, not a server, not IndexedDB. The
 * promise the product makes is that nothing about a document is kept, and a history
 * that survives a refresh is a record of what someone converted. Closing the tab
 * should genuinely leave nothing behind.
 */
const ActivityContext = createContext<ActivityContextValue | null>(null);

const MAX_ENTRIES = 50;

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  const record = useCallback<ActivityContextValue["record"]>((entry) => {
    setEntries((current) => [
      { ...entry, id: crypto.randomUUID(), at: Date.now() },
      ...current,
    ].slice(0, MAX_ENTRIES));
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const totals = useMemo<ActivityTotals>(
    () => ({
      conversions: entries.length,
      pages: entries.reduce((n, e) => n + e.pages, 0),
      bytes: entries.reduce((n, e) => n + e.bytes, 0),
    }),
    [entries],
  );

  const value = useMemo(() => ({ entries, record, clear, totals }), [entries, record, clear, totals]);

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity(): ActivityContextValue {
  const context = useContext(ActivityContext);
  if (!context) throw new Error("useActivity must be used inside ActivityProvider");
  return context;
}
