/**
 * `kpi` family definitions (annex §1; M4-T06 slice: `kpi-stat-card`,
 * `usage-meter` — the remaining §1 ids land through M7). Metadata only in
 * this file; component code lives in sibling files reached through the
 * `components.ts` barrel via `lazy()` so Vite emits one chunk for the
 * whole family (04 §2.3).
 *
 * Grid sizing per the annex, stored in half-row units (04 §6.1): annex
 * "3×1.5" ⇒ `defaultH: 3`.
 */

import { lazy } from 'react';
import { demoSparkline, mulberry32 } from '@adminium/charts';

import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';
import { kpiStatCardConfigSchema } from './KpiStatCard.js';
import { usageMeterConfigSchema } from './UsageMeter.js';

/** Deterministic `metric+delta` demo payload (04 §7.7). */
export function kpiStatCardDemoData(seed: number): {
  value: number;
  prior: number;
  spark: number[];
} {
  const random = mulberry32(seed);
  const value = Math.round(1200 + random() * 46_000);
  const prior = Math.round(value * (0.72 + random() * 0.5));
  return { value, prior, spark: demoSparkline(seed, 8) };
}

/** Deterministic `single-metric` demo payload against the default limit of 100. */
export function usageMeterDemoData(seed: number): { value: number } {
  const random = mulberry32(seed);
  return { value: Math.round(35 + random() * 60) };
}

export const kpiWidgetDefinitions: readonly WidgetDefinition[] = [
  defineWidget({
    id: 'kpi-stat-card',
    family: 'kpi',
    component: lazy(async () => ({ default: (await import('./components.js')).KpiStatCard })),
    configSchema: kpiStatCardConfigSchema,
    dataContract: 'metric+delta',
    sizing: { minW: 3, minH: 2, defaultW: 3, defaultH: 3 },
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
    sizing: { minW: 3, minH: 2, defaultW: 3, defaultH: 2 },
    placement: 'grid',
    skeleton: 'card',
    demoData: usageMeterDemoData,
    descriptionKey: 'widgets.kpi.usageMeter.description',
  }),
];
