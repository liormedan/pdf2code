"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Conversion history for the current tab.
 *
 * Held in React state on purpose — not localStorage, not a server, not IndexedDB. The
 * promise the product makes is that nothing about a document is kept, and a history
 * that survives a refresh is a record of what someone converted. Closing the tab
 * should genuinely leave nothing behind.
 */
const ActivityContext = createContext(null);

export function ActivityProvider({ children }) {
  const [entries, setEntries] = useState([]);

  const record = useCallback((entry) => {
    setEntries((current) => [
      { ...entry, id: crypto.randomUUID(), at: Date.now() },
      ...current,
    ].slice(0, 50));
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const totals = useMemo(
    () => ({
      conversions: entries.length,
      pages: entries.reduce((n, e) => n + (e.pages ?? 0), 0),
      bytes: entries.reduce((n, e) => n + (e.bytes ?? 0), 0),
    }),
    [entries],
  );

  const value = useMemo(() => ({ entries, record, clear, totals }), [entries, record, clear, totals]);

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const context = useContext(ActivityContext);
  if (!context) throw new Error("useActivity must be used inside ActivityProvider");
  return context;
}
