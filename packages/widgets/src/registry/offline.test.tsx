// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The offline asset policy — the pure rule and, more importantly, the rule AS
 * WIRED into WidgetHost.
 *
 * The second half is the point. `resolveOfflineWidgetId` is a two-line function
 * that could be exported, tested, and called by nobody — this repo has shipped
 * exactly that failure five times. So the tests that matter here render a real
 * `<WidgetHost widgetId="map-bubble">` against the REAL `widgetRegistry` (no
 * injected map) and assert what the production path actually did.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  THE MAP ENGINE SPY — what turns "the other id mounted" into the offline contract's actual claim,
  "the map engine is NEVER loaded in desktop runtime".

  Two jobs. First, safety: an unmocked `map-bubble` render with a map server
  named would import the real engine after the test body returns. Rejecting
  the import is also a production failure the widget is built to survive, so
  it is the honest fixture.

  Second — the assertion itself. The factory records every attempt to load the
  module, which is the event the contract forbids. `map-bubble` reaches MapLibre through a
  dynamic `import('maplibre-gl')` in its mount effect and is the ONLY module in the
  package that names it (qa/chunk-budget.test.ts pins that at file granularity),
  so this spy IS the observable for "did a map engine get pulled in". Asserting
  it stays untouched in a desktop runtime and with maps switched off — while
  proving it fires in a browser whose session names a map server, so the
  observable is known to work — is the closest a unit suite can get to the
  offline smoke test.
*/
const { engineLoads } = vi.hoisted(() => ({ engineLoads: vi.fn() }));
vi.mock('maplibre-gl', () => {
  engineLoads();
  throw new Error('maplibre chunk unavailable');
});

import {
  DEFAULT_WIDGET_RUNTIME_ENV,
  OFFLINE_MAP_FALLBACK_ID,
  offlineAssetsRequired,
  resolveOfflineWidgetId,
  type WidgetRuntimeEnv,
} from './offline.js';
import { widgetRegistry } from './index.js';
import { mapServerOf } from './map-server.js';
import { WidgetHost } from '../frame/WidgetHost.js';
import { WidgetRuntimeProvider } from '../frame/WidgetRuntimeContext.js';

const BROWSER: WidgetRuntimeEnv = { runtime: 'browser', offlineAssets: false };
/** A browser whose session names a map server: maps are on. */
const MAPS = { server: 'https://maps.example.test', routing: false };
const BROWSER_MAPS_ON: WidgetRuntimeEnv = { ...BROWSER, maps: MAPS };
// The desktop server never names a map server; these name one anyway, so the
// runtime rule is what is tested and not the server's manners.
const DESKTOP: WidgetRuntimeEnv = { runtime: 'desktop', offlineAssets: false, maps: MAPS };
const OFFLINE_BROWSER: WidgetRuntimeEnv = { runtime: 'browser', offlineAssets: true, maps: MAPS };

beforeEach(() => engineLoads.mockClear());
afterEach(cleanup);

describe('resolveOfflineWidgetId — "runtime === desktop or offlineAssets === true"', () => {
  it('is identity online: self-host and Cloud must be untouched by this', () => {
    expect(resolveOfflineWidgetId('map-bubble', BROWSER)).toBe('map-bubble');
    expect(resolveOfflineWidgetId('kpi-stat-card', BROWSER)).toBe('kpi-stat-card');
    expect(offlineAssetsRequired(BROWSER)).toBe(false);
  });

  it('folds map-* onto the tilegram on BOTH triggers, independently', () => {
    expect(resolveOfflineWidgetId('map-bubble', DESKTOP)).toBe(OFFLINE_MAP_FALLBACK_ID);
    expect(resolveOfflineWidgetId('map-bubble', OFFLINE_BROWSER)).toBe(OFFLINE_MAP_FALLBACK_ID);
    expect(offlineAssetsRequired(DESKTOP)).toBe(true);
    expect(offlineAssetsRequired(OFFLINE_BROWSER)).toBe(true);
  });

  it('is idempotent on the fallback target itself (it is map-* too)', () => {
    expect(resolveOfflineWidgetId(OFFLINE_MAP_FALLBACK_ID, DESKTOP)).toBe(OFFLINE_MAP_FALLBACK_ID);
  });

  it('leaves every non-map id alone, offline included', () => {
    // The rule is a prefix rule, and a prefix rule that over-reaches would be a
    // far worse bug than the one it prevents: half the product would silently
    // render a map tilegram in the desktop app.
    for (const id of ['kpi-stat-card', 'data-grid', 'kanban-board', 'chart-choropleth-grid', 'sitemap-tree']) {
      expect(resolveOfflineWidgetId(id, DESKTOP)).toBe(id);
    }
  });

  it('covers a map-* id that does not exist yet (the annex family is open)', () => {
    // The reason this is a prefix rule and not a two-row lookup table: a future
    // `map-heat` must be offline-safe on the day it lands, without anyone
    // remembering to come back here.
    expect(resolveOfflineWidgetId('map-heat', DESKTOP)).toBe(OFFLINE_MAP_FALLBACK_ID);
  });

  it('defaults to online — an un-provided app is a browser', () => {
    expect(DEFAULT_WIDGET_RUNTIME_ENV).toEqual(BROWSER);
    expect(offlineAssetsRequired(DEFAULT_WIDGET_RUNTIME_ENV)).toBe(false);
  });
});

describe('mapServerOf — the one read of where a map may come from', () => {
  it('is the session\'s server in a browser', () => {
    expect(mapServerOf(BROWSER_MAPS_ON)).toBe('https://maps.example.test');
  });

  it('is null with no provider: the bundle itself names no server', () => {
    expect(mapServerOf(DEFAULT_WIDGET_RUNTIME_ENV)).toBeNull();
  });

  it('is null while maps are switched off', () => {
    expect(mapServerOf({ ...BROWSER, maps: { server: null, routing: false } })).toBeNull();
    expect(mapServerOf({ ...BROWSER, maps: { server: '  ', routing: false } })).toBeNull();
  });

  it('is null on the desktop app and under the offline policy, whatever the session says', () => {
    expect(mapServerOf(DESKTOP)).toBeNull();
    expect(mapServerOf(OFFLINE_BROWSER)).toBeNull();
  });
});

describe('the fallback target is real', () => {
  it('is registered in the live registry', () => {
    // Guards the guard: WidgetHost resolves the id and then reads the map. If
    // the target were ever renamed or dropped, every map in the desktop app
    // would render the widget-missing card and every test above would still
    // pass — they only compare strings.
    expect(widgetRegistry.has(OFFLINE_MAP_FALLBACK_ID)).toBe(true);
    expect(widgetRegistry.get(OFFLINE_MAP_FALLBACK_ID)?.family).toBe('geo');
  });

  it('accepts the same data contract as the map it replaces', () => {
    // The fallback swaps the COMPONENT, not the binding: the stored page config
    // and whatever `widget-data/batch` returns for it are unchanged. If the two
    // ids disagreed on shape, the desktop app would render an empty state where
    // self-host renders a map.
    expect(widgetRegistry.get('map-bubble')?.dataContract).toBe(
      widgetRegistry.get(OFFLINE_MAP_FALLBACK_ID)?.dataContract,
    );
  });
});

/**
 * `data-widget` is each geo component's own root attribute, so these assert on
 * the module that actually mounted rather than on anything the test set up.
 */
async function mountedWidget(): Promise<string | null> {
  const node = await waitFor(() => {
    const found = document.querySelector('[data-widget]');
    expect(found).not.toBeNull();
    return found;
  });
  return node?.getAttribute('data-widget') ?? null;
}

describe('WidgetHost — the wiring, against the real registry', () => {
  const data = { status: 'success' as const, data: widgetRegistry.get('map-bubble')?.demoData(7) };

  it('mounts the real bubble map in a browser runtime with maps on — and reaches for the engine', async () => {
    render(
      <WidgetRuntimeProvider env={BROWSER_MAPS_ON}>
        <WidgetHost widgetId="map-bubble" instanceId="i1" config={{}} data={data} />
      </WidgetRuntimeProvider>,
    );
    expect(await mountedWidget()).toBe('map-bubble');
    // Proves the observable the two tests below rely on actually fires: online,
    // a placed bubble map DOES pull the map engine. Without this, "the engine was
    // never loaded" would also pass on a spy that could never be called.
    await waitFor(() => expect(engineLoads).toHaveBeenCalled());
  });

  it('mounts the tilegram in a desktop runtime, and NEVER loads the engine', async () => {
    render(
      <WidgetRuntimeProvider env={DESKTOP}>
        <WidgetHost widgetId="map-bubble" instanceId="i2" config={{}} data={data} />
      </WidgetRuntimeProvider>,
    );
    expect(await mountedWidget()).toBe('map-choropleth-grid');
    // The maps row: "the map engine is never loaded in desktop runtime".
    // The mount effect that would import it belongs to a component that was
    // never constructed, so there is nothing to fail and nothing to catch.
    expect(engineLoads).not.toHaveBeenCalled();
  });

  it('mounts the tilegram when offlineAssets is forced on a browser runtime', async () => {
    render(
      <WidgetRuntimeProvider env={OFFLINE_BROWSER}>
        <WidgetHost widgetId="map-bubble" instanceId="i3" config={{}} data={data} />
      </WidgetRuntimeProvider>,
    );
    expect(await mountedWidget()).toBe('map-choropleth-grid');
    expect(engineLoads).not.toHaveBeenCalled();
  });

  it('mounts the map widget with no provider at all (the default is online), and loads no engine', async () => {
    // No provider is a browser with no map server named. The map widget still
    // mounts (it is not swapped for the tilegram: that is the offline rule) and
    // shows its list and "maps are switched off" — asking for nothing.
    render(<WidgetHost widgetId="map-bubble" instanceId="i4" config={{}} data={data} />);
    expect(await mountedWidget()).toBe('map-bubble');
    await waitFor(() => expect(document.querySelector('[data-part="map-off"]')).not.toBeNull());
    expect(document.querySelector('[data-widget="map-bubble"]')?.getAttribute('data-map-status')).toBe('off');
    expect(engineLoads).not.toHaveBeenCalled();
  });

  it('maps switched off in a browser: the map widget, its list, and no engine', async () => {
    render(
      <WidgetRuntimeProvider env={{ ...BROWSER, maps: { server: null, routing: false } }}>
        <WidgetHost widgetId="map-bubble" instanceId="i6" config={{}} data={data} />
      </WidgetRuntimeProvider>,
    );
    expect(await mountedWidget()).toBe('map-bubble');
    await waitFor(() => expect(document.querySelectorAll('[data-part="geo-ranking-row"]').length).toBeGreaterThan(0));
    expect(engineLoads).not.toHaveBeenCalled();
  });

  it('leaves a non-map widget alone in a desktop runtime', async () => {
    const kpi = widgetRegistry.get('kpi-stat-card');
    render(
      <WidgetRuntimeProvider env={DESKTOP}>
        <WidgetHost
          widgetId="kpi-stat-card"
          instanceId="i5"
          config={{}}
          data={{ status: 'success', data: kpi?.demoData(3) }}
        />
      </WidgetRuntimeProvider>,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-widget="map-choropleth-grid"]')).toBeNull();
    });
  });
});
