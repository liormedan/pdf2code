/**
 * What was converted, and where the result went.
 *
 * Every call here is a named command. **No SQL crosses this boundary** — the window asks
 * for projects, records one, or forgets one, and the store on the Rust side decides what
 * that means. A front end able to send a query is a front end able to read any table.
 *
 * The store holds paths, never contents. See src-tauri/src/projects.rs.
 */

import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "@/lib/engine";

export interface Project {
  id: number;
  source: string;
  name: string;
  size: number;
  pages: number;
  out: string;
  /** Comma-separated; two values do not earn a join table. */
  formats: string;
  lang: string;
  /** Unix seconds. */
  convertedAt: number;
}

export type NewProject = Omit<Project, "id" | "convertedAt">;

/** Whether a project's source is still there, and still the same file. */
export interface SourceState {
  exists: boolean;
  /** Present, but no longer the document that was converted. */
  changed: boolean;
  size: number;
}

export function recordProject(project: NewProject): Promise<number> {
  if (!isDesktop()) return Promise.resolve(0);
  return invoke<number>("record_project", { project });
}

export function listProjects(limit = 200): Promise<Project[]> {
  if (!isDesktop()) return Promise.resolve([]);
  return invoke<Project[]>("list_projects", { limit });
}

/**
 * Remove the row. The output stays on disk — deleting somebody's files because they
 * tidied a list is a surprise, and an irreversible one.
 */
export function forgetProject(id: number): Promise<void> {
  if (!isDesktop()) return Promise.resolve();
  return invoke("forget_project", { id });
}

export function sourceState(source: string, recordedSize: number): Promise<SourceState> {
  if (!isDesktop()) return Promise.resolve({ exists: false, changed: false, size: 0 });
  return invoke<SourceState>("source_state", { source, recordedSize });
}
