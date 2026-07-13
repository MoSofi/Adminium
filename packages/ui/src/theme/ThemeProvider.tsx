/**
 * ThemeProvider — runtime for the four theming axes (theme/accent/density/locale→dir),
 * per workplan/02-design-system.md §4 and 03-component-library.md §3.6.
 *
 * Responsibilities:
 * 1. Resolve effective prefs per-axis (§4.2): baseline ← localStorage pre-paint
 *    cache ← `globalDefaults` (adminium_settings) ← `userPrefs`
 *    (adminium_user_prefs) ← in-session `setPref` calls. localStorage is a
 *    cache, not a preference source: it only fills axes the server props do
 *    not supply (pre-auth surfaces), and server-resolved values always win.
 * 2. Stamp `THEME_ATTRIBUTES` on `document.documentElement` (`data-theme` with
 *    the RESOLVED light/dark, `data-accent`, `data-density`, `dir`, `lang`).
 *    This is the only place theming attributes are set after pre-hydration.
 * 3. Track `matchMedia('(prefers-color-scheme: dark)')` live while the
 *    effective theme pref is `system`; detach when it becomes explicit.
 * 4. Write the cache back to localStorage under `STORAGE_KEYS` on every
 *    resolution change. The theme key stores the PREF (so `system` round-trips
 *    and the pre-hydration script re-resolves it against the OS at next boot —
 *    the script explicitly handles a cached "system"); `dir` stores the
 *    derived value the script needs pre-React.
 * 5. Notify `subscribeTheme` listeners after the DOM attributes are committed.
 *
 * Persistence to `adminium_user_prefs` (M8) is the caller's job via
 * `onPrefChange`; the provider itself never talks to the server.
 */
import { DirectionProvider } from '@radix-ui/react-direction';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ACCENTS,
  DENSITIES,
  STORAGE_KEYS,
  THEMES,
  THEME_ATTRIBUTES,
  type ThemePref,
  type Accent,
  type Density,
} from '@adminium/tokens';

import { ThemeContext, type SetThemePref, type ThemeContextValue } from './context.js';
import { emitTheme } from './subscribe.js';
import {
  BASELINE_PREFS,
  LOCALES,
  dirForLocale,
  langForLocale,
  type Locale,
  type ResolvedTheme,
  type ThemePrefs,
} from './types.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Called after each `setPref` with the axis, the new value, and the next full prefs. */
export type ThemePrefChangeHandler = <K extends keyof ThemePrefs>(
  key: K,
  value: ThemePrefs[K],
  prefs: ThemePrefs,
) => void;

export interface ThemeProviderProps {
  /** Global super-admin defaults from `adminium_settings` (M8; absent pre-M8/pre-auth). */
  globalDefaults?: Partial<ThemePrefs>;
  /** Per-user overrides from `adminium_user_prefs` (M8; absent pre-auth). */
  userPrefs?: Partial<ThemePrefs>;
  /** Persistence hook for `setPref` (M8 wires `PATCH /api/v1/me/prefs` here). */
  onPrefChange?: ThemePrefChangeHandler;
  children: ReactNode;
}

/** Read the localStorage pre-paint cache, ignoring unknown/invalid values. */
function readStorageCache(): Partial<ThemePrefs> {
  const cache: Partial<ThemePrefs> = {};
  if (typeof window === 'undefined') return cache;
  try {
    const theme = window.localStorage.getItem(STORAGE_KEYS.theme);
    if (theme !== null && (THEMES as readonly string[]).includes(theme)) {
      cache.theme = theme as ThemePref;
    }
    const accent = window.localStorage.getItem(STORAGE_KEYS.accent);
    if (accent !== null && accent in ACCENTS) cache.accent = accent as Accent;
    const density = window.localStorage.getItem(STORAGE_KEYS.density);
    if (density !== null && (DENSITIES as readonly string[]).includes(density)) {
      cache.density = density as Density;
    }
    const locale = window.localStorage.getItem(STORAGE_KEYS.locale);
    if (locale !== null && (LOCALES as readonly string[]).includes(locale)) {
      cache.locale = locale as Locale;
    }
  } catch {
    // Private mode / storage disabled: baseline render.
  }
  return cache;
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_QUERY).matches;
}

export function ThemeProvider(props: ThemeProviderProps): ReactNode {
  const { globalDefaults, userPrefs, onPrefChange, children } = props;

  // Read once per mount — the cache is a boot-time fallback, not a live source.
  const [storageCache] = useState<Partial<ThemePrefs>>(readStorageCache);
  // Axes changed via setPref during this session (optimistic layer, wins over props).
  const [sessionPrefs, setSessionPrefs] = useState<Partial<ThemePrefs>>({});
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  const prefs: ThemePrefs = useMemo(
    () => ({
      ...BASELINE_PREFS,
      ...storageCache,
      ...globalDefaults,
      ...userPrefs,
      ...sessionPrefs,
    }),
    [storageCache, globalDefaults, userPrefs, sessionPrefs],
  );

  // Live system-theme tracking, attached only while the pref is `system` (§4 behavior 2).
  useEffect(() => {
    if (prefs.theme !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DARK_QUERY);
    setPrefersDark(mql.matches);
    const onChange = (event: MediaQueryListEvent): void => {
      setPrefersDark(event.matches);
    };
    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
    };
  }, [prefs.theme]);

  const resolved: ResolvedTheme = useMemo(
    () => ({
      theme: prefs.theme === 'system' ? (prefersDark ? 'dark' : 'light') : prefs.theme,
      accent: prefs.accent,
      density: prefs.density,
      locale: prefs.locale,
      dir: dirForLocale(prefs.locale),
    }),
    [prefs, prefersDark],
  );

  // Stamp <html>, write the cache back, then notify listeners (§4 behaviors 1/3/5).
  useLayoutEffect(() => {
    const el = document.documentElement;
    el.setAttribute(THEME_ATTRIBUTES.theme, resolved.theme);
    el.setAttribute(THEME_ATTRIBUTES.accent, resolved.accent);
    el.setAttribute(THEME_ATTRIBUTES.density, resolved.density);
    el.setAttribute(THEME_ATTRIBUTES.dir, resolved.dir);
    el.setAttribute(THEME_ATTRIBUTES.lang, langForLocale(resolved.locale));
    try {
      window.localStorage.setItem(STORAGE_KEYS.theme, prefs.theme);
      window.localStorage.setItem(STORAGE_KEYS.accent, resolved.accent);
      window.localStorage.setItem(STORAGE_KEYS.density, resolved.density);
      window.localStorage.setItem(STORAGE_KEYS.locale, resolved.locale);
      window.localStorage.setItem(STORAGE_KEYS.dir, resolved.dir);
    } catch {
      // Private mode / storage disabled: skip the pre-paint cache.
    }
    emitTheme(resolved);
  }, [resolved, prefs.theme]);

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const onPrefChangeRef = useRef(onPrefChange);
  onPrefChangeRef.current = onPrefChange;

  const setPref: SetThemePref = useCallback((key, value) => {
    setSessionPrefs((prev) => ({ ...prev, [key]: value }));
    onPrefChangeRef.current?.(key, value, { ...prefsRef.current, [key]: value });
  }, []);

  const contextValue: ThemeContextValue = useMemo(
    () => ({ prefs, resolved, setPref }),
    [prefs, resolved, setPref],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <DirectionProvider dir={resolved.dir}>{children}</DirectionProvider>
    </ThemeContext.Provider>
  );
}
