/**
 * Theming axis types for ThemeProvider (02-design-system.md §4.1).
 * Axis value unions come from `@adminium/tokens` so the DOM attributes,
 * Storybook toolbar and provider can never drift apart; the locale union and
 * the pref/resolved shapes live here because they are UI-runtime concerns.
 */
import type {
  Accent,
  Density,
  Dir,
  ResolvedTheme as ResolvedThemeMode,
  ThemePref,
} from '@adminium/tokens';
import { DEFAULT_PREFS } from '@adminium/tokens';

/** The 8 COMPILED locales (02-design-system.md §4.1). */
export const LOCALES = [
  'en_US',
  'de_DE',
  'ar_EG',
  'zh_CN',
  'zh_TW',
  'cs_CZ',
  'da_DK',
  'fr_FR',
] as const;
export type BuiltinLocale = (typeof LOCALES)[number];

/**
 * Any locale the instance may resolve to — the compiled eight plus whatever
 * an admin created at runtime (23-runtime-translations.md §5). `(string & {})`
 * keeps literal autocomplete for the eight.
 *
 * This package deliberately does NOT depend on `@adminium/i18n`, so it cannot
 * look a custom locale up. Direction therefore arrives one of two ways — an
 * injected `resolveDir` (from the app, which does have the registry) or the
 * cached `dir` axis — see {@link dirForLocale} and ThemeProvider.
 */
export type Locale = BuiltinLocale | (string & {});

/** User-facing preferences: `theme` may be `system`; `dir` is derived, not a pref. */
export interface ThemePrefs {
  theme: ThemePref;
  accent: Accent;
  density: Density;
  locale: Locale;
}

/** Fully resolved theme as stamped on `<html>`: `system` resolved, `dir` derived. */
export interface ResolvedTheme {
  theme: ResolvedThemeMode;
  accent: Accent;
  density: Density;
  locale: Locale;
  dir: Dir;
}

/** Baseline of the resolution order (BRIEF §7 via `@adminium/tokens`). */
export const BASELINE_PREFS: ThemePrefs = { ...DEFAULT_PREFS };

/** Direction of the COMPILED locales; `null` for anything else. */
export function builtinLocaleDir(locale: string): Dir | null {
  if (!(LOCALES as readonly string[]).includes(locale)) return null;
  return locale === 'ar_EG' ? 'rtl' : 'ltr';
}

/**
 * Direction for a locale, best-effort and total.
 *
 * A hardcoded `locale === 'ar_EG'` test cannot answer for an admin-created
 * RTL locale, and this package cannot import the runtime registry. So the
 * order is: an injected resolver (the app has the registry) → the compiled
 * table → the cached `dir` axis from the last resolved paint → `ltr`. The
 * cached axis is what keeps a custom RTL locale from flashing on pre-auth
 * screens, where no bootstrap payload exists yet (23 §5.4).
 */
export function dirForLocale(
  locale: Locale,
  opts: { resolve?: ((locale: Locale) => Dir | null) | undefined; cached?: Dir | undefined } = {},
): Dir {
  return opts.resolve?.(locale) ?? builtinLocaleDir(locale) ?? opts.cached ?? 'ltr';
}

/**
 * BCP-47 form of a locale for the `lang` attribute (`ar_EG` → `ar-EG`).
 * Replaces EVERY underscore: a single replacement leaves `zh-Hant_TW`, which
 * is not a valid tag (23 §5.5).
 */
export function langForLocale(locale: Locale): string {
  return locale.replaceAll('_', '-');
}
