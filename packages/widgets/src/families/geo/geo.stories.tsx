/**
 * TRACK COMM-GEO `geo` family stories (annex §7): the Leaflet bubble map and the
 * region-coded tilegram, the four WidgetFrame states through WidgetHost
 * (acceptance #4), and light/dark × LTR/RTL matrices with REAL geometry
 * (acceptance #9).
 *
 * WHAT "REAL GEOMETRY" MEANS FOR A MAP (04 §7.4): the RTL frames set `dir="rtl"`
 * on a genuine host wrapper, so the chrome — metric tabs, ranked list, legend —
 * actually mirrors through logical properties. The map canvas and the US tilegram
 * deliberately do NOT: they are fixed-LTR islands, because geography is not a
 * reading order. A capture where the world map mirrored would be the bug, not the
 * fix — so these frames are the regression test for the island holding.
 *
 * Widgets resolve through a LOCAL registry override so the stories work before
 * the green loop merges the definitions into the global map. Payloads are the
 * same seeded generators `demoData` uses, so VRT captures are byte-deterministic
 * (04-T17).
 *
 * NOTE ON THE MAP IN CI: Leaflet loads on demand inside MapBubble's mount effect
 * and fetches Carto tiles over the network. In a sandboxed VRT runner it degrades
 * to `data-map-status="unavailable"` and the ranked list carries the frame —
 * which is itself worth capturing, and is why `MapUnavailable` below is a story
 * rather than an accident.
 */
import type { ReactNode } from 'react';

import { MapBubble } from './MapBubble.js';
import { MapChoroplethGrid } from './MapChoroplethGrid.js';
import { mapBubbleDemoData, mapChoroplethGridDemoData } from './geo-config.js';
import { mapBubbleDefinition, mapChoroplethGridDefinition } from './geo-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([mapBubbleDefinition, mapChoroplethGridDefinition] as WidgetDefinition[]);

const meta = { title: 'Widgets/Geo' };
export default meta;

type Status = 'success' | 'loading' | 'error';

/** Pin the locale so every formatted metric is byte-deterministic. */
const PINNED = { format: { locale: 'en-US' } };

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
) {
  return (
    <div className="h-[28rem] w-full">
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={{ ...PINNED, ...config }}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('GEO_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

const bubbleConfig = {
  title: 'Users by city',
  metrics: ['users', 'revenue'],
  metricLabels: { users: 'Users', revenue: 'Revenue' },
  valueFormat: 'compact',
};
const choroplethConfig = { title: 'Sales by state', metric: 'sales', layout: 'us-tilegram', valueFormat: 'currency' };

export const MapBubbleStory = {
  name: 'map-bubble',
  render: () => host('map-bubble', 's-bubble', bubbleConfig, mapBubbleDemoData(7)),
};

export const MapChoroplethGridStory = {
  name: 'map-choropleth-grid',
  render: () => host('map-choropleth-grid', 's-choro', choroplethConfig, mapChoroplethGridDemoData(7)),
};

/**
 * The annex §7 pairing decision, side by side: coordinates → `map-bubble`;
 * region codes and no coordinates → `map-choropleth-grid`. Same data question,
 * two answers depending on what the table actually carries.
 */
export const BubbleAndChoropleth = {
  name: 'map-bubble + map-choropleth-grid (the §7 pair)',
  render: () => (
    <Frame>
      <div className="flex flex-wrap gap-4">
        <div className="min-w-[24rem] flex-1">{host('map-bubble', 'p-bubble', bubbleConfig, mapBubbleDemoData(7))}</div>
        <div className="min-w-[24rem] flex-1">
          {host('map-choropleth-grid', 'p-choro', choroplethConfig, mapChoroplethGridDemoData(7))}
        </div>
      </div>
    </Frame>
  ),
};

/** All four WidgetFrame states (loaded · skeleton · empty · error). */
export const MapBubbleStates = {
  name: 'map-bubble (four states)',
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('map-bubble', 'bs-loaded', bubbleConfig, mapBubbleDemoData(7))}
        {host('map-bubble', 'bs-skeleton', bubbleConfig, undefined, 'loading')}
        {host('map-bubble', 'bs-empty', { ...bubbleConfig, emptyState: { titleKey: 'No locations' } }, { points: [] })}
        {host('map-bubble', 'bs-error', bubbleConfig, undefined, 'error')}
      </div>
    </Frame>
  ),
};

export const MapChoroplethGridStates = {
  name: 'map-choropleth-grid (four states)',
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('map-choropleth-grid', 'cs-loaded', choroplethConfig, mapChoroplethGridDemoData(7))}
        {host('map-choropleth-grid', 'cs-skeleton', choroplethConfig, undefined, 'loading')}
        {host(
          'map-choropleth-grid',
          'cs-empty',
          { ...choroplethConfig, emptyState: { titleKey: 'No regions' } },
          { points: [] },
        )}
        {host('map-choropleth-grid', 'cs-error', choroplethConfig, undefined, 'error')}
      </div>
    </Frame>
  ),
};

/**
 * Light × dark × LTR × RTL. The RTL frames genuinely mirror the CHROME — the
 * metric tabs and ranked list swap edges because they are expressed with logical
 * properties — while the map canvas stays `dir="ltr"`. That asymmetry is the
 * feature: a mirrored world map is a wrong map (04 §7.4).
 *
 * The dark frames are also where the Carto tile swap shows: `subscribeTheme`
 * repoints the basemap at `dark_all` when the theme resolves to dark.
 */
export const MapBubbleThemeAndDirectionMatrix = {
  name: 'map-bubble (light/dark × LTR/RTL — chrome mirrors, map does not)',
  render: () => {
    const points = mapBubbleDemoData(7).points;
    const map = () => (
      <div className="h-[22rem]">
        <MapBubble
          points={points}
          metrics={['users', 'revenue']}
          metricLabels={{ users: 'Users', revenue: 'Revenue' }}
          regionsLabel="Top regions"
          format={(value) => value.toLocaleString('en-US')}
        />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{map()}</Frame>
        <Frame dir="rtl">{map()}</Frame>
        <Frame dark dir="ltr">{map()}</Frame>
        <Frame dark dir="rtl">{map()}</Frame>
      </div>
    );
  },
};

/**
 * The tilegram under both directions. Its tiles do not mirror either (a
 * geographic island, same policy as the map canvas — `choroplethLayout` only
 * mirrors the non-geographic compact `grid` layout), but the ranked companion
 * beside it does.
 */
export const ChoroplethThemeAndDirectionMatrix = {
  name: 'map-choropleth-grid (light/dark × LTR/RTL — tilegram is an LTR island)',
  render: () => {
    const points = mapChoroplethGridDemoData(7).points;
    const grid = () => (
      <MapChoroplethGrid
        points={points}
        metric="sales"
        label="Sales by state"
        legendLabels={{ low: 'Low', high: 'High' }}
        format={(value) => value.toLocaleString('en-US')}
      />
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{grid()}</Frame>
        <Frame dir="rtl">{grid()}</Frame>
        <Frame dark dir="ltr">{grid()}</Frame>
        <Frame dark dir="rtl">{grid()}</Frame>
      </div>
    );
  },
};

/**
 * The compact `grid` layout — the annex's alternative to the US tilegram, for
 * non-US region codes. Unlike the tilegram this one IS categorical, so its
 * columns mirror under RTL (04 §7.4, applied by `choroplethLayout`).
 */
export const ChoroplethCompactGrid = {
  name: 'map-choropleth-grid (compact grid layout)',
  render: () => {
    const points = mapChoroplethGridDemoData(7).points;
    const grid = () => <MapChoroplethGrid points={points} metric="orders" layout="grid" columns={6} topN={0} />;
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{grid()}</Frame>
        <Frame dir="rtl">{grid()}</Frame>
      </div>
    );
  },
};

/**
 * The degraded map: no Leaflet, no tiles, still useful. This is what an offline
 * desktop build, a blocked tile CDN, or a failed chunk fetch looks like — the
 * ranked list carries the widget, which is why it is real content and not merely
 * a screen-reader fallback.
 */
export const MapUnavailable = {
  name: 'map-bubble (map unavailable — the ranked list carries it)',
  render: () => (
    <Frame>
      <div className="h-[22rem] w-[28rem]">
        <MapBubble
          points={mapBubbleDemoData(7).points}
          metrics={['users']}
          mapUnavailableLabel="The map could not be loaded. The ranked list shows the same data."
          format={(value) => value.toLocaleString('en-US')}
        />
      </div>
    </Frame>
  ),
};
