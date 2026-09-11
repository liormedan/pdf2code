/**
 * The one rule of the conversion queue that is worth proving: **a result lands on the
 * run that asked for it, and on nothing else.**
 *
 * Items are keyed by document path, so the same document dropped twice is one entry.
 * That key is not enough to route a result: remove a document while it converts, drop
 * it in again, and the second entry has the first entry's key — and the first entry's
 * result, arriving late, would have marked the new one done with the old folder under
 * it. So every entry also carries a `run`, minted once and never reused, and a patch
 * names both. A late result then finds nothing to land on, which is the right answer.
 *
 * **No runtime imports**, so `node --test` can load it — see viewer.ts for the rule.
 */

export interface Keyed {
  key: string;
  run: number;
}

let minted = 0;

/** A run identity nobody else will ever get. */
export function nextRun(): number {
  minted += 1;
  return minted;
}

/**
 * The list with one entry changed — the entry that is both this key and this run.
 *
 * Returns the same array when nothing matched, so a late patch is not even a re-render.
 */
export function applyPatch<T extends Keyed>(items: T[], key: string, run: number, change: Partial<T>): T[] {
  let touched = false;
  const next = items.map((item) => {
    if (item.key !== key || item.run !== run) return item;
    touched = true;
    return { ...item, ...change };
  });
  return touched ? next : items;
}
