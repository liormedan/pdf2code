// What an account is allowed, and how much of it is left.
//
// The unit is a conversion, not a page. That was a real choice: the converter runs in
// the browser, so the server never sees the document and cannot count its pages without
// taking the browser's word for it. A conversion, on the other hand, is something the
// server is asked to record — it can count those itself, and a number it derives is a
// number a quota can rest on.
//
// What this cannot do, and does not pretend to: stop a conversion. The work happens on
// the user's machine with their own file, and nothing served from here can prevent that.
// What a quota actually governs is whether we record the result, whether the interface
// offers to start, and — when there is one — whether a bill is owed. Someone determined
// to edit their own JavaScript keeps their output and loses their history. That is the
// honest shape of the trade, and pretending otherwise would only produce a lock that
// looks stronger than it is.

export interface Plan {
  id: "free";
  /** Conversions per calendar month. */
  conversions: number;
}

/**
 * The only plan so far.
 *
 * Enough to convert a handful of real documents and know whether the output is any good;
 * not so much that there is never a reason to pay. One number, one place.
 */
export const FREE: Plan = { id: "free", conversions: 20 };

export interface Usage {
  /** The month being counted, as YYYY-MM. */
  month: string;
  conversions: number;
  pages: number;
}

export interface Quota {
  plan: Plan["id"];
  used: number;
  limit: number;
  remaining: number;
  /** False once the month's allowance is spent. */
  allowed: boolean;
}

/** Read a usage record into the shape the interface asks about, resetting on a new month. */
export function quotaFor(usage: Usage | undefined, month: string, plan: Plan = FREE): Quota {
  // A count from a month that has passed is not this month's count. The reset happens
  // when it is next written; until then it simply does not apply.
  const used = usage?.month === month ? Math.max(0, usage.conversions ?? 0) : 0;
  const remaining = Math.max(0, plan.conversions - used);

  return {
    plan: plan.id,
    used,
    limit: plan.conversions,
    remaining,
    allowed: remaining > 0,
  };
}
