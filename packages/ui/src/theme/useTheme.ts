// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Theme hooks (02-design-system.md §4.1).
 * `useTheme` → resolved values for rendering; `useThemePrefs` → raw prefs +
 * `setPref` for the appearance settings UI.
 */
import { useContext } from 'react';

import { ThemeContext, type ClearSessionPref, type SetThemePref } from './context.js';
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

/**
 * The effective preferences (theme may be `system`), the optimistic setter, and
 * `clearSessionPref` for dropping a session override on reset-to-default.
 */
export function useThemePrefs(): {
  prefs: ThemePrefs;
  setPref: SetThemePref;
  clearSessionPref: ClearSessionPref;
} {
  const { prefs, setPref, clearSessionPref } = useRequiredThemeContext('useThemePrefs()');
  return { prefs, setPref, clearSessionPref };
}
