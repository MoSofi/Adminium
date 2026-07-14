/**
 * `page-dashboard` envelope generation — one per FK-cluster domain, cap 3
 * for v1 (research/widget-registry.md §14 trigger, §15 decision summary).
 *
 * Widget set per §15: 4 KPI candidates (COUNT(*), money SUM when present,
 * new-this-period on the created-at family, status-group count with a
 * secondary-table fallback), a hero timeseries (`chart-line-area`, span 8)
 * bucketing the best timestamp by month, and a `chart-donut` (span 4) over
 * the top categorical breakdown. Layout spans follow the §15 / ia-mapping
 * §3.2 heuristic: kpi=3, donut=4, line=8 on the 12-column grid; heights are
 * half-row units of 40 px (04 §6.1).
 */

import type { ColumnModel, DatabaseModel, TableModel } from '../schema-model.js';
import type { Domain } from './domains.js';
import { humanize } from './util.js';

/** Span heuristic (research/ia-mapping.md §3.2). */
const KPI_SPAN = 3;
const DONUT_SPAN = 4;
const LINE_SPAN = 8;
const KPI_HEIGHT = 3; // 120 px
const CHART_HEIGHT = 8; // 320 px

interface DomainColumn {
  table: TableModel;
  column: ColumnModel;
}

export interface DashboardBuildContext {
  connectionId: string;
  slug: string;
  title: string;
  navOrder: number;
}

function tag(column: ColumnModel): string {
  return column.semantics?.primary ?? 'plain';
}

function descriptorSource(table: TableModel): Record<string, unknown> {
  return {
    schema: table.schema,
    name: table.name,
    type: table.kind === 'table' ? 'table' : 'view',
  };
}

/**
 * Rank a domain's columns matching `predicate`: hub table first, then tables
 * adjacent to the hub, then the rest; within a table, declaration order.
 */
function rankDomainColumns(
  model: DatabaseModel,
  domain: Domain,
  tables: readonly TableModel[],
  predicate: (column: ColumnModel, table: TableModel) => boolean,
): DomainColumn[] {
  const adjacent = new Set<string>();
  for (const relation of model.relations) {
    if (relation.from.tableId === domain.hubTableId) adjacent.add(relation.to.tableId);
    if (relation.to.tableId === domain.hubTableId) adjacent.add(relation.from.tableId);
  }
  const tier = (t: TableModel): number =>
    t.id === domain.hubTableId ? 0 : adjacent.has(t.id) ? 1 : 2;

  const out: DomainColumn[] = [];
  for (const table of tables) {
    if (!domain.tableIds.includes(table.id)) continue;
    for (const column of table.columns) {
      if (predicate(column, table)) out.push({ table, column });
    }
  }
  out.sort(
    (a, b) =>
      tier(a.table) - tier(b.table) ||
      a.table.id.localeCompare(b.table.id) ||
      a.column.ordinal - b.column.ordinal,
  );
  return out;
}

const TIMESTAMPY = new Set(['date', 'timestamp', 'timestamptz']);

/** Best time axis: created-at first (05 §7.1 rule 9), else event timestamps. */
function bestTimestamp(
  model: DatabaseModel,
  domain: Domain,
  tables: readonly TableModel[],
): DomainColumn | null {
  const createdAt = rankDomainColumns(model, domain, tables, (c) => tag(c) === 'created-at');
  if (createdAt.length > 0) return createdAt[0] as DomainColumn;
  const eventish = rankDomainColumns(
    model,
    domain,
    tables,
    (c) => (tag(c) === 'event-timestamp' || tag(c) === 'date-range') && TIMESTAMPY.has(c.logicalType),
  );
  return eventish[0] ?? null;
}

/** Donut group-by ranking: status > category > geo-region > boolean flags. */
function bestCategorical(
  model: DatabaseModel,
  domain: Domain,
  tables: readonly TableModel[],
): DomainColumn | null {
  for (const wanted of ['status-workflow', 'category-enum', 'geo-region', 'boolean-flag']) {
    const hits = rankDomainColumns(model, domain, tables, (c) => tag(c) === wanted);
    if (hits.length === 0) continue;
    if (wanted === 'geo-region') {
      // Country beats region/state/city-level codes as a breakdown.
      const country = hits.find((h) => /country/i.test(h.column.name));
      return country ?? (hits[0] as DomainColumn);
    }
    return hits[0] as DomainColumn;
  }
  return null;
}

/** §8 trigger: a domain can host a dashboard only with ≥ 1 time axis. */
export function hasDashboardSignal(
  model: DatabaseModel,
  domain: Domain,
  tables: readonly TableModel[],
): boolean {
  return bestTimestamp(model, domain, tables) !== null;
}

interface WidgetItem {
  i: string;
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

function kpi(
  id: string,
  x: number,
  title: string,
  binding: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): WidgetItem {
  return {
    i: id,
    widget: 'kpi-stat-card',
    x,
    y: 0,
    w: KPI_SPAN,
    h: KPI_HEIGHT,
    config: { title, binding, ...extra },
  };
}

/**
 * Build the four §15 KPI candidates for a domain. Always returns exactly 4
 * (fallbacks: secondary-table counts) so the KPI row is stable.
 */
function kpiRow(
  model: DatabaseModel,
  domain: Domain,
  tables: readonly TableModel[],
  connectionId: string,
): WidgetItem[] {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const hub = byId.get(domain.hubTableId) as TableModel;
  const hubLabel = humanize(hub.name);
  const items: WidgetItem[] = [];

  // 1 — COUNT(*) of the hub table.
  items.push(
    kpi(`kpi-count-${hub.name}`, 0, `Total ${hubLabel}`, {
      kind: 'table-query',
      connectionId,
      source: descriptorSource(hub),
      shape: 'single-metric',
      aggregations: [{ fn: 'count', alias: 'value' }],
    }),
  );

  // 2 — money SUM when present (hub first, then adjacent tables).
  const money = rankDomainColumns(model, domain, tables, (c) => tag(c) === 'money')[0];
  if (money !== undefined) {
    items.push(
      kpi(
        `kpi-sum-${money.table.name}-${money.column.name}`,
        KPI_SPAN,
        `Total ${humanize(money.column.name)}`,
        {
          kind: 'table-query',
          connectionId,
          source: descriptorSource(money.table),
          shape: 'single-metric',
          aggregations: [{ fn: 'sum', column: money.column.name, alias: 'value' }],
        },
        { format: 'currency' },
      ),
    );
  }

  // 3 — new-this-period on the created-at family, with prior comparison.
  const ts = bestTimestamp(model, domain, tables);
  if (ts !== null && items.length < 4) {
    items.push(
      kpi(
        `kpi-new-${ts.table.name}`,
        items.length * KPI_SPAN,
        `New ${humanize(ts.table.name)} (30d)`,
        {
          kind: 'table-query',
          connectionId,
          source: descriptorSource(ts.table),
          shape: 'metric+delta',
          aggregations: [{ fn: 'count', alias: 'value' }],
          window: { column: ts.column.name, last: 30, unit: 'day', compareToPrior: true },
        },
      ),
    );
  }

  // 4 — status-group count when a workflow enum exists…
  const status = rankDomainColumns(model, domain, tables, (c) => tag(c) === 'status-workflow')[0];
  if (status !== undefined && items.length < 4) {
    const values = model.enums.find((e) => e.id === status.column.enumRef)?.values ?? [];
    const active =
      values.find((v) => /^(open|pending|new|in_progress|active|todo|backlog)$/i.test(v)) ??
      values[0] ??
      null;
    if (active !== null) {
      items.push(
        kpi(
          `kpi-status-${status.table.name}`,
          items.length * KPI_SPAN,
          `${humanize(active)} ${humanize(status.table.name)}`,
          {
            kind: 'table-query',
            connectionId,
            source: descriptorSource(status.table),
            shape: 'single-metric',
            aggregations: [{ fn: 'count', alias: 'value' }],
            filters: [{ column: status.column.name, op: 'eq', value: active }],
          },
        ),
      );
    }
  }

  // …fallbacks: counts of the next-most-connected entity tables.
  if (items.length < 4) {
    const fallbacks = domain.tableIds
      .map((id) => byId.get(id))
      .filter(
        (t): t is TableModel =>
          t !== undefined && t.id !== hub.id && t.semantics?.role !== 'join-table',
      )
      .sort((a, b) => (b.rowCountEstimate ?? 0) - (a.rowCountEstimate ?? 0) || a.id.localeCompare(b.id));
    for (const table of fallbacks) {
      if (items.length >= 4) break;
      items.push(
        kpi(`kpi-count-${table.name}`, items.length * KPI_SPAN, `Total ${humanize(table.name)}`, {
          kind: 'table-query',
          connectionId,
          source: descriptorSource(table),
          shape: 'single-metric',
          aggregations: [{ fn: 'count', alias: 'value' }],
        }),
      );
    }
  }

  // Re-stamp x positions after fallback fills (order is already final).
  return items.slice(0, 4).map((item, index) => ({ ...item, x: index * KPI_SPAN }));
}

/**
 * Build the (unhashed, unvalidated) `page-dashboard` envelope for a domain.
 * Returns null when the domain has no time axis at all (05 §8 trigger
 * requires ≥ 1 timestamp) — the caller records a warning.
 */
export function buildDashboardEnvelope(
  model: DatabaseModel,
  domain: Domain,
  tables: readonly TableModel[],
  ctx: DashboardBuildContext,
): Record<string, unknown> | null {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const hub = byId.get(domain.hubTableId);
  if (hub === undefined) return null;

  const ts = bestTimestamp(model, domain, tables);
  if (ts === null) return null; // §8: dashboard needs ≥1 timestamp in the domain

  const items = kpiRow(model, domain, tables, ctx.connectionId);
  const y = KPI_HEIGHT;

  // Hero timeseries: money sum when the time-axis table has a money column,
  // else row count, bucketed by month (§15 chart candidate ranking).
  const heroMoney = ts.table.columns.find((c) => tag(c) === 'money');
  items.push({
    i: `hero-line-${ts.table.name}`,
    widget: 'chart-line-area',
    x: 0,
    y,
    w: LINE_SPAN,
    h: CHART_HEIGHT,
    config: {
      title:
        heroMoney !== undefined
          ? `${humanize(heroMoney.name)} per Month`
          : `${humanize(ts.table.name)} per Month`,
      binding: {
        kind: 'table-query',
        connectionId: ctx.connectionId,
        source: descriptorSource(ts.table),
        shape: 'timeseries',
        aggregations: [
          heroMoney !== undefined
            ? { fn: 'sum', column: heroMoney.name, alias: 'value' }
            : { fn: 'count', alias: 'value' },
        ],
        bucket: { column: ts.column.name, unit: 'month' },
      },
    },
  });

  // Donut: top categorical/status breakdown (§15), span 4 beside the hero.
  const categorical = bestCategorical(model, domain, tables);
  if (categorical !== null) {
    items.push({
      i: `donut-${categorical.table.name}-${categorical.column.name}`,
      widget: 'chart-donut',
      x: LINE_SPAN,
      y,
      w: DONUT_SPAN,
      h: CHART_HEIGHT,
      config: {
        title: `${humanize(categorical.table.name)} by ${humanize(categorical.column.name)}`,
        binding: {
          kind: 'table-query',
          connectionId: ctx.connectionId,
          source: descriptorSource(categorical.table),
          shape: 'categorical',
          aggregations: [{ fn: 'count', alias: 'value' }],
          groupBy: [categorical.column.name],
          limit: 8,
        },
      },
    });
  }

  return {
    v: 1,
    kind: 'dashboard',
    id: `page_${ctx.slug}`,
    template: 'page-dashboard',
    title: { key: `nav.${ctx.slug}`, fallback: ctx.title },
    source: { connectionId: ctx.connectionId, table: null },
    nav: { group: 'workspace', icon: 'layout-dashboard', order: ctx.navOrder, slug: ctx.slug },
    access: { minRole: 'viewer', permissions: [] },
    config: {
      domain: { key: domain.key, label: domain.label, tables: domain.tableIds },
      layout: { version: 1, items },
    },
  };
}
