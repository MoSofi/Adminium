/**
 * `charts` family "bars & ranking" definitions (04-T09; annex §2 ids
 * chart-bullet, chart-ranking-bars, chart-pareto, chart-waterfall,
 * chart-marimekko, chart-stacked-bar-100, chart-slope). Metadata only; the
 * green loop spreads `barsRankingChartDefinitions` into the family's
 * `chartsWidgetDefinitions`. Component code loads through the group barrel via
 * `lazy()` so the whole group stays in the one `charts` chunk (04 §2.3).
 * Annex grid heights are rows; `sizing` stores 40px half-units (rows × 2, 04 §6.1).
 */
import { lazy } from 'react';

import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';
import {
  chartBulletConfigSchema,
  chartMarimekkoConfigSchema,
  chartParetoConfigSchema,
  chartRankingBarsConfigSchema,
  chartSlopeConfigSchema,
  chartStackedBar100ConfigSchema,
  chartWaterfallConfigSchema,
} from './bars-ranking-config.js';
import {
  bulletDemoData,
  marimekkoDemoData,
  paretoDemoData,
  rankingDemoData,
  slopeDemoData,
  stackedBar100DemoData,
  waterfallDemoData,
} from './bars-ranking-demo.js';

export const barsRankingChartDefinitions: readonly WidgetDefinition[] = [
  defineWidget({
    id: 'chart-bullet',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./bars-ranking-components.js')).ChartBulletWidget })),
    configSchema: chartBulletConfigSchema,
    dataContract: 'record-list',
    sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 4 }, // annex 4×2 → 6×2
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: bulletDemoData,
    descriptionKey: 'widgets.charts.bullet.description',
  }),
  defineWidget({
    id: 'chart-ranking-bars',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./bars-ranking-components.js')).ChartRankingBarsWidget })),
    configSchema: chartRankingBarsConfigSchema,
    dataContract: 'categorical',
    sizing: { minW: 3, minH: 4, defaultW: 3, defaultH: 6 }, // annex 3×2 → 3×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: rankingDemoData,
    descriptionKey: 'widgets.charts.rankingBars.description',
  }),
  defineWidget({
    id: 'chart-pareto',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./bars-ranking-components.js')).ChartParetoWidget })),
    configSchema: chartParetoConfigSchema,
    dataContract: 'categorical',
    sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 6 }, // annex 4×2 → 6×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: paretoDemoData,
    descriptionKey: 'widgets.charts.pareto.description',
  }),
  defineWidget({
    id: 'chart-waterfall',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./bars-ranking-components.js')).ChartWaterfallWidget })),
    configSchema: chartWaterfallConfigSchema,
    dataContract: 'record-list',
    sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 6 }, // annex 4×2 → 6×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: waterfallDemoData,
    descriptionKey: 'widgets.charts.waterfall.description',
  }),
  defineWidget({
    id: 'chart-marimekko',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./bars-ranking-components.js')).ChartMarimekkoWidget })),
    configSchema: chartMarimekkoConfigSchema,
    dataContract: 'matrix',
    sizing: { minW: 6, minH: 6, defaultW: 8, defaultH: 6 }, // annex 6×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: marimekkoDemoData,
    descriptionKey: 'widgets.charts.marimekko.description',
  }),
  defineWidget({
    id: 'chart-stacked-bar-100',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./bars-ranking-components.js')).ChartStackedBar100Widget })),
    configSchema: chartStackedBar100ConfigSchema,
    dataContract: 'categorical',
    // annex 3×1 → 4×2. minH raised 2 → 4: the annex floor predates the card
    // chrome, and 2 half-units is 80px — less than the header plus one legible
    // bar row. Below `lg` the grid is single-column, so minH is the ONLY
    // constraint that binds on a phone (chart-legibility-floor.test.ts).
    sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 4 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: stackedBar100DemoData,
    descriptionKey: 'widgets.charts.stackedBar100.description',
  }),
  defineWidget({
    id: 'chart-slope',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./bars-ranking-components.js')).ChartSlopeWidget })),
    configSchema: chartSlopeConfigSchema,
    dataContract: 'record-list',
    sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 }, // annex 4×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: slopeDemoData,
    descriptionKey: 'widgets.charts.slope.description',
  }),
];
