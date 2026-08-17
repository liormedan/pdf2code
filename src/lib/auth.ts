// Access gate.
//
// This is a shared access code, not a user account system — there is no user record,
// no email, and nothing stored anywhere. It exists to keep the tool off the open web
// while it is in development.
//
// Two things it is deliberately NOT:
//   - It is not a per-user identity. Everyone who gets in is indistinguishable.
//   - It is not protecting server-side data, because there is none: conversion runs
//     entirely in the browser. It gates access to the app, not to anyone's files.
//
// Built on Web Crypto so the same code runs in middleware (Edge) and in route
// handlers (Node) without a second implementation.

const encoder = new TextEncoder();

const SESSION_COOKIE = "pdf2code_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export { SESSION_COOKIE, SESSION_TTL_SECONDS };

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
    encoder.encode(secret),
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

/** Mint a session token. It carries an expiry and nothing else — there is no identity. */
export async function createSession(secret: string, ttlSeconds: number = SESSION_TTL_SECONDS): Promise<string> {
  const payload = b64url.encode(
    encoder.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds })),
  );
  return `${payload}.${await sign(payload, secret)}`;
}

/** Whether the token is authentic and unexpired. */
export async function verifySession(
  token: string | null | undefined,
  secret: string | null | undefined,
): Promise<boolean> {
  if (!token || !secret) return false;

  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return false;

  // Verify the signature before parsing: never trust the payload of an unsigned token.
  if (!constantTimeEqual(signature, await sign(payload, secret))) return false;

  try {
    const { exp } = JSON.parse(new TextDecoder().decode(b64url.decode(payload)));
    return typeof exp === "number" && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
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
