/**
 * The engine, as the window sees it.
 *
 * Four calls and one subscription. Notably absent: any way to spawn, kill, or read the
 * engine's output directly — the front end names a job and listens for progress, and
 * everything else happens on the Rust side. That is the boundary from
 * desktop/architecture.md §1, expressed as an API rather than as a rule someone has to
 * remember.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** ConversionProgress["phase"] from src/converter/types.ts. Copied, not invented. */
export type Phase = "extract" | "render" | "generate";

export interface Progress {
  id: string;
  page: number;
  pages: number;
  phase: Phase;
}

export type EngineStatus =
  | { state: "down"; reason: string }
  | { state: "up"; protocol: number; python: string; ops: string[] };

/** What the engine returns when a job ends badly. `CANCELLED` is not bad news. */
export interface EngineError {
  type: "error";
  code: string;
  message: string;
}

/**
 * Whether we are inside the app rather than a plain browser tab.
 *
 * `npm run dev` serves this to a browser, where there is no Tauri and every `invoke`
 * rejects. The shell uses this to say "not running in the app" instead of showing an
 * engine failure that is really just a development convenience.
 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Outside the app there is nothing to call, and every entry point below says so in the
 * shape its caller expects rather than letting Tauri's own internals throw.
 *
 * This is not defensive padding: `npm run dev` serving to a browser is a documented
 * workflow in the README, and the first version of this file guarded only some of the
 * calls — which produced a shell that rendered correctly while two unhandled rejections
 * piled up in the console from `listen`.
 */
const OFFLINE: EngineStatus = { state: "down", reason: "not running in the app" };

function unavailable<T>(): Promise<T> {
  return Promise.reject(new Error("engine is only available inside the app"));
}

export async function engineStatus(): Promise<EngineStatus> {
  if (!isDesktop()) return OFFLINE;
  return invoke<EngineStatus>("engine_status");
}

/** An id minted by the Rust side, needed *before* the call so the job can be cancelled. */
export function newJobId(): Promise<string> {
  if (!isDesktop()) return unavailable<string>();
  return invoke<string>("engine_job_id");
}

/**
 * Run one job and wait for it to end.
 *
 * Rejects on `error`, including `CANCELLED` — the caller decides that a cancellation
 * is not a failure, because only the caller knows whether it asked for one.
 */
export function engineCall<T = unknown>(id: string, op: string, args: unknown = {}): Promise<T> {
  if (!isDesktop()) return unavailable<T>();
  return invoke<T>("engine_call", { id, op, args });
}

export function engineCancel(id: string): Promise<void> {
  if (!isDesktop()) return unavailable<void>();
  return invoke("engine_cancel", { id });
}

/** Unsubscribing from a subscription that was never made. */
const NOOP: UnlistenFn = () => {};

/** Progress for every job. Filter by id — one window can run more than one. */
export function onProgress(handler: (p: Progress) => void): Promise<UnlistenFn> {
  if (!isDesktop()) return Promise.resolve(NOOP);
  return listen<Progress>("engine://progress", (event) => handler(event.payload));
}

// ---------------------------------------------------------------------------
// Documents. Both of these are decisions the Rust side makes — which file may be
// read, and where output is allowed to land — so the window asks rather than acts.
// ---------------------------------------------------------------------------

export interface PickedDocument {
  path: string;
  name: string;
  size: number;
}

/** Opens the native picker. Resolves to null when the person cancels. */
export async function pickDocument(): Promise<PickedDocument | null> {
  if (!isDesktop()) return null;
  return (await invoke<PickedDocument | null>("pick_document")) ?? null;
}

/** The same picker, several files at once. Empty when the person cancels. */
export async function pickDocuments(): Promise<PickedDocument[]> {
  if (!isDesktop()) return [];
  return (await invoke<PickedDocument[]>("pick_documents")) ?? [];
}

/**
 * Describe a path the window already has — dropped on the window, or read back from a
 * saved project. Resolves to null for anything that is not a readable PDF, which is how
 * a drag and drop carrying a spreadsheet gets refused before the engine sees it.
 */
export async function describeDocument(path: string): Promise<PickedDocument | null> {
  if (!isDesktop()) return null;
  return (await invoke<PickedDocument | null>("describe_document", { path })) ?? null;
}

/**
 * Where output goes, if a folder was chosen.
 *
 * The preference lives on the Rust side rather than here. If the window held it, it
 * would have to pass a path into `outputDir`, and a command that creates a directory
 * wherever the front end says is a write primitive nobody asked for.
 */
export async function outputRoot(): Promise<string | null> {
  if (!isDesktop()) return null;
  return (await invoke<string | null>("output_root")) ?? null;
}

export async function pickOutputRoot(): Promise<string | null> {
  if (!isDesktop()) return null;
  return (await invoke<string | null>("pick_output_root")) ?? null;
}

export function clearOutputRoot(): Promise<void> {
  if (!isDesktop()) return Promise.resolve();
  return invoke("clear_output_root");
}

export function outputDir(source: string): Promise<string> {
  if (!isDesktop()) return unavailable<string>();
  return invoke<string>("output_dir", { source });
}

/**
 * Read one file from a conversion's output, for previewing.
 *
 * Rejects for a path outside the conversions directory, and for a file too large to be
 * worth pushing through the IPC boundary. Both refusals happen on the Rust side — the
 * window asks, it does not decide.
 */
export function readOutput(path: string): Promise<string> {
  if (!isDesktop()) return unavailable<string>();
  return invoke<string>("read_output", { path });
}

/** What `probe` reports about a document before anything is converted. */
export interface Probe {
  pages: number;
  chars: number;
  rtl: number;
  fonts: string[];
  scanned: boolean;
}

/** A warning carries a code and its parameters, never a sentence — the window words it. */
export interface Warning {
  code: "SCANNED" | "GRAPHICS_DROPPED" | "TRUNCATED" | "UNMAPPED_GLYPHS";
  params: Record<string, string | number>;
  message: string;
}

export interface ConversionResult {
  out: string;
  /** Names, not contents. The output is on disk; see architecture.md §2. */
  files: string[];
  info: {
    pages: number;
    converted: number;
    title: string;
    scanned: boolean;
    hasRTL: boolean;
    lang: string;
    dir: "ltr" | "rtl";
  };
  warnings: Warning[];
}

/** Fires when the engine announces itself, and again if it stops. */
export function onStatus(handler: (s: EngineStatus) => void): Promise<UnlistenFn> {
  if (!isDesktop()) return Promise.resolve(NOOP);
  return listen<EngineStatus>("engine://status", (event) => handler(event.payload));
}
