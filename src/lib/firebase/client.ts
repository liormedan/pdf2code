// Firebase in the browser: accounts only.
//
// Auth is the whole of it. There is no Storage bucket in this configuration and no
// `storageBucket` key below, which is not an omission — documents are never uploaded,
// so there is nothing for a bucket to hold. Firestore is read directly by the client
// from the project screens; that arrives with the projects work, not here.
//
// The values are public by design. A Firebase web config identifies the project, it
// does not authorise anything — access is decided by Auth and by security rules.

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/**
 * The configuration, or null when this deployment has none.
 *
 * Each variable is read as a literal member of process.env because that is what the
 * bundler substitutes at build time — a computed lookup would be undefined in the
 * browser.
 */
export function firebaseConfig(): FirebaseConfig | null {
  // Trimmed because these are baked in at build time from whatever the hosting
  // dashboard holds. A trailing newline survives into the bundle and turns authDomain
  // into a host that does not exist, which surfaces only as a failed sign-in popup.
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();

  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId };
}

/** Whether accounts are available at all. Fixed at build time, like the config. */
export const FIREBASE_ENABLED = firebaseConfig() !== null;

function firebaseApp(): FirebaseApp {
  const config = firebaseConfig();
  if (!config) throw new Error("Firebase is not configured on this deployment.");
  // getApps() rather than a module-level flag: Next remounts modules across HMR, and a
  // second initializeApp with the same name throws.
  return getApps().length ? getApp() : initializeApp(config);
}

export function firebaseAuth(): Auth {
  return getAuth(firebaseApp());
}
