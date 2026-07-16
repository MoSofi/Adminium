/**
 * `tables` family M7 Wave-4 TAIL config schemas + deterministic demo generators
 * — PURE module (zod, the shared config, and the `tables-tail-types` types only;
 * no React, no component code).
 *
 * WHY THIS EXISTS: `registry/index.ts` statically imports
 * `tables-tail.definitions.ts`, so everything that module imports lands in the
 * registry's EAGER graph. Holding the schemas + demo payloads here (the
 * boards/domain/media `*-config` convention, and this family's own
 * `tables-config` / `tables-track-f-config` precedent) lets the definitions
 * import metadata only, so the components stay reachable exclusively through the
 * lazy `tables-tail-components` barrel (04 §2.3, acceptance #3; enforced by
 * `qa/chunk-budget.test.ts`).
 *
 * The component files re-export these symbols, so the family barrel, stories and
 * tests keep their existing import points.
 */
import { z } from 'zod';

import type {
  AccordionRow,
  CloudChip,
  ComparisonColumn,
  ComparisonMatrixData,
  ComparisonRow,
  MoverRow,
  RankedEntity,
  SparkMetricRow,
} from './tables-tail-types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * Mulberry32 — the repo's deterministic seeded PRNG (see `demo-data.ts` and
 * `tables-track-f-config.ts`). One copy for the whole track, kept local so this
 * pure module pulls no package dependency into the eager registry graph.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pick from a non-empty tuple. */
function pickFrom<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length] as T;
}

/** A deterministic 8-point micro-series with a drift, for the row sparklines. */
function sparkSeries(random: () => number, drift: number, points = 8): number[] {
  let value = 40 + random() * 30;
  return Array.from({ length: points }, () => {
    value = Math.max(2, value + drift + (random() - 0.5) * 14);
    return Math.round(value * 10) / 10;
  });
}

const toneEnum = z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);
const goodDirectionEnum = z.enum(['up', 'down']);

// ── sparkline-table (annex §3) ─────────────────────────────────────────────
export const sparklineTableConfigSchema = widgetSharedConfigSchema.extend({
  /** Max metric rows rendered (annex `rows`). */
  rows: z.number().int().min(1).max(24).default(6),
  /** Sparkline width in px (annex `sparkWidth`). */
  sparkWidth: z.number().int().min(32).max(240).default(72),
  /** Bar (the annex's "8-bar sparkline") or line micro-chart. */
  sparkVariant: z.enum(['bar', 'line']).default('bar'),
  /**
   * Per-metric good direction override, keyed by row name — `down` inverts the
   * delta pill's tone for cost/latency/churn metrics (annex "good/bad aware").
   */
  goodDirectionByMetric: z.record(z.string(), goodDirectionEnum).optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type SparklineTableConfig = z.infer<typeof sparklineTableConfigSchema>;

const SPARK_METRICS: readonly { name: string; good: 'up' | 'down'; unit?: string; currency?: string }[] = [
  { name: 'Active users', good: 'up' },
  { name: 'Sessions', good: 'up' },
  { name: 'Conversion', good: 'up', unit: '%' },
  { name: 'Error rate', good: 'down', unit: '%' },
  { name: 'p95 latency', good: 'down', unit: 'ms' },
  { name: 'MRR', good: 'up', currency: 'USD' },
  { name: 'Churn', good: 'down', unit: '%' },
  { name: 'Support backlog', good: 'down' },
];

/** Deterministic `record-list` of metric rows (04 §7.7). */
export function sparklineTableDemoData(seed: number): { data: SparkMetricRow[]; total: number } {
  const random = mulberry32(seed || 1);
  const data: SparkMetricRow[] = SPARK_METRICS.map((metric, index) => {
    const delta = Math.round((random() * 28 - 12) * 10) / 10;
    return {
      id: index + 1,
      name: metric.name,
      value: Math.round(random() * 9000) + 120,
      delta,
      goodDirection: metric.good,
      spark: sparkSeries(random, delta / 8),
      ...(metric.unit === undefined ? {} : { unit: metric.unit }),
      ...(metric.currency === undefined ? {} : { currency: metric.currency }),
    };
  });
  return { data, total: data.length };
}

// ── top-movers-list (annex §3) ─────────────────────────────────────────────
export const topMoversListConfigSchema = widgetSharedConfigSchema.extend({
  /** Top-N by |delta| (annex `n`). */
  n: z.number().int().min(1).max(20).default(5),
  /** Per-metric good direction override, keyed by row name (annex). */
  goodDirectionByMetric: z.record(z.string(), goodDirectionEnum).optional(),
  showSparkline: z.boolean().default(true),
  sparkWidth: z.number().int().min(24).max(160).default(48),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type TopMoversListConfig = z.infer<typeof topMoversListConfigSchema>;

const MOVER_ENTITIES: readonly { name: string; good: 'up' | 'down'; currency?: string; unit?: string }[] = [
  { name: 'Enterprise plan', good: 'up', currency: 'USD' },
  { name: 'Trial signups', good: 'up' },
  { name: 'Checkout errors', good: 'down' },
  { name: 'API latency', good: 'down', unit: 'ms' },
  { name: 'Refunds', good: 'down', currency: 'USD' },
  { name: 'Mobile sessions', good: 'up' },
  { name: 'Docs traffic', good: 'up' },
  { name: 'Failed webhooks', good: 'down' },
  { name: 'Seats added', good: 'up' },
];

/** Deterministic `record-list` ranked by |delta| (annex data contract; 04 §7.7). */
export function topMoversListDemoData(seed: number): { data: MoverRow[]; total: number } {
  const random = mulberry32(seed || 1);
  const rows: MoverRow[] = MOVER_ENTITIES.map((entity, index) => {
    const delta = Math.round((random() * 90 - 40) * 10) / 10;
    return {
      id: index + 1,
      name: entity.name,
      value: Math.round(random() * 5000) + 60,
      delta,
      goodDirection: entity.good,
      spark: sparkSeries(random, delta / 12),
      ...(entity.currency === undefined ? {} : { currency: entity.currency }),
      ...(entity.unit === undefined ? {} : { unit: entity.unit }),
    };
  });
  // The annex's contract is "record-list ranked by |delta|" — the server sends
  // it pre-ranked, so the demo payload is ranked too (the widget re-ranks
  // defensively for an unsorted binding).
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { data: rows, total: rows.length };
}

// ── ranked-entity-list (annex §3) ──────────────────────────────────────────
export const rankedEntityListConfigSchema = widgetSharedConfigSchema.extend({
  /** Top-N by metric (annex `n`). */
  n: z.number().int().min(1).max(25).default(6),
  /**
   * Sibling-widget link target (annex: "row click can drive sibling widget (map
   * flyTo)"). The widget emits the row key on `drill-through`; the host owns the
   * cross-widget wiring, so this is a plain instance id, never a callback.
   */
  linkTarget: z.string().optional(),
  /** Proportional accent bar behind each row (annex). */
  showBar: z.boolean().default(true),
  /** Format the value as a share of the total instead of an absolute count. */
  valueFormat: z.enum(['number', 'compact', 'percent', 'currency']).default('compact'),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type RankedEntityListConfig = z.infer<typeof rankedEntityListConfigSchema>;

const RANKED_REGIONS = [
  'United States',
  'Germany',
  'United Kingdom',
  'Japan',
  'Brazil',
  'Canada',
  'France',
  'Australia',
] as const;

/** Deterministic sorted top-N `record-list` (04 §7.7). */
export function rankedEntityListDemoData(seed: number): { data: RankedEntity[]; total: number } {
  const random = mulberry32(seed || 1);
  const rows: RankedEntity[] = RANKED_REGIONS.map((name, index) => ({
    id: index + 1,
    name,
    key: name.toLowerCase().replace(/[^a-z]+/g, '-'),
    value: Math.round(random() * 48_000) + 900,
  }));
  rows.sort((a, b) => b.value - a.value);
  return { data: rows, total: rows.length };
}

// ── accordion-list (annex §3) ──────────────────────────────────────────────
export const accordionListConfigSchema = widgetSharedConfigSchema.extend({
  /** Single-open (annex "exclusive") vs. multi-open. */
  exclusive: z.boolean().default(false),
  /** Row ids expanded on first render (annex `defaultOpen`). */
  defaultOpen: z.array(z.string()).default([]),
  /** Expand affordance (annex `glyph`). */
  glyph: z.enum(['chevron', 'plus-minus']).default('chevron'),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type AccordionListConfig = z.infer<typeof accordionListConfigSchema>;

const ENDPOINTS: readonly { path: string; method: string; tone: string; body: string }[] = [
  { path: '/api/v1/customers', method: 'GET', tone: 'info', body: 'List customers with cursor pagination, filtering, and sparse fieldsets.' },
  { path: '/api/v1/customers', method: 'POST', tone: 'pos', body: 'Create a customer. Returns 201 with the created row and its generated id.' },
  { path: '/api/v1/customers/{id}', method: 'PATCH', tone: 'warn', body: 'Partially update a customer. Only the supplied fields are written.' },
  { path: '/api/v1/customers/{id}', method: 'DELETE', tone: 'danger', body: 'Soft-delete a customer. The row stays queryable via ?include_deleted=1.' },
  { path: '/api/v1/invoices', method: 'GET', tone: 'info', body: 'List invoices for a customer, newest first, with line items expanded.' },
  { path: '/api/v1/webhooks', method: 'POST', tone: 'pos', body: 'Register a webhook endpoint and receive a signing secret once.' },
];
const ENDPOINT_FIELDS: readonly { label: string; value: string }[] = [
  { label: 'id', value: 'integer · primary key' },
  { label: 'name', value: 'varchar(120) · not null' },
  { label: 'status', value: 'enum · active | trialing | canceled' },
  { label: 'created_at', value: 'timestamptz · default now()' },
];

/** Deterministic `record-list` of expandable endpoint rows (04 §7.7). */
export function accordionListDemoData(seed: number): { data: AccordionRow[]; total: number } {
  const random = mulberry32(seed || 1);
  const data: AccordionRow[] = ENDPOINTS.map((endpoint, index) => ({
    id: `ep-${index + 1}`,
    header: endpoint.path,
    badge: endpoint.method,
    badgeTone: endpoint.tone,
    body: endpoint.body,
    fields: ENDPOINT_FIELDS.slice(0, 2 + Math.floor(random() * 3)).map((field) => ({
      label: field.label,
      value: field.value,
      mono: true,
    })),
  }));
  return { data, total: data.length };
}

// ── comparison-matrix (annex §3) ───────────────────────────────────────────
export const comparisonMatrixConfigSchema = widgetSharedConfigSchema.extend({
  /**
   * Column id visually promoted (annex: "one column visually promoted") — the
   * recommended plan. Unknown ids simply promote nothing.
   */
  promotedColumn: z.string().optional(),
  /** Category band order override (annex `groups`); unlisted bands follow. */
  groups: z.array(z.string()).optional(),
  /** Column allow-list / order override (annex `columns`). */
  columns: z.array(z.string()).optional(),
  promotedLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ComparisonMatrixConfig = z.infer<typeof comparisonMatrixConfigSchema>;

const PLAN_COLUMNS: readonly ComparisonColumn[] = [
  { id: 'starter', label: 'Starter', meta: '$0 / mo' },
  { id: 'team', label: 'Team', meta: '$29 / mo' },
  { id: 'enterprise', label: 'Enterprise', meta: 'Custom' },
];
const PLAN_GROUPS = ['Usage', 'Collaboration', 'Security'] as const;

/**
 * Deterministic comparison payload (annex: "static or config-driven rows"; 04
 * §7.7). The catalog of rows is fixed — what the seed varies are the quota
 * numbers, so the payload still threads its seed (the determinism gate's
 * "seed actually threads into the generator" assertion) rather than being a
 * constant the gate would have to allow-list as seed-invariant.
 */
export function comparisonMatrixDemoData(seed: number): ComparisonMatrixData {
  const random = mulberry32(seed || 1);
  const teamRows = 5 + Math.floor(random() * 20);
  const teamSeats = 5 + Math.floor(random() * 15);
  const teamStorage = 10 + Math.floor(random() * 90);
  const rows: ComparisonRow[] = [
    {
      id: 'rows',
      label: 'Rows per table',
      group: 'Usage',
      cells: { starter: '10K', team: `${teamRows * 100}K`, enterprise: 'Unlimited' },
    },
    {
      id: 'storage',
      label: 'Storage',
      group: 'Usage',
      cells: { starter: '1 GB', team: `${teamStorage} GB`, enterprise: 'Unlimited' },
    },
    {
      id: 'connections',
      label: 'Database connections',
      group: 'Usage',
      cells: { starter: '1', team: '10', enterprise: 'Unlimited' },
    },
    {
      id: 'seats',
      label: 'Team seats',
      group: 'Collaboration',
      cells: { starter: '1', team: String(teamSeats), enterprise: 'Unlimited' },
    },
    { id: 'roles', label: 'Custom roles', group: 'Collaboration', cells: { starter: false, team: true, enterprise: true } },
    { id: 'audit', label: 'Audit log', group: 'Collaboration', cells: { starter: false, team: true, enterprise: true } },
    { id: 'sso', label: 'SAML single sign-on', group: 'Security', cells: { starter: false, team: false, enterprise: true } },
    { id: 'rls', label: 'Row-level security', group: 'Security', cells: { starter: false, team: true, enterprise: true } },
    { id: 'sla', label: 'Uptime SLA', group: 'Security', cells: { starter: false, team: '99.9%', enterprise: '99.99%' } },
  ];
  return { columns: [...PLAN_COLUMNS], rows, groups: [...PLAN_GROUPS] };
}

// ── chip-cloud (annex §3) ──────────────────────────────────────────────────
export const chipCloudConfigSchema = widgetSharedConfigSchema.extend({
  /** Chip click behaviour (annex `clickAction`). */
  clickAction: z.enum(['none', 'insert', 'navigate']).default('none'),
  /** Staggered pop-in on mount (annex `stagger`); disabled under reduced motion. */
  stagger: z.boolean().default(false),
  /** Max chips before the cloud collapses to a "+N more" chip. */
  limit: z.number().int().min(1).max(200).default(40),
  /** Uniform chip tone; a per-chip `tone` still wins. */
  chipTone: toneEnum.default('neutral'),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ChipCloudConfig = z.infer<typeof chipCloudConfigSchema>;

const CHIP_TABLES = [
  'public.customers',
  'public.orders',
  'public.order_items',
  'public.invoices',
  'public.payments',
  'public.subscriptions',
  'public.team_members',
  'public.audit_log',
  'public.webhooks',
  'public.api_keys',
  'public.sessions',
  'public.products',
  'public.categories',
  'public.addresses',
] as const;

/**
 * Deterministic `categorical` payload of discovered-table chips (04 §7.7). The
 * canonical `categorical` envelope (`{ items: [...] }`) is what lets the host's
 * shared `isEmptyByShape` route an empty cloud to the empty state.
 */
export function chipCloudDemoData(seed: number): { items: CloudChip[] } {
  const random = mulberry32(seed || 1);
  const count = 8 + Math.floor(random() * (CHIP_TABLES.length - 8));
  const items: CloudChip[] = CHIP_TABLES.slice(0, count).map((label) => ({
    label,
    icon: pickFrom(random, ['table', 'database', 'entity'] as const),
    value: label,
  }));
  return { items };
}
