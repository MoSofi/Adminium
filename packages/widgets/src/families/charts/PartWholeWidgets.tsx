/**
 * `charts` family — part-to-whole & hierarchy wrappers (04-T09): map stored
 * instance config + §3 envelopes onto the @adminium/charts primitives. Loaded
 * lazily (one chunk per family, 04 §2.3); components render only the LOADED
 * state — WidgetFrame owns skeleton/empty/error. Accessible names come from
 * `config.title` (rendered as the SVG aria-label). Direction flows from the
 * ChartDirectionContext the dashboard bridges from the i18n `dir` (04 §7.4).
 */
import { Chord, Funnel, Radar, RadialBar, Sunburst, Treemap, WordCloud } from '@adminium/charts';

import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import type { WidgetProps } from '../../registry/types.js';
import {
  chordInputsOf,
  funnelInputsOf,
  radarInputsOf,
  radialBarInputsOf,
  sunburstInputsOf,
  treemapInputsOf,
  wordcloudInputsOf,
} from './part-whole-config.js';
import type {
  ChartChordConfig,
  ChartFunnelConfig,
  ChartRadarConfig,
  ChartRadialBarConfig,
  ChartSunburstConfig,
  ChartTreemapConfig,
  ChartWordcloudConfig,
} from './part-whole-config.js';

function BadShape() {
  return <p className="px-4 pb-4 text-body-sm text-fg-muted">Unexpected data shape.</p>;
}

// --- chart-treemap -----------------------------------------------------------

export function ChartTreemapWidget({ config, data }: WidgetProps<ChartTreemapConfig>) {
  const inputs = treemapInputsOf(data);
  if (inputs === null) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-treemap">
      <Treemap
        data={inputs}
        labels={{ label: config.title ?? 'Treemap' }}
        maxTiles={config.maxTiles}
        height={config.height}
        format={(value: number) => formatMetricValue(value, config.metricFormat, opts)}
      />
    </div>
  );
}

// --- chart-sunburst ----------------------------------------------------------

export function ChartSunburstWidget({ config, data }: WidgetProps<ChartSunburstConfig>) {
  const inputs = sunburstInputsOf(data);
  if (inputs === null) return <BadShape />;
  return (
    <div className="flex justify-center px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-sunburst">
      <Sunburst
        data={inputs}
        labels={{ label: config.title ?? 'Sunburst' }}
        size={config.size}
        showLegend={config.showLegend}
      />
    </div>
  );
}

// --- chart-funnel ------------------------------------------------------------

export function ChartFunnelWidget({ config, data }: WidgetProps<ChartFunnelConfig>) {
  const inputs = funnelInputsOf(data);
  if (inputs === null) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-funnel">
      <Funnel
        data={inputs}
        labels={{ label: config.title ?? 'Funnel' }}
        variant={config.variant}
        showStepConversion={config.showStepConversion}
        overallFooter={config.overallFooter}
        height={config.height}
        format={(value: number) => formatMetricValue(value, config.metricFormat, opts)}
      />
    </div>
  );
}

// --- chart-radial-bar --------------------------------------------------------

export function ChartRadialBarWidget({ config, data }: WidgetProps<ChartRadialBarConfig>) {
  const inputs = radialBarInputsOf(data, config.maxRings);
  if (inputs === null) return <BadShape />;
  return (
    <div className="flex justify-center px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-radial-bar">
      <RadialBar
        data={inputs}
        labels={{ label: config.title ?? 'Radial bar' }}
        size={config.size}
        showLegend={config.showLegend}
      />
    </div>
  );
}

// --- chart-radar -------------------------------------------------------------

export function ChartRadarWidget({ config, data }: WidgetProps<ChartRadarConfig>) {
  const inputs = radarInputsOf(data);
  if (inputs === null || inputs.axes.length === 0) return <BadShape />;
  return (
    <div className="flex justify-center px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-radar">
      <Radar
        axes={inputs.axes}
        series={inputs.series}
        labels={{ label: config.title ?? 'Radar' }}
        size={config.size}
        levels={config.levels}
        showLegend={config.showLegend}
      />
    </div>
  );
}

// --- chart-chord -------------------------------------------------------------

export function ChartChordWidget({ config, data }: WidgetProps<ChartChordConfig>) {
  const inputs = chordInputsOf(data, config.nodeLimit);
  if (inputs === null) return <BadShape />;
  return (
    <div className="flex justify-center px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-chord">
      <Chord
        nodes={inputs.nodes}
        links={inputs.links}
        labels={{ label: config.title ?? 'Chord' }}
        size={config.size}
        showLegend={config.showLegend}
      />
    </div>
  );
}

// --- chart-wordcloud ---------------------------------------------------------

export function ChartWordcloudWidget({ config, data }: WidgetProps<ChartWordcloudConfig>) {
  const inputs = wordcloudInputsOf(data, config.maxTerms);
  if (inputs === null) return <BadShape />;
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-wordcloud">
      <WordCloud
        data={inputs}
        labels={{ label: config.title ?? 'Word cloud' }}
        height={config.height}
        maxTerms={config.maxTerms}
        minFontSize={config.minFontSize}
        maxFontSize={config.maxFontSize}
      />
    </div>
  );
}
