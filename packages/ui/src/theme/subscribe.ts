/**
 * Non-React theme subscription (02-design-system.md §4.1) — for
 * Leaflet tile swaps, chart re-tints, Electron `nativeTheme` mirroring.
 * ThemeProvider emits AFTER the DOM attributes are committed (§4 behavior 5).
 */
import type { ResolvedTheme } from './types.js';

export type ThemeListener = (theme: ResolvedTheme) => void;

const listeners = new Set<ThemeListener>();

/** Subscribe to resolved-theme changes; returns an unsubscribe function. */
export function subscribeTheme(listener: ThemeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * @internal Called by ThemeProvider after stamping `<html>`. Not part of the
 * public API.
 *
 * Each listener is isolated (23 §4.4). This runs inside ThemeProvider's
 * `useLayoutEffect`, so an unguarded throw from ONE subscriber does not just
 * lose that subscriber — it skips every listener after it (the i18n language
 * bridge, the chart-direction bridge, the Electron `nativeTheme` mirror) and
 * errors the React commit. That is a white screen. A subscriber must not be
 * able to abort the theme commit, so failures are reported and swallowed.
 */
export function emitTheme(theme: ResolvedTheme): void {
  for (const listener of [...listeners]) {
    try {
      listener(theme);
    } catch (error) {
      console.error('[theme] subscriber threw; continuing with the remaining listeners', error);
    }
  }
}
