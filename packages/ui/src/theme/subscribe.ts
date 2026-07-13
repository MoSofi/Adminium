/**
 * Non-React theme subscription (workplan/02-design-system.md §4.1) — for
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

/** @internal Called by ThemeProvider after stamping `<html>`. Not part of the public API. */
export function emitTheme(theme: ResolvedTheme): void {
  for (const listener of [...listeners]) listener(theme);
}
