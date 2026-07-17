/**
 * Domain-scoped `page-dashboard` candidate assembly — the cross-table widget
 * selection of the Engine's bespoke `generate/dashboard.ts`, relocated behind
 * the leaf boundary (research/widget-registry.md §14 trigger, §15 decision
 * summary: one dashboard per FK-cluster domain).
 *
 * Widget set per §15: 4 KPI candidates (COUNT(*), money SUM when present,
 * new-this-period on the created-at family, status-group count with a
 * secondary-table fallback), a hero timeseries (`chart-line-area`) bucketing
 * the best timestamp by month, and a `chart-donut` over the top categorical
 * breakdown.
 *
 * Unlike the bespoke builder this module emits `TemplateCandidate[]` and stops:
 * geometry comes from the `page-dashboard` manifest via `composeTemplate`
 * (04 §10), not from hand-stamped x/y/w/h. The manifest's v2 slot areas
 * reproduce the bespoke spans exactly (kpi 3×3 row, hero 8×8, donut 4×8), and
 * each candidate carries the bespoke instance id so regenerated layout items
 * keep their identity. Domain detection itself (FK clustering, hub election,
 * naming) stays in the Engine — this module receives the result as a
 * structural mirror ({@link DashboardDomain}), same contract style as
 * `../registry/candidates.ts`.
 *
 * SEMANTIC SOURCE: column tags and table roles come from `entry.classified` —
 * the classification the Engine adapter supplies (recomputed on the model as
 * generated, with `source: 'llm' | 'override'` column stamps folded in, 05 §7).
 * The bespoke builder read full-model stamped semantics instead; the delta is
 * deliberate and pinned by `generate-archetypes.test.ts` — on a filtered model
 * a join table whose partner is excluded reclassifies (and may take a fallback
 * KPI), exactly as it earns a `page-crud`.
 *
 * DETERMINISM: candidates are emitted in the bespoke order with equal scores —
 * `composeTemplate`'s total order (score, widget id, input order) then
 * preserves it, so a re-run over an unchanged schema composes an identical
 * layout (H5 `generated_hash`).
 */

import type { QueryDescriptor } from '../page-config/query-descriptor.js';
import type { TemplateCandidate } from '../templates/compose.js';
import {
  humanize,
  type CandidateColumn,
  type CandidateRelation,
  type CandidateTableInput,
} from '../registry/candidates.js';

/** The engine `Domain` fields this assembly reads (structural mirror). */
export interface DashboardDomain {
  /** Deterministic kebab-case key, e.g. `orders`. */
  key: string;
  /** Human label, e.g. `Orders`. */
  label: string;
  /** All member table ids, sorted. */
  tableIds: readonly string[];
  /** The weighted hub — highest relation degree. */
  hubTableId: string;
}

export interface DashboardDomainContext {
  /** `adminium_connections.id` every emitted binding scopes to. */
  connectionId: string;
}

/** A domain column with its table and classification folded in. */
interface DomainColumn {
  entry: CandidateTableInput;
  column: CandidateColumn;
  semantic: string;
}

function tag(entry: CandidateTableInput, column: CandidateColumn): string {
  const info = entry.classified.columns.find((c) => c.column === column.name);
  return info?.semantic ?? 'plain';
}

function ordinalOf(column: CandidateColumn): number {
  return column.ordinal ?? 0;
}

/** Query-descriptor `source` for a table (bespoke `descriptorSource` shape). */
function descriptorSource(entry: CandidateTableInput): QueryDescriptor['source'] {
  const { table } = entry;
  return {
    ...(table.schema === undefined ? {} : { schema: table.schema }),
    name: table.name,
    type: (table.kind ?? 'table') === 'table' ? 'table' : 'view',
  };
}

/**
 * Rank a domain's columns matching `predicate`: hub table first, then tables
 * adjacent to the hub, then the rest; within a table, declaration order.
 */
function rankDomainColumns(
  domain: DashboardDomain,
  model: readonly CandidateTableInput[],
  relations: readonly CandidateRelation[],
  predicate: (semantic: string, column: CandidateColumn) => boolean,
): DomainColumn[] {
  const adjacent = new Set<string>();
  for (const relation of relations) {
    if (relation.from.tableId === domain.hubTableId) adjacent.add(relation.to.tableId);
    if (relation.to.tableId === domain.hubTableId) adjacent.add(relation.from.tableId);
  }
  const tier = (id: string): number => (id === domain.hubTableId ? 0 : adjacent.has(id) ? 1 : 2);

  const out: DomainColumn[] = [];
  for (const entry of model) {
    if (!domain.tableIds.includes(entry.table.id)) continue;
    for (const column of entry.table.columns) {
      const semantic = tag(entry, column);
      if (predicate(semantic, column)) out.push({ entry, column, semantic });
    }
  }
  out.sort(
    (a, b) =>
      tier(a.entry.table.id) - tier(b.entry.table.id) ||
      a.entry.table.id.localeCompare(b.entry.table.id) ||
      ordinalOf(a.column) - ordinalOf(b.column),
  );
  return out;
}

const TIMESTAMPY = new Set(['date', 'timestamp', 'timestamptz']);

/** Best time axis: created-at first (05 §7.1 rule 9), else event timestamps. */
function bestTimestamp(
  domain: DashboardDomain,
  model: readonly CandidateTableInput[],
  relations: readonly CandidateRelation[],
): DomainColumn | null {
  const createdAt = rankDomainColumns(domain, model, relations, (s) => s === 'created-at');
  if (createdAt.length > 0) return createdAt[0] as DomainColumn;
  const eventish = rankDomainColumns(
    domain,
    model,
    relations,
    (s, c) => (s === 'event-timestamp' || s === 'date-range') && TIMESTAMPY.has(c.logicalType),
  );
  return eventish[0] ?? null;
}

/** Donut group-by ranking: status > category > geo-region > boolean flags. */
function bestCategorical(
  domain: DashboardDomain,
  model: readonly CandidateTableInput[],
  relations: readonly CandidateRelation[],
): DomainColumn | null {
  for (const wanted of ['status-workflow', 'category-enum', 'geo-region', 'boolean-flag']) {
    const hits = rankDomainColumns(domain, model, relations, (s) => s === wanted);
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
export function domainHasDashboardSignal(
  domain: DashboardDomain,
  model: readonly CandidateTableInput[],
  relations: readonly CandidateRelation[],
): boolean {
  return bestTimestamp(domain, model, relations) !== null;
}

/** The §15 dashboard candidates all share one score: input order decides. */
const DOMAIN_SCORE = 1;
/** Bespoke `ACTIVE`-state vocabulary for the status KPI (annex §1/§6). */
const ACTIVE_STATE = /^(open|pending|new|in_progress|active|todo|backlog)$/i;

function kpi(
  instanceId: string,
  title: string,
  binding: QueryDescriptor,
  extra: Record<string, unknown> = {},
): TemplateCandidate {
  return {
    widget: 'kpi-stat-card',
    shape: binding.shape,
    score: DOMAIN_SCORE,
    instanceId,
    config: { title, binding, ...extra },
  };
}

/**
 * Build the four §15 KPI candidates for a domain. Always returns exactly 4
 * when the domain has enough tables (fallbacks: secondary-table counts) so
 * the KPI row is stable; `composeTemplate` tiles them 3×3 along the row.
 */
function kpiRow(
  domain: DashboardDomain,
  model: readonly CandidateTableInput[],
  relations: readonly CandidateRelation[],
  connectionId: string,
): TemplateCandidate[] {
  const byId = new Map(model.map((entry) => [entry.table.id, entry]));
  const hub = byId.get(domain.hubTableId) as CandidateTableInput;
  const hubLabel = humanize(hub.table.name);
  const items: TemplateCandidate[] = [];

  // 1 — COUNT(*) of the hub table.
  items.push(
    kpi(`kpi-count-${hub.table.name}`, `Total ${hubLabel}`, {
      kind: 'table-query',
      connectionId,
      source: descriptorSource(hub),
      shape: 'single-metric',
      aggregations: [{ fn: 'count', alias: 'value' }],
    }),
  );

  // 2 — money SUM when present (hub first, then adjacent tables).
  const money = rankDomainColumns(domain, model, relations, (s) => s === 'money')[0];
  if (money !== undefined) {
    items.push(
      kpi(
        `kpi-sum-${money.entry.table.name}-${money.column.name}`,
        `Total ${humanize(money.column.name)}`,
        {
          kind: 'table-query',
          connectionId,
          source: descriptorSource(money.entry),
          shape: 'single-metric',
          aggregations: [{ fn: 'sum', column: money.column.name, alias: 'value' }],
        },
        { format: 'currency' },
      ),
    );
  }

  // 3 — new-this-period on the created-at family, with prior comparison.
  const ts = bestTimestamp(domain, model, relations);
  if (ts !== null && items.length < 4) {
    items.push(
      kpi(`kpi-new-${ts.entry.table.name}`, `New ${humanize(ts.entry.table.name)} (30d)`, {
        kind: 'table-query',
        connectionId,
        source: descriptorSource(ts.entry),
        shape: 'metric+delta',
        aggregations: [{ fn: 'count', alias: 'value' }],
        window: { column: ts.column.name, last: 30, unit: 'day', compareToPrior: true },
      }),
    );
  }

  // 4 — status-group count when a workflow enum exists…
  const status = rankDomainColumns(domain, model, relations, (s) => s === 'status-workflow')[0];
  if (status !== undefined && items.length < 4) {
    const values = status.column.enumValues ?? [];
    const active = values.find((v) => ACTIVE_STATE.test(v)) ?? values[0] ?? null;
    if (active !== null) {
      items.push(
        kpi(
          `kpi-status-${status.entry.table.name}`,
          `${humanize(active)} ${humanize(status.entry.table.name)}`,
          {
            kind: 'table-query',
            connectionId,
            source: descriptorSource(status.entry),
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
        (entry): entry is CandidateTableInput =>
          entry !== undefined &&
          entry.table.id !== hub.table.id &&
          entry.classified.role !== 'join-table',
      )
      .sort(
        (a, b) =>
          (b.table.rowCountEstimate ?? 0) - (a.table.rowCountEstimate ?? 0) ||
          a.table.id.localeCompare(b.table.id),
      );
    for (const entry of fallbacks) {
      if (items.length >= 4) break;
      items.push(
        kpi(`kpi-count-${entry.table.name}`, `Total ${humanize(entry.table.name)}`, {
          kind: 'table-query',
          connectionId,
          source: descriptorSource(entry),
          shape: 'single-metric',
          aggregations: [{ fn: 'count', alias: 'value' }],
        }),
      );
    }
  }

  return items.slice(0, 4);
}

/**
 * Emit the §15 candidate set for one domain's `page-dashboard`, in slot order:
 * KPI row, hero timeseries, donut breakdown. Feed the result to
 * `composeTemplate('page-dashboard', …)` — the manifest supplies the geometry.
 *
 * Returns `null` when the domain's hub is not in `model` or the domain has no
 * time axis at all (05 §8 trigger requires ≥ 1 timestamp) — the caller records
 * a warning, exactly the bespoke `buildDashboardEnvelope` → `null` idiom.
 */
export function emitDomainDashboardCandidates(
  domain: DashboardDomain,
  model: readonly CandidateTableInput[],
  relations: readonly CandidateRelation[],
  ctx: DashboardDomainContext,
): TemplateCandidate[] | null {
  const hub = model.find((entry) => entry.table.id === domain.hubTableId);
  if (hub === undefined) return null;

  const ts = bestTimestamp(domain, model, relations);
  if (ts === null) return null; // §8: dashboard needs ≥1 timestamp in the domain

  const items = kpiRow(domain, model, relations, ctx.connectionId);

  // Hero timeseries: money sum when the time-axis table has a money column,
  // else row count, bucketed by month (§15 chart candidate ranking).
  const heroMoney = ts.entry.table.columns.find((c) => tag(ts.entry, c) === 'money');
  items.push({
    widget: 'chart-line-area',
    shape: 'timeseries',
    score: DOMAIN_SCORE,
    instanceId: `hero-line-${ts.entry.table.name}`,
    config: {
      title:
        heroMoney !== undefined
          ? `${humanize(heroMoney.name)} per Month`
          : `${humanize(ts.entry.table.name)} per Month`,
      binding: {
        kind: 'table-query',
        connectionId: ctx.connectionId,
        source: descriptorSource(ts.entry),
        shape: 'timeseries',
        aggregations: [
          heroMoney !== undefined
            ? { fn: 'sum', column: heroMoney.name, alias: 'value' }
            : { fn: 'count', alias: 'value' },
        ],
        bucket: { column: ts.column.name, unit: 'month' },
      } satisfies QueryDescriptor,
    },
  });

  // Donut: top categorical/status breakdown (§15), beside the hero.
  const categorical = bestCategorical(domain, model, relations);
  if (categorical !== null) {
    items.push({
      widget: 'chart-donut',
      shape: 'categorical',
      score: DOMAIN_SCORE,
      instanceId: `donut-${categorical.entry.table.name}-${categorical.column.name}`,
      config: {
        title: `${humanize(categorical.entry.table.name)} by ${humanize(categorical.column.name)}`,
        binding: {
          kind: 'table-query',
          connectionId: ctx.connectionId,
          source: descriptorSource(categorical.entry),
          shape: 'categorical',
          aggregations: [{ fn: 'count', alias: 'value' }],
          groupBy: [categorical.column.name],
          limit: 8,
        } satisfies QueryDescriptor,
      },
    });
  }

  return items;
}
