// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `kpi` family config schemas + deterministic demo generators — PURE module
 * (zod, the shared config, and the @adminium/charts demo helpers only; no
 * relative component imports, no React).
 *
 * WHY THIS EXISTS: `registry/index.ts` statically imports `definitions.ts`, so
 * everything the definitions module imports lands in the registry's EAGER
 * graph. While the schemas lived in `KpiStatCard.tsx` / `UsageMeter.tsx`, the
 * definitions had to reach into those component modules to name them — which
 * pulled the components and their @adminium/ui deps into the eager chunk and
 * left the sibling `lazy(() => import('./components.js'))` refs buying nothing.
 * Holding the schemas + demo payloads here (the boards/domain/media `*-config`
 * convention) lets the definitions import metadata only, so the components stay
 * reachable exclusively through the lazy `components.ts` barrel (04 §2.3,
 * acceptance #3; enforced by `qa/chunk-budget.test.ts`).
 *
 * The component files re-export these symbols, so existing story/test import
 * points stay stable.
 */
import { demoSparkline, mulberry32 } from '@adminium/charts';
import { z } from 'zod';

import { DEFAULT_GAUGE_BANDS, DERIVED_OPS, INSIGHT_ICONS } from './kpi-lib.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/** The annex §1 `format` vocabulary, shared by every metric-bearing kpi widget. */
const metricFormatSchema = z.enum(['plain', 'compact', 'currency', 'percent', 'duration']);
/** The annex §1 `deltaMode` vocabulary. */
const deltaModeSchema = z.enum(['none', 'pct', 'abs']);
/** The semantic tone vocabulary — bands/insights name a token, never a colour. */
const toneSchema = z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);

// ── kpi-stat-card (annex §1) ───────────────────────────────────────────────
export const kpiStatCardConfigSchema = widgetSharedConfigSchema.extend({
  /** Card label under the icon row (falls back to `title`). */
  metricLabel: z.string().optional(),
  /** Value formatting (annex §1 `format`). */
  metricFormat: z.enum(['plain', 'compact', 'currency', 'percent', 'duration']).default('plain'),
  deltaMode: z.enum(['none', 'pct', 'abs']).default('pct'),
  /** Down-is-good (costs, error rates, churn) — flips the pill tones. */
  invertDeltaGood: z.boolean().default(false),
  showSparkline: z.boolean().default(true),
  /** Curated Lucide tile icon (M4 set — full by-name lookup lands with the builder). */
  iconName: z
    .enum(['activity', 'dollar', 'users', 'cart', 'gauge', 'database', 'zap', 'star', 'package', 'trending'])
    .default('activity'),
  iconTone: z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']).default('accent'),
});

export type KpiStatCardConfig = z.infer<typeof kpiStatCardConfigSchema>;

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

// ── usage-meter (annex §1) ─────────────────────────────────────────────────
export const usageMeterConfigSchema = widgetSharedConfigSchema.extend({
  /** The quota cap; the data payload carries only the used scalar. */
  limit: z.number().positive().default(100),
  /** Percent thresholds (annex §1 defaults). */
  warnThreshold: z.number().min(0).max(100).default(80),
  dangerThreshold: z.number().min(0).max(100).default(95),
  unit: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional(),
  /** Sidebar mode: single line + slim bar. */
  compact: z.boolean().default(false),
});

export type UsageMeterConfig = z.infer<typeof usageMeterConfigSchema>;

/** Deterministic `single-metric` demo payload against the default limit of 100. */
export function usageMeterDemoData(seed: number): { value: number } {
  const random = mulberry32(seed);
  return { value: Math.round(35 + random() * 60) };
}

// ── kpi-stat-tile-compact (annex §1) ───────────────────────────────────────

export const kpiStatTileCompactConfigSchema = widgetSharedConfigSchema.extend({
  /** Uppercase micro-label above the value (falls back to `title`). */
  metricLabel: z.string().optional(),
  metricFormat: metricFormatSchema.default('compact'),
  deltaMode: deltaModeSchema.default('pct'),
  /** Down-is-good (costs, error rates, churn) — flips the chip tones. */
  invertDeltaGood: z.boolean().default(false),
  /** The 22px 6-bar spark (annex §1). */
  showSparkline: z.boolean().default(true),
  /**
   * Tiles per row in the dense "power" row (annex §1: 4–6). Advisory metadata
   * for the generator's row packing — a single tile always fills its cell.
   */
  columns: z.number().int().min(4).max(6).default(6),
});
export type KpiStatTileCompactConfig = z.infer<typeof kpiStatTileCompactConfigSchema>;

/** Deterministic `metric+delta` (+ `timeseries[6]`) demo payload (04 §7.7). */
export function kpiStatTileCompactDemoData(seed: number): {
  value: number;
  prior: number;
  spark: number[];
} {
  const random = mulberry32(seed || 1);
  const value = Math.round(240 + random() * 9_600);
  const prior = Math.round(value * (0.78 + random() * 0.42));
  return { value, prior, spark: demoSparkline(seed, 6) };
}

// ── metric-hero (annex §1) ─────────────────────────────────────────────────

export const metricHeroConfigSchema = widgetSharedConfigSchema.extend({
  metricLabel: z.string().optional(),
  metricFormat: metricFormatSchema.default('currency'),
  deltaMode: deltaModeSchema.default('pct'),
  invertDeltaGood: z.boolean().default(false),
  /** Goal scalar; overrides the payload's `goal` when set (annex §1). */
  goalValue: z.number().positive().optional(),
  /** Goal track caption prefix, e.g. "Goal" → "Goal · $650k, 74%". */
  goalLabel: z.string().optional(),
  /** `requestAnimationFrame` count-up; forced off under reduced motion. */
  countUp: z.boolean().default(true),
  /** Spark bars rendered from the bound timeseries (annex §1 `sparkBars`). */
  sparkBars: z.number().int().min(4).max(24).default(12),
});
export type MetricHeroConfig = z.infer<typeof metricHeroConfigSchema>;

/** Deterministic `metric+delta` + `timeseries` + goal demo payload (04 §7.7). */
export function metricHeroDemoData(seed: number): {
  value: number;
  prior: number;
  spark: number[];
  goal: number;
} {
  const random = mulberry32(seed || 1);
  const value = Math.round(180_000 + random() * 520_000);
  const prior = Math.round(value * (0.7 + random() * 0.35));
  // Goal sits above the current value so the track is partway, never complete.
  const goal = Math.round(value * (1.15 + random() * 0.5));
  return { value, prior, spark: demoSparkline(seed, 12), goal };
}

// ── stat-pair-card (annex §1) ──────────────────────────────────────────────

export const statPairCardConfigSchema = widgetSharedConfigSchema.extend({
  /** Side labels (annex §1 `metricA` / `metricB`). */
  metricALabel: z.string().optional(),
  metricBLabel: z.string().optional(),
  /** Per-side formatting (annex §1 "format per side"). */
  metricAFormat: metricFormatSchema.default('currency'),
  metricBFormat: metricFormatSchema.default('currency'),
  /**
   * Derive side B from side A instead of reading it off the payload (annex §1:
   * "second may be a formula over the first", e.g. LTV = MRR × lifetime).
   * A closed enum, never an expression string — a stored config can never
   * smuggle evaluable code into the renderer.
   */
  derivedFormula: z.enum(DERIVED_OPS).default('none'),
  /** The right-hand operand of `derivedFormula`. */
  derivedOperand: z.number().default(1),
  // Field naming (04 §5) — which payload key carries each side.
  valueAField: z.string().default('value'),
  valueBField: z.string().default('valueB'),
});
export type StatPairCardConfig = z.infer<typeof statPairCardConfigSchema>;

/** Deterministic two-`single-metric` demo payload (04 §7.7). */
export function statPairCardDemoData(seed: number): { value: number; valueB: number } {
  const random = mulberry32(seed || 1);
  const value = Math.round(8_400 + random() * 62_000);
  return { value, valueB: Math.round(value * (2.4 + random() * 3.2)) };
}

// ── gauge-ring + gauge-arc shared band config (annex §1) ───────────────────

/**
 * One qualitative gauge band (annex §1 `bands` [{to, color, label}]). `tone`
 * names a semantic token rather than a colour so bands re-theme with the app
 * (research/widget-registry.md Conventions: "CSS variables only").
 */
export const gaugeBandSchema = z.object({
  /** Inclusive upper cutoff in the gauge's own value space (not a percent). */
  to: z.number(),
  tone: toneSchema,
  label: z.string().optional(),
});
export type GaugeBandConfig = z.infer<typeof gaugeBandSchema>;

const defaultBands = (): GaugeBandConfig[] => DEFAULT_GAUGE_BANDS.map((band) => ({ ...band }));

// ── gauge-ring (annex §1) ──────────────────────────────────────────────────

export const gaugeRingConfigSchema = widgetSharedConfigSchema.extend({
  max: z.number().positive().default(100),
  bands: z.array(gaugeBandSchema).default(defaultBands),
  /** Center readout: "73%" | "86" | "86/100" (annex §1 `centerFormat`). */
  centerFormat: z.enum(['percent', 'value', 'fraction']).default('percent'),
  /** Annex §1 `footer` (spent-of-total | avatar-stack | none). */
  footer: z.enum(['none', 'spent-of-total', 'avatar-stack']).default('none'),
  size: z.enum(['sm', 'md', 'lg']).default('md'),
  /** Formatting for the footer's spent/total figures. */
  metricFormat: metricFormatSchema.default('compact'),
  /** Trend pill next to the footer figures (annex §1 "+ optional delta"). */
  deltaMode: deltaModeSchema.default('none'),
  invertDeltaGood: z.boolean().default(false),
  /** Overrides the band label as the status caption under the center value. */
  caption: z.string().optional(),
  spentLabel: z.string().optional(),
  totalLabel: z.string().optional(),
});
export type GaugeRingConfig = z.infer<typeof gaugeRingConfigSchema>;

const RING_AVATARS = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Edsger Dijkstra'] as const;

/**
 * Deterministic `single-metric` demo payload (04 §7.7) carrying the optional
 * numerator/denominator + delta + avatar stack the annex's footer variants read.
 */
export function gaugeRingDemoData(seed: number): {
  value: number;
  total: number;
  prior: number;
  avatars: string[];
} {
  const random = mulberry32(seed || 1);
  const value = Math.round(42 + random() * 56);
  return {
    value,
    total: 100,
    prior: Math.round(Math.min(100, Math.max(1, value * (0.75 + random() * 0.4)))),
    avatars: RING_AVATARS.slice(0, 3 + Math.floor(random() * 3)).map((name) => name),
  };
}

// ── gauge-arc (annex §1) ───────────────────────────────────────────────────

export const gaugeArcConfigSchema = widgetSharedConfigSchema.extend({
  max: z.number().positive().default(100),
  bands: z.array(gaugeBandSchema).default(defaultBands),
  /** Grid-of-gauges mode (annex §1: 2×2 / 5-up SLA + system-health clusters). */
  cluster: z.boolean().default(false),
  /** Columns in cluster mode (annex §1 `columns`). */
  columns: z.number().int().min(1).max(5).default(2),
  /** Draw the speedometer needle (off → a plain half-arc dasharray gauge). */
  needle: z.boolean().default(true),
  valueFormat: metricFormatSchema.default('plain'),
  unit: z.string().optional(),
  /**
   * Per-widget empty copy (04 §4) for CLUSTER mode — the one shape this widget
   * accepts that can legitimately be empty. The frame cannot route it there for
   * us: the definition declares `['single-metric', 'categorical']`, and
   * `isEmptyData` reads a multi-shape contract as empty only when EVERY shape
   * does, while `isEmptyByShape['single-metric']` is `() => false` by design (a
   * zero metric is data). So a cluster bound to an SLA query returning no rows
   * arrives here in the `loaded` state and this widget owns the copy.
   */
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type GaugeArcConfig = z.infer<typeof gaugeArcConfigSchema>;

const CLUSTER_SERVICES = [
  'API gateway',
  'Postgres primary',
  'Job runner',
  'Search index',
  'CDN edge',
] as const;

/**
 * Deterministic demo payload satisfying BOTH accepted shapes at once (04 §7.7).
 * `gauge-arc` declares `['single-metric', 'categorical']` because `cluster` is a
 * CONFIG flag while `demoData(seed)` only sees the seed — so the payload carries
 * `value` (single-metric, the speedometer) *and* `items` (categorical, the
 * cluster grid), and the component reads whichever its config selects.
 */
export function gaugeArcDemoData(seed: number): {
  value: number;
  items: { key: string; label: string; value: number; tone: string }[];
} {
  const random = mulberry32(seed || 1);
  const toneFor = (score: number): string => (score <= 50 ? 'danger' : score <= 75 ? 'warn' : 'pos');
  const items = CLUSTER_SERVICES.map((label, index) => {
    const value = Math.round(38 + random() * 60);
    return { key: `svc-${index + 1}`, label, value, tone: toneFor(value) };
  });
  return { value: Math.round(45 + random() * 54), items };
}

// ── period-comparison (annex §1) ───────────────────────────────────────────

export const periodComparisonConfigSchema = widgetSharedConfigSchema.extend({
  /** Bar labels for the two adjacent windows (annex §1 `periodA`/`periodB`). */
  periodALabel: z.string().optional(),
  periodBLabel: z.string().optional(),
  metricFormat: metricFormatSchema.default('currency'),
  /** Down-is-good — flips the footer's tone (costs, error rates, churn). */
  invertDeltaGood: z.boolean().default(false),
  /** Footer connectives, e.g. "higher" / "lower" / "vs". */
  higherLabel: z.string().optional(),
  lowerLabel: z.string().optional(),
  flatLabel: z.string().optional(),
});
export type PeriodComparisonConfig = z.infer<typeof periodComparisonConfigSchema>;

/**
 * Deterministic `metric+delta` demo payload (04 §7.7) — the annex's "two
 * `single-metric` values for adjacent windows" IS the `metric+delta` envelope
 * (`value` = this period, `prior` = last), so the shared `computeDelta` produces
 * the footer figure without a bespoke shape.
 */
export function periodComparisonDemoData(seed: number): { value: number; prior: number } {
  const random = mulberry32(seed || 1);
  const value = Math.round(12_000 + random() * 62_000);
  return { value, prior: Math.round(value * (0.6 + random() * 0.55)) };
}

// ── micro-kpi-subtitle (annex §1) ──────────────────────────────────────────

export const microKpiSubtitleConfigSchema = widgetSharedConfigSchema.extend({
  /**
   * Template with `{placeholder}` tokens resolved against the bound scalars
   * (annex §1 `template`), e.g. "{value} unread · {total} total". An unknown
   * token resolves to the empty string — a stored template that outlives its
   * binding degrades to a shorter sentence, never to visible template syntax.
   */
  template: z.string().default('{value}'),
  /** Shown instead of the template when `zeroKey`'s scalar is 0 (annex §1). */
  zeroStateText: z.string().optional(),
  /** Which scalar's 0 triggers `zeroStateText`. */
  zeroKey: z.string().default('value'),
  metricFormat: metricFormatSchema.default('plain'),
});
export type MicroKpiSubtitleConfig = z.infer<typeof microKpiSubtitleConfigSchema>;

/**
 * Deterministic `single-metric` demo payload (04 §7.7). The annex's contract is
 * "1–3 derived scalars over a sibling `record-list`", so the envelope is a
 * `single-metric` (`value`) carrying the sibling scalars the template reads.
 */
export function microKpiSubtitleDemoData(seed: number): {
  value: number;
  total: number;
  online: number;
} {
  const random = mulberry32(seed || 1);
  const total = Math.round(12 + random() * 40);
  return {
    value: Math.round(random() * Math.min(9, total)),
    total,
    online: Math.round(1 + random() * (total - 1)),
  };
}

// ── auto-insights (annex §1) ───────────────────────────────────────────────

export const autoInsightsConfigSchema = widgetSharedConfigSchema.extend({
  /** Insights visible at once (annex §1 `count`). */
  count: z.number().int().min(1).max(8).default(3),
  /** Show the Refresh control that rotates the visible window (annex §1). */
  refreshable: z.boolean().default(true),
  /** Rows kept in the rotation pool (annex §1 `pool` size). */
  pool: z.number().int().min(1).max(24).default(9),
  /** Bullet rows (Adminium UI Kit) vs the tone-icon card grid (Project Overview). */
  variant: z.enum(['bullets', 'cards']).default('bullets'),
  columns: z.number().int().min(1).max(3).default(2),
  /** Per-insight CTA (annex §1 `applyAction`); omitted → no CTA. */
  applyLabel: z.string().optional(),
  refreshLabel: z.string().optional(),
  // Field naming (04 §5) — which column carries what.
  idField: z.string().default('id'),
  iconField: z.string().default('icon'),
  toneField: z.string().default('tone'),
  tagField: z.string().default('tag'),
  titleField: z.string().default('title'),
  bodyField: z.string().default('body'),
  sparkField: z.string().default('spark'),
  hrefField: z.string().default('href'),
  /** Ranking column — rows sort by it descending (stable when absent). */
  scoreField: z.string().default('score'),
});
export type AutoInsightsConfig = z.infer<typeof autoInsightsConfigSchema>;

/**
 * The seeded insight catalogue. The copy is authored here (and, in production,
 * arrives through the binding) — `auto-insights` NEVER calls an LLM at render
 * time: the annex's "AI-flavoured" framing describes where the sentences come
 * from upstream, not a runtime dependency. The widget only ranks and renders.
 */
const INSIGHT_POOL = [
  {
    icon: 'trend-up',
    tone: 'pos',
    tag: 'Revenue',
    title: 'MRR up 12.4% this month',
    body: 'Expansion from existing accounts drove most of the lift; new logos held flat.',
  },
  {
    icon: 'alert',
    tone: 'danger',
    tag: 'Churn',
    title: '3 enterprise accounts at risk',
    body: 'Weekly active seats fell by more than half across three accounts renewing in 30 days.',
  },
  {
    icon: 'trend-down',
    tone: 'warn',
    tag: 'Performance',
    title: 'p95 latency up 180ms',
    body: 'The regression tracks the search index rebuild that started on the 9th.',
  },
  {
    icon: 'target',
    tone: 'accent',
    tag: 'Pipeline',
    title: '74% of the quarterly goal',
    body: 'At the current run rate the target lands four days before quarter end.',
  },
  {
    icon: 'zap',
    tone: 'info',
    tag: 'Usage',
    title: 'API calls doubled week over week',
    body: 'Two integrations account for the increase; neither is near its rate limit yet.',
  },
  {
    icon: 'lightbulb',
    tone: 'accent',
    tag: 'Workload',
    title: 'Rebalance three tickets off Priya',
    body: 'Her queue is 40% above team median while two peers are under-allocated.',
  },
  {
    icon: 'info',
    tone: 'info',
    tag: 'Data quality',
    title: '412 rows missing a country code',
    body: 'All of them were created by the legacy import job before the 3rd.',
  },
  {
    icon: 'sparkles',
    tone: 'pos',
    tag: 'Conversion',
    title: 'Checkout completion hit a 6-month high',
    body: 'The shortened form is converting 8.1% better than the previous layout.',
  },
  {
    icon: 'trend-down',
    tone: 'warn',
    tag: 'Support',
    title: 'First-response time slipped to 4h 12m',
    body: 'Ticket volume rose 22% while staffing stayed flat through the period.',
  },
] as const;

/**
 * Deterministic `record-list` of ranked insights (04 §7.7). Every row carries a
 * `score` so the widget's ranking is exercised, and a spark so the annex's
 * "bold stat + sentence + mini sparkline" row has its third element.
 */
export function autoInsightsDemoData(seed: number): {
  rows: Record<string, unknown>[];
  total: number;
} {
  const random = mulberry32(seed || 1);
  // Walk the catalogue from a seeded offset rather than sampling with
  // replacement, so no two visible insights repeat the same sentence.
  const offset = Math.floor(random() * INSIGHT_POOL.length);
  const count = 6 + Math.floor(random() * 4);
  const rows = Array.from({ length: count }, (_, index) => {
    const insight = INSIGHT_POOL[(offset + index) % INSIGHT_POOL.length] as (typeof INSIGHT_POOL)[number];
    return {
      id: `insight-${index + 1}`,
      icon: insight.icon,
      tone: insight.tone,
      tag: insight.tag,
      title: insight.title,
      body: insight.body,
      score: Math.round(random() * 1000) / 10,
      spark: demoSparkline(seed + index, 8),
      href: `/p/insights/${index + 1}`,
    };
  });
  return { rows, total: rows.length };
}

/** Re-exported so the definitions module's icon enum stays annex-anchored. */
export { INSIGHT_ICONS };
