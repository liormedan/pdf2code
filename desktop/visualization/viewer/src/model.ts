/**
 * The shape of `desktop/visualization/system-map.json`, as the window reads it.
 *
 * Written by hand against the generator rather than derived from it: this is the one place
 * that says what the window expects, and if `sync-system-map.mjs` ever stops producing it,
 * `npm run typecheck` says so at build time instead of the map rendering half empty.
 *
 * Fields carrying `sourceText` are Hebrew whatever the interface language is, because they
 * are quoted out of Hebrew documents. Translating them here would create a second copy to
 * keep true; showing them as they were written cannot go stale.
 */

export type SprintStatus = "done" | "partly" | "blocked" | "open";

export interface Process {
  id: string;
  /** sourceText */
  name: string;
  nameEn: string;
  stack: string[];
  path: string;
  /** sourceText */
  is: string;
  /** sourceText */
  isNot: string;
  source: string;
  parts: { name: string; file: string; does: string }[];
}

export interface Link {
  from: string;
  to: string;
  protocol: string;
  /** sourceText */
  detail: string;
  source: string;
}

export interface Sprint {
  number: number;
  /** sourceText */
  name: string;
  weight: number;
  status: SprintStatus;
  blockedOn: string | null;
  owner: "engineering" | "you";
  items: { done: string[]; open: string[]; deferred: string[] };
}

export interface Blocker {
  id: string;
  name: string;
  detail: string;
  blocks: string;
  who: string;
}

export interface SystemMap {
  generatedBy: string;
  sources: { file: string; sha256: string }[];
  processes: Process[];
  links: Link[];
  flow: { step: string; where: string }[];
  forbidden: { what: string; why: string; source: string }[];
  capabilities: {
    name: string;
    state: "built" | "planned" | "out-of-scope";
    where: string;
    source: string;
  }[];
  sprints: Sprint[];
  blockers: Blocker[];
  waitingOnYou: { sprint: number | null; what: string; need: string; after: string }[];
  decisions: {
    decided: { title: string; date: string; who: string }[];
    open: { index: number; title: string; blocks: number[]; urgent: boolean; moot: boolean }[];
  };
  progress: { closed: number; reached: number; done: number; total: number };
}

/** What the inspector is showing. Shared between the canvas and the list beside it. */
export type Selection =
  | { kind: "process"; id: string }
  | { kind: "part"; id: string; part: string }
  | { kind: "sprint"; id: string }
  | { kind: "decision"; id: string };

/**
 * The four states, and the token each one borrows.
 *
 * No new colours: every one of these is already measured by `check-a11y` in both themes,
 * so a status here cannot quietly introduce a contrast failure. **Each is also always
 * accompanied by its own word** — the legend and every row name the state in text, because
 * a map that distinguishes "blocked" from "done" by hue alone is unreadable to a good
 * number of the people who would most want to read it.
 */
export const TONE: Record<SprintStatus, { text: string; border: string; dot: string }> = {
  done: { text: "text-primary", border: "border-primary", dot: "bg-primary" },
  partly: { text: "text-warning", border: "border-warning", dot: "bg-warning" },
  blocked: { text: "text-destructive", border: "border-destructive", dot: "bg-destructive" },
  open: { text: "text-muted-foreground", border: "border-divider", dot: "bg-muted-foreground" },
};
