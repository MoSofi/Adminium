/**
 * The PURE apply-planner (06-llm-assist.md §8.3).
 *
 * Turns a reviewed {@link SuggestionDiff}[] plus the set of accepted suggestion
 * ids into an ordered, serializable {@link ApplyPlan} of WRITE DESCRIPTORS — one
 * per accepted suggestion, each mapped to its §8.3 apply target. A descriptor
 * names its target table/column/field + value; it is NOT SQL. The server-side
 * executor (T10b, `apps/server`) turns descriptors into transactional Kysely
 * writes against `adminium_schema_overrides` / `adminium_pages` and owns
 * upsert idempotency at write time.
 *
 * Browser-safe (01-architecture.md §2.3): this module imports only pure-TS types
 * from within `@adminium/llm`; it never touches `@adminium/meta` or a DB driver.
 * Provider network calls happen server-side only — the dashboard imports this
 * planner purely to preview the write set in the review confirmation modal.
 *
 * Provenance (§8.3, user > llm > heuristic) is enforced IN THE PLAN:
 *  - suggestions whose diff row is `user-locked` (an existing `source: 'user'`
 *    override) are EXCLUDED — applying an LLM run never touches a user edit;
 *  - a `rejects-heuristic` acceptance produces the correct SUPPRESSION
 *    descriptor (`pii` value `null`, or `relation_suppressed`) rather than a
 *    positive override.
 *
 * Idempotency: `buildApplyPlan` is a pure function of `(diff, acceptedIds, opts)`
 * — no `Date.now` / `Math.random`, `acceptedIds` order is irrelevant (it is
 * consumed as a set), and the output is emitted in the diff's own stable
 * (category, id) order — so re-planning the same run yields an identical plan.
 * Write-time upsert idempotency (no duplicate rows/pages) is T10b's concern.
 */
import type { EnumSuggestion, InferredRelation, LocaleCode } from '../response/schema.js';
import type { SuggestionCategory, SuggestionDiff, SuggestionStatus } from './diff.js';
import { widgetId } from './suggestion-id.js';

// ─── Write descriptor vocabulary (§8.3) ──────────────────────────────────────

/**
 * The `adminium_schema_overrides` fields an accepted suggestion can target. The
 * table-`label` value bundles `label` + `description` + `icon` together (the
 * §8.1 accept unit "table label+description+icon bundle", mirroring the meta
 * `table.label` op which stores the icon inline) — there is no standalone icon
 * descriptor. The executor maps each field onto a concrete override op.
 */
export type OverrideField =
  | 'label'
  | 'key'
  | 'pii'
  | 'copy'
  | 'enum_semantics'
  | 'virtual_relation'
  | 'relation_suppressed';

/** A write against `adminium_schema_overrides` (§8.3). */
export interface OverrideWrite {
  target: 'override';
  /** The originating §8.1 suggestion id (accept/reject trace + idempotency key). */
  suggestionId: string;
  field: OverrideField;
  /** Qualified `"schema.table"`. */
  table: string;
  /** Column name for column-scoped fields; `null` for table-scoped fields. */
  column: string | null;
  /**
   * Field-specific value json (localized maps where applicable), or `null` for
   * an explicit clear — a `rejects-heuristic` PII rejection writes `pii: null`.
   */
  value: Record<string, unknown> | null;
  /** Always `'llm'` — the executor never lets an LLM write shadow a user edit. */
  source: 'llm';
  confidence: number;
}

/** One grid item on a planned dashboard page (04-widget-registry.md §6.1). */
export interface PlannedLayoutItem {
  /** Deterministic instance id = the widget's §8.1 suggestion id. */
  i: string;
  /** Registry widget id. */
  widget: string;
  x: number;
  y: number;
  /** Width in grid columns — the §5 span heuristic (KPI 3, donut/funnel 4, bar/table 6, line/area 8). */
  w: number;
  /** Height in half-row (40px) units — KPI 3, everything else 8. */
  h: number;
  config: { title: string; binding: Record<string, unknown> };
}

/** A planned dashboard grid (`config.layout`), matching `pageLayoutSchema`. */
export interface PlannedLayout {
  version: 1;
  items: PlannedLayoutItem[];
}

/**
 * Assign `nav_group` + `nav_order` to each member table's page rows (§8.3
 * `group`). The executor stamps the group/order onto every table in `tables`.
 */
export interface NavGroupWrite {
  target: 'page';
  kind: 'nav-group';
  suggestionId: string;
  /** Group slug (kebab-case). */
  group: string;
  navOrder: number;
  /** Localized group label. */
  label: Partial<Record<LocaleCode, string>>;
  icon: string;
  /** Qualified table names this nav placement applies to. */
  tables: string[];
  source: 'llm';
  confidence: number;
}

/**
 * A new template page row for a table (§8.3 `template`): `{ type: template,
 * table, config, enabled: true, source: 'llm' }`. The executor generates the
 * template body from the active snapshot and skips the write if an identical
 * page already exists — the planner does not dedupe against DB state.
 */
export interface TemplatePageWrite {
  target: 'page';
  kind: 'template-page';
  suggestionId: string;
  /** Page-template id, e.g. `page-queue-inbox`. */
  template: string;
  /** Qualified `"schema.table"` this page is generated for. */
  table: string;
  /** Recommendation rank (1 = best) — the executor derives nav ordering from it. */
  rank: number;
  /** Minimal data-scope seed; the executor expands it into the full page body. */
  config: { source: { connectionId: string; table: string } };
  source: 'llm';
  confidence: number;
}

/**
 * A new `page-dashboard` row whose `config.layout.items[]` carry the accepted,
 * bound widgets (§8.3 `dashboard` + `widget`). Widgets are NOT standalone
 * descriptors — each accepted widget folds into its dashboard's layout; an
 * accepted widget whose dashboard was not accepted produces nothing (a widget
 * cannot exist without its container page).
 */
export interface DashboardPageWrite {
  target: 'page';
  kind: 'dashboard-page';
  suggestionId: string;
  /** Dashboard slug. */
  dashboard: string;
  domain: string;
  label: Partial<Record<LocaleCode, string>>;
  navOrder: number;
  /** Qualified table names the dashboard spans. */
  tables: string[];
  /** `config.layout` — items carry the query-descriptor binding + span-heuristic w/h. */
  layout: PlannedLayout;
  /** The accepted widget suggestion ids folded into this page (bound layout items). */
  widgetIds: string[];
  source: 'llm';
  confidence: number;
}

export type PageWrite = NavGroupWrite | TemplatePageWrite | DashboardPageWrite;
export type WriteDescriptor = OverrideWrite | PageWrite;

/** An ordered, serializable plan of write descriptors (§8.3). */
export interface ApplyPlan {
  /** The connection every write targets (also stamped into widget bindings). */
  connectionId: string;
  /** The run this plan derives from — provenance recorded on every applied row. */
  llmRunId?: string;
  /**
   * Write descriptors in the diff's stable (category, id) order: labels, keys,
   * enum semantics, relations, PII, template pages, nav groups, dashboard
   * pages, micro-copy. Deterministic — re-planning the same run is identical.
   */
  writes: WriteDescriptor[];
  /** Accepted ids skipped because their target is a `source: 'user'` override (locked). */
  excludedUserLocked: string[];
}

export interface ApplyPlanOptions {
  /** The connection these writes target; stamped into query-descriptor bindings. */
  connectionId: string;
  /** The run this plan derives from — provenance recorded on the plan. */
  llmRunId?: string;
}

// ─── Span → grid heuristic (§5 / 04-widget-registry.md §6.1) ─────────────────

/** KPI cards are 3 half-rows (120px); every other widget is 8 (320px). */
const KPI_HEIGHT = 3;
const CHART_HEIGHT = 8;
const GRID_COLUMNS = 12;

function clampSpan(span: number): number {
  if (!Number.isFinite(span)) return 6;
  return Math.min(GRID_COLUMNS, Math.max(1, Math.trunc(span)));
}

function widgetHeight(width: number): number {
  return width <= KPI_HEIGHT ? KPI_HEIGHT : CHART_HEIGHT;
}

// ─── Narrow structural views of diff `llmValue`s (this package's own outputs) ──

interface LabelBundle {
  label: Partial<Record<LocaleCode, string>>;
  description?: Partial<Record<LocaleCode, string>>;
  icon?: string;
}
interface KeyBundle {
  displayColumn: string | null;
  naturalKey: string[] | null;
}
interface SuppressedRelation {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
}
interface WidgetValue {
  widget: string;
  rank: number;
  span: number;
  table: string;
  metricColumn?: string;
  dimensionColumn?: string;
  timeColumn?: string;
  agg?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  titleEn: string;
}
interface DashboardValue {
  id: string;
  domain: string;
  label: Partial<Record<LocaleCode, string>>;
  order: number;
  tables: string[];
  widgets: WidgetValue[];
}
interface NavGroupValue {
  id: string;
  label: Partial<Record<LocaleCode, string>>;
  icon: string;
  order: number;
  tables: string[];
}
interface TemplateValue {
  template: string;
  rank: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

// ─── Query-descriptor binding (04-widget-registry.md §5.1) ───────────────────

/** Split a qualified `"schema.table"` into a query-descriptor `source` block. */
function tableSource(qualified: string): { schema?: string; name: string; type: 'table' } {
  const dot = qualified.indexOf('.');
  if (dot <= 0) return { name: qualified, type: 'table' };
  return { schema: qualified.slice(0, dot), name: qualified.slice(dot + 1), type: 'table' };
}

/**
 * Build a declarative query-descriptor binding for one accepted widget, shaped
 * from its bound columns: a `timeColumn` ⇒ `timeseries` (month buckets); else a
 * `dimensionColumn` ⇒ `categorical` (group-by); else `single-metric`. The
 * aggregation defaults to `sum` when a metric column is bound, else `count(*)`.
 */
function buildBinding(connectionId: string, w: WidgetValue): Record<string, unknown> {
  const source = tableSource(w.table);
  const fn = w.agg ?? (w.metricColumn !== undefined ? 'sum' : 'count');
  const aggregation: Record<string, unknown> = { fn, alias: 'value' };
  if (w.metricColumn !== undefined) aggregation['column'] = w.metricColumn;

  const binding: Record<string, unknown> = {
    kind: 'table-query',
    connectionId,
    source,
    aggregations: [aggregation],
  };

  if (w.timeColumn !== undefined) {
    binding['shape'] = 'timeseries';
    binding['bucket'] = { column: w.timeColumn, unit: 'month' };
  } else if (w.dimensionColumn !== undefined) {
    binding['shape'] = 'categorical';
    binding['groupBy'] = [w.dimensionColumn];
    binding['limit'] = 8;
  } else {
    binding['shape'] = 'single-metric';
  }
  return binding;
}

/**
 * Pack accepted widgets left-to-right on the 12-column grid in rank order,
 * wrapping to a new shelf when the current row overflows. Pure and deterministic
 * — widths come from the §5 span heuristic, heights from {@link widgetHeight}.
 */
function planLayout(
  connectionId: string,
  dashboardSlug: string,
  widgets: readonly WidgetValue[],
  accepted: ReadonlySet<string>,
): { layout: PlannedLayout; widgetIds: string[] } {
  const chosen = widgets
    .filter((w) => accepted.has(widgetId(dashboardSlug, w.widget, w.rank)))
    .slice()
    .sort((a, b) => a.rank - b.rank);

  const items: PlannedLayoutItem[] = [];
  const widgetIds: string[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const w of chosen) {
    const width = clampSpan(w.span);
    const height = widgetHeight(width);
    if (x + width > GRID_COLUMNS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    const id = widgetId(dashboardSlug, w.widget, w.rank);
    items.push({
      i: id,
      widget: w.widget,
      x,
      y,
      w: width,
      h: height,
      config: { title: w.titleEn, binding: buildBinding(connectionId, w) },
    });
    widgetIds.push(id);
    x += width;
    rowHeight = Math.max(rowHeight, height);
  }

  return { layout: { version: 1, items }, widgetIds };
}

// ─── Per-category descriptor emitters ────────────────────────────────────────

/** Table-label vs column-label: `label:<table>` is table-scoped, else column. */
function labelWrite(row: SuggestionDiff): OverrideWrite | null {
  const value = row.llmValue;
  if (!isRecord(value) || row.table === undefined) return null;
  const bundle = value as unknown as LabelBundle;
  const body = row.id.slice('label:'.length);
  const column = body === row.table ? null : body.slice(row.table.length + 1) || null;
  const json: Record<string, unknown> = { label: bundle.label };
  if (bundle.description !== undefined) json['description'] = bundle.description;
  // icon rides with the table-label bundle only (§8.1); columns carry no icon.
  if (column === null && bundle.icon !== undefined) json['icon'] = bundle.icon;
  return override(row, 'label', row.table, column, json);
}

function keyWrite(row: SuggestionDiff): OverrideWrite | null {
  const value = row.llmValue;
  if (!isRecord(value) || row.table === undefined) return null;
  const bundle = value as unknown as KeyBundle;
  return override(row, 'key', row.table, null, {
    displayColumn: bundle.displayColumn ?? null,
    naturalKey: bundle.naturalKey ?? null,
  });
}

function enumWrite(row: SuggestionDiff): OverrideWrite | null {
  const value = row.llmValue;
  if (!isRecord(value) || row.table === undefined) return null;
  const e = value as unknown as EnumSuggestion;
  const column = row.id.slice(`enum:${row.table}.`.length);
  return override(row, 'enum_semantics', row.table, column, {
    kind: e.kind,
    order: e.order,
    terminal: e.terminal ?? null,
    tones: e.tones,
  });
}

/**
 * Per-relation discriminator for the override upsert key. A `fromTable` can carry
 * more than one relation (a junction/denormalized table with several undeclared
 * FKs), and every relation override shares `field`+`table`+`column=null`, so
 * without this the upsert key `(connection, op, table, column)` collides and all
 * but the last relation is silently dropped. Encoding the full relation
 * coordinates (mirroring the §8.1 suggestion id) keeps each distinct relation on
 * its own row while staying deterministic — re-applying the same run upserts in
 * place (idempotent), it never inserts a duplicate.
 */
function relationColumnKey(
  fromColumns: readonly string[],
  toTable: string,
  toColumns: readonly string[],
): string {
  return `${fromColumns.join(',')}->${toTable}.${toColumns.join(',')}`;
}

function relationWrite(row: SuggestionDiff): OverrideWrite | null {
  const value = row.llmValue;
  if (!isRecord(value) || row.table === undefined) return null;
  if (row.status === 'rejects-heuristic') {
    // A confirmed relation the LLM rejects (`correct: false`) → suppress the FK.
    const rel = value as unknown as SuppressedRelation;
    return override(
      row,
      'relation_suppressed',
      row.table,
      relationColumnKey(rel.fromColumns, rel.toTable, rel.toColumns),
      {
        fromColumns: rel.fromColumns,
        toTable: rel.toTable,
        toColumns: rel.toColumns,
      },
    );
  }
  // An inferred relation the engine should treat as a real FK (§8.3).
  const rel = value as unknown as InferredRelation;
  const json: Record<string, unknown> = {
    fromColumns: rel.fromColumns,
    toTable: rel.toTable,
    toColumns: rel.toColumns,
    kind: rel.kind,
  };
  if (rel.viaTable !== undefined) json['viaTable'] = rel.viaTable;
  return override(
    row,
    'virtual_relation',
    row.table,
    relationColumnKey(rel.fromColumns, rel.toTable, rel.toColumns),
    json,
  );
}

function piiWrite(row: SuggestionDiff): OverrideWrite | null {
  if (row.table === undefined) return null;
  const column = row.id.slice(`pii:${row.table}.`.length);
  if (row.status === 'rejects-heuristic') {
    // Explicit `pii: null` over a heuristic flag → an explicit clear (§8.3).
    return override(row, 'pii', row.table, column, null);
  }
  const value = row.llmValue;
  if (!isRecord(value)) return null;
  return override(row, 'pii', row.table, column, { ...value });
}

function copyWrite(row: SuggestionDiff): OverrideWrite | null {
  const value = row.llmValue;
  if (!isRecord(value) || row.table === undefined) return null;
  return override(row, 'copy', row.table, null, { ...value });
}

function groupWrite(row: SuggestionDiff): NavGroupWrite | null {
  const value = row.llmValue;
  if (!isRecord(value)) return null;
  const g = value as unknown as NavGroupValue;
  return {
    target: 'page',
    kind: 'nav-group',
    suggestionId: row.id,
    group: g.id,
    navOrder: g.order,
    label: g.label,
    icon: g.icon,
    tables: [...g.tables],
    source: 'llm',
    confidence: row.confidence,
  };
}

function templateWrite(
  row: SuggestionDiff,
  connectionId: string,
): TemplatePageWrite | null {
  const value = row.llmValue;
  if (!isRecord(value) || row.table === undefined) return null;
  const t = value as unknown as TemplateValue;
  return {
    target: 'page',
    kind: 'template-page',
    suggestionId: row.id,
    template: t.template,
    table: row.table,
    rank: t.rank,
    config: { source: { connectionId, table: row.table } },
    source: 'llm',
    confidence: row.confidence,
  };
}

function dashboardWrite(
  row: SuggestionDiff,
  connectionId: string,
  accepted: ReadonlySet<string>,
): DashboardPageWrite | null {
  const value = row.llmValue;
  if (!isRecord(value)) return null;
  const d = value as unknown as DashboardValue;
  const { layout, widgetIds } = planLayout(connectionId, d.id, d.widgets ?? [], accepted);
  return {
    target: 'page',
    kind: 'dashboard-page',
    suggestionId: row.id,
    dashboard: d.id,
    domain: d.domain,
    label: d.label,
    navOrder: d.order,
    tables: [...d.tables],
    layout,
    widgetIds,
    source: 'llm',
    confidence: row.confidence,
  };
}

/** Build an {@link OverrideWrite}, omitting `column` semantics via an explicit null. */
function override(
  row: SuggestionDiff,
  field: OverrideField,
  table: string,
  column: string | null,
  value: Record<string, unknown> | null,
): OverrideWrite {
  return {
    target: 'override',
    suggestionId: row.id,
    field,
    table,
    column,
    value,
    source: 'llm',
    confidence: row.confidence,
  };
}

// ─── The planner ─────────────────────────────────────────────────────────────

/** Categories that never produce a standalone descriptor (widgets fold into dashboards). */
const FOLDED: ReadonlySet<SuggestionCategory> = new Set<SuggestionCategory>(['widget']);

/** Statuses that carry no LLM value to apply — nothing to write. */
const NON_ACTIONABLE: ReadonlySet<SuggestionStatus> = new Set<SuggestionStatus>([
  'heuristic-only',
]);

/**
 * Build the ordered {@link ApplyPlan} for the accepted subset of a reviewed diff
 * (§8.3). Emits one descriptor per accepted suggestion (widgets fold into their
 * dashboard), excludes `user-locked` targets (provenance), and turns
 * `rejects-heuristic` acceptances into suppression descriptors.
 */
export function buildApplyPlan(
  diff: readonly SuggestionDiff[],
  acceptedIds: Iterable<string>,
  opts: ApplyPlanOptions,
): ApplyPlan {
  const accepted = new Set(acceptedIds);
  const writes: WriteDescriptor[] = [];
  const excludedUserLocked: string[] = [];

  for (const row of diff) {
    if (!accepted.has(row.id)) continue;
    // Provenance user > llm > heuristic: never write over a user edit (§8.3).
    if (row.status === 'user-locked') {
      excludedUserLocked.push(row.id);
      continue;
    }
    if (NON_ACTIONABLE.has(row.status)) continue;
    if (FOLDED.has(row.category)) continue; // widgets materialize inside dashboards

    const write = emit(row, opts.connectionId, accepted);
    if (write !== null) writes.push(write);
  }

  const plan: ApplyPlan = { connectionId: opts.connectionId, writes, excludedUserLocked };
  if (opts.llmRunId !== undefined) plan.llmRunId = opts.llmRunId;
  return plan;
}

function emit(
  row: SuggestionDiff,
  connectionId: string,
  accepted: ReadonlySet<string>,
): WriteDescriptor | null {
  switch (row.category) {
    case 'label':
      return labelWrite(row);
    case 'key':
      return keyWrite(row);
    case 'enum':
      return enumWrite(row);
    case 'relation':
      return relationWrite(row);
    case 'pii':
      return piiWrite(row);
    case 'copy':
      return copyWrite(row);
    case 'group':
      return groupWrite(row);
    case 'template':
      return templateWrite(row, connectionId);
    case 'dashboard':
      return dashboardWrite(row, connectionId, accepted);
    case 'widget':
      return null; // folded — handled above
  }
}

// ─── Human summary for the review confirmation modal (§10.3) ─────────────────

export interface ApplyPlanSummary {
  totalWrites: number;
  overrides: number;
  pages: number;
  labels: number;
  keys: number;
  pii: number;
  enums: number;
  /** virtual relations + suppressions. */
  relations: number;
  microcopy: number;
  navGroups: number;
  templatePages: number;
  dashboardPages: number;
  /** Total bound layout items across all dashboard pages. */
  widgets: number;
  /**
   * English fallback sentence ("Creates 1 dashboard page, 3 template pages;
   * updates 41 labels…") for the confirmation modal. UI surfaces localize from
   * the numeric counts above; this package carries no i18n runtime.
   */
  text: string;
}

/** Human counts for the review confirmation modal (§10.3, task step 3). */
export function applyPlanSummary(plan: ApplyPlan): ApplyPlanSummary {
  const s = {
    totalWrites: plan.writes.length,
    overrides: 0,
    pages: 0,
    labels: 0,
    keys: 0,
    pii: 0,
    enums: 0,
    relations: 0,
    microcopy: 0,
    navGroups: 0,
    templatePages: 0,
    dashboardPages: 0,
    widgets: 0,
  };

  for (const w of plan.writes) {
    if (w.target === 'override') {
      s.overrides += 1;
      switch (w.field) {
        case 'label':
          s.labels += 1;
          break;
        case 'key':
          s.keys += 1;
          break;
        case 'pii':
          s.pii += 1;
          break;
        case 'enum_semantics':
          s.enums += 1;
          break;
        case 'virtual_relation':
        case 'relation_suppressed':
          s.relations += 1;
          break;
        case 'copy':
          s.microcopy += 1;
          break;
      }
    } else {
      s.pages += 1;
      if (w.kind === 'nav-group') s.navGroups += 1;
      else if (w.kind === 'template-page') s.templatePages += 1;
      else {
        s.dashboardPages += 1;
        s.widgets += w.widgetIds.length;
      }
    }
  }

  return { ...s, text: summaryText(s) };
}

function summaryText(s: Omit<ApplyPlanSummary, 'text'>): string {
  const creates: string[] = [];
  if (s.dashboardPages > 0) {
    creates.push(
      `${s.dashboardPages} dashboard ${plural(s.dashboardPages, 'page')} (${s.widgets} ${plural(s.widgets, 'widget')})`,
    );
  }
  if (s.templatePages > 0) creates.push(`${s.templatePages} template ${plural(s.templatePages, 'page')}`);

  const updates: string[] = [];
  if (s.labels > 0) updates.push(`${s.labels} ${plural(s.labels, 'label')}`);
  if (s.keys > 0) updates.push(`${s.keys} key ${plural(s.keys, 'column')}`);
  if (s.enums > 0) updates.push(`${s.enums} enum ${plural(s.enums, 'semantic')}`);
  if (s.relations > 0) updates.push(`${s.relations} ${plural(s.relations, 'relation')}`);
  if (s.pii > 0) updates.push(`${s.pii} PII ${plural(s.pii, 'flag')}`);
  if (s.microcopy > 0) updates.push(`${s.microcopy} micro-copy ${plural(s.microcopy, 'block')}`);
  if (s.navGroups > 0) updates.push(`${s.navGroups} nav ${plural(s.navGroups, 'group')}`);

  const clauses: string[] = [];
  if (creates.length > 0) clauses.push(`Creates ${joinList(creates)}`);
  if (updates.length > 0) clauses.push(`${creates.length > 0 ? 'updates' : 'Updates'} ${joinList(updates)}`);
  if (clauses.length === 0) return 'No changes to apply.';
  return `${clauses.join('; ')}.`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
