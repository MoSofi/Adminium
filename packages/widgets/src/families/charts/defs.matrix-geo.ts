// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `charts` family — matrix, calendar & geo-grid definitions (annex §2, 04-T09):
 * `chart-cohort-matrix`, `chart-heatmap-calendar`, `chart-heat-month`,
 * `chart-choropleth-grid`, `chart-sankey`. Metadata only; components load
 * through `lazy()` (one Vite chunk per family, 04 §2.3). Demo payloads are
 * deterministic seeded generators (04 §7.7) shaped into the §3 envelopes the
 * live server returns.
 *
 * Grid sizing per the annex, stored in half-row units (04 §6.1): annex rows R
 * ⇒ `h = round(R × 2)`.
 *
 * NOTE for the green loop: these entries are assembled into the shared
 * `families/charts/definitions.ts` array and the components are re-exported
 * from `components.ts`; the `lazy()` targets point at this track's own module
 * so the fragment type-checks and tests standalone.
 */

import { lazy } from 'react';
import { DEMO_EPOCH_MS, mulberry32 } from '@adminium/charts';

import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';
import {
  chartChoroplethGridConfigSchema,
  chartCohortMatrixConfigSchema,
  chartHeatMonthConfigSchema,
  chartHeatmapCalendarConfigSchema,
  chartSankeyConfigSchema,
} from './MatrixGeoWidgets.js';

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAY_FACTOR = [0.5, 1, 1.1, 1.15, 1.05, 0.95, 0.55] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// --- demoData (04 §7.7) ------------------------------------------------------

/** Triangular retention `matrix`: 8 monthly cohorts × 6 periods, newest cohorts shorter. */
export function cohortMatrixDemoData(seed: number): {
  rowKeys: string[];
  colKeys: string[];
  cells: (number | null)[][];
} {
  const random = mulberry32(seed);
  const cohorts = 8;
  const periods = 6;
  const startMonth = new Date(DEMO_EPOCH_MS).getUTCMonth();
  const rowKeys = Array.from({ length: cohorts }, (_, i) => MONTHS[(startMonth - (cohorts - 1) + i + 1200) % 12] ?? '');
  const colKeys = Array.from({ length: periods }, (_, j) => `M${j}`);
  const cells: (number | null)[][] = [];
  for (let i = 0; i < cohorts; i += 1) {
    const observed = Math.min(periods, cohorts - i);
    const row: (number | null)[] = [];
    let retention = 100;
    for (let j = 0; j < periods; j += 1) {
      if (j >= observed) {
        row.push(null);
        continue;
      }
      if (j === 0) {
        retention = 100;
      } else {
        retention = Math.round(retention * (0.6 + random() * 0.32));
      }
      row.push(retention);
    }
    cells.push(row);
  }
  return { rowKeys, colKeys, cells };
}

/** Daily `timeseries` of contribution counts over `weeks` (default 53). */
export function heatCalendarDemoData(seed: number, weeks = 53): { points: { t: string; v: number }[] } {
  const random = mulberry32(seed);
  const days = weeks * 7;
  const points: { t: string; v: number }[] = [];
  for (let i = 0; i < days; i += 1) {
    const ms = DEMO_EPOCH_MS - (days - 1 - i) * DAY_MS;
    const factor = WEEKDAY_FACTOR[new Date(ms).getUTCDay()] ?? 1;
    const base = 3 + random() * 9;
    const spike = random() > 0.94 ? random() * 14 : 0;
    points.push({ t: isoDate(ms), v: Math.max(0, Math.round(base * factor + spike)) });
  }
  return { points };
}

/** Daily `timeseries` for a single month (the month containing DEMO_EPOCH_MS). */
export function heatMonthDemoData(seed: number): { points: { t: string; v: number }[] } {
  const random = mulberry32(seed);
  const anchor = new Date(DEMO_EPOCH_MS);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const points: { t: string; v: number }[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const ms = Date.UTC(year, month, day);
    const factor = WEEKDAY_FACTOR[new Date(ms).getUTCDay()] ?? 1;
    points.push({ t: isoDate(ms), v: Math.max(0, Math.round((4 + random() * 10) * factor)) });
  }
  return { points };
}

const DEMO_STATES: readonly (readonly [string, string])[] = [
  ['CA', 'California'], ['TX', 'Texas'], ['NY', 'New York'], ['FL', 'Florida'], ['IL', 'Illinois'],
  ['PA', 'Pennsylvania'], ['OH', 'Ohio'], ['GA', 'Georgia'], ['NC', 'North Carolina'], ['MI', 'Michigan'],
  ['WA', 'Washington'], ['AZ', 'Arizona'], ['MA', 'Massachusetts'], ['CO', 'Colorado'], ['OR', 'Oregon'],
];

/** `geo-points` keyed by US state code with sales + orders metrics. */
export function choroplethGridDemoData(seed: number): {
  points: { code: string; name: string; values: { sales: number; orders: number } }[];
} {
  const random = mulberry32(seed);
  const points = DEMO_STATES.map(([code, name]) => ({
    code,
    name,
    values: {
      sales: Math.round(20_000 + random() * 480_000),
      orders: Math.round(120 + random() * 4200),
    },
  }));
  return { points };
}

/** Conversion `flows`: 3-layer funnel with deterministic split weights. */
export function sankeyDemoData(seed: number): {
  nodes: { id: string; label: string; layer: number }[];
  links: { from: string; to: string; weight: number }[];
} {
  const random = mulberry32(seed);
  const visited = 10_000;
  const signedUp = Math.round(visited * (0.42 + random() * 0.12));
  const bounced = visited - signedUp;
  const paid = Math.round(signedUp * (0.4 + random() * 0.16));
  const churned = signedUp - paid;
  return {
    nodes: [
      { id: 'visited', label: 'Visited', layer: 0 },
      { id: 'signed_up', label: 'Signed up', layer: 1 },
      { id: 'bounced', label: 'Bounced', layer: 1 },
      { id: 'paid', label: 'Paid', layer: 2 },
      { id: 'churned', label: 'Churned', layer: 2 },
    ],
    links: [
      { from: 'visited', to: 'signed_up', weight: signedUp },
      { from: 'visited', to: 'bounced', weight: bounced },
      { from: 'signed_up', to: 'paid', weight: paid },
      { from: 'signed_up', to: 'churned', weight: churned },
    ],
  };
}

// --- definitions -------------------------------------------------------------

export const matrixGeoChartDefinitions: readonly WidgetDefinition[] = [
  defineWidget({
    id: 'chart-cohort-matrix',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./MatrixGeoWidgets.js')).ChartCohortMatrixWidget })),
    configSchema: chartCohortMatrixConfigSchema,
    dataContract: 'matrix',
    sizing: { minW: 6, minH: 6, defaultW: 8, defaultH: 6 }, // annex 8×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: cohortMatrixDemoData,
    descriptionKey: 'widgets.charts.cohortMatrix.description',
  }),
  defineWidget({
    id: 'chart-heatmap-calendar',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./MatrixGeoWidgets.js')).ChartHeatmapCalendarWidget })),
    configSchema: chartHeatmapCalendarConfigSchema,
    dataContract: 'timeseries',
    sizing: { minW: 6, minH: 4, defaultW: 12, defaultH: 4 }, // annex 12×2
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: (seed) => heatCalendarDemoData(seed),
    descriptionKey: 'widgets.charts.heatmapCalendar.description',
  }),
  defineWidget({
    id: 'chart-heat-month',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./MatrixGeoWidgets.js')).ChartHeatMonthWidget })),
    configSchema: chartHeatMonthConfigSchema,
    dataContract: 'timeseries',
    sizing: { minW: 3, minH: 6, defaultW: 4, defaultH: 8 }, // annex min 3×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: heatMonthDemoData,
    descriptionKey: 'widgets.charts.heatMonth.description',
  }),
  defineWidget({
    id: 'chart-choropleth-grid',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./MatrixGeoWidgets.js')).ChartChoroplethGridWidget })),
    configSchema: chartChoroplethGridConfigSchema,
    dataContract: 'geo-points',
    sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 }, // annex 6×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: choroplethGridDemoData,
    descriptionKey: 'widgets.charts.choroplethGrid.description',
  }),
  defineWidget({
    id: 'chart-sankey',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./MatrixGeoWidgets.js')).ChartSankeyWidget })),
    configSchema: chartSankeyConfigSchema,
    dataContract: 'flows',
    sizing: { minW: 6, minH: 6, defaultW: 8, defaultH: 6 }, // annex 8×3
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: sankeyDemoData,
    descriptionKey: 'widgets.charts.sankey.description',
  }),
];
