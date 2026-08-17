// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic domain-shaped demo generators for the "bars & ranking" chart
 * group (04-T09; 04-widget-registry.md §7.7). Same seed → identical
 * payload across runs and platforms — seeded PRNG only, never Date.now()/
 * Math.random(). These feed the chart-primitive tests and stories; the
 * @adminium/widgets defs wrap the same numbers into §3 envelopes.
 */
import { mulberry32 } from './mulberry32.js';
import type { RankingInput } from '../geometry/ranking.js';
import type { BulletInput } from '../geometry/bullet.js';
import type { ParetoInput } from '../geometry/pareto.js';
import type { WaterfallInput } from '../geometry/waterfall.js';
import type { StackedInput } from '../geometry/stacked100.js';
import type { SlopeInput } from '../geometry/slope.js';

const REGIONS = ['United States', 'Germany', 'Japan', 'Brazil', 'India', 'Canada', 'France', 'Australia'] as const;
const CAUSES = ['Timeout', 'Validation', 'Auth', 'Rate limit', 'Network', 'Unknown'] as const;
const PLANS = ['Free', 'Pro', 'Business', 'Enterprise'] as const;
const SOURCES = ['Organic', 'Paid', 'Referral', 'Social', 'Email'] as const;
const GOALS = ['Revenue', 'Signups', 'Retention', 'NPS'] as const;

/** Sorted-descending top-N ranking values (top countries / regions). */
export function demoRanking(seed: number, n = 6): RankingInput[] {
  const random = mulberry32(seed);
  return REGIONS.slice(0, n)
    .map((label) => ({ label, value: Math.round(200 + random() * 800) }))
    .sort((a, b) => b.value - a.value);
}

/** Goal rows: measure vs target with three qualitative bands. */
export function demoBullet(seed: number, n = 4): BulletInput[] {
  const random = mulberry32(seed);
  return GOALS.slice(0, n).map((label) => {
    const max = 100;
    const target = Math.round(60 + random() * 25);
    const measure = Math.round(30 + random() * 65);
    return { label, measure, target, max, bandCutoffs: [40, 75] };
  });
}

/** Sorted-descending cause counts for the Pareto bars + cumulative line. */
export function demoPareto(seed: number): ParetoInput[] {
  const random = mulberry32(seed);
  return CAUSES.map((label) => ({ label, value: Math.round(10 + random() * 240) })).sort(
    (a, b) => b.value - a.value,
  );
}

/** MRR bridge: Start anchor, up/down movements, Net anchor. */
export function demoWaterfall(seed: number): WaterfallInput[] {
  const random = mulberry32(seed);
  const start = Math.round(180 + random() * 60);
  const newBiz = Math.round(30 + random() * 40);
  const expansion = Math.round(15 + random() * 25);
  const contraction = Math.round(8 + random() * 16);
  const churn = Math.round(12 + random() * 22);
  const net = start + newBiz + expansion - contraction - churn;
  return [
    { label: 'Start', value: start, type: 'total' },
    { label: 'New', value: newBiz, type: 'up' },
    { label: 'Expansion', value: expansion, type: 'up' },
    { label: 'Contraction', value: contraction, type: 'down' },
    { label: 'Churn', value: churn, type: 'down' },
    { label: 'Net', value: net, type: 'total' },
  ];
}

export interface DemoMarimekko {
  rowKeys: string[];
  colKeys: string[];
  cells: number[][];
}

/** Region (columns) × plan (rows) revenue matrix. */
export function demoMarimekko(seed: number): DemoMarimekko {
  const random = mulberry32(seed);
  const colKeys = REGIONS.slice(0, 4);
  const rowKeys = [...PLANS];
  const cells = rowKeys.map(() => colKeys.map(() => Math.round(20 + random() * 180)));
  return { rowKeys, colKeys, cells };
}

/** Traffic-by-source shares for the 100% bar. */
export function demoStacked100(seed: number): StackedInput[] {
  const random = mulberry32(seed);
  return SOURCES.map((label) => ({
    key: label.toLowerCase(),
    label,
    value: Math.round(20 + random() * 100),
  }));
}

/** Plan-mix share shift A → B. */
export function demoSlope(seed: number): SlopeInput[] {
  const random = mulberry32(seed);
  return PLANS.map((label) => {
    const a = Math.round(10 + random() * 40);
    const b = Math.max(2, Math.round(a + (random() - 0.5) * 26));
    return { label, a, b };
  });
}
