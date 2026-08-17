// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `tables` family Track F config schemas + deterministic demo generators —
 * PURE module (zod, the shared config, the pure `column-spec` leaf and
 * `tables-track-f-types` types only; no React, no component code).
 *
 * WHY THIS EXISTS: `registry/index.ts` statically imports
 * `tables-track-f.definitions.ts`, so everything that module imports lands in
 * the registry's EAGER graph. While the schemas + demo payloads lived in
 * `CardGallery.tsx` / `GroupedSummaryTable.tsx` / `LogTable.tsx` /
 * `MasterList.tsx` / `SchemaTree.tsx` / `ToggleMatrixWidget.tsx`, the
 * definitions had to reach into those component modules to name them — which
 * pulled all six widgets and their @adminium/ui deps into the eager chunk and
 * left the sibling `lazy(() => import('./tables-track-f-components.js'))` refs
 * buying nothing. Holding them here (the boards/domain/media `*-config`
 * convention) lets the definitions import metadata only, so the components stay
 * reachable exclusively through the lazy barrel (04 §2.3, acceptance #3;
 * enforced by `qa/chunk-budget.test.ts`).
 *
 * The component files re-export these symbols, so the family barrel, stories and
 * tests keep their existing import points.
 */
import { z } from 'zod';

import type { GridRow } from './column-spec.js';
import type {
  AggColumn,
  GalleryCard,
  GroupedSummaryData,
  LogRow,
  MatrixColumn,
  MatrixData,
  SchemaNode,
  SummaryGroup,
} from './tables-track-f-types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * Mulberry32 — the repo's deterministic seeded PRNG (see tables/demo-data.ts).
 * One copy for the whole track: each widget module used to carry its own
 * private duplicate of this function beside its demo generator.
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

// ── card-gallery (annex §3) ────────────────────────────────────────────────
const thumbnailMode = z.enum(['none', 'icon', 'monogram', 'doc-preview']);
/** The `card-gallery` thumbnail treatment (the component's prop type). */
export type CardThumbnailMode = z.infer<typeof thumbnailMode>;

export const cardGalleryConfigSchema = widgetSharedConfigSchema.extend({
  columns: z.number().int().min(2).max(4).default(3),
  thumbnail: thumbnailMode.default('monogram'),
  clickAction: z.enum(['open', 'link', 'none']).default('open'),
  actions: z
    .array(z.object({ key: z.string().min(1), label: z.string().min(1) }))
    .default([]),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type CardGalleryConfig = z.infer<typeof cardGalleryConfigSchema>;

const INTEGRATIONS = [
  { name: 'Stripe', category: 'Payments', status: 'connected', tone: 'accent' },
  { name: 'Slack', category: 'Messaging', status: 'connected', tone: 'info' },
  { name: 'GitHub', category: 'Developer', status: 'available', tone: 'neutral' },
  { name: 'Segment', category: 'Analytics', status: 'available', tone: 'warn' },
  { name: 'Salesforce', category: 'CRM', status: 'connected', tone: 'info' },
  { name: 'Zendesk', category: 'Support', status: 'available', tone: 'pos' },
  { name: 'Snowflake', category: 'Data', status: 'error', tone: 'danger' },
  { name: 'Notion', category: 'Docs', status: 'available', tone: 'neutral' },
] as const;
const STATUS_META: Record<string, string> = { connected: 'Synced 2h ago', available: 'Not connected', error: 'Action required' };

/** Deterministic `record-list` of gallery cards (04 §7.7). */
export function cardGalleryDemoData(seed: number): { data: GalleryCard[] } {
  const random = mulberry32(seed || 1);
  void random();
  const data: GalleryCard[] = INTEGRATIONS.map((integration, index) => ({
    id: index + 1,
    title: integration.name,
    subtitle: integration.category,
    status: integration.status,
    tone: integration.tone,
    meta: STATUS_META[integration.status] ?? '',
  }));
  return { data };
}

// ── grouped-summary-table (annex §3) ───────────────────────────────────────
export const groupedSummaryTableConfigSchema = widgetSharedConfigSchema.extend({
  expandable: z.boolean().default(true),
  totalsRow: z.boolean().default(true),
  groupLabel: z.string().optional(),
  totalsLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
});
export type GroupedSummaryTableConfig = z.infer<typeof groupedSummaryTableConfigSchema>;

const REGIONS = [
  { key: 'na', label: 'North America', services: ['API', 'Web', 'Jobs'] },
  { key: 'eu', label: 'Europe', services: ['API', 'Web'] },
  { key: 'apac', label: 'Asia Pacific', services: ['API', 'Web', 'Edge'] },
  { key: 'latam', label: 'Latin America', services: ['API'] },
] as const;

/** Deterministic grouped-summary payload (04 §7.7). */
export function groupedSummaryTableDemoData(seed: number): GroupedSummaryData {
  const random = mulberry32(seed || 1);
  const columns: AggColumn[] = [
    { key: 'requests', label: 'Requests', format: 'number' },
    { key: 'revenue', label: 'Revenue', format: 'currency' },
    { key: 'usage', label: 'Quota', format: 'progress', max: 100, tone: 'accent' },
    { key: 'errorRate', label: 'Errors', format: 'percent', tone: 'danger' },
  ];
  const groups: SummaryGroup[] = REGIONS.map((region) => {
    const rows = region.services.map((service) => ({
      label: service,
      aggregates: {
        requests: Math.floor(random() * 40_000) + 1000,
        revenue: Math.floor(random() * 20_000) + 500,
        usage: Math.floor(random() * 100),
        errorRate: Math.round(random() * 40) / 10,
      } as Record<string, number>,
    }));
    const sum = (key: string) => rows.reduce((acc, row) => acc + (row.aggregates[key] as number), 0);
    return {
      key: region.key,
      label: region.label,
      count: rows.length,
      rows,
      aggregates: {
        requests: sum('requests'),
        revenue: sum('revenue'),
        usage: Math.round(sum('usage') / rows.length),
        errorRate: Math.round((sum('errorRate') / rows.length) * 10) / 10,
      },
    };
  });
  const totals: Record<string, number> = {
    requests: groups.reduce((acc, g) => acc + (g.aggregates['requests'] as number), 0),
    revenue: groups.reduce((acc, g) => acc + (g.aggregates['revenue'] as number), 0),
    usage: Math.round(groups.reduce((acc, g) => acc + (g.aggregates['usage'] as number), 0) / groups.length),
    errorRate: Math.round((groups.reduce((acc, g) => acc + (g.aggregates['errorRate'] as number), 0) / groups.length) * 10) / 10,
  };
  return { data: groups, columns, totals };
}

// ── log-table (annex §3) ───────────────────────────────────────────────────
export const logTableConfigSchema = widgetSharedConfigSchema.extend({
  rowAction: z.enum(['retry', 'download', 'inspect', 'none']).default('inspect'),
  search: z.boolean().default(true),
  filters: z.boolean().default(true),
  liveTail: z.boolean().default(false),
  labels: z
    .object({
      searchPlaceholder: z.string().optional(),
      all: z.string().optional(),
      errors: z.string().optional(),
      live: z.string().optional(),
      retry: z.string().optional(),
      download: z.string().optional(),
      inspect: z.string().optional(),
      emptyTitle: z.string().optional(),
      emptyBody: z.string().optional(),
      noMatches: z.string().optional(),
    })
    .optional(),
});
export type LogTableConfig = z.infer<typeof logTableConfigSchema>;

const LOG_TEMPLATES = [
  { category: 'auth', categoryTone: 'info', action: 'signed in', resource: 'session/9f2a', status: 'success', ip: '203.0.113.7' },
  { category: 'billing', categoryTone: 'warn', action: 'charge failed for', resource: 'sub_4821', code: 402 },
  { category: 'api', categoryTone: 'neutral', action: 'POST', resource: '/v1/orders', code: 201 },
  { category: 'webhook', categoryTone: 'accent', action: 'delivered', resource: 'order.paid', code: 200 },
  { category: 'api', categoryTone: 'neutral', action: 'GET', resource: '/v1/reports', code: 500 },
  { category: 'security', categoryTone: 'danger', action: 'blocked request from', resource: 'bot/crawler', status: 'denied', ip: '198.51.100.4' },
  { category: 'export', categoryTone: 'info', action: 'generated', resource: 'customers.csv', status: 'success' },
] as const;
const LOG_ACTORS = ['Ada Lovelace', 'System', 'api-gw', 'Grace Hopper', 'cron'] as const;

/** Deterministic DESC-ordered `record-list` of log rows (04 §7.7). */
export function logTableDemoData(seed: number): { data: LogRow[] } {
  const random = mulberry32(seed || 1);
  const base = Date.UTC(2026, 6, 14, 14, 30, 0);
  const data: LogRow[] = Array.from({ length: 12 }, (_, index) => {
    const template = LOG_TEMPLATES[Math.floor(random() * LOG_TEMPLATES.length) % LOG_TEMPLATES.length]!;
    return {
      id: index + 1,
      ts: new Date(base - index * 47 * 60_000 - Math.floor(random() * 60) * 1000).toISOString(),
      actor: LOG_ACTORS[Math.floor(random() * LOG_ACTORS.length) % LOG_ACTORS.length]!,
      ...template,
    };
  });
  return { data };
}

// ── master-list (annex §3) ─────────────────────────────────────────────────
export const masterListConfigSchema = widgetSharedConfigSchema.extend({
  titleField: z.string().default('name'),
  subtitleField: z.string().optional(),
  statusField: z.string().optional(),
  toggleField: z.string().optional(),
  progressField: z.string().optional(),
  ownerField: z.string().optional(),
  updatedField: z.string().optional(),
  /** Column whose distinct values seed the filter chip bar. */
  filterField: z.string().optional(),
  selectable: z.boolean().default(true),
  allLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
});
export type MasterListConfig = z.infer<typeof masterListConfigSchema>;

const RULES = [
  { name: 'Auto-assign new tickets', status: 'active', category: 'Support' },
  { name: 'Escalate SLA breach', status: 'active', category: 'Support' },
  { name: 'Weekly usage digest', status: 'paused', category: 'Reports' },
  { name: 'Churn risk alert', status: 'active', category: 'Growth' },
  { name: 'Failed payment retry', status: 'active', category: 'Billing' },
  { name: 'Onboarding nudge', status: 'draft', category: 'Growth' },
  { name: 'Backup export nightly', status: 'paused', category: 'Reports' },
] as const;
const OWNERS = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson'] as const;

/** Deterministic `record-list` of automation rules (04 §7.7). */
export function masterListDemoData(seed: number): { data: GridRow[] } {
  const random = mulberry32(seed || 1);
  const base = Date.UTC(2026, 6, 14, 9, 0, 0);
  const data: GridRow[] = RULES.map((rule, index) => ({
    id: index + 1,
    name: rule.name,
    status: rule.status,
    category: rule.category,
    enabled: rule.status === 'active',
    progress: Math.floor(random() * 100),
    owner_name: OWNERS[Math.floor(random() * OWNERS.length) % OWNERS.length],
    updated_at: new Date(base - Math.floor(random() * 96) * 3_600_000).toISOString(),
  }));
  return { data };
}

// ── schema-tree (annex §3) ─────────────────────────────────────────────────
export const schemaTreeConfigSchema = widgetSharedConfigSchema.extend({
  expandDepth: z.number().int().min(0).max(4).default(1),
  showTypes: z.boolean().default(true),
  emptyTitle: z.string().optional(),
});
export type SchemaTreeConfig = z.infer<typeof schemaTreeConfigSchema>;

const TABLES = [
  { name: 'customers', rows: 8402, cols: [['id', 'int8', { pk: true }], ['email', 'varchar', { unique: true }], ['owner_id', 'int8', { fk: true }], ['created_at', 'timestamptz', {}]] },
  { name: 'orders', rows: 51230, cols: [['id', 'int8', { pk: true }], ['customer_id', 'int8', { fk: true }], ['total', 'numeric', {}], ['status', 'text', {}]] },
  { name: 'invoices', rows: 12904, cols: [['id', 'uuid', { pk: true }], ['order_id', 'int8', { fk: true }], ['amount', 'numeric', {}]] },
] as const;
const VIEWS = [{ name: 'active_customers', rows: 6120, cols: [['id', 'int8', {}], ['email', 'varchar', {}]] }] as const;

/** Deterministic `hierarchy/tree` introspection payload — schema is fixed, so seed-independent (04 §7.7). */
export function schemaTreeDemoData(seed: number): { roots: SchemaNode[] } {
  void seed;
  const tableNodes: SchemaNode[] = TABLES.map((table) => ({
    id: `public.${table.name}`,
    kind: 'table',
    label: table.name,
    rowCount: table.rows,
    children: table.cols.map(([name, type, flags]) => ({
      id: `public.${table.name}.${name as string}`,
      kind: 'column',
      label: name as string,
      pgType: type as string,
      ...(flags as { pk?: boolean; fk?: boolean; unique?: boolean }),
    })),
  }));
  const viewNodes: SchemaNode[] = VIEWS.map((view) => ({
    id: `public.${view.name}`,
    kind: 'view',
    label: view.name,
    rowCount: view.rows,
    children: view.cols.map(([name, type]) => ({
      id: `public.${view.name}.${name as string}`,
      kind: 'column',
      label: name as string,
      pgType: type as string,
    })),
  }));
  return {
    roots: [
      {
        id: 'public',
        kind: 'schema',
        label: 'public',
        children: [...tableNodes, ...viewNodes],
      },
    ],
  };
}

// ── toggle-matrix (annex §3) ───────────────────────────────────────────────
const cellMode = z.enum(['toggle', 'readonly', 'read-write-pair']);
/** The `toggle-matrix` cell interaction mode (the component's prop type). */
export type ToggleCellMode = z.infer<typeof cellMode>;

export const toggleMatrixConfigSchema = widgetSharedConfigSchema.extend({
  cellMode: cellMode.default('toggle'),
  /** Table/policy target for persisted edits (adminium_roles / policy tables). */
  persistTarget: z.string().optional(),
  rowHeader: z.string().optional(),
  matrixLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
});
export type ToggleMatrixConfig = z.infer<typeof toggleMatrixConfigSchema>;

const PERMISSIONS: { id: string; label: string; group: string }[] = [
  { id: 'view', label: 'View records', group: 'Records' },
  { id: 'create', label: 'Create records', group: 'Records' },
  { id: 'update', label: 'Edit records', group: 'Records' },
  { id: 'delete', label: 'Delete records', group: 'Records' },
  { id: 'export', label: 'Export data', group: 'Data' },
  { id: 'import', label: 'Import data', group: 'Data' },
  { id: 'manage_users', label: 'Manage users', group: 'Admin' },
  { id: 'manage_billing', label: 'Manage billing', group: 'Admin' },
];
const ROLES: MatrixColumn[] = [
  { id: 'owner', label: 'Owner', locked: true },
  { id: 'admin', label: 'Admin' },
  { id: 'editor', label: 'Editor' },
  { id: 'viewer', label: 'Viewer' },
];

/** Deterministic `matrix` payload — RBAC permissions × roles (04 §7.7). */
export function toggleMatrixDemoData(seed: number): MatrixData {
  const random = mulberry32(seed || 1);
  const cells: Record<string, Record<string, boolean>> = {};
  const locked: Record<string, Record<string, boolean>> = {};
  for (const permission of PERMISSIONS) {
    cells[permission.id] = {};
    locked[permission.id] = {};
    for (const role of ROLES) {
      // Owner is granted-and-locked on everything; others get seeded grants.
      if (role.id === 'owner') {
        cells[permission.id]![role.id] = true;
        locked[permission.id]![role.id] = true;
      } else if (role.id === 'viewer') {
        cells[permission.id]![role.id] = permission.id === 'view' || permission.id === 'export';
      } else if (role.id === 'admin') {
        cells[permission.id]![role.id] = permission.group !== 'Admin' ? true : random() > 0.3;
      } else {
        cells[permission.id]![role.id] = permission.group === 'Records' ? random() > 0.2 : random() > 0.6;
      }
    }
  }
  return {
    rowKeys: PERMISSIONS.map((permission) => permission.id),
    colKeys: ROLES.map((role) => role.id),
    columns: ROLES,
    rows: PERMISSIONS,
    cells,
    locked,
  };
}
