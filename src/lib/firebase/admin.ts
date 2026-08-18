// Firebase on the server: verifying who someone is, and recording that they exist.
//
// Server-only, and it holds a service account — a credential that can read and write
// the whole project, bypassing every security rule. It must never be imported from a
// client component, and its variable must never be prefixed NEXT_PUBLIC. The guard
// below turns a mistake into an immediate, obvious failure rather than a leak.
//
// firebase-admin does not run on the Edge, which is why nothing here is reachable from
// middleware. It is used once per sign-in, in a Node route handler, and after that the
// signed cookie from src/lib/auth.ts carries the identity.

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

if (typeof window !== "undefined") {
  throw new Error("src/lib/firebase/admin.ts was imported in the browser.");
}

export class AdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminConfigError";
  }
}

/**
 * The service account, decoded from base64.
 *
 * Base64 rather than raw JSON because the private key is multi-line, and every hosting
 * dashboard mangles multi-line values differently. One opaque string survives all of them.
 */
function serviceAccount(): { projectId: string; clientEmail: string; privateKey: string } {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!encoded) throw new AdminConfigError("FIREBASE_SERVICE_ACCOUNT is not set.");

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new AdminConfigError("FIREBASE_SERVICE_ACCOUNT is not base64-encoded JSON.");
  }

  const projectId = parsed.project_id;
  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  if (!projectId || !clientEmail || !privateKey) {
    throw new AdminConfigError("FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key.");
  }

  return { projectId, clientEmail, privateKey };
}

/** Whether the server can verify accounts at all, without throwing to find out. */
export function adminConfigured(): boolean {
  try {
    serviceAccount();
    return true;
  } catch {
    return false;
  }
}

function adminApp(): App {
  // Same reason as the client: a second initializeApp with the same name throws, and
  // route handler modules are re-evaluated across reloads.
  const existing = getApps();
  if (existing.length) return existing[0]!;
  return initializeApp({ credential: cert(serviceAccount()) });
}

export const adminAuth = (): Auth => getAuth(adminApp());
export const adminDb = (): Firestore => getFirestore(adminApp());
