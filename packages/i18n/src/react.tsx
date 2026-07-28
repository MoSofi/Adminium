/**
 * React bindings for `@adminium/i18n` (separate entry so the framework-free
 * core — server emails, jobs, CLI — never pulls React in; §2.2). Deliberately
 * thin: an `I18nProvider` that re-renders its subtree on `languageChanged`
 * plus hooks bound to the active locale. The `t()` call signature matches the
 * dashboard's key+fallback convention.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { IntlMessageFormat } from 'intl-messageformat';

import type { I18nInstance } from './create-i18n.js';
import { getFormatters, type Formatters } from './format/index.js';
import { isRtlLocale, localeFromTag, tagForLocale, type LocaleId } from './locales.js';

export interface I18nContextValue {
  i18n: I18nInstance;
  locale: LocaleId;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  i18n: I18nInstance;
  children: ReactNode;
}

export function I18nProvider({ i18n, children }: I18nProviderProps): ReactNode {
  const [locale, setLocale] = useState<LocaleId>(() => localeFromTag(i18n.language ?? 'en-US'));

  useEffect(() => {
    setLocale(localeFromTag(i18n.language ?? 'en-US'));
    const onChanged = (lng: string): void => {
      setLocale(localeFromTag(lng));
    };
    i18n.on('languageChanged', onChanged);
    return () => {
      i18n.off('languageChanged', onChanged);
    };
  }, [i18n]);

  const value = useMemo<I18nContextValue>(() => ({ i18n, locale }), [i18n, locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18nContext(hook: string): I18nContextValue {
  const context = useContext(I18nContext);
  if (context === null) throw new Error(`${hook} must be used inside <I18nProvider>`);
  return context;
}

/** The shared i18next instance (advanced use — prefer `useT`). */
export function useI18n(): I18nInstance {
  return useI18nContext('useI18n()').i18n;
}

/** Active canonical locale id, live across `changeLanguage`. */
export function useLocale(): LocaleId {
  return useI18nContext('useLocale()').locale;
}

/** `true` iff the active locale reads right-to-left (10 §5). */
export function useRtl(): boolean {
  return isRtlLocale(useI18nContext('useRtl()').locale);
}

/** Translator bound to the provider instance: `t(key, fallback, args?)`. */
export function useT(): (key: string, fallback: string, args?: Record<string, unknown>) => string {
  const { i18n, locale } = useI18nContext('useT()');
  return useCallback(
    (key: string, fallback: string, args?: Record<string, unknown>) =>
      i18n.t(key, { defaultValue: fallback, ...args }),
    // `locale` is a dependency on purpose: a language switch re-binds the
    // callback so memoized consumers re-render with fresh strings.
    [i18n, locale],
  );
}

/** Provider context, or `null` outside an `<I18nProvider>` (advanced probe). */
export function useMaybeI18n(): I18nContextValue | null {
  return useContext(I18nContext);
}

// Fallback-path message cache for `useMaybeT` (mirrors IcuFormat.parse's).
const fallbackMessageCache = new Map<string, IntlMessageFormat>();

function formatFallback(fallback: string, args?: Record<string, unknown>): string {
  if (args === undefined || !fallback.includes('{')) return fallback;
  try {
    let message = fallbackMessageCache.get(fallback);
    if (message === undefined) {
      message = new IntlMessageFormat(fallback, 'en-US', undefined, { ignoreTag: true });
      fallbackMessageCache.set(fallback, message);
    }
    return String(message.format(args as Record<string, string | number>));
  } catch {
    return fallback;
  }
}

/**
 * `useT` for packages whose components must also render OUTSIDE an
 * `<I18nProvider>` (widget chrome in bare tests/Storybook/embeds): inside a
 * provider it is exactly `useT()`; outside, it ICU-formats the English
 * `fallback` argument (en-US rules) instead of throwing, which is the
 * pre-i18n behavior of those components.
 */
export function useMaybeT(): (key: string, fallback: string, args?: Record<string, unknown>) => string {
  const context = useContext(I18nContext);
  const i18n = context?.i18n;
  const locale = context?.locale;
  return useCallback(
    (key: string, fallback: string, args?: Record<string, unknown>) =>
      i18n === undefined ? formatFallback(fallback, args) : i18n.t(key, { defaultValue: fallback, ...args }),
    // `locale` re-binds on language switch, same as `useT`.
    [i18n, locale],
  );
}

/** Locale-bound Intl formatters (10 §4.1) — `useFmt().number(…)` etc. */
export function useFmt(): Formatters {
  const { locale } = useI18nContext('useFmt()');
  return getFormatters(tagForLocale(locale));
}

/** Alias per the M8 assignment naming. */
export const useFormatters = useFmt;
