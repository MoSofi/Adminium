/**
 * Distribution & correlation charts group (04-T09): registry wrappers mapping
 * stored instance config + §3 envelopes onto the @adminium/charts primitives
 * (`chart-boxplot`, `chart-violin`, `chart-ridgeline`, `chart-scatter-bubble`,
 * `chart-hexbin`, `chart-correlation-matrix`, `chart-parallel-coordinates`).
 * Components render only the loaded state; accessible names come from
 * config.title (the primitive renders it as the SVG aria-label).
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
  return <p className="px-4 pb-4 text-body-sm text-fg-muted">Unexpected data shape.</p>;
}

// --- chart-boxplot -----------------------------------------------------------

export function ChartBoxplotWidget({ config, data }: WidgetProps<ChartBoxplotConfig>) {
  const distribution = asDistribution(data);
  if (distribution === null || distribution.groups.length === 0) return <BadShape />;
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-boxplot">
      <BoxPlotChart
        groups={distribution.groups}
        labels={{ label: config.title ?? 'Box plot' }}
        showAxis={config.showAxis}
        showCategoryLabels={config.showCategoryLabels}
        height={config.height}
      />
    </div>
  );
}

// --- chart-violin ------------------------------------------------------------

export function ChartViolinWidget({ config, data }: WidgetProps<ChartViolinConfig>) {
  const distribution = asDistribution(data);
  if (distribution === null) return <BadShape />;
  const groups = distribution.groups
    .filter((g) => g.density !== undefined && g.density.length > 0)
    .map((g) => ({ label: g.label, min: g.min, max: g.max, med: g.med, density: g.density ?? [] }));
  if (groups.length === 0) return <BadShape />;
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-violin">
      <ViolinChart
        groups={groups}
        labels={{ label: config.title ?? 'Violin plot' }}
        showAxis={config.showAxis}
        showCategoryLabels={config.showCategoryLabels}
        height={config.height}
      />
    </div>
  );
}

// --- chart-ridgeline ---------------------------------------------------------

export function ChartRidgelineWidget({ config, data }: WidgetProps<ChartRidgelineConfig>) {
  const distribution = asDistribution(data);
  if (distribution === null) return <BadShape />;
  const groups = distribution.groups
    .filter((g) => g.density !== undefined && g.density.length > 0)
    .map((g) => ({ label: g.label, density: g.density ?? [] }));
  if (groups.length === 0) return <BadShape />;
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-ridgeline">
      <RidgelineChart
        groups={groups}
        labels={{ label: config.title ?? 'Ridgeline' }}
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
  const list = asRecordList(data);
  if (list === null) return <BadShape />;
  const points = scatterPointsOf(list.rows, config);
  if (points.length === 0) return <BadShape />;
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-scatter-bubble">
      <ScatterBubbleChart
        points={points}
        labels={{ label: config.title ?? 'Scatter plot' }}
        trendLine={config.trendLine}
        showAxis={config.axisLabels}
        height={config.height}
      />
    </div>
  );
}

// --- chart-hexbin ------------------------------------------------------------

export function ChartHexbinWidget({ config, data }: WidgetProps<ChartHexbinConfig>) {
  const matrix = asMatrix(data);
  if (matrix === null || matrix.cells.length === 0) return <BadShape />;
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-hexbin">
      <HexbinChart
        cells={matrix.cells}
        labels={{ label: config.title ?? 'Density hexbin' }}
        minAlpha={config.minAlpha}
        height={config.height}
      />
    </div>
  );
}

// --- chart-correlation-matrix ------------------------------------------------

export function ChartCorrelationMatrixWidget({ config, data }: WidgetProps<ChartCorrelationMatrixConfig>) {
  const matrix = asMatrix(data);
  if (matrix === null || matrix.cells.length === 0 || matrix.colKeys.length === 0) return <BadShape />;
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-correlation-matrix">
      <CorrelationMatrixChart
        cells={matrix.cells}
        columns={matrix.colKeys}
        labels={{ label: config.title ?? 'Correlation matrix' }}
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
  const list = asRecordList(data);
  if (list === null) return <BadShape />;
  const inputs = parallelInputsOf(list.rows, config);
  if (inputs === null || inputs.records.length === 0) return <BadShape />;
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-parallel-coordinates">
      <ParallelCoordinatesChart
        axes={inputs.axes}
        records={inputs.records}
        labels={{ label: config.title ?? 'Parallel coordinates' }}
        showAxisLabels={config.showAxisLabels}
        height={config.height}
      />
    </div>
  );
}
