// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `charts` family — distribution & correlation group (04-T09). Metadata-only
 * definitions for the seven annex §2 ids `chart-boxplot`, `chart-violin`,
 * `chart-ridgeline`, `chart-scatter-bubble`, `chart-hexbin`,
 * `chart-correlation-matrix`, `chart-parallel-coordinates`. Component code
 * loads lazily so the family ships as one Vite chunk (04 §2.3). Grid sizing
 * follows the annex → half-unit conversion (04 §6.1: annex `4×3` → h 6).
 * Demo payloads are the deterministic §3-envelope generators (04 §7.7).
 *
 * These are exported as a discrete array so the GREEN LOOP can concatenate the
 * group into the family `definitions.ts` + registry map without a concurrent
 * edit to the shared barrel.
 */
import { lazy } from 'react';

import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';
import {
  boxplotDemoData,
  chartBoxplotConfigSchema,
  chartCorrelationMatrixConfigSchema,
  chartHexbinConfigSchema,
  chartParallelCoordinatesConfigSchema,
  chartRidgelineConfigSchema,
  chartScatterBubbleConfigSchema,
  chartViolinConfigSchema,
  correlationDemoData,
  hexbinDemoData,
  parallelDemoData,
  ridgelineDemoData,
  scatterDemoData,
  violinDemoData,
} from './distributionShapes.js';

export const distributionCorrelationChartDefinitions: readonly WidgetDefinition[] = [
  defineWidget({
    id: 'chart-boxplot',
    family: 'charts',
    component: lazy(async () => ({
      default: (await import('./DistributionCorrelationWidgets.js')).ChartBoxplotWidget,
    })),
    configSchema: chartBoxplotConfigSchema,
    dataContract: 'distribution',
    sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: boxplotDemoData,
    descriptionKey: 'widgets.charts.boxplot.description',
  }),
  defineWidget({
    id: 'chart-violin',
    family: 'charts',
    component: lazy(async () => ({
      default: (await import('./DistributionCorrelationWidgets.js')).ChartViolinWidget,
    })),
    configSchema: chartViolinConfigSchema,
    dataContract: 'distribution',
    sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: violinDemoData,
    descriptionKey: 'widgets.charts.violin.description',
  }),
  defineWidget({
    id: 'chart-ridgeline',
    family: 'charts',
    component: lazy(async () => ({
      default: (await import('./DistributionCorrelationWidgets.js')).ChartRidgelineWidget,
    })),
    configSchema: chartRidgelineConfigSchema,
    dataContract: 'distribution',
    sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: ridgelineDemoData,
    descriptionKey: 'widgets.charts.ridgeline.description',
  }),
  defineWidget({
    id: 'chart-scatter-bubble',
    family: 'charts',
    component: lazy(async () => ({
      default: (await import('./DistributionCorrelationWidgets.js')).ChartScatterBubbleWidget,
    })),
    configSchema: chartScatterBubbleConfigSchema,
    dataContract: 'record-list',
    sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: scatterDemoData,
    descriptionKey: 'widgets.charts.scatterBubble.description',
  }),
  defineWidget({
    id: 'chart-hexbin',
    family: 'charts',
    component: lazy(async () => ({
      default: (await import('./DistributionCorrelationWidgets.js')).ChartHexbinWidget,
    })),
    configSchema: chartHexbinConfigSchema,
    dataContract: 'matrix',
    sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: hexbinDemoData,
    descriptionKey: 'widgets.charts.hexbin.description',
  }),
  defineWidget({
    id: 'chart-correlation-matrix',
    family: 'charts',
    component: lazy(async () => ({
      default: (await import('./DistributionCorrelationWidgets.js')).ChartCorrelationMatrixWidget,
    })),
    configSchema: chartCorrelationMatrixConfigSchema,
    dataContract: 'matrix',
    sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: correlationDemoData,
    descriptionKey: 'widgets.charts.correlationMatrix.description',
  }),
  defineWidget({
    id: 'chart-parallel-coordinates',
    family: 'charts',
    component: lazy(async () => ({
      default: (await import('./DistributionCorrelationWidgets.js')).ChartParallelCoordinatesWidget,
    })),
    configSchema: chartParallelCoordinatesConfigSchema,
    dataContract: 'record-list',
    sizing: { minW: 6, minH: 6, defaultW: 8, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: parallelDemoData,
    descriptionKey: 'widgets.charts.parallelCoordinates.description',
  }),
];
