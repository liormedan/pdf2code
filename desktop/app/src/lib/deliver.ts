/**
 * Getting the output to the person who asked for it.
 *
 * A conversion used to end at a path printed on screen. Everything here is the rest of
 * that sentence: what was written and how big it is, opening the folder, opening the
 * page, packing it into one file, and putting the path on the clipboard.
 *
 * Every call names a path and none of them decides anything. The Rust side refuses a path
 * outside the output directories, and refuses a file whose extension is not one this app
 * could have written — an output root is a folder somebody picked, and a command that
 * opens any file in it is a command that runs any program in it.
 */

import { invoke } from "@tauri-apps/api/core";
import { engineCall, isDesktop, newJobId } from "@/lib/engine";
import { pickSavePath } from "@/lib/workbench";

export interface OutFile {
  name: string;
  size: number;
}

/** What the conversion wrote, with sizes. Empty outside the app. */
export async function listOutput(dir: string): Promise<OutFile[]> {
  if (!isDesktop()) return [];
  return (await invoke<OutFile[]>("list_output", { dir })) ?? [];
}

/** Open a folder, or a file in whatever the system opens it with. */
export function openPath(path: string): Promise<void> {
  if (!isDesktop()) return Promise.reject(new Error("not running in the app"));
  return invoke("open_path", { path });
}

/** Show it in the file manager, selected, rather than opening it. */
export function revealPath(path: string): Promise<void> {
  if (!isDesktop()) return Promise.reject(new Error("not running in the app"));
  return invoke("reveal_path", { path });
}

export interface Archive {
  out: string;
  files: string[];
  bytes: number;
  unpacked: number;
}

/**
 * Pack a conversion's folder into one file, after asking where it goes.
 *
 * Resolves to null when the person cancels the dialog, which is an answer rather than a
 * failure. The dialog is also the only thing that makes the destination writable at all.
 */
export async function zipOutput(dir: string, suggested: string): Promise<Archive | null> {
  const out = await pickSavePath(suggested, "zip");
  if (!out) return null;
  return engineCall<Archive>(await newJobId(), "zip", { path: dir, out, overwrite: true });
}

/**
 * Put the path on the clipboard.
 *
 * The WebView's own API rather than a Tauri plugin: it needs no permission the window
 * does not already have, and a path is not a secret. It can still fail — a WebView with
 * clipboard access denied — so the caller is told rather than left wondering.
 */
export async function copyPath(path: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(path);
    return true;
  } catch {
    return false;
  }
}

/** Bytes as something a person reads. */
export function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
