// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `charts` family definitions (annex §2; M4-T05 slice: `chart-line-area`,
 * `chart-bar`, `chart-donut`, `chart-sparkline` — the remaining ~33 ids
 * land with 04-T09). Metadata only; component code loads through the
 * `components.ts` barrel via `lazy()` so Vite emits one chunk for the
 * whole family (04 §2.3). Demo payloads come from the deterministic
 * seeded generators in @adminium/charts (04 §7.7), converted into the §3
 * envelopes the live server returns.
 */

import { lazy } from 'react';
import { demoCategorical, demoComparisonSeries, demoTimeseries } from '@adminium/charts';
import type { DemoPoint } from '@adminium/charts';

import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';
import {
  chartBarConfigSchema,
  chartDonutConfigSchema,
  chartLineAreaConfigSchema,
  chartSparklineConfigSchema,
} from './charts-config.js';

function toEnvelopePoints(points: readonly DemoPoint[]): { t: string; v: number }[] {
  return points.map((point) => ({ t: point.x.toISOString(), v: point.y }));
}

/** `timeseries` demo with a prior-period comparison series. */
export function timeseriesDemoData(seed: number): {
  points: { t: string; v: number }[];
  compare: { t: string; v: number }[];
} {
  const points = demoTimeseries(seed, { points: 30 });
  return {
    points: toEnvelopePoints(points),
    compare: toEnvelopePoints(demoComparisonSeries(points, seed)),
  };
}

export function shortTimeseriesDemoData(seed: number): { points: { t: string; v: number }[] } {
  return { points: toEnvelopePoints(demoTimeseries(seed, { points: 8 })) };
}

export function categoricalDemoData(seed: number): {
  items: { key: string; label: string; value: number }[];
  total: number;
} {
  const items = demoCategorical(seed).map((category) => ({
    key: category.label.toLowerCase(),
    label: category.label,
    value: category.value,
  }));
  return { items, total: items.reduce((sum, item) => sum + item.value, 0) };
}

export const chartsWidgetDefinitions: readonly WidgetDefinition[] = [
  defineWidget({
    id: 'chart-line-area',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./components.js')).ChartLineAreaWidget })),
    configSchema: chartLineAreaConfigSchema,
    dataContract: 'timeseries',
    sizing: { minW: 4, minH: 4, defaultW: 8, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: timeseriesDemoData,
    descriptionKey: 'widgets.charts.lineArea.description',
  }),
  defineWidget({
    id: 'chart-bar',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./components.js')).ChartBarWidget })),
    configSchema: chartBarConfigSchema,
    dataContract: ['timeseries', 'categorical'],
    sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: (seed) => shortTimeseriesDemoData(seed),
    descriptionKey: 'widgets.charts.bar.description',
  }),
  defineWidget({
    id: 'chart-donut',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./components.js')).ChartDonutWidget })),
    configSchema: chartDonutConfigSchema,
    dataContract: 'categorical',
    sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: categoricalDemoData,
    descriptionKey: 'widgets.charts.donut.description',
  }),
  defineWidget({
    id: 'chart-sparkline',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./components.js')).ChartSparklineWidget })),
    configSchema: chartSparklineConfigSchema,
    dataContract: 'timeseries',
    sizing: { minW: 1, minH: 1, defaultW: 2, defaultH: 1 },
    placement: 'inline',
    skeleton: 'block',
    demoData: (seed) => shortTimeseriesDemoData(seed),
    descriptionKey: 'widgets.charts.sparkline.description',
  }),
];
