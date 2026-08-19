// What a converted document can come out as, and what it cannot yet.
//
// Two of these ship today. The rest are here so the webpage can ask which one is worth
// building next, and so that question is asked from one list rather than from copy that
// drifts away from the converter.
//
// A note on what belongs here. HTML, React, Vue and Svelte are the same idea — the
// document *becomes* markup you control. Python is not: a script that redraws the
// document with different data is a tool that acts on the document rather than the
// document itself. It sits in this list because people asked for it, but its description
// says plainly what it would be, so nobody clicks expecting a Python page.

export type OutputId = "html" | "react" | "vue" | "svelte" | "python";

export interface OutputKind {
  id: OutputId;
  /** Whether the converter produces this today. */
  shipped: boolean;
}

export const OUTPUTS: OutputKind[] = [
  { id: "html", shipped: true },
  { id: "react", shipped: true },
  { id: "vue", shipped: false },
  { id: "svelte", shipped: false },
  { id: "python", shipped: false },
];

export const SHIPPED = OUTPUTS.filter((o) => o.shipped);
export const PLANNED = OUTPUTS.filter((o) => !o.shipped);

/**
 * Whether a value names something we are collecting interest in.
 *
 * The endpoint stores what this accepts, so it accepts a closed list and nothing else —
 * it is reachable without an account, and free text from an open endpoint is a database
 * of whatever a stranger felt like typing.
 */
export function isPlannedOutput(value: unknown): value is OutputId {
  return typeof value === "string" && PLANNED.some((o) => o.id === value);
}
