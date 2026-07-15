/**
 * Stories for the part-to-whole & hierarchy charts (04-T09 / acceptance #4):
 * each widget's loaded variant plus the four WidgetFrame states through
 * WidgetHost — loaded / skeleton / empty (per-widget copy) / error+Retry ×
 * LTR & RTL. Demo payloads are the same deterministic seeded generators the
 * registry's `demoData` uses, so stories match demo mode exactly. Widgets are
 * referenced by id so the story never imports the lazy chart chunk directly.
 */
import { ChartDirectionContext } from '@adminium/charts';

import { WidgetHost } from '../../frame/WidgetHost.js';
import {
  chordDemoData,
  funnelDemoData,
  radarDemoData,
  radialBarDemoData,
  sunburstDemoData,
  treemapDemoData,
  wordcloudDemoData,
} from './def.part-whole.js';

const meta = {
  title: 'Widgets/Charts/PartWhole',
};
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
  width = 'w-[30rem]',
) {
  return (
    <div className={width}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('TABLE_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

export const Treemap = {
  render: () => host('chart-treemap', 'story-treemap', { title: 'Storage by table' }, treemapDemoData(7)),
};

export const Sunburst = {
  render: () => host('chart-sunburst', 'story-sunburst', { title: 'Traffic sources' }, sunburstDemoData(3), 'success', 'w-96'),
};

export const FunnelStepped = {
  render: () => host('chart-funnel', 'story-funnel-1', { title: 'Onboarding funnel', variant: 'stepped' }, funnelDemoData(5)),
};

export const FunnelHorizontal = {
  render: () =>
    host('chart-funnel', 'story-funnel-2', { title: 'Checkout funnel', variant: 'horizontal', showStepConversion: false }, funnelDemoData(9)),
};

export const RadialBar = {
  render: () => host('chart-radial-bar', 'story-radial', { title: 'Sessions by device' }, radialBarDemoData(2), 'success', 'w-80'),
};

export const Radar = {
  render: () => host('chart-radar', 'story-radar', { title: 'Product scorecard' }, radarDemoData(4), 'success', 'w-96'),
};

export const Chord = {
  render: () => host('chart-chord', 'story-chord', { title: 'Team collaboration' }, chordDemoData(6), 'success', 'w-96'),
};

export const WordCloud = {
  render: () => host('chart-wordcloud', 'story-wordcloud', { title: 'Top search terms' }, wordcloudDemoData(8)),
};

/**
 * LTR vs RTL — categorical part-to-whole layouts mirror (04 §7.4). The charts
 * read direction from `ChartDirectionContext` (via `useChartDir`), not the DOM
 * `dir` attribute, so the context provider is what mirrors the SVG geometry.
 */
export const Rtl = {
  render: () => (
    <div dir="rtl">
      <ChartDirectionContext.Provider value="rtl">
        <div className="flex flex-wrap gap-4">
          {host('chart-treemap', 'story-treemap-rtl', { title: 'التخزين حسب الجدول' }, treemapDemoData(7))}
          {host('chart-funnel', 'story-funnel-rtl', { title: 'مسار التحويل' }, funnelDemoData(5))}
        </div>
      </ChartDirectionContext.Provider>
    </div>
  ),
};

/** The four WidgetFrame states, incl. per-widget empty copy + error Retry. */
export const States = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {host('chart-treemap', 'story-skeleton', { title: 'Loading' }, undefined, 'loading', 'w-80')}
      {host('chart-treemap', 'story-error', { title: 'Denied' }, undefined, 'error', 'w-80')}
      {host('chart-funnel', 'story-empty', { title: 'No funnel' }, { items: [], total: 0 }, 'success', 'w-80')}
      {host(
        'chart-chord',
        'story-empty-override',
        { title: 'No handoffs', emptyState: { titleKey: 'No handoffs yet', bodyKey: 'Once teams collaborate they appear here.' } },
        { nodes: [], links: [] },
        'success',
        'w-80',
      )}
    </div>
  ),
};
