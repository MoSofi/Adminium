/**
 * React context shared by ThemeProvider and the useTheme/useThemePrefs hooks.
 * Internal module — consumers use the hooks, never the raw context.
 */
import { createContext } from 'react';

import type { ResolvedTheme, ThemePrefs } from './types.js';

/** `setPref` updates one axis optimistically (02-design-system.md §4 behavior 4). */
export type SetThemePref = <K extends keyof ThemePrefs>(key: K, value: ThemePrefs[K]) => void;

export interface ThemeContextValue {
  /** Effective preferences after the resolution order (§4.2); `theme` may be `system`. */
  prefs: ThemePrefs;
  /** Resolved values as stamped on `<html>`. */
  resolved: ResolvedTheme;
  setPref: SetThemePref;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
