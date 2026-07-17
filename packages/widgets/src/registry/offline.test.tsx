// @vitest-environment happy-dom
/**
 * The §7 offline asset policy (11-electron.md §7, 11-T09) — the pure rule and,
 * more importantly, the rule AS WIRED into WidgetHost.
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
  THE LEAFLET SPY — what turns "the other id mounted" into §7's actual claim,
  "Leaflet is NEVER loaded in desktop runtime".

  Two jobs. First, safety, and the geo suite learned this the hard way: Leaflet
  builds FINE under happy-dom, so an unmocked `map-bubble` render constructs a
  live map against a tile CDN after the test body returns. Rejecting the import
  is also the production failure the widget is built to survive, so it is the
  honest fixture.

  Second — the assertion itself. The factory records every attempt to load the
  module, which is the event §7 forbids. `map-bubble` reaches Leaflet through a
  dynamic `import('leaflet')` in its mount effect and is the ONLY module in the
  package that names it (qa/chunk-budget.test.ts pins that at file granularity),
  so this spy IS the observable for "did a map engine get pulled in". Asserting
  it stays untouched in a desktop runtime — while proving it fires in a browser
  one, so the observable is known to work — is the closest a unit suite can get
  to 11-T18's offline smoke test.
*/
const { leafletLoads } = vi.hoisted(() => ({ leafletLoads: vi.fn() }));
vi.mock('leaflet', () => {
  leafletLoads();
  throw new Error('leaflet chunk unavailable');
});

import {
  DEFAULT_WIDGET_RUNTIME_ENV,
  OFFLINE_MAP_FALLBACK_ID,
  offlineAssetsRequired,
  resolveOfflineWidgetId,
  type WidgetRuntimeEnv,
} from './offline.js';
import { widgetRegistry } from './index.js';
import { WidgetHost } from '../frame/WidgetHost.js';
import { WidgetRuntimeProvider } from '../frame/WidgetRuntimeContext.js';

const BROWSER: WidgetRuntimeEnv = { runtime: 'browser', offlineAssets: false };
const DESKTOP: WidgetRuntimeEnv = { runtime: 'desktop', offlineAssets: false };
const OFFLINE_BROWSER: WidgetRuntimeEnv = { runtime: 'browser', offlineAssets: true };

beforeEach(() => leafletLoads.mockClear());
afterEach(cleanup);

describe('resolveOfflineWidgetId — §7 "runtime === desktop or offlineAssets === true"', () => {
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

  it('covers a map-* id that does not exist yet (the annex §7 family is open)', () => {
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

  it('mounts the real bubble map in a browser runtime — and reaches for Leaflet', async () => {
    render(
      <WidgetRuntimeProvider env={BROWSER}>
        <WidgetHost widgetId="map-bubble" instanceId="i1" config={{}} data={data} />
      </WidgetRuntimeProvider>,
    );
    expect(await mountedWidget()).toBe('map-bubble');
    // Proves the observable the two tests below rely on actually fires: online,
    // a placed bubble map DOES pull the map engine. Without this, "Leaflet was
    // never loaded" would also pass on a spy that could never be called.
    await waitFor(() => expect(leafletLoads).toHaveBeenCalled());
  });

  it('mounts the tilegram in a desktop runtime, and NEVER loads Leaflet (§7)', async () => {
    render(
      <WidgetRuntimeProvider env={DESKTOP}>
        <WidgetHost widgetId="map-bubble" instanceId="i2" config={{}} data={data} />
      </WidgetRuntimeProvider>,
    );
    expect(await mountedWidget()).toBe('map-choropleth-grid');
    // §7's maps row, verbatim: "Leaflet is never loaded in desktop runtime".
    // The mount effect that would import it belongs to a component that was
    // never constructed, so there is nothing to fail and nothing to catch.
    expect(leafletLoads).not.toHaveBeenCalled();
  });

  it('mounts the tilegram when offlineAssets is forced on a browser runtime', async () => {
    render(
      <WidgetRuntimeProvider env={OFFLINE_BROWSER}>
        <WidgetHost widgetId="map-bubble" instanceId="i3" config={{}} data={data} />
      </WidgetRuntimeProvider>,
    );
    expect(await mountedWidget()).toBe('map-choropleth-grid');
    expect(leafletLoads).not.toHaveBeenCalled();
  });

  it('renders the real map with no provider at all (the default is online)', async () => {
    // Self-host and Cloud mount no provider today. If the default ever flipped,
    // every map in the product would quietly become a tilegram.
    render(<WidgetHost widgetId="map-bubble" instanceId="i4" config={{}} data={data} />);
    expect(await mountedWidget()).toBe('map-bubble');
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
