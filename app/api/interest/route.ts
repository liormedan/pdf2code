// Which output to build next, asked of the people who would use it.
//
// A plain form post, answered with a redirect. That is deliberate: the webpage ships no
// client JavaScript, and a button that needed a fetch would have put a bundle on the one
// page a stranger waits for. This works with scripting switched off, too.
//
// It is reachable without an account, so it stores nothing a stranger typed — only which
// of a closed list of names was chosen. Signed in, the vote is one document per account
// per output, which makes a second click idempotent rather than a second vote; anonymous
// votes are a counter, and a counter reachable by anyone is a direction, not a number to
// quote. That is all it is being asked to be.

import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { SESSION_COOKIE, readSession } from "@/src/lib/auth.ts";
import { adminDb } from "@/src/lib/firebase/admin.ts";
import { isPlannedOutput } from "@/src/lib/outputs.ts";

export const runtime = "nodejs";

/**
 * Return to the page the form was on, rather than to a hardcoded path.
 *
 * The button now lives on /about and used to live on /, and pinning the destination
 * meant pressing it silently moved you somewhere else. Only the path of a same-origin
 * referer is taken — a referer is attacker-controllable, so it decides where on this
 * site to land and never which site.
 */
function back(request: Request, query: string): Response {
  let path = "/";
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.origin === new URL(request.url).origin) path = url.pathname;
    } catch {
      // Unparseable referer: fall back to the root rather than trusting it.
    }
  }
  return Response.redirect(new URL(`${path}${query}`, request.url), 303);
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const target = form?.get("target");

  if (!isPlannedOutput(target)) return back(request, "");

  try {
    const db = adminDb();
    const doc = db.collection("interest").doc(target);

    const store = await cookies();
    const session = await readSession(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);

    if (session) {
      // Keyed by account, so clicking twice says the same thing once — and so there is
      // somebody to tell when the output is ready.
      await doc.collection("accounts").doc(session.uid).set(
        { email: session.email, at: new Date() },
        { merge: true },
      );
    }

    await doc.set({ votes: FieldValue.increment(1) }, { merge: true });
  } catch {
    // Saying "noted" when nothing was written would be the one dishonest thing this
    // endpoint could do, so a failure says so instead.
    return back(request, "?interest=failed");
  }

  return back(request, `?noted=${target}`);
}
