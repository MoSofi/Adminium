/**
 * React context carrying the host app's {@link WidgetRuntimeEnv} to WidgetHost —
 * the input to §7's offline asset policy (11-electron.md §7, 11-T09).
 *
 * Mirrors `binding/StreamTransportContext.tsx`: the host app (`apps/dashboard`)
 * decides once and provides here; the widgets package reads. It stays a context
 * rather than a module-level setting because the value is a property of the
 * running app, not of the module, and a mutable module global would make two
 * suites in one process fight over it.
 *
 * SYNCHRONOUS BY DESIGN. The default is the browser, so an absent provider means
 * "online" — and that is why the provider must sit above every widget-rendering
 * route rather than be resolved from a query: a provider that arrived one render
 * late would let a `map-bubble` mount, and the Leaflet chunk fetch it triggers is
 * exactly the network touch the desktop app promises never to make. See
 * `apps/dashboard/src/lib/widget-runtime.ts` for why the bridge, not
 * `GET /api/v1/system/info`, is what feeds it.
 */

import { createContext, useContext, type ReactNode } from 'react';

import {
  DEFAULT_WIDGET_RUNTIME_ENV,
  resolveOfflineWidgetId,
  type WidgetRuntimeEnv,
} from '../registry/offline.js';

const WidgetRuntimeContext = createContext<WidgetRuntimeEnv>(DEFAULT_WIDGET_RUNTIME_ENV);

export interface WidgetRuntimeProviderProps {
  env: WidgetRuntimeEnv;
  children: ReactNode;
}

/**
 * Provide the runtime env to descendant widgets. Pass a STABLE `env` (a module
 * const, or a memo) — this is context, so a fresh object per render re-renders
 * every WidgetHost below it.
 */
export function WidgetRuntimeProvider({ env, children }: WidgetRuntimeProviderProps) {
  return <WidgetRuntimeContext.Provider value={env}>{children}</WidgetRuntimeContext.Provider>;
}

/** The provided env, or {@link DEFAULT_WIDGET_RUNTIME_ENV} without a provider. */
export function useWidgetRuntimeEnv(): WidgetRuntimeEnv {
  return useContext(WidgetRuntimeContext);
}

/**
 * §7's offline asset policy applied to a stored widget id — the id that will
 * actually MOUNT in this runtime.
 *
 * ─── ANYTHING THAT LOOKS A WIDGET UP MUST GO THROUGH THIS ───────────────────
 *
 * A stored `map-bubble` mounts as `map-choropleth-grid` on desktop. Any code
 * that reads the registry with the STORED id therefore gets a definition for a
 * component that is not the one on screen — and the two disagree about their
 * data contract, which is the interesting part.
 *
 * That is not hypothetical; it shipped. `useDashboardData` generated demo data
 * from `registry.get(item.widget)`, so an unbound `map-bubble` on desktop
 * produced `mapBubbleDemoData`'s `{points:[{name,lat,lng}]}` and handed it to
 * `MapChoroplethGridWidget`, which needs `points[].code`. `choroplethLayout`
 * skips every point whose code is absent from `US_TILEGRAM`, so ZERO tiles were
 * placed — while `points.length` of 10 kept `isEmptyData` reporting 'loaded', so
 * no empty state intervened either. The user saw a blank US map captioned with a
 * top-5 list of world cities (Tokyo, London, New York, Berlin, Cairo) instead of
 * §7's "designed fallback".
 *
 * Resolve FIRST, then look up. The identity case (any online runtime) costs
 * nothing.
 */
export function useResolvedWidgetId(widgetId: string): string {
  return resolveOfflineWidgetId(widgetId, useWidgetRuntimeEnv());
}
