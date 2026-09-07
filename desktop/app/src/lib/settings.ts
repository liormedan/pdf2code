/**
 * What the app remembers between launches.
 *
 * The Rust side owns the file — see `settings.rs`, which reads the whole document,
 * changes one field and writes it back. That is not fussiness: two writers of one JSON
 * file are two writers erasing each other's fields, and this app had exactly that bug
 * waiting the moment it gained a second setting.
 *
 * Language and theme are **not** here. They live in the WebView's own storage where the
 * i18n provider and the theme toggle already keep them, and fetching them across the IPC
 * boundary would mean a round trip before the first frame can be painted right-to-left.
 */

import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "@/lib/engine";

export interface StoredSettings {
  outputRoot: string | null;
  formats: ("html" | "react")[];
  background: boolean;
  seenIntro: boolean;
  window: { x: number; y: number; width: number; height: number } | null;
}

/** What the window assumes before the Rust side has answered, and outside the app. */
export const FALLBACK: StoredSettings = {
  outputRoot: null,
  formats: ["html"],
  background: true,
  // Assumed seen, so a browser tab does not open on a first-run card nobody can dismiss.
  seenIntro: true,
  window: null,
};

export async function getSettings(): Promise<StoredSettings> {
  if (!isDesktop()) return FALLBACK;
  try {
    return await invoke<StoredSettings>("get_settings");
  } catch {
    // A settings file that cannot be read is a worse day than a default one.
    return FALLBACK;
  }
}

export function saveDefaults(formats: string[], background: boolean): Promise<void> {
  if (!isDesktop()) return Promise.resolve();
  return invoke("save_defaults", { formats, background });
}

export function markIntroSeen(): Promise<void> {
  if (!isDesktop()) return Promise.resolve();
  return invoke("mark_intro_seen");
}

/** One third-party component, as the About screen states it. */
export interface Credit {
  name: string;
  version: string;
  license: string;
  role: string;
}

/**
 * The licences, from the Rust side rather than a constant in here.
 *
 * They are read from the versions that are actually installed, and they are a legal
 * statement rather than a courtesy — a wrong line is a claim about software we do not
 * ship.
 */
export async function getCredits(): Promise<Credit[]> {
  if (!isDesktop()) return [];
  return (await invoke<Credit[]>("credits")) ?? [];
}

export function appVersion(): Promise<string> {
  if (!isDesktop()) return Promise.resolve("dev");
  return invoke<string>("app_version");
}

// ---------------------------------------------------------------------------
// Disk used by the app's own output — scoped to that folder alone. If somebody chose an
// output root in a native dialog, that folder is theirs to manage; cleaning here never
// touches it. See storage.rs.
// ---------------------------------------------------------------------------

export interface OutputFolder {
  name: string;
  path: string;
  bytes: number;
  ageDays: number;
  /** Still named in the history — cleaning never removes this one. */
  referenced: boolean;
}

export interface StorageSummary {
  path: string;
  bytes: number;
  folders: OutputFolder[];
}

export async function storageSummary(): Promise<StorageSummary | null> {
  if (!isDesktop()) return null;
  try {
    return await invoke<StorageSummary>("storage_summary");
  } catch {
    return null;
  }
}

export interface CleanResult {
  removed: number;
  freedBytes: number;
  keptReferenced: number;
}

/** Delete conversion folders older than `olderThanDays`, except ones the history still names. */
export function cleanOldOutput(olderThanDays: number): Promise<CleanResult> {
  if (!isDesktop()) return Promise.reject(new Error("not running in the app"));
  return invoke<CleanResult>("clean_old_output", { olderThanDays });
}

// ---------------------------------------------------------------------------
// The trouble report. The engine's diagnostics go to its stderr and never to the window,
// because they can quote a document — see report.rs. This is the other half: keep the
// last lines, scrub every path out of them, and let somebody read the whole thing before
// deciding to hand it over.
// ---------------------------------------------------------------------------

/** The report as text, so it can be read before it is written anywhere. */
export function previewReport(): Promise<string> {
  if (!isDesktop()) return Promise.resolve("");
  return invoke<string>("preview_report");
}

/** Write it to a path a save dialog produced. Returns where it went. */
export function exportReport(path: string): Promise<string> {
  if (!isDesktop()) return Promise.reject(new Error("not running in the app"));
  return invoke<string>("export_report", { path });
}
