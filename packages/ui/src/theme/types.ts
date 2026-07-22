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

/** The 8 BRIEF locales (02-design-system.md §4.1). */
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
export type Locale = (typeof LOCALES)[number];

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

/** `rtl` iff the locale is `ar_EG` (02-design-system.md §4.1). */
export function dirForLocale(locale: Locale): Dir {
  return locale === 'ar_EG' ? 'rtl' : 'ltr';
}

/** BCP-47 form of a locale for the `lang` attribute (`ar_EG` → `ar-EG`). */
export function langForLocale(locale: Locale): string {
  return locale.replace('_', '-');
}
