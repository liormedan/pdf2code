"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";

/**
 * Locale-aware number and date formatting.
 *
 * Deliberately built on the platform `Intl` API rather than next-intl's `useFormatter`.
 * That hook pulls the file into next-intl's message-extraction compiler, which runs as
 * a webpack child compilation and does not inherit the project's tsconfig path aliases
 * — so every `@/…` import in the file fails to resolve at build time. Using `Intl`
 * directly keeps the locale awareness and avoids that path entirely.
 */
export function useFormat() {
  const locale = useLocale();

  return useMemo(
    () => ({
      number: (value: number) => new Intl.NumberFormat(locale).format(value),
      dateTime: (value: number | Date, options?: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(locale, options).format(value),
    }),
    [locale],
  );
}
