/**
 * Two things done to a plan that are worth proving rather than clicking.
 *
 * A plan is a list of leaves, each a page of a file with a `uid` of its own — see
 * workbench.ts, which owns the reducer. These are the operations the context menu added
 * in September 2026 and the reducer calls: they take the list and give back a list, so
 * they can be tested here without the reducer's runtime imports.
 *
 * **No runtime imports**, so `node --test` can load it — see viewer.ts for the rule.
 */

export interface Copyable {
  uid: string;
}

/**
 * The list with a copy of each chosen entry placed right after its original, in order.
 *
 * Copies come from `fresh`, which mints the new uid and copies the rest: two entries
 * with one uid would be one page to React and to the selection, which is the bug that
 * `keepViewing`'s test "two copies of one source page are two pages" already guards
 * against downstream.
 */
export function duplicated<T extends Copyable>(
  present: T[],
  uids: ReadonlySet<string>,
  fresh: (leaf: T) => T,
): T[] {
  const next: T[] = [];
  for (const leaf of present) {
    next.push(leaf);
    if (uids.has(leaf.uid)) next.push(fresh(leaf));
  }
  return next;
}

/**
 * The chosen entries moved to one end, keeping their order among themselves.
 *
 * Not one at a time: moving pages 3 and 5 to the front should give 3, 5, 1, 2, 4 — and
 * moving each to index zero in turn gives 5, 3. The rest keep their order too.
 */
export function movedToEdge<T extends Copyable>(
  present: T[],
  uids: ReadonlySet<string>,
  edge: "start" | "end",
): T[] {
  const chosen = present.filter((leaf) => uids.has(leaf.uid));
  const rest = present.filter((leaf) => !uids.has(leaf.uid));
  return edge === "start" ? [...chosen, ...rest] : [...rest, ...chosen];
}
