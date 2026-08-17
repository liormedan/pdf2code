"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * A file handed from one screen to another.
 *
 * The overview invites you to drop a PDF, but the converter lives on a different
 * route — and a File cannot travel in a URL. So the drop parks it here and the
 * converter collects it on arrival. Held in memory only, like everything else about
 * a document in this app.
 */
interface PendingFileValue {
  /** Hand a file to the converter and let the caller navigate. */
  put: (file: File) => void;
  /** Collect the waiting file, if any. Clears it — a reload must not re-convert. */
  take: () => File | null;
  has: boolean;
}

const PendingFileContext = createContext<PendingFileValue | null>(null);

export function PendingFileProvider({ children }: { children: ReactNode }) {
  const slot = useRef<File | null>(null);
  const [has, setHas] = useState(false);

  const put = useCallback((file: File) => {
    slot.current = file;
    setHas(true);
  }, []);

  const take = useCallback(() => {
    const file = slot.current;
    slot.current = null;
    setHas(false);
    return file;
  }, []);

  const value = useMemo(() => ({ put, take, has }), [put, take, has]);

  return <PendingFileContext.Provider value={value}>{children}</PendingFileContext.Provider>;
}

export function usePendingFile(): PendingFileValue {
  const context = useContext(PendingFileContext);
  if (!context) throw new Error("usePendingFile must be used inside PendingFileProvider");
  return context;
}
