/**
 * `kpi` family definitions (annex §1; M4-T06 slice: `kpi-stat-card`,
 * `usage-meter` — the remaining §1 ids land through M7). Metadata only in
 * this file: the config schemas and demo generators come from the pure
 * `kpi-config` module, and component code lives in sibling files reached
 * through the `components.ts` barrel via `lazy()`, so Vite emits one chunk for
 * the whole family (04 §2.3) and the registry's static graph never pulls the
 * components in.
 *
 * Grid sizing per the annex, stored in half-row units (04 §6.1): annex
 * "3×1.5" ⇒ `defaultH: 3`.
 */

import { lazy } from 'react';

import {
  kpiStatCardConfigSchema,
  kpiStatCardDemoData,
  usageMeterConfigSchema,
  usageMeterDemoData,
} from './kpi-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

// The demo generators moved to `kpi-config`; re-exported so story/test import
// points against this module stay stable.
export { kpiStatCardDemoData, usageMeterDemoData } from './kpi-config.js';

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
