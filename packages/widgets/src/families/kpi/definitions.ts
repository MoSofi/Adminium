// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `kpi` family definitions — the COMPLETE annex §1 slice (10 ids). The M4-T06
 * wave landed `kpi-stat-card` + `usage-meter`; M7 Wave 4 (TRACK KPI-FEEDS)
 * closes the family out with the remaining eight.
 *
 * Metadata only in this file: the config schemas and demo generators come from
 * the pure `kpi-config` module, and component code lives in sibling files
 * reached through the `components.ts` barrel via `lazy()`, so Vite emits one
 * chunk for the whole family (04 §2.3) and the registry's static graph never
 * pulls the components in (enforced by `qa/chunk-budget.test.ts`).
 *
 * Grid sizing per the annex, stored in half-row units (04 §6.1:
 * `h = round(annexRows × 2)`) — annex "3×1.5" ⇒ `defaultH: 3`. Widths map 1:1.
 *
 * `capabilities.exportPng` marks the widgets whose loaded body is a raster-able
 * canvas (the stat card's spark, the hero, the two SVG gauges) — §7.6's export
 * pipeline picks them up via their `data-export-node` roots.
 */

import { lazy } from 'react';

import {
  autoInsightsConfigSchema,
  autoInsightsDemoData,
  gaugeArcConfigSchema,
  gaugeArcDemoData,
  gaugeRingConfigSchema,
  gaugeRingDemoData,
  kpiStatCardConfigSchema,
  kpiStatCardDemoData,
  kpiStatTileCompactConfigSchema,
  kpiStatTileCompactDemoData,
  metricHeroConfigSchema,
  metricHeroDemoData,
  microKpiSubtitleConfigSchema,
  microKpiSubtitleDemoData,
  periodComparisonConfigSchema,
  periodComparisonDemoData,
  statPairCardConfigSchema,
  statPairCardDemoData,
  usageMeterConfigSchema,
  usageMeterDemoData,
} from './kpi-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

// The demo generators live in `kpi-config`; re-exported so story/test import
// points against this module stay stable.
export {
  autoInsightsDemoData,
  gaugeArcDemoData,
  gaugeRingDemoData,
  kpiStatCardDemoData,
  kpiStatTileCompactDemoData,
  metricHeroDemoData,
  microKpiSubtitleDemoData,
  periodComparisonDemoData,
  statPairCardDemoData,
  usageMeterDemoData,
} from './kpi-config.js';

export const kpiWidgetDefinitions: readonly WidgetDefinition[] = [
  defineWidget({
    id: 'kpi-stat-card',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).KpiStatCard })),
    configSchema: kpiStatCardConfigSchema,
    dataContract: 'metric+delta',
    sizing: { minW: 3, minH: 2, defaultW: 3, defaultH: 3 }, // annex "min 3×1, default 3×1.5"
    placement: 'grid',
    skeleton: 'card',
    capabilities: { exportPng: true },
    demoData: kpiStatCardDemoData,
    descriptionKey: 'widgets.kpi.statCard.description',
  }),
  defineWidget({
    id: 'usage-meter',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).UsageMeter })),
    configSchema: usageMeterConfigSchema,
    dataContract: 'single-metric',
    sizing: { minW: 3, minH: 2, defaultW: 3, defaultH: 2 }, // annex "min 3×1, default 3×1"
    placement: 'grid',
    skeleton: 'card',
    demoData: usageMeterDemoData,
    descriptionKey: 'widgets.kpi.usageMeter.description',
  }),
  defineWidget({
    id: 'kpi-stat-tile-compact',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).KpiStatTileCompact })),
    configSchema: kpiStatTileCompactConfigSchema,
    dataContract: 'metric+delta',
    sizing: { minW: 2, minH: 2, defaultW: 2, defaultH: 2 }, // annex "min 2×1, default 2×1"
    placement: 'grid',
    skeleton: 'card',
    capabilities: { exportPng: true },
    demoData: kpiStatTileCompactDemoData,
    descriptionKey: 'widgets.kpi.statTileCompact.description',
  }),
  defineWidget({
    id: 'metric-hero',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).MetricHero })),
    configSchema: metricHeroConfigSchema,
    dataContract: 'metric+delta',
    sizing: { minW: 4, minH: 4, defaultW: 4, defaultH: 4 }, // annex "min 4×2, default 4×2"
    placement: 'grid',
    skeleton: 'card',
    capabilities: { exportPng: true },
    demoData: metricHeroDemoData,
    descriptionKey: 'widgets.kpi.metricHero.description',
  }),
  defineWidget({
    id: 'stat-pair-card',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).StatPairCard })),
    configSchema: statPairCardConfigSchema,
    dataContract: 'single-metric', // annex "two `single-metric` values" — one envelope, two keys
    sizing: { minW: 3, minH: 2, defaultW: 3, defaultH: 2 }, // annex "min 3×1, default 3×1"
    placement: 'grid',
    skeleton: 'card',
    demoData: statPairCardDemoData,
    descriptionKey: 'widgets.kpi.statPairCard.description',
  }),
  defineWidget({
    id: 'gauge-ring',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).GaugeRing })),
    configSchema: gaugeRingConfigSchema,
    dataContract: 'single-metric',
    sizing: { minW: 3, minH: 4, defaultW: 3, defaultH: 4 }, // annex "min 3×2, default 3×2"
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: gaugeRingDemoData,
    descriptionKey: 'widgets.kpi.gaugeRing.description',
  }),
  defineWidget({
    id: 'gauge-arc',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).GaugeArc })),
    configSchema: gaugeArcConfigSchema,
    // annex §1: `single-metric` score for the speedometer; `categorical` list of
    // {label, pct, tone} in cluster mode. `cluster` is config, so both are
    // accepted and the component reads whichever it is configured for (04 §3).
    dataContract: ['single-metric', 'categorical'],
    sizing: { minW: 3, minH: 4, defaultW: 6, defaultH: 4 }, // annex "single min 3×2; cluster min 4×2, default 6×2"
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: gaugeArcDemoData,
    descriptionKey: 'widgets.kpi.gaugeArc.description',
  }),
  defineWidget({
    id: 'period-comparison',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).PeriodComparison })),
    configSchema: periodComparisonConfigSchema,
    // annex "two `single-metric` values for adjacent windows" = the
    // `metric+delta` envelope (value = this window, prior = last).
    dataContract: 'metric+delta',
    sizing: { minW: 3, minH: 2, defaultW: 3, defaultH: 3 }, // annex "min 3×1, default 3×1.5"
    placement: 'grid',
    skeleton: 'card',
    demoData: periodComparisonDemoData,
    descriptionKey: 'widgets.kpi.periodComparison.description',
  }),
  defineWidget({
    id: 'micro-kpi-subtitle',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).MicroKpiSubtitle })),
    configSchema: microKpiSubtitleConfigSchema,
    // annex "1–3 derived scalars over a sibling record-list" — the host compiles
    // them into one `single-metric` envelope whose sibling keys are the scalars.
    dataContract: 'single-metric',
    sizing: { minW: 2, minH: 1, defaultW: 3, defaultH: 1 }, // annex "inline (page header slot)"
    placement: 'inline',
    skeleton: 'block',
    demoData: microKpiSubtitleDemoData,
    descriptionKey: 'widgets.kpi.microKpiSubtitle.description',
  }),
  defineWidget({
    id: 'auto-insights',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).AutoInsights })),
    configSchema: autoInsightsConfigSchema,
    dataContract: 'record-list',
    sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 4 }, // annex "min 4×2, default 6×2"
    placement: 'grid',
    skeleton: 'list',
    demoData: autoInsightsDemoData,
    descriptionKey: 'widgets.kpi.autoInsights.description',
  }),
];
