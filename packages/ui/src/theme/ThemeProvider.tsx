/**
 * ThemeProvider — runtime for the four theming axes (theme/accent/density/locale→dir),
 * per 02-design-system.md §4 and 03-component-library.md §3.6.
 *
 * Responsibilities:
 * 1. Resolve effective prefs per-axis (§4.2): baseline ← localStorage pre-paint
 *    cache ← `globalDefaults` (adminium_settings) ← `userPrefs`
 *    (adminium_user_prefs) ← in-session `setPref` calls. localStorage is a
 *    cache, not a preference source: it only fills axes the server props do
 *    not supply (pre-auth surfaces), and server-resolved values always win.
 *    The `setPref` layer (`sessionPrefs`) is optimistic and transient: an entry
 *    is reconciled away once the server-resolved props catch up to it (same
 *    value), and can be dropped explicitly via `clearSessionPref` when the
 *    caller resets an axis server-side (M8 reset-to-default) — otherwise a
 *    stale optimistic value would keep masking the refetched default until a
 *    reload. Entries whose value still differs from the props are treated as
 *    in flight and keep winning (§4 behavior 4).
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
  type Dir,
} from '@adminium/tokens';

import {
  ThemeContext,
  type ClearSessionPref,
  type SetThemePref,
  type ThemeContextValue,
} from './context.js';
import { emitTheme } from './subscribe.js';
import {
  BASELINE_PREFS,
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
  /**
   * Direction resolver for locales this package cannot know about
   * (23 §5.4). The app injects one backed by `@adminium/i18n`'s runtime
   * registry; return `null` to defer to the compiled table and the cached
   * axis. Absent in Storybook and in tests, where only the eight compiled
   * locales exist.
   */
  resolveDir?: (locale: Locale) => Dir | null;
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
    // SHAPE check, not membership (23 §5.2): a cached preference may name an
    // admin-created locale this build does not compile in, and dropping it
    // would strand that user on en-US on every cold load.
    const locale = window.localStorage.getItem(STORAGE_KEYS.locale);
    if (locale !== null && LOCALE_ID_SHAPE.test(locale)) {
      cache.locale = locale as Locale;
    }
  } catch {
    // Private mode / storage disabled: baseline render.
  }
  return cache;
}

/** Mirrors `LOCALE_ID_RE` in `@adminium/i18n` (this package cannot import it). */
const LOCALE_ID_SHAPE = /^[a-z]{2,3}(_[A-Za-z0-9]{2,8}){0,2}$/;

/**
 * The `dir` the last resolved paint cached — an INDEPENDENT axis, not
 * re-derived from the locale (23 §5.4).
 *
 * Without this, a custom RTL locale paints `rtl` from the pre-hydration
 * script and snaps to `ltr` at hydration on every signed-out screen: this
 * provider is the sole writer of the attribute, it recomputes direction on
 * every commit, and on pre-auth surfaces there is no `userPrefs` and no
 * locale registry to compute it from.
 */
function readCachedDir(): Dir | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const dir = window.localStorage.getItem(STORAGE_KEYS.dir);
    return dir === 'rtl' || dir === 'ltr' ? dir : undefined;
  } catch {
    return undefined;
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** Value-equality over the four axes (props identity churns when the parent
 * re-derives `userPrefs`, so the reconcile trigger must compare by value). */
function samePrefs(a: ThemePrefs, b: ThemePrefs): boolean {
  return a.theme === b.theme && a.accent === b.accent && a.density === b.density && a.locale === b.locale;
}

/**
 * Drop optimistic session entries the freshly-resolved props now confirm (the
 * axis resolves to the same value with or without the override). Those entries
 * have served their purpose; keeping them would mask a *later* authoritative
 * change to the axis. Entries whose value still differs are left untouched —
 * they are in flight and must keep winning. Returns the same reference when
 * nothing changed so the caller can skip a state update.
 */
function reconcileSessionPrefs(
  session: Partial<ThemePrefs>,
  propsResolved: ThemePrefs,
): Partial<ThemePrefs> {
  const confirmed = (Object.keys(session) as Array<keyof ThemePrefs>).filter(
    (key) => propsResolved[key] === session[key],
  );
  if (confirmed.length === 0) return session;
  const next = { ...session };
  for (const key of confirmed) delete next[key];
  return next;
}

export function ThemeProvider(props: ThemeProviderProps): ReactNode {
  const { globalDefaults, userPrefs, onPrefChange, resolveDir, children } = props;

  // Read once per mount — the cache is a boot-time fallback, not a live source.
  const [storageCache] = useState<Partial<ThemePrefs>>(readStorageCache);
  const [cachedDir] = useState<Dir | undefined>(readCachedDir);
  // Axes changed via setPref during this session (optimistic layer, wins over props).
  const [sessionPrefs, setSessionPrefs] = useState<Partial<ThemePrefs>>({});
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  // Everything resolvable from the server props (+ pre-paint cache), WITHOUT the
  // optimistic session layer. `sessionPrefs` rides on top of this (§4.2).
  const propsResolved: ThemePrefs = useMemo(
    () => ({
      ...BASELINE_PREFS,
      ...storageCache,
      ...globalDefaults,
      ...userPrefs,
    }),
    [storageCache, globalDefaults, userPrefs],
  );

  // When a fresh server resolution arrives (by value — the parent re-derives
  // `userPrefs` into a new object each render), reconcile the optimistic layer:
  // adjusting state during render (per the React docs' "storing information from
  // previous renders" pattern) drops confirmed entries before commit, so it
  // never re-stamps <html> or re-emits with an intermediate value.
  const [prevPropsResolved, setPrevPropsResolved] = useState(propsResolved);
  if (!samePrefs(propsResolved, prevPropsResolved)) {
    setPrevPropsResolved(propsResolved);
    setSessionPrefs((prev) => reconcileSessionPrefs(prev, propsResolved));
  }

  const prefs: ThemePrefs = useMemo(
    () => ({ ...propsResolved, ...sessionPrefs }),
    [propsResolved, sessionPrefs],
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
      dir: dirForLocale(prefs.locale, { resolve: resolveDir, cached: cachedDir }),
    }),
    [prefs, prefersDark, resolveDir, cachedDir],
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

  // Drop the optimistic entry so resolution falls back to the props (the caller
  // owns the server-side clear). Not a `setPref`, so no `onPrefChange` fires.
  const clearSessionPref: ClearSessionPref = useCallback((key) => {
    setSessionPrefs((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const contextValue: ThemeContextValue = useMemo(
    () => ({ prefs, resolved, setPref, clearSessionPref }),
    [prefs, resolved, setPref, clearSessionPref],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <DirectionProvider dir={resolved.dir}>{children}</DirectionProvider>
    </ThemeContext.Provider>
  );
}
