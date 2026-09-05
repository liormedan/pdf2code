/**
 * Translations, in about eighty lines instead of a framework.
 *
 * The web app used next-intl, which is built around a server that renders per request.
 * There is no server here and there is exactly one window, so the whole of what the app
 * actually consumed from it — `useTranslations(namespace)` and `useLocale()` — is
 * reimplemented with the same signatures. That is deliberate: it means every component
 * moves over with its import line changed and nothing else.
 *
 * Both languages are imported outright rather than fetched. Two JSON files are a few
 * kilobytes, and an installed application that needs a round trip to render its own menu
 * in Hebrew has got something backwards.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import en from "@/messages/en.json";
import he from "@/messages/he.json";
import { DEFAULT_LOCALE, LOCALE_KEY, directionOf, isSupported, nearest } from "./config";

/**
 * A message bundle nests: `activity.filter.all` is three levels deep, not two. The tree
 * is typed as one rather than flattened, because flattening it would mean rewriting the
 * two JSON files the web app and this one are meant to share.
 */
type Node = string | { [key: string]: Node };

const BUNDLES: Record<string, Node> = { en, he };

/** Walk a dotted path, returning a string or nothing. Never throws on a bad path. */
function lookup(bundle: Node | undefined, path: string): string | undefined {
  let node = bundle;
  for (const step of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[step];
  }
  return typeof node === "string" ? node : undefined;
}

interface I18n {
  locale: string;
  setLocale: (code: string) => void;
}

const Context = createContext<I18n | null>(null);

/** What the app starts in: the stored choice, else the OS language, else English. */
function initialLocale(): string {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (isSupported(stored)) return stored as string;
  } catch {
    // Storage can throw outright in a WebView with site data blocked. A window that
    // opens in English beats a window that does not open.
  }
  return nearest(navigator.language) || DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale);

  // The document carries the language and the direction, not a wrapper element — so
  // `dir`-aware CSS (`ms-`, `pe-`, `text-start`) works everywhere including portals,
  // which render outside the React tree.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = directionOf(locale);
  }, [locale]);

  const setLocale = useCallback((code: string) => {
    if (!isSupported(code)) return;
    setLocaleState(code);
    try {
      localStorage.setItem(LOCALE_KEY, code);
    } catch {
      // The choice still applies to this session; it just will not survive a restart.
    }
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function useI18n(): I18n {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useTranslations used outside <I18nProvider>");
  return ctx;
}

export function useLocale(): string {
  return useI18n().locale;
}

export function useSetLocale(): (code: string) => void {
  return useI18n().setLocale;
}

/**
 * Translations for one namespace.
 *
 * A missing key returns the key itself rather than throwing or rendering blank: a
 * screen with `nav.settings` visible tells you exactly what to add, while an empty
 * button tells you nothing and an exception loses the whole window.
 */
export function useTranslations(namespace: string) {
  const { locale } = useI18n();

  return useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const path = `${namespace}.${key}`;
      // Falling back to English rather than to nothing: a language we ship with a gap
      // in it should read as a mixed screen, not a broken one.
      const value = lookup(BUNDLES[locale], path) ?? lookup(BUNDLES[DEFAULT_LOCALE], path);
      if (value === undefined) return path;

      if (!params) return value;
      return value.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in params ? String(params[name]) : whole,
      );
    },
    [locale, namespace],
  );
}
