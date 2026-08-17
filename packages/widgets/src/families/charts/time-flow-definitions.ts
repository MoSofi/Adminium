// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `charts` family "time, forecast & flow" definitions (04-T09; annex §2 ids
 * chart-multiline, chart-stream, chart-forecast, chart-anomaly,
 * chart-candlestick, chart-bump, chart-timeline-lanes). Metadata only; the green
 * loop spreads `timeFlowChartDefinitions` into the family's registry wiring.
 * Component code loads through the group barrel via `lazy()` so the whole group
 * stays in the one `charts` chunk (04 §2.3). Annex grid heights are rows;
 * `sizing` stores 40px half-units (rows × 2, 04 §6.1).
 */
import { lazy } from 'react';

import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';
import {
  chartAnomalyConfigSchema,
  chartBumpConfigSchema,
  chartCandlestickConfigSchema,
  chartForecastConfigSchema,
  chartMultilineConfigSchema,
  chartStreamConfigSchema,
  chartTimelineLanesConfigSchema,
} from './time-flow-config.js';
import {
  chartAnomalyDemoData,
  chartBumpDemoData,
  chartCandlestickDemoData,
  chartForecastDemoData,
  chartMultilineDemoData,
  chartStreamDemoData,
  chartTimelineLanesDemoData,
} from './time-flow-demo.js';

export const timeFlowChartDefinitions: readonly WidgetDefinition[] = [
  defineWidget({
    id: 'chart-multiline',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./time-flow-components.js')).ChartMultilineWidget })),
    configSchema: chartMultilineConfigSchema,
    dataContract: 'multi-timeseries',
    sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 6 }, // annex min 4×2, default 6×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: chartMultilineDemoData,
    descriptionKey: 'widgets.charts.multiline.description',
  }),
  defineWidget({
    id: 'chart-stream',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./time-flow-components.js')).ChartStreamWidget })),
    configSchema: chartStreamConfigSchema,
    dataContract: 'multi-timeseries',
    sizing: { minW: 6, minH: 6, defaultW: 8, defaultH: 6 }, // annex min 6×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: chartStreamDemoData,
    descriptionKey: 'widgets.charts.stream.description',
  }),
  defineWidget({
    id: 'chart-forecast',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./time-flow-components.js')).ChartForecastWidget })),
    configSchema: chartForecastConfigSchema,
    dataContract: 'timeseries',
    sizing: { minW: 6, minH: 6, defaultW: 8, defaultH: 6 }, // annex min 6×3, default 8×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: chartForecastDemoData,
    descriptionKey: 'widgets.charts.forecast.description',
  }),
  defineWidget({
    id: 'chart-anomaly',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./time-flow-components.js')).ChartAnomalyWidget })),
    configSchema: chartAnomalyConfigSchema,
    dataContract: 'timeseries',
    sizing: { minW: 6, minH: 4, defaultW: 8, defaultH: 4 }, // annex min 6×2
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: chartAnomalyDemoData,
    descriptionKey: 'widgets.charts.anomaly.description',
  }),
  defineWidget({
    id: 'chart-candlestick',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./time-flow-components.js')).ChartCandlestickWidget })),
    configSchema: chartCandlestickConfigSchema,
    dataContract: 'ohlc',
    sizing: { minW: 6, minH: 6, defaultW: 8, defaultH: 6 }, // annex min 6×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: chartCandlestickDemoData,
    descriptionKey: 'widgets.charts.candlestick.description',
  }),
  defineWidget({
    id: 'chart-bump',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./time-flow-components.js')).ChartBumpWidget })),
    configSchema: chartBumpConfigSchema,
    dataContract: 'multi-timeseries',
    sizing: { minW: 6, minH: 6, defaultW: 8, defaultH: 6 }, // annex min 6×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: chartBumpDemoData,
    descriptionKey: 'widgets.charts.bump.description',
  }),
  defineWidget({
    id: 'chart-timeline-lanes',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./time-flow-components.js')).ChartTimelineLanesWidget })),
    configSchema: chartTimelineLanesConfigSchema,
    dataContract: 'calendar-events',
    sizing: { minW: 6, minH: 4, defaultW: 8, defaultH: 4 }, // annex min 6×2
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: chartTimelineLanesDemoData,
    descriptionKey: 'widgets.charts.timelineLanes.description',
  }),
];
