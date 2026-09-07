/**
 * The queue: documents waiting, the one running, and what came of the rest.
 *
 * **Sequential on purpose.** The engine is one process, and forty documents converted at
 * once would have it competing with itself for the same cores and the same memory while
 * making every individual result arrive later. One at a time also gives cancellation a
 * meaning a person recognises: stop this one, keep the queue.
 *
 * Cancelling the running item stops the queue rather than skipping ahead. Someone who
 * presses cancel during a batch almost never means "and carry on with the next forty".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  engineCall,
  engineCancel,
  HUNG,
  newJobId,
  onProgress,
  outputDir,
  type ConversionResult,
  type PickedDocument,
  type Progress,
} from "@/lib/engine";
import { recordProject } from "@/lib/projects";

export type ItemState = "waiting" | "running" | "done" | "failed" | "cancelled";

export interface QueueItem {
  /** The path, which is also what makes a document unique in the queue. */
  key: string;
  document: PickedDocument;
  state: ItemState;
  progress: Progress | null;
  result: ConversionResult | null;
  error: string | null;
  /** Seconds the conversion took, once it has finished. */
  took: number | null;
}

export interface ConversionSettings {
  formats: ("html" | "react")[];
  background: boolean;
}

const asItem = (document: PickedDocument): QueueItem => ({
  key: document.path,
  document,
  state: "waiting",
  progress: null,
  result: null,
  error: null,
  took: null,
});

export function useConversions(settings: ConversionSettings, onRecorded: () => void) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);

  // The job the progress listener should attribute events to. A ref because the
  // subscription is made once and must not be torn down between queue items.
  const activeJob = useRef<string | null>(null);
  const activeKey = useRef<string | null>(null);
  // Set when someone cancels, read by the loop to decide whether to carry on.
  const stopped = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let gone = false;

    void onProgress((progress) => {
      if (progress.id !== activeJob.current) return;
      const key = activeKey.current;
      setItems((current) =>
        current.map((item) => (item.key === key ? { ...item, progress } : item)),
      );
    }).then((stop) => {
      if (gone) stop();
      else unlisten = stop;
    });

    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  const add = useCallback((documents: PickedDocument[]) => {
    if (documents.length === 0) return;
    setItems((current) => {
      // The same document dropped twice is one entry. Converting it twice by accident
      // produces two output folders and no useful difference between them.
      const known = new Set(current.map((item) => item.key));
      return [...current, ...documents.filter((d) => !known.has(d.path)).map(asItem)];
    });
  }, []);

  const remove = useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  /** Drop everything that has already finished, keeping what has not run. */
  const clearFinished = useCallback(() => {
    setItems((current) => current.filter((item) => item.state === "waiting"));
  }, []);

  const patch = useCallback((key: string, change: Partial<QueueItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    stopped.current = false;

    // Read the queue from state at the moment the run starts. Anything added while it
    // runs waits for the next press rather than extending a batch under way.
    const pending = items.filter((item) => item.state === "waiting");

    for (const item of pending) {
      if (stopped.current) {
        patch(item.key, { state: "cancelled" });
        continue;
      }

      const started = performance.now();
      patch(item.key, { state: "running", progress: null, error: null, result: null });

      try {
        const id = await newJobId();
        activeJob.current = id;
        activeKey.current = item.key;

        const out = await outputDir(item.document.path);
        const result = await engineCall<ConversionResult>(id, "convert", {
          path: item.document.path,
          out,
          formats: settings.formats,
          background: settings.background,
        });

        patch(item.key, {
          state: "done",
          result,
          progress: null,
          took: (performance.now() - started) / 1000,
        });

        // Recorded only on success. A history full of failures is a log, and this is
        // meant to be a list of things somebody can open again.
        await recordProject({
          source: item.document.path,
          name: item.document.name,
          size: item.document.size,
          pages: result.info.converted,
          out: result.out,
          formats: settings.formats.join(","),
          lang: result.info.lang,
        });
        onRecorded();
      } catch (error) {
        const message = String(error);
        // A cancel is not a failure. A hang is, but it is a failure of the engine rather
        // than of this document, so it stops the batch the way a cancel does — the next
        // thirty-nine would each wait two minutes to fail the same way.
        const cancelled = message.includes("CANCELLED");
        const hung = message.includes(HUNG);
        // The engine returns a code and the window owns the sentence, in whichever
        // language it is running in. Until sprint 4 every unopenable document arrived
        // as INTERNAL carrying PDFium's own words, so there was nothing to word.
        const reason = message.includes("UNREADABLE")
          ? "itemUnreadable"
          : message.includes("UNWRITABLE")
            ? "itemUnwritable"
            : message.includes("ENCRYPTED")
              ? "itemEncrypted"
              : null;
        patch(item.key, {
          state: cancelled ? "cancelled" : "failed",
          error: cancelled ? null : reason ? `${reason}|${message}` : message,
          progress: null,
          took: (performance.now() - started) / 1000,
        });
        // A cancel stops the batch, and so does a hung engine. One document the engine
        // could not open says nothing about the next thirty-nine; an engine that stopped
        // answering says everything about them.
        if (cancelled || hung) stopped.current = true;
      } finally {
        activeJob.current = null;
        activeKey.current = null;
      }
    }

    setRunning(false);
  }, [items, running, settings, patch, onRecorded]);

  const cancel = useCallback(() => {
    stopped.current = true;
    if (activeJob.current) void engineCancel(activeJob.current);
  }, []);

  return { items, add, remove, clearFinished, run, cancel, running };
}
