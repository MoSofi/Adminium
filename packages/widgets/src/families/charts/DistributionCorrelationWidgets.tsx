// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Distribution & correlation charts group (04-T09): registry wrappers mapping
 * stored instance config + §3 envelopes onto the @adminium/charts primitives
 * (`chart-boxplot`, `chart-violin`, `chart-ridgeline`, `chart-scatter-bubble`,
 * `chart-hexbin`, `chart-correlation-matrix`, `chart-parallel-coordinates`).
 * Components render only the loaded state; accessible names come from
 * config.title (the primitive renders it as the SVG aria-label). Chrome text
 * (aria-label defaults, the per-widget nothing-to-plot copy) resolves through
 * `useMaybeT` — `ui:widgets.charts.*` under an I18nProvider, the identical
 * English fallback outside one.
 */
import {
  BoxPlotChart,
  CorrelationMatrixChart,
  HexbinChart,
  ParallelCoordinatesChart,
  RidgelineChart,
  ScatterBubbleChart,
  ViolinChart,
} from '@adminium/charts';
import type { ParallelAxisInput, ParallelRecordInput, ScatterPointInput } from '@adminium/charts';
import { EmptyState } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import type { WidgetProps } from '../../registry/types.js';
import {
  asDistribution,
  asMatrix,
  asRecordList,
  rowNumber,
  rowString,
} from './distributionShapes.js';
import type {
  ChartBoxplotConfig,
  ChartCorrelationMatrixConfig,
  ChartHexbinConfig,
  ChartParallelCoordinatesConfig,
  ChartRidgelineConfig,
  ChartScatterBubbleConfig,
  ChartViolinConfig,
} from './distributionShapes.js';

function BadShape() {
  const t = useMaybeT();
  return <p className="px-[var(--widget-pad)] pb-[var(--widget-pad)] text-body-sm text-fg-muted">{t('ui:widgets.charts.unexpectedShape', 'Unexpected data shape.')}</p>;
}

/**
 * Per-widget "nothing to plot" state (bundle `widgets.charts.<id>.emptyTitle`/
 * `emptyBody`), rendered when the §3 envelope narrows fine but yields nothing
 * plottable (WidgetFrame's per-shape predicate cannot see these sub-cases). A
 * config `emptyState` override keeps winning over the localized default.
 */
function ChartEmptyState({ title, body }: { title: string; body: string }) {
  return <EmptyState compact preset="no-data" title={title} body={body} />;
}

// --- chart-boxplot -----------------------------------------------------------

export function ChartBoxplotWidget({ config, data }: WidgetProps<ChartBoxplotConfig>) {
  const t = useMaybeT();
  const distribution = asDistribution(data);
  if (distribution === null) return <BadShape />;
  if (distribution.groups.length === 0) {
    return (
      <ChartEmptyState
        title={config.emptyState?.titleKey ?? t('ui:widgets.charts.boxplot.emptyTitle', 'No distribution to plot')}
        body={config.emptyState?.bodyKey ?? t('ui:widgets.charts.boxplot.emptyBody', 'No rows matched the filters to summarise as box plots.')}
      />
    );
  }
  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chart-boxplot">
      <BoxPlotChart
        groups={distribution.groups}
        labels={{ label: config.title ?? t('ui:widgets.charts.boxplot.chartLabel', 'Box plot') }}
        showAxis={config.showAxis}
        showCategoryLabels={config.showCategoryLabels}
        height={config.height}
      />
    </div>
  );
}

// --- chart-violin ------------------------------------------------------------

export function ChartViolinWidget({ config, data }: WidgetProps<ChartViolinConfig>) {
  const t = useMaybeT();
  const distribution = asDistribution(data);
  if (distribution === null) return <BadShape />;
  const groups = distribution.groups
    .filter((g) => g.density !== undefined && g.density.length > 0)
    .map((g) => ({ label: g.label, min: g.min, max: g.max, med: g.med, density: g.density ?? [] }));
  if (groups.length === 0) {
    return (
      <ChartEmptyState
        title={config.emptyState?.titleKey ?? t('ui:widgets.charts.violin.emptyTitle', 'No distribution to plot')}
        body={config.emptyState?.bodyKey ?? t('ui:widgets.charts.violin.emptyBody', 'No rows matched the filters to build density profiles.')}
      />
    );
  }
  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chart-violin">
      <ViolinChart
        groups={groups}
        labels={{ label: config.title ?? t('ui:widgets.charts.violin.chartLabel', 'Violin plot') }}
        showAxis={config.showAxis}
        showCategoryLabels={config.showCategoryLabels}
        height={config.height}
      />
    </div>
  );
}

// --- chart-ridgeline ---------------------------------------------------------

export function ChartRidgelineWidget({ config, data }: WidgetProps<ChartRidgelineConfig>) {
  const t = useMaybeT();
  const distribution = asDistribution(data);
  if (distribution === null) return <BadShape />;
  const groups = distribution.groups
    .filter((g) => g.density !== undefined && g.density.length > 0)
    .map((g) => ({ label: g.label, density: g.density ?? [] }));
  if (groups.length === 0) {
    return (
      <ChartEmptyState
        title={config.emptyState?.titleKey ?? t('ui:widgets.charts.ridgeline.emptyTitle', 'No ridges to plot')}
        body={config.emptyState?.bodyKey ?? t('ui:widgets.charts.ridgeline.emptyBody', 'No rows matched the filters to build density profiles.')}
      />
    );
  }
  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chart-ridgeline">
      <RidgelineChart
        groups={groups}
        labels={{ label: config.title ?? t('ui:widgets.charts.ridgeline.chartLabel', 'Ridgeline') }}
        overlap={config.overlap}
        showLabels={config.showLabels}
        height={config.height}
      />
    </div>
  );
}

// --- chart-scatter-bubble ----------------------------------------------------

/** Projects record-list rows onto scatter points via the config field mapping. */
export function scatterPointsOf(
  rows: readonly Record<string, unknown>[],
  config: ChartScatterBubbleConfig,
): ScatterPointInput[] {
  const points: ScatterPointInput[] = [];
  for (const row of rows) {
    const x = rowNumber(row, config.xField);
    const y = rowNumber(row, config.yField);
    if (x === undefined || y === undefined) continue;
    points.push({
      x,
      y,
      r: config.rField !== undefined ? rowNumber(row, config.rField) : undefined,
      segment: config.segmentField !== undefined ? rowString(row, config.segmentField) : undefined,
    });
  }
  return points;
}

export function ChartScatterBubbleWidget({ config, data }: WidgetProps<ChartScatterBubbleConfig>) {
  const t = useMaybeT();
  const list = asRecordList(data);
  if (list === null) return <BadShape />;
  const points = scatterPointsOf(list.rows, config);
  if (points.length === 0) {
    return (
      <ChartEmptyState
        title={config.emptyState?.titleKey ?? t('ui:widgets.charts.scatterBubble.emptyTitle', 'No points to plot')}
        body={config.emptyState?.bodyKey ?? t('ui:widgets.charts.scatterBubble.emptyBody', 'No rows matched the filters for the selected columns.')}
      />
    );
  }
  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chart-scatter-bubble">
      <ScatterBubbleChart
        points={points}
        labels={{ label: config.title ?? t('ui:widgets.charts.scatterBubble.chartLabel', 'Scatter plot') }}
        trendLine={config.trendLine}
        showAxis={config.axisLabels}
        height={config.height}
      />
    </div>
  );
}

// --- chart-hexbin ------------------------------------------------------------

export function ChartHexbinWidget({ config, data }: WidgetProps<ChartHexbinConfig>) {
  const t = useMaybeT();
  const matrix = asMatrix(data);
  if (matrix === null) return <BadShape />;
  if (matrix.cells.length === 0) {
    return (
      <ChartEmptyState
        title={config.emptyState?.titleKey ?? t('ui:widgets.charts.hexbin.emptyTitle', 'No density to plot')}
        body={config.emptyState?.bodyKey ?? t('ui:widgets.charts.hexbin.emptyBody', 'No rows matched the filters to bin.')}
      />
    );
  }
  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chart-hexbin">
      <HexbinChart
        cells={matrix.cells}
        labels={{ label: config.title ?? t('ui:widgets.charts.hexbin.chartLabel', 'Density hexbin') }}
        minAlpha={config.minAlpha}
        height={config.height}
      />
    </div>
  );
}

// --- chart-correlation-matrix ------------------------------------------------

export function ChartCorrelationMatrixWidget({ config, data }: WidgetProps<ChartCorrelationMatrixConfig>) {
  const t = useMaybeT();
  const matrix = asMatrix(data);
  if (matrix === null) return <BadShape />;
  if (matrix.cells.length === 0 || matrix.colKeys.length === 0) {
    return (
      <ChartEmptyState
        title={config.emptyState?.titleKey ?? t('ui:widgets.charts.correlationMatrix.emptyTitle', 'Nothing to correlate')}
        body={config.emptyState?.bodyKey ?? t('ui:widgets.charts.correlationMatrix.emptyBody', 'Select at least two numeric columns with matching rows.')}
      />
    );
  }
  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chart-correlation-matrix">
      <CorrelationMatrixChart
        cells={matrix.cells}
        columns={matrix.colKeys}
        labels={{ label: config.title ?? t('ui:widgets.charts.correlationMatrix.chartLabel', 'Correlation matrix') }}
        showLabels={config.showLabels}
        strongThreshold={config.strongThreshold}
        height={config.height}
      />
    </div>
  );
}

// --- chart-parallel-coordinates ----------------------------------------------

/** Builds normalised axes + one record per row from the config axis columns. */
export function parallelInputsOf(
  rows: readonly Record<string, unknown>[],
  config: ChartParallelCoordinatesConfig,
): { axes: ParallelAxisInput[]; records: ParallelRecordInput[] } | null {
  const keys = config.axes;
  if (keys.length < 2) return null;
  const bounds = keys.map((key) => {
    let min = Infinity;
    let max = -Infinity;
    for (const row of rows) {
      const value = rowNumber(row, key);
      if (value === undefined) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return min <= max ? { min, max } : { min: 0, max: 1 };
  });
  const axes: ParallelAxisInput[] = keys.map((key, i) => ({
    key,
    label: key,
    min: bounds[i]?.min ?? 0,
    max: bounds[i]?.max ?? 1,
  }));
  const records: ParallelRecordInput[] = [];
  for (const row of rows) {
    const values = keys.map((key) => rowNumber(row, key) ?? 0);
    records.push({
      values,
      segment: config.colorBy !== undefined ? rowString(row, config.colorBy) : undefined,
    });
  }
  return { axes, records };
}

export function ChartParallelCoordinatesWidget({ config, data }: WidgetProps<ChartParallelCoordinatesConfig>) {
  const t = useMaybeT();
  const list = asRecordList(data);
  if (list === null) return <BadShape />;
  const inputs = parallelInputsOf(list.rows, config);
  if (inputs === null || inputs.records.length === 0) {
    return (
      <ChartEmptyState
        title={config.emptyState?.titleKey ?? t('ui:widgets.charts.parallelCoordinates.emptyTitle', 'No records to plot')}
        body={config.emptyState?.bodyKey ?? t('ui:widgets.charts.parallelCoordinates.emptyBody', 'No rows matched the filters across the selected axes.')}
      />
    );
  }
  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chart-parallel-coordinates">
      <ParallelCoordinatesChart
        axes={inputs.axes}
        records={inputs.records}
        labels={{ label: config.title ?? t('ui:widgets.charts.parallelCoordinates.chartLabel', 'Parallel coordinates') }}
        showAxisLabels={config.showAxisLabels}
        height={config.height}
      />
    </div>
  );
}
