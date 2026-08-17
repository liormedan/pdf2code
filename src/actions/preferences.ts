"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, isSupported } from "@/src/i18n/config.ts";
import { SESSION_COOKIE } from "@/src/lib/auth.ts";

/**
 * Persist the interface language.
 *
 * A cookie rather than a stored preference, because there is no account to attach it
 * to — which also means it survives exactly as long as the browser keeps it, and
 * nothing about the choice reaches a server we own.
 */
export async function setLocale(locale: string): Promise<{ ok: boolean }> {
  if (!isSupported(locale)) return { ok: false };

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signOut() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}
