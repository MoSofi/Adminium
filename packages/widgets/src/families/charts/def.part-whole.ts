/**
 * `charts` family — part-to-whole & hierarchy group (04-T09): registry
 * definitions + deterministic demoData for `chart-treemap`, `chart-sunburst`,
 * `chart-funnel`, `chart-radial-bar`, `chart-radar`, `chart-chord`,
 * `chart-wordcloud`.
 *
 * This module holds METADATA ONLY — it never statically imports the
 * @adminium/charts chart primitives (those load lazily through
 * PartWholeWidgets.tsx, one chunk per family, 04 §2.3), so registry metadata and
 * demoData stay importable without pulling component code. Config schemas, config
 * types and the pure §3→primitive input mappers live in `part-whole-config.ts`
 * (so the wrappers can consume them without importing this definitions module —
 * that would be an import cycle, 01 §2.3) and are re-exported here for back-compat.
 * Demo payloads are the §3 envelopes the live server returns, seeded by the
 * deterministic mulberry32 PRNG (04 §7.7).
 */
import { lazy } from 'react';
import { mulberry32 } from '@adminium/charts';

import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';
import {
  chartChordConfigSchema,
  chartFunnelConfigSchema,
  chartRadarConfigSchema,
  chartRadialBarConfigSchema,
  chartSunburstConfigSchema,
  chartTreemapConfigSchema,
  chartWordcloudConfigSchema,
} from './part-whole-config.js';

export * from './part-whole-config.js';

// --- demoData (deterministic §3 envelopes) -----------------------------------

export function treemapDemoData(seed: number): { items: { key: string; label: string; value: number }[]; total: number } {
  const rng = mulberry32(seed);
  const labels = ['users', 'orders', 'events', 'sessions', 'line_items', 'payments', 'audit_log', 'files'];
  let weight = 900 + rng() * 500;
  const items = labels.map((label) => {
    const value = Math.round(weight);
    weight *= 0.5 + rng() * 0.35;
    return { key: label, label, value };
  });
  return { items, total: items.reduce((sum, i) => sum + i.value, 0) };
}

export function sunburstDemoData(seed: number): {
  roots: { id: string; label: string; children: { id: string; label: string; value: number }[] }[];
} {
  const rng = mulberry32(seed);
  const groups: [string, string[]][] = [
    ['Direct', ['Home', 'Docs']],
    ['Search', ['Brand', 'Generic']],
    ['Social', ['X', 'LinkedIn', 'Reddit']],
    ['Referral', ['Partners', 'Blogs']],
  ];
  return {
    roots: groups.map(([parent, children]) => ({
      id: parent.toLowerCase(),
      label: parent,
      children: children.map((child) => ({
        id: `${parent}-${child}`.toLowerCase(),
        label: child,
        value: Math.round(20 + rng() * 120),
      })),
    })),
  };
}

export function funnelDemoData(seed: number): { items: { key: string; label: string; value: number }[]; total: number } {
  const rng = mulberry32(seed);
  const stages = ['Visited', 'Signed up', 'Activated', 'Subscribed', 'Renewed'];
  let value = 8000 + Math.round(rng() * 4000);
  const items = stages.map((label) => {
    const current = value;
    value = Math.round(value * (0.32 + rng() * 0.36));
    return { key: label.toLowerCase().replace(/\s+/g, '_'), label, value: current };
  });
  return { items, total: items[0]?.value ?? 0 };
}

export function radialBarDemoData(seed: number): { items: { key: string; label: string; value: number }[]; total: number } {
  const rng = mulberry32(seed);
  const labels = ['Desktop', 'Mobile', 'Tablet', 'Other'];
  const items = labels.map((label, i) => ({
    key: label.toLowerCase(),
    label,
    value: Math.round([58, 30, 9, 3][i]! + (rng() - 0.5) * 12),
  }));
  return { items, total: items.reduce((sum, i) => sum + i.value, 0) };
}

export function radarDemoData(seed: number): { rowKeys: string[]; colKeys: string[]; cells: number[][] } {
  const rng = mulberry32(seed);
  const rowKeys = ['Speed', 'Reliability', 'Coverage', 'Cost', 'Support', 'UX'];
  const colKeys = ['Current', 'Target'];
  const cells = rowKeys.map(() => {
    const current = Math.round(45 + rng() * 45);
    return [current, Math.min(100, current + Math.round(8 + rng() * 20))];
  });
  return { rowKeys, colKeys, cells };
}

export function chordDemoData(seed: number): {
  nodes: { id: string; label: string }[];
  links: { from: string; to: string; weight: number }[];
} {
  const rng = mulberry32(seed);
  const teams = ['Design', 'Eng', 'Product', 'Sales', 'Support'];
  const nodes = teams.map((label) => ({ id: label.toLowerCase(), label }));
  const links: { from: string; to: string; weight: number }[] = [];
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      const weight = Math.round(2 + rng() * 18);
      if (weight > 3) {
        links.push({ from: nodes[i]!.id, to: nodes[j]!.id, weight });
      }
    }
  }
  return { nodes, links };
}

export function wordcloudDemoData(seed: number): { items: { key: string; label: string; value: number }[]; total: number } {
  const rng = mulberry32(seed);
  const terms = [
    'database', 'schema', 'query', 'index', 'migration', 'connection', 'dashboard',
    'permission', 'webhook', 'export', 'audit', 'realtime', 'chart', 'widget', 'template',
  ];
  const items = terms.map((label) => ({ key: label, label, value: Math.round(10 + rng() * 90) }));
  return { items, total: items.reduce((sum, i) => sum + i.value, 0) };
}

// --- registry definitions ----------------------------------------------------

export const partWholeChartDefinitions: readonly WidgetDefinition[] = [
  defineWidget({
    id: 'chart-treemap',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./PartWholeWidgets.js')).ChartTreemapWidget })),
    configSchema: chartTreemapConfigSchema,
    dataContract: 'categorical',
    sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: treemapDemoData,
    descriptionKey: 'widgets.charts.treemap.description',
  }),
  defineWidget({
    id: 'chart-sunburst',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./PartWholeWidgets.js')).ChartSunburstWidget })),
    configSchema: chartSunburstConfigSchema,
    dataContract: 'hierarchy/tree',
    sizing: { minW: 4, minH: 6, defaultW: 4, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: sunburstDemoData,
    descriptionKey: 'widgets.charts.sunburst.description',
  }),
  defineWidget({
    id: 'chart-funnel',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./PartWholeWidgets.js')).ChartFunnelWidget })),
    configSchema: chartFunnelConfigSchema,
    dataContract: 'categorical',
    sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: funnelDemoData,
    descriptionKey: 'widgets.charts.funnel.description',
  }),
  defineWidget({
    id: 'chart-radial-bar',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./PartWholeWidgets.js')).ChartRadialBarWidget })),
    configSchema: chartRadialBarConfigSchema,
    dataContract: 'categorical',
    sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 4 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: radialBarDemoData,
    descriptionKey: 'widgets.charts.radialBar.description',
  }),
  defineWidget({
    id: 'chart-radar',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./PartWholeWidgets.js')).ChartRadarWidget })),
    configSchema: chartRadarConfigSchema,
    dataContract: 'matrix',
    sizing: { minW: 4, minH: 6, defaultW: 4, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: radarDemoData,
    descriptionKey: 'widgets.charts.radar.description',
  }),
  defineWidget({
    id: 'chart-chord',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./PartWholeWidgets.js')).ChartChordWidget })),
    configSchema: chartChordConfigSchema,
    dataContract: 'flows',
    sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: chordDemoData,
    descriptionKey: 'widgets.charts.chord.description',
  }),
  defineWidget({
    id: 'chart-wordcloud',
    family: 'charts',
    component: lazy(async () => ({ default: (await import('./PartWholeWidgets.js')).ChartWordcloudWidget })),
    configSchema: chartWordcloudConfigSchema,
    dataContract: 'categorical',
    sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 4 },
    placement: 'grid',
    skeleton: 'chart',
    capabilities: { exportPng: true },
    demoData: wordcloudDemoData,
    descriptionKey: 'widgets.charts.wordcloud.description',
  }),
];
