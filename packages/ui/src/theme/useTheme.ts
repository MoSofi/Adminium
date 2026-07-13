/**
 * Theme hooks (workplan/02-design-system.md §4.1).
 * `useTheme` → resolved values for rendering; `useThemePrefs` → raw prefs +
 * `setPref` for the appearance settings UI.
 */
import { useContext } from 'react';

import { ThemeContext, type SetThemePref } from './context.js';
import type { ResolvedTheme, ThemePrefs } from './types.js';

function useRequiredThemeContext(hook: string) {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error(`${hook} must be used inside <ThemeProvider>`);
  }
  return context;
}

/** The resolved theme as stamped on `<html>` (`system` already resolved, `dir` derived). */
export function useTheme(): ResolvedTheme {
  return useRequiredThemeContext('useTheme()').resolved;
}

/** The effective preferences (theme may be `system`) and the optimistic setter. */
export function useThemePrefs(): { prefs: ThemePrefs; setPref: SetThemePref } {
  const { prefs, setPref } = useRequiredThemeContext('useThemePrefs()');
  return { prefs, setPref };
}
