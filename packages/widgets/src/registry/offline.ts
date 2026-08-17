// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline asset policy for the widget registry (11-electron.md §7, 11-T09).
 *
 * §7's maps row, in full:
 *
 * > Leaflet is **never loaded** in desktop runtime; the geo widget family renders
 * > its designed fallback, the choropleth/tilegram grid. The widget registry
 * > resolves `map-*` widgets to `choropleth-grid` when `runtime === "desktop"` or
 * > `offlineAssets === true`.
 *
 * WHY THE REGISTRY AND NOT THE WIDGET. `map-bubble`'s component already degrades
 * on its own — it catches a failed `await import('leaflet')` and renders the
 * ranked companion list under a "map unavailable" notice. That is the right
 * behavior for a self-host box whose CDN is briefly unreachable, and the wrong
 * one for the desktop app: the chunk fetch and the tile requests would still be
 * ATTEMPTED (§7's smoke test asserts zero of them), the user would see an error
 * state where a working visual belongs, and the guarantee would depend on a
 * component's catch block rather than on the app never asking for a map. Resolving
 * one id to another BEFORE the lazy ref is read means the map chunk is never
 * imported, so Leaflet is not loaded — it is not even requested.
 *
 * `map-*` IS A PREFIX RULE, NOT A TWO-ENTRY TABLE, and that is deliberate: the
 * annex §7 family is open, and a future `map-heat`/`map-routes` would otherwise
 * ship a map engine into the offline build on the day it landed, silently and with
 * every gate green. The rule reads the way §7 states it, so new map ids are
 * covered by default and opting one OUT is the change that has to be argued for.
 *
 * Pure module — no React, no registry map import. The resolution runs in
 * `frame/WidgetHost.tsx` (the single mount path for every registry widget), fed
 * by `WidgetRuntimeProvider`; see those two files for the wiring.
 */

/** Which wrapper is running the SPA (11-electron.md §4 detection contract). */
export type WidgetRuntime = 'browser' | 'desktop';

export interface WidgetRuntimeEnv {
  /** `desktop` ⇒ the Electron shell (§2.1), which must never touch the network. */
  runtime: WidgetRuntime;
  /**
   * Force the offline policy on a non-desktop runtime — §7's second trigger.
   * Self-host behind an air-gap is the case that exists today; the offline smoke
   * test (11-T18) is the case that exercises it without an Electron shell.
   */
  offlineAssets: boolean;
}

/**
 * What every surface without a provider gets: the plain browser. Self-host and
 * Cloud serve the identical bundle and are online by definition, so this is the
 * honest default rather than a placeholder — and it is why an un-wrapped test or
 * story still renders the real map.
 */
export const DEFAULT_WIDGET_RUNTIME_ENV: WidgetRuntimeEnv = { runtime: 'browser', offlineAssets: false };

/** §7's `map-*`. Every id under it is network-bearing until proven otherwise. */
export const MAP_WIDGET_PREFIX = 'map-';

/**
 * §7's `choropleth-grid` — the geo family's designed offline fallback: an SVG
 * tilegram over `@adminium/charts` (dependency-light, no tiles, no engine).
 * It is itself `map-*`-prefixed, so the rule below is idempotent on it.
 */
export const OFFLINE_MAP_FALLBACK_ID = 'map-choropleth-grid';

/** §7's two triggers, in one place so they cannot drift between call sites. */
export function offlineAssetsRequired(env: WidgetRuntimeEnv): boolean {
  return env.runtime === 'desktop' || env.offlineAssets;
}

/**
 * The registry id a runtime should actually mount for a stored id (§7).
 *
 * Online → identity, always: this must be invisible on self-host and Cloud, where
 * a placed bubble map is a bubble map. Offline → every `map-*` id collapses onto
 * the tilegram, including `map-choropleth-grid` itself (a no-op, by construction).
 *
 * Stored page config is NOT rewritten. The same `map-bubble` row keeps rendering a
 * real map on self-host and a tilegram in the desktop app, which is the point:
 * one config document, two runtimes, no migration when a database moves between
 * them.
 */
export function resolveOfflineWidgetId(id: string, env: WidgetRuntimeEnv): string {
  if (!offlineAssetsRequired(env)) return id;
  return id.startsWith(MAP_WIDGET_PREFIX) ? OFFLINE_MAP_FALLBACK_ID : id;
}
