// Signed cookies, and the two gates they carry.
//
// There are two independent things to prove, so there are two cookies:
//
//   pdf2code_gate     the shared beta access code was entered. Says nothing about who
//                     you are — only that this browser was let past the front door.
//   pdf2code_session  a Firebase account was verified. Carries the uid, which is what
//                     everything user-scoped is keyed on.
//
// The gate is a temporary measure for the beta and can be removed by deleting one
// check; the session is the real identity. Keeping them apart means neither has to
// know about the other, and losing the gate does not log anyone out of their account.
//
// Firebase verifies an account exactly once, at sign-in, in a Node route handler —
// firebase-admin cannot run on the Edge. What middleware sees on every request after
// that is this HMAC, which Web Crypto verifies in either runtime with no network call.

const encoder = new TextEncoder();

const GATE_COOKIE = "pdf2code_gate";
const SESSION_COOKIE = "pdf2code_session";

/** The gate outlives a session deliberately: re-entering the beta code daily is noise. */
const GATE_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export { GATE_COOKIE, SESSION_COOKIE, GATE_TTL_SECONDS, SESSION_TTL_SECONDS };

/** Who is signed in. Mirrors the Firebase account, and nothing more of it than this. */
export interface SessionClaims {
  uid: string;
  email: string | null;
  exp: number;
}

const b64url = {
  encode(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Uint8Array {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(text.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  },
};

/**
 * Compare without leaking length or position through timing.
 * Node's timingSafeEqual is unavailable in the Edge runtime, so this is by hand.
 */
export function constantTimeEqual(a: unknown, b: unknown): boolean {
  const left = encoder.encode(String(a ?? ""));
  const right = encoder.encode(String(b ?? ""));

  // Fold length into the result instead of returning early on a mismatch.
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    // Trimmed here, at the one point the secret becomes a key, so that minting and
    // verifying always derive the same one. readAuthConfig trims, but middleware and
    // the login page read process.env directly — and a value pasted into a hosting
    // dashboard with a trailing newline would otherwise sign with one secret and
    // verify with another. That failure is silent: every cookie simply looks forged.
    encoder.encode(secret.trim()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return b64url.encode(new Uint8Array(signature));
}

/** Mint a signed cookie value carrying these claims and an expiry. */
export async function createToken(
  claims: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const payload = b64url.encode(
    encoder.encode(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })),
  );
  return `${payload}.${await sign(payload, secret)}`;
}

/** Verify a token and return its claims, or null if it is forged, malformed or expired. */
export async function readToken(
  token: string | null | undefined,
  secret: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!token || !secret) return null;

  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return null;

  // Verify the signature before parsing: never trust the payload of an unsigned token.
  if (!constantTimeEqual(signature, await sign(payload, secret))) return null;

  try {
    const claims = JSON.parse(new TextDecoder().decode(b64url.decode(payload)));
    const exp = claims?.exp;
    if (typeof exp !== "number" || exp <= Math.floor(Date.now() / 1000)) return null;
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Whether the token is authentic and unexpired. All the gate ever needs to know. */
export async function verifySession(
  token: string | null | undefined,
  secret: string | null | undefined,
): Promise<boolean> {
  return (await readToken(token, secret)) !== null;
}

/** Mint the beta gate cookie. It carries no identity, because the code is shared. */
export const createGate = (secret: string): Promise<string> =>
  createToken({ gate: true }, secret, GATE_TTL_SECONDS);

/** Mint the session cookie for a verified Firebase account. */
export const createSession = (
  secret: string,
  account: { uid: string; email: string | null },
): Promise<string> => createToken(account, secret, SESSION_TTL_SECONDS);

/** Read a session cookie back into claims. A token without a uid is not a session. */
export async function readSession(
  token: string | null | undefined,
  secret: string | null | undefined,
): Promise<SessionClaims | null> {
  const claims = await readToken(token, secret);
  if (!claims || typeof claims.uid !== "string" || !claims.uid) return null;

  return {
    uid: claims.uid,
    email: typeof claims.email === "string" ? claims.email : null,
    exp: claims.exp as number,
  };
}

/**
 * Read configuration, refusing to run with placeholder values.
 * A gate with a default password is worse than no gate, because it looks like one.
 */
export interface AuthConfig {
  code: string | undefined;
  secret: string | undefined;
  problems: string[];
  ok: boolean;
}

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const code = env.ACCESS_CODE?.trim();
  const secret = env.SESSION_SECRET?.trim();

  const problems: string[] = [];
  if (!code) problems.push("ACCESS_CODE is not set");
  else if (code.length < 8) problems.push("ACCESS_CODE is shorter than 8 characters");
  if (!secret) problems.push("SESSION_SECRET is not set");
  else if (secret.length < 32) problems.push("SESSION_SECRET is shorter than 32 characters");

  return { code, secret, problems, ok: problems.length === 0 };
}
