// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Candidate rules — hook **H1 (candidate emission)** and **H2 (scoring &
 * pruning)** of the auto-instantiation pipeline, encoding the per-family
 * "Auto-instantiation" paragraphs of research/widget-registry.md and the
 * decision summary (step 3: "per table emit … KPI candidates and 2–4 chart
 * candidates ranked by column-pair scoring").
 *
 * WHY THE RULES LIVE HERE AND NOT IN THE ENGINE (verbatim): "The Engine owns
 * introspection/classification/generation; the Registry owns **what can be
 * instantiated and why** … encoded as data-driven rules living in this package
 * so the catalog and its trigger logic never drift apart."
 *
 * WHY THE INPUT TYPES ARE STRUCTURAL: `@adminium/widgets` must never import
 * `@adminium/engine` beyond the pure-Zod `@adminium/engine/config` leaf, so
 * this module cannot name `TableModel` / `ClassifiedTable`. Instead it declares
 * the **fields the rules read** as its own contract ({@link CandidateTable} /
 * {@link ClassifiedTableInput}) and the Engine adapts its model into them
 * (`@adminium/engine/generate/archetype.ts`). The two are kept in lockstep by
 * the engine-side adapter's compile-time types plus
 * `packages/engine/test/generate-archetypes.test.ts`.
 *
 * PURITY / DETERMINISM: no `Date.now()`, no `Math.random()`, no I/O. Generation
 * output is content-hashed (`generated_hash`, H5), so identical inputs must
 * produce byte-identical candidates — every ordering decision below is total
 * (score → rule id → widget id → emission order) and every score is rounded to
 * three decimals so float association can never reorder a tie.
 */
import type { DataShape } from '../page-config/data-shapes.js';
import type { QueryDescriptor } from '../page-config/query-descriptor.js';
import type { WidgetFamily } from './types.js';

/* ------------------------------------------------------------------ inputs */

/**
 * The `TableModel` fields the rules read (structural mirror — see the module
 * docstring). Optional fields mirror the engine defaults.
 */
export interface CandidateColumn {
  name: string;
  /** The column's own name for a person, when it has one (a rename); else it is humanized. */
  label?: string | undefined;
  /** 1-based position (pg attnum-style); 0/absent = unspecified (imports). */
  ordinal?: number | undefined;
  /** `@adminium/engine`'s `LogicalType`, widened: 'text' | 'integer' | 'enum' | … */
  logicalType: string;
  nullable?: boolean | undefined;
  isPrimaryKey?: boolean | undefined;
  isUnique?: boolean | undefined;
  /** Computed/stored generated column — never a form field. */
  isGenerated?: boolean | undefined;
  /**
   * `ColumnDefault.kind` ('literal' | 'expression' | 'autoincrement' | 'now' |
   * 'uuid'); null/absent ⇔ no DB default. The crud composer needs the kind, not
   * just presence: literal/expression defaults still make a natural PK a create
   * input, while autoincrement/now/uuid PKs are skipped.
   */
  defaultKind?: string | null | undefined;
  maxLength?: number | null | undefined;
  /** Resolved `EnumDef.values` for `logicalType: 'enum'` (or CHECK-derived). */
  enumValues?: readonly string[] | undefined;
  /** `label`: what a person calls the referenced table, when it has a name. */
  references?: { tableId: string; column: string; label?: string | undefined } | null | undefined;
}

export interface CandidateTable {
  /** `${schema}.${name}`. */
  id: string;
  schema?: string | undefined;
  name: string;
  /**
   * Effective display label (override channel, provenance user > llm >
   * heuristic). No rule reads it — it rides the mirror so the engine's
   * envelope wrap can title pages `label ?? humanize(name)`.
   */
  label?: string | undefined;
  kind?: 'table' | 'view' | 'materialized-view' | undefined;
  /** ESTIMATE only; null ⇔ unknown. */
  rowCountEstimate?: number | null | undefined;
  /** pg_stat write activity (inserts+updates+deletes); null ⇔ unknown. */
  writeVelocity?: number | null | undefined;
  /** Ordered PK column names; []/absent ⇔ no PK (table renders read-only). */
  primaryKey?: readonly string[] | undefined;
  columns: readonly CandidateColumn[];
}

/** The `ClassifiedColumn` fields the rules read (structural mirror). */
export interface ClassifiedColumnInput {
  column: string;
  /** `@adminium/engine`'s `SemanticTag`, widened: 'money' | 'status-workflow' | … */
  semantic: string;
  format?: string | null | undefined;
  secret?: boolean | undefined;
  pii?: string | null | undefined;
  /** `ColumnSemantics.flags.maskedByDefault` — drives the spec's `pii` flag. */
  maskedByDefault?: boolean | undefined;
  pair?: { role: string; partner: string } | null | undefined;
}

/** The `ClassifiedTable` fields the rules read (structural mirror). */
export interface ClassifiedTableInput {
  tableId: string;
  /** `TableShapeKind`: 'people' | 'workflow' | 'events' | 'catalog' | 'log' | … */
  shape: string;
  /** `TableRole`: 'entity' | 'join-table' | 'log' | 'people' | 'messages' | … */
  role: string;
  displayColumn?: string | null | undefined;
  naturalKey?: string | null | undefined;
  /** `TableSemantics.hierarchy.parentColumn` — the self-FK. */
  hierarchyColumn?: string | null | undefined;
  columns: readonly ClassifiedColumnInput[];
}

/** One table of the model, as the rules see it. */
export interface CandidateTableInput {
  table: CandidateTable;
  classified: ClassifiedTableInput;
}

/**
 * The `Relation` fields the generator leaves read (structural mirror). The
 * crud-body composer derives detail tabs from inbound FKs, and the domain
 * dashboard assembly derives hub adjacency — neither needs kind/cardinality.
 */
export interface CandidateRelation {
  /** Stable relation id — detail-tab ordering sorts on it. */
  id: string;
  /** FK side ("many" side for 1:N). */
  from: { tableId: string; columns: readonly string[] };
  /** Referenced side. */
  to: { tableId: string };
  /** 1.0 declared/override; <1 inferred (thresholds). */
  confidence: number;
}

export interface CandidateContext {
  /** `adminium_connections.id` every emitted binding scopes to. */
  connectionId: string;
  /**
   * Live registry membership test. Supplying it is what enforces invariant that
   * "candidates only ever carry registered ids" — the rules are written against
   * the full annex catalog, so ids whose family has not shipped are dropped
   * here rather than reaching a page as `widget-missing`. Omitted ⇒ every id is
   * treated as registered (unit tests, annex-completeness checks).
   */
  isRegistered?: ((widgetId: string) => boolean) | undefined;
  /**
   * Every table of the model, including `table` itself. Cross-table triggers
   * read it: the annex conversation+message **pair**, person/project FK targets.
   * Omitted ⇒ single-table rules only.
   */
  model?: readonly CandidateTableInput[] | undefined;
}

/* ----------------------------------------------------------------- outputs */

/**
 * One instantiable widget a rule proposes for a table (verbatim fields:
 * `widget` / `score` / `binding` / `config` / `reason`).
 *
 * `shape`, `family` and `rule` extend the listing with what the downstream
 * hooks need and would otherwise have to re-derive: `composeTemplate` matches
 * `accepts.shapes` on **the shape the binding produces**, H2 caps are per
 * family, and `rule` is both the provenance the Studio review UI shows and the
 * first tiebreak that keeps ordering total.
 */
export interface WidgetCandidate {
  /** Registry id. */
  widget: string;
  /** 0–1 heuristic confidence (H2 output: base × modifiers, rounded to 1e-3). */
  score: number;
  binding: QueryDescriptor;
  /** Stored instance config; pre-shaped for the widget's `configSchema`. */
  config: Record<string, unknown>;
  /** Human-readable — surfaced in the Studio review UI and in the LLM prompt. */
  reason: string;
  /** The data contract `binding` produces. */
  shape: DataShape;
  family: WidgetFamily;
  /** Emitting {@link CandidateRule.id}. */
  rule: string;
}

/**
 * A table + its classification, pre-joined per column. Rules receive this
 * instead of `(table, cols, stats)` triple: it carries exactly those three
 * ({@link CandidateView.table}, {@link CandidateView.columns}, {@link
 * CandidateView.stats}) with the column/semantics join done once per table
 * rather than once per rule.
 */
export interface CandidateView {
  table: CandidateTable;
  classified: ClassifiedTableInput;
  columns: readonly ViewColumn[];
  stats: { rowCount: number | null; writeVelocity: number | null };
  shape: string;
  role: string;
  displayColumn: string | null;
  hierarchyColumn: string | null;
  /** Query-descriptor `source` for this table. */
  source: QueryDescriptor['source'];
}

/** A column with its classification folded in. */
export interface ViewColumn {
  name: string;
  /** The column's own name for a person, when it has one. */
  label?: string | undefined;
  logicalType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  enumValues: readonly string[];
  references: { tableId: string; column: string } | null;
  semantic: string;
  format: string | null;
  secret: boolean;
  pii: string | null;
  pair: { role: string; partner: string } | null;
}

export interface CandidateRule {
  /** 'kpi.count-total', 'charts.time-numeric', 'boards.workflow-enum', … */
  id: string;
  family: WidgetFamily;
  match(view: CandidateView, ctx: CandidateContext): WidgetCandidate[];
}

/* ----------------------------------------------------------------- helpers */

/**
 * `order_details` → `Order Details`. A three-line copy of the Engine's
 * `generate/util.ts` helper: candidate configs carry human titles, and the
 * package boundary (see the module docstring) forbids importing it. Kept
 * behaviourally identical — `packages/engine/test/generate-archetypes.test.ts`
 * asserts the titles the engine ends up persisting. Exported for the sibling
 * generator-leaf modules (`../generate/crud-body.ts`, `dashboard-domain.ts`),
 * whose labels must match what the bespoke generator produced byte-for-byte.
 */
export function humanize(name: string): string {
  const bare = name.includes('.') ? (name.split('.').pop() ?? name) : name;
  return bare
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * What a composed widget calls a table: its own name for a person — a rename,
 * or the one its app installed — else its humanized name. Titles read
 * "Reservations", not "Pos Reservations".
 */
export function tableTitle(table: { name: string; label?: string | undefined }): string {
  return table.label ?? humanize(table.name);
}

/** The same for a column: "Unit price", never a humanized `unit_price` it has a name for. */
export const columnTitle = tableTitle;

/** Deterministic 3-decimal rounding — float association must never reorder ties. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * H2 scoring: "Base score per rule × modifiers (row count, null ratio,
 * cardinality fit, name-match strength)".
 */
function score(base: number, ...modifiers: number[]): number {
  let value = base;
  for (const modifier of modifiers) value *= modifier;
  return round3(clamp01(value));
}

/**
 * Row-count modifier: a widget over an empty table renders an empty state, so
 * few rows means low confidence. Deliberately capped at 1 — a *busy* table is
 * not evidence that a widget suits it better, and letting row count push a score
 * up would make cross-rule ordering (which decides who wins a template slot)
 * depend on data volume rather than on shape.
 */
function byRowCount(view: CandidateView): number {
  const rows = view.stats.rowCount;
  if (rows === null) return 1;
  if (rows === 0) return 0.6;
  if (rows < 100) return 0.9;
  return 1;
}

/** Name-match strength modifier. */
function byName(matches: boolean, hit = 1.1, miss = 0.95): number {
  return matches ? hit : miss;
}

/** Cardinality fit: an enum breakdown reads best at 2–6 slices (annex). */
function byCardinality(count: number, best: number, worst: number): number {
  if (count <= 0) return 0.5;
  if (count <= best) return 1.05;
  if (count <= worst) return 1;
  return 0.8;
}

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);
const TEXTISH_TYPES: ReadonlySet<string> = new Set(['text', 'varchar']);
const DATE_TYPES: ReadonlySet<string> = new Set(['date', 'timestamp', 'timestamptz']);

/** Annex: money name vocabulary that upgrades a SUM card to a currency hero. */
const MONEY_NAME_RE = /(amount|price|mrr|arr|total|budget|revenue)/i;
/** Annex: the "currently open" state a status KPI counts. */
const ACTIVE_STATE_RE = /^(open|pending|new|in_progress|active|todo|backlog|queued|draft)$/i;
/**
 * Annex: kanban-worthy workflow value vocabulary (subset). Shared with
 * `./archetypes.ts` — the `page-board` trigger is "a status enum classified as
 * workflow", i.e. exactly what puts a `kanban-board` on the page.
 */
export const BOARD_STATE_RE =
  /^(todo|to_do|backlog|open|new|draft|in_progress|inprogress|doing|review|in_review|blocked|on_hold|done|completed?|closed|cancell?ed|archived|active|paused|shipped|q[1-4])$/i;
/** Annex: read/unread notification booleans. Shared with `./archetypes.ts`. */
export const READ_FLAG_RE = /(^|_)(read|seen|opened|acknowledged|unread)(_|$)/i;
/** Annex: verb-ish activity text. */
const VERBISH_RE = /(^|_)(action|event|activity|verb|operation)(_type|_name)?(_|$)/i;
/** Annex: changelog version strings. */
const VERSION_RE = /(^|_)(version|release|tag|semver)(_|$)/i;
/** Annex: shift-type vocabulary. */
const SHIFT_TYPE_RE = /(^|_)(shift|slot|rota|duty)(_type|_kind|_name)?(_|$)/i;
/** Annex: hours-per-project capacity numerics. */
const HOURS_RE = /(^|_)(hours?|capacity|allocation|workload|effort|load)(_|$)/i;
/** Annex: project/phase FK targets. */
const PROJECT_RE = /(^|_)(projects?|phases?|epics?|milestones?|sprints?|initiatives?)(_|$)/i;
/** Annex: people FK targets (mirrors the engine's PEOPLE_TABLE_RE). */
const PEOPLE_TARGET_RE =
  /(^|_)(users?|people|persons?|employees?|staff|members?|contacts?|customers?|profiles?|teachers?|students?|drivers?|agents?|authors?|patients?)(_|$)/i;
/** Annex: file-shaped size columns. */
const SIZE_RE = /(^|_)(size|bytes|filesize|file_size|storage|quota)(_|$)/i;
/** Annex: conversation containers. */
const CONVERSATION_RE = /(^|_)(conversations?|threads?|chats?|channels?|rooms?|tickets?)(_|$)/i;

/** `public.orders` → the last segment. */
function bareName(id: string): string {
  return id.includes('.') ? (id.split('.').pop() ?? id) : id;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/* ------------------------------------------------------------------- view */

/** Join a table with its classification once, for every rule to read. */
export function buildCandidateView(
  table: CandidateTable,
  classified: ClassifiedTableInput,
): CandidateView {
  const semanticsByColumn = new Map(classified.columns.map((c) => [c.column, c]));
  const columns: ViewColumn[] = table.columns.map((column) => {
    const info = semanticsByColumn.get(column.name);
    return {
      name: column.name,
      ...(column.label === undefined ? {} : { label: column.label }),
      logicalType: column.logicalType,
      nullable: column.nullable ?? true,
      isPrimaryKey: column.isPrimaryKey ?? false,
      isUnique: column.isUnique ?? false,
      enumValues: column.enumValues ?? [],
      references: column.references ?? null,
      semantic: info?.semantic ?? 'plain',
      format: info?.format ?? null,
      secret: info?.secret ?? false,
      pii: info?.pii ?? null,
      pair: info?.pair ?? null,
    };
  });

  const source: QueryDescriptor['source'] = {
    name: table.name,
    type: table.kind === 'view' || table.kind === 'materialized-view' ? 'view' : 'table',
  };
  if (table.schema !== undefined) source.schema = table.schema;

  return {
    table,
    classified,
    columns,
    stats: {
      rowCount: table.rowCountEstimate ?? null,
      writeVelocity: table.writeVelocity ?? null,
    },
    shape: classified.shape,
    role: classified.role,
    displayColumn: classified.displayColumn ?? null,
    hierarchyColumn: classified.hierarchyColumn ?? null,
    source,
  };
}

/* --------------------------------------------------------- view predicates */

export function withSemantic(view: CandidateView, ...tags: string[]): ViewColumn[] {
  const wanted = new Set(tags);
  return view.columns.filter((c) => wanted.has(c.semantic) && !c.secret);
}

export function firstWithSemantic(view: CandidateView, ...tags: string[]): ViewColumn | null {
  return withSemantic(view, ...tags)[0] ?? null;
}

/** Best time axis for a chart/KPI window: created-at, then event timestamps. */
function timeAxis(view: CandidateView): ViewColumn | null {
  return (
    firstWithSemantic(view, 'created-at') ??
    view.columns.find(
      (c) =>
        (c.semantic === 'event-timestamp' || c.semantic === 'date-range') &&
        DATE_TYPES.has(c.logicalType),
    ) ??
    null
  );
}

/** A point-in-time event column — the annex `calendar-month` axis. */
export function eventDate(view: CandidateView): ViewColumn | null {
  return (
    view.columns.find((c) => c.semantic === 'event-timestamp' && DATE_TYPES.has(c.logicalType)) ??
    null
  );
}

/** The `start` half of a -row-11 start/end pair (annex scheduling signal). */
export function dateRangeStart(view: CandidateView): ViewColumn | null {
  return view.columns.find((c) => c.semantic === 'date-range' && c.pair?.role === 'start') ?? null;
}

/** An FK whose target table name reads as people (annex). */
export function personFk(view: CandidateView): ViewColumn | null {
  return (
    view.columns.find(
      (c) =>
        c.references !== null &&
        c.references.tableId !== view.table.id &&
        PEOPLE_TARGET_RE.test(normalize(bareName(c.references.tableId))),
    ) ?? null
  );
}

/** An FK whose target reads as a project/phase container (annex). */
export function projectFk(view: CandidateView): ViewColumn | null {
  return (
    view.columns.find(
      (c) => c.references !== null && PROJECT_RE.test(normalize(bareName(c.references.tableId))),
    ) ?? null
  );
}

/** Low-cardinality enum columns, richest breakdown first (annex). */
export function enumColumns(view: CandidateView): ViewColumn[] {
  const wanted = ['status-workflow', 'category-enum'];
  return view.columns
    .filter((c) => wanted.includes(c.semantic) && !c.secret)
    .sort((a, b) => wanted.indexOf(a.semantic) - wanted.indexOf(b.semantic));
}

/** Grid/list `select` — display column first, then the informative columns. */
function listSelect(view: CandidateView, limit = 8): string[] {
  const out: string[] = [];
  if (view.displayColumn !== null) out.push(view.displayColumn);
  const priority = [
    'status-workflow',
    'money',
    'created-at',
    'event-timestamp',
    'date-range',
    'fk',
    'category-enum',
    'person-name',
    'email',
    'boolean-flag',
    'percent',
    'score',
  ];
  for (const tag of priority) {
    for (const column of withSemantic(view, tag)) {
      if (out.length >= limit) break;
      if (!out.includes(column.name)) out.push(column.name);
    }
  }
  return out.slice(0, limit);
}

/* ------------------------------------------------------------- descriptors */

function descriptor(
  view: CandidateView,
  ctx: CandidateContext,
  shape: DataShape,
  rest: Omit<QueryDescriptor, 'kind' | 'connectionId' | 'source' | 'shape'> = {},
): QueryDescriptor {
  return {
    kind: 'table-query',
    connectionId: ctx.connectionId,
    source: view.source,
    shape,
    ...rest,
  };
}

/** A binding against a *sibling* table (the annex pair rule needs one). */
function siblingDescriptor(
  sibling: CandidateView,
  ctx: CandidateContext,
  shape: DataShape,
  rest: Omit<QueryDescriptor, 'kind' | 'connectionId' | 'source' | 'shape'> = {},
): QueryDescriptor {
  return {
    kind: 'table-query',
    connectionId: ctx.connectionId,
    source: sibling.source,
    shape,
    ...rest,
  };
}

/* ------------------------------------------------------------------ rules */

/** Annex — "For every table the introspector emits KPI candidates". */
const kpiCountTotal: CandidateRule = {
  id: 'kpi.count-total',
  family: 'kpi',
  match(view, ctx) {
    const label = tableTitle(view.table);
    return [
      {
        widget: 'kpi-stat-card',
        score: score(0.9, byRowCount(view)),
        shape: 'single-metric',
        family: 'kpi',
        rule: 'kpi.count-total',
        reason: `COUNT(*) over ${view.table.id} — the total card every table gets`,
        binding: descriptor(view, ctx, 'single-metric', {
          aggregations: [{ fn: 'count', alias: 'value' }],
        }),
        config: { title: `Total ${label}` },
      },
    ];
  },
};

/** Annex — money-typed numeric → SUM card with currency format. */
const kpiMoneySum: CandidateRule = {
  id: 'kpi.money-sum',
  family: 'kpi',
  match(view, ctx) {
    return withSemantic(view, 'money')
      .slice(0, 2)
      .map((column) => ({
        widget: 'kpi-stat-card',
        score: score(0.85, byRowCount(view), byName(MONEY_NAME_RE.test(column.name))),
        shape: 'single-metric' as const,
        family: 'kpi' as const,
        rule: 'kpi.money-sum',
        reason: `money column "${column.name}" — SUM card with currency format`,
        binding: descriptor(view, ctx, 'single-metric', {
          aggregations: [{ fn: 'sum', column: column.name, alias: 'value' }],
        }),
        // `metricFormat`, not `format`: the shared `format` key is an OBJECT
        // ({locale, currency, number, date}), so the string form failed
        // validation and was pruned on every mount — every money KPI on a
        // generated dashboard rendered unformatted, and `format` is skipped by
        // the config drawer so it could not be repaired by hand either.
        config: { title: `Total ${columnTitle(column)}`, metricFormat: 'currency' },
      }));
  },
};

/** Annex — `created_at` → "new this period" + delta vs prior period. */
const kpiNewThisPeriod: CandidateRule = {
  id: 'kpi.new-this-period',
  family: 'kpi',
  match(view, ctx) {
    const column = firstWithSemantic(view, 'created-at');
    if (column === null) return [];
    return [
      {
        widget: 'kpi-stat-card',
        score: score(0.8, byRowCount(view)),
        shape: 'metric+delta',
        family: 'kpi',
        rule: 'kpi.new-this-period',
        reason: `created-at "${column.name}" — new-this-period card with a prior-period delta`,
        binding: descriptor(view, ctx, 'metric+delta', {
          aggregations: [{ fn: 'count', alias: 'value' }],
          window: { column: column.name, last: 30, unit: 'day', compareToPrior: true },
        }),
        config: { title: `New ${tableTitle(view.table)} (30d)`, deltaMode: 'pct' },
      },
    ];
  },
};

/** Annex — enum/status column → per-state counts (Pending/Approved…). */
const kpiStatusCount: CandidateRule = {
  id: 'kpi.status-count',
  family: 'kpi',
  match(view, ctx) {
    const column = firstWithSemantic(view, 'status-workflow');
    if (column === null) return [];
    const active = column.enumValues.find((v) => ACTIVE_STATE_RE.test(v)) ?? column.enumValues[0];
    if (active === undefined) return [];
    return [
      {
        widget: 'kpi-stat-card',
        score: score(0.75, byRowCount(view), byName(ACTIVE_STATE_RE.test(active))),
        shape: 'single-metric',
        family: 'kpi',
        rule: 'kpi.status-count',
        reason: `status enum "${column.name}" — count of the "${active}" state`,
        binding: descriptor(view, ctx, 'single-metric', {
          aggregations: [{ fn: 'count', alias: 'value' }],
          filters: [{ column: column.name, op: 'eq', value: active }],
        }),
        config: { title: `${humanize(active)} ${tableTitle(view.table)}` },
      },
    ];
  },
};

/** Annex — score-like 0–100 column → `gauge-ring`. */
const kpiScoreGauge: CandidateRule = {
  id: 'kpi.score-gauge',
  family: 'kpi',
  match(view, ctx) {
    const column = firstWithSemantic(view, 'score', 'percent');
    if (column === null) return [];
    return [
      {
        widget: 'gauge-ring',
        score: score(0.6, byRowCount(view)),
        shape: 'single-metric',
        family: 'kpi',
        rule: 'kpi.score-gauge',
        reason: `${column.semantic} column "${column.name}" — average as a 0–100 ring`,
        binding: descriptor(view, ctx, 'single-metric', {
          aggregations: [{ fn: 'avg', column: column.name, alias: 'value' }],
        }),
        config: { title: `Average ${columnTitle(column)}`, max: 100 },
      },
    ];
  },
};

/**
 * Annex — "numeric + configured cap … → `usage-meter`". No `adminium_settings`
 * cap is available at generation time, so the rule fires on the storage shape
 * the annex `page-files` template meters (a byte/size numeric); the limit stays
 * a config default the admin edits in Studio.
 */
const kpiStorageUsage: CandidateRule = {
  id: 'kpi.storage-usage',
  family: 'kpi',
  match(view, ctx) {
    const column = view.columns.find(
      (c) => NUMERIC_TYPES.has(c.logicalType) && !c.isPrimaryKey && SIZE_RE.test(normalize(c.name)),
    );
    if (column === undefined) return [];
    return [
      {
        widget: 'usage-meter',
        score: score(0.6, byRowCount(view)),
        shape: 'single-metric',
        family: 'kpi',
        rule: 'kpi.storage-usage',
        reason: `size numeric "${column.name}" — quota meter over SUM(${column.name})`,
        binding: descriptor(view, ctx, 'single-metric', {
          aggregations: [{ fn: 'sum', column: column.name, alias: 'value' }],
        }),
        // Same class of bug as `kpi.money-sum` above: `format: 'filesize'` never
        // parsed and was pruned on every mount. Dropped rather than translated —
        // UsageMeter's `unit` is a free-text SUFFIX ("12 of 100 GB"), not a
        // formatter, and the generator cannot know the unit of an arbitrary size
        // column. Falling through to the metric's own `unit` is the honest
        // default; a wrong hardcoded suffix would be worse than none.
        config: { title: `${tableTitle(view.table)} Storage` },
      },
    ];
  },
};

/** Annex — "timestamp column + numeric column → `chart-line-area`". */
const chartsHeroTimeseries: CandidateRule = {
  id: 'charts.time-numeric',
  family: 'charts',
  match(view, ctx) {
    const axis = timeAxis(view);
    if (axis === null) return [];
    const money = firstWithSemantic(view, 'money');
    const title =
      money !== null
        ? `${columnTitle(money)} per Month`
        : `${tableTitle(view.table)} per Month`;
    return [
      {
        widget: 'chart-line-area',
        score: score(0.95, byRowCount(view), byName(money !== null, 1.05, 1)),
        shape: 'timeseries',
        family: 'charts',
        rule: 'charts.time-numeric',
        reason:
          money !== null
            ? `time axis "${axis.name}" × money "${money.name}" — the hero timeseries`
            : `time axis "${axis.name}" — row counts per month as the hero timeseries`,
        binding: descriptor(view, ctx, 'timeseries', {
          aggregations: [
            money !== null
              ? { fn: 'sum', column: money.name, alias: 'value' }
              : { fn: 'count', alias: 'value' },
          ],
          bucket: { column: axis.name, unit: 'month' },
        }),
        config: { title },
      },
    ];
  },
};

/** Annex — "timestamp alone → `chart-heatmap-calendar` of row counts". */
const chartsTimeHeatmap: CandidateRule = {
  id: 'charts.time-only',
  family: 'charts',
  match(view, ctx) {
    const axis = timeAxis(view);
    if (axis === null) return [];
    if (withSemantic(view, 'money', 'percent', 'score').length > 0) return [];
    return [
      {
        widget: 'chart-heatmap-calendar',
        score: score(0.5, byRowCount(view)),
        shape: 'timeseries',
        family: 'charts',
        rule: 'charts.time-only',
        reason: `time axis "${axis.name}" with no numeric measure — daily row-count heatmap`,
        binding: descriptor(view, ctx, 'timeseries', {
          aggregations: [{ fn: 'count', alias: 'value' }],
          bucket: { column: axis.name, unit: 'day' },
        }),
        config: { title: `${tableTitle(view.table)} Activity` },
      },
    ];
  },
};

/** Annex — "low-cardinality enum/text (≤8 distinct) → `chart-donut`". */
const chartsCategoricalDonut: CandidateRule = {
  id: 'charts.low-cardinality-enum',
  family: 'charts',
  match(view, ctx) {
    const column = enumColumns(view)[0];
    if (column === undefined) return [];
    if (column.enumValues.length > 8) return [];
    return [
      {
        widget: 'chart-donut',
        score: score(0.8, byRowCount(view), byCardinality(column.enumValues.length, 6, 8)),
        shape: 'categorical',
        family: 'charts',
        rule: 'charts.low-cardinality-enum',
        reason: `enum "${column.name}" with ${column.enumValues.length} values — part-to-whole donut`,
        binding: descriptor(view, ctx, 'categorical', {
          aggregations: [{ fn: 'count', alias: 'value' }],
          groupBy: [column.name],
          limit: 8,
        }),
        config: { title: `${tableTitle(view.table)} by ${columnTitle(column)}` },
      },
    ];
  },
};

/** Annex — "two numerics → `chart-scatter-bubble`". */
const chartsScatter: CandidateRule = {
  id: 'charts.two-numerics',
  family: 'charts',
  match(view, ctx) {
    const numerics = withSemantic(view, 'money', 'percent', 'score', 'duration').filter((c) =>
      NUMERIC_TYPES.has(c.logicalType),
    );
    const x = numerics[0];
    const y = numerics[1];
    if (x === undefined || y === undefined) return [];
    return [
      {
        widget: 'chart-scatter-bubble',
        score: score(0.5, byRowCount(view)),
        shape: 'record-list',
        family: 'charts',
        rule: 'charts.two-numerics',
        reason: `numeric pair "${x.name}" × "${y.name}" — correlation scatter`,
        binding: descriptor(view, ctx, 'record-list', {
          select: [x.name, y.name],
          limit: 500,
        }),
        config: { title: `${columnTitle(x)} vs ${columnTitle(y)}` },
      },
    ];
  },
};

/** Annex — "per-row latency/duration numeric → `chart-boxplot`". */
const chartsDurationBoxplot: CandidateRule = {
  id: 'charts.duration-distribution',
  family: 'charts',
  match(view, ctx) {
    const column = firstWithSemantic(view, 'duration');
    if (column === null) return [];
    return [
      {
        widget: 'chart-boxplot',
        score: score(0.55, byRowCount(view)),
        shape: 'distribution',
        family: 'charts',
        rule: 'charts.duration-distribution',
        reason: `duration column "${column.name}" — quantile distribution`,
        binding: descriptor(view, ctx, 'distribution', {
          aggregations: [
            { fn: 'percentile', column: column.name, p: 0.5, alias: 'p50' },
            { fn: 'percentile', column: column.name, p: 0.9, alias: 'p90' },
            { fn: 'percentile', column: column.name, p: 0.99, alias: 'p99' },
          ],
        }),
        config: { title: `${columnTitle(column)} Distribution` },
      },
    ];
  },
};

/** Annex — "region codes → `chart-choropleth-grid`". */
const chartsGeoRegion: CandidateRule = {
  id: 'charts.geo-region',
  family: 'charts',
  match(view, ctx) {
    const column = firstWithSemantic(view, 'geo-region');
    if (column === null) return [];
    return [
      {
        widget: 'chart-choropleth-grid',
        score: score(0.6, byRowCount(view), byName(/country/i.test(column.name))),
        shape: 'geo-points',
        family: 'charts',
        rule: 'charts.geo-region',
        reason: `region code "${column.name}" — grid choropleth of row counts`,
        binding: descriptor(view, ctx, 'geo-points', {
          aggregations: [{ fn: 'count', alias: 'value' }],
          groupBy: [column.name],
          limit: 60,
        }),
        config: { title: `${tableTitle(view.table)} by ${columnTitle(column)}` },
      },
    ];
  },
};

/** Annex — "every included table gets a `data-grid`". */
const tablesDataGrid: CandidateRule = {
  id: 'tables.data-grid',
  family: 'tables',
  match(view, ctx) {
    return [
      {
        widget: 'data-grid',
        // Deliberately below the specialised lists: `page-crud` already gives
        // every table its grid, so as an archetype-slot candidate
        // the grid is the last-resort filler, not the first choice.
        score: score(0.55, byRowCount(view)),
        shape: 'record-list',
        family: 'tables',
        rule: 'tables.data-grid',
        reason: `every included table gets a typed data-grid`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          limit: 50,
        }),
        config: { title: tableTitle(view.table) },
      },
    ];
  },
};

/**
 * Annex — "enum column present → `master-list` + detail split candidate".
 *
 * Also fires for the domain-card shape (start/end + progress/phase), which
 * `./archetypes.ts` routes to `page-master-detail` as well: that manifest's
 * `master` slot is `required`, so the split view needs its rail whether the
 * detail pane ends up a key-value list or a gantt.
 *
 * SCORING — `master-list` is deliberately flat 0.95, unmodified: `page-master-
 * detail`'s `master` slot accepts **any** `record-list` (shape match) and is
 * filled before `detail`, so the rail must outrank every other record-list
 * candidate on the table or it would consume the very domain card the detail
 * pane exists to show (a `gantt-chart` in the 4-column master rail, and an
 * unfillable `detail` → no page at all). No modifier may lift another candidate
 * past it — see `byRowCount`'s cap and the ordering test in
 * `candidates.test.ts`.
 */
const tablesMasterDetail: CandidateRule = {
  id: 'tables.master-detail',
  family: 'tables',
  match(view, ctx) {
    const enums = enumColumns(view);
    const start = dateRangeStart(view);
    const domainCard =
      start !== null && (firstWithSemantic(view, 'percent') !== null || projectFk(view) !== null);
    if (enums.length === 0 && !domainCard) return [];

    const enumColumn = enums[0];
    const reason =
      enumColumn === undefined
        ? `start/end pair "${start?.name}" — master rail of the domain-card split view`
        : `enum "${enumColumn.name}" — master list of the split view`;
    return [
      {
        widget: 'master-list',
        score: score(0.95),
        shape: 'record-list',
        family: 'tables',
        rule: 'tables.master-detail',
        reason,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view, 4),
          limit: 100,
        }),
        config: {
          title: tableTitle(view.table),
          ...(enumColumn === undefined ? {} : { groupBy: enumColumn.name }),
        },
      },
      {
        widget: 'detail-key-value',
        score: score(0.7, byRowCount(view)),
        shape: 'record',
        family: 'tables',
        rule: 'tables.master-detail',
        reason: `per-record detail pane for the ${tableTitle(view.table)} split view`,
        binding: descriptor(view, ctx, 'record', { limit: 1 }),
        config: { title: `${tableTitle(view.table)} Detail` },
      },
    ];
  },
};

/** Annex — "table with `name`+`image/avatar/logo` columns → `card-gallery`". */
const tablesCardGallery: CandidateRule = {
  id: 'tables.card-gallery',
  family: 'tables',
  match(view, ctx) {
    const image = firstWithSemantic(view, 'image-url');
    if (image === null || view.displayColumn === null) return [];
    return [
      {
        widget: 'card-gallery',
        score: score(0.75, byRowCount(view), byName(view.shape === 'people', 1.1, 1)),
        shape: 'record-list',
        family: 'tables',
        rule: 'tables.card-gallery',
        reason: `display column "${view.displayColumn}" + image "${image.name}" — card gallery`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          limit: 60,
        }),
        config: {
          title: tableTitle(view.table),
          titleColumn: view.displayColumn,
          imageColumn: image.name,
        },
      },
    ];
  },
};

/** Annex — "audit/log-named tables (`*_log`, `*_events`, `audit*`) →
 * `log-table`". */
const tablesLogTable: CandidateRule = {
  id: 'tables.log-table',
  family: 'tables',
  match(view, ctx) {
    if (view.shape !== 'log' && view.role !== 'log') return [];
    const axis = timeAxis(view);
    return [
      {
        widget: 'log-table',
        score: score(0.85, byRowCount(view)),
        shape: 'record-list',
        family: 'tables',
        rule: 'tables.log-table',
        reason: `${view.table.id} classified as a log table — dense log grid`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          ...(axis === null ? {} : { orderBy: [{ column: axis.name, dir: 'desc' as const }] }),
          limit: 100,
        }),
        config: { title: tableTitle(view.table) },
      },
    ];
  },
};

/** Annex — "parent-child FK self-reference → `schema-tree`-style tree view". */
const tablesTree: CandidateRule = {
  id: 'tables.self-fk-tree',
  family: 'tables',
  match(view, ctx) {
    if (view.hierarchyColumn === null) return [];
    return [
      {
        widget: 'schema-tree',
        score: score(0.5, byRowCount(view)),
        shape: 'hierarchy/tree',
        family: 'tables',
        rule: 'tables.self-fk-tree',
        reason: `self-FK "${view.hierarchyColumn}" — collapsible tree view`,
        binding: descriptor(view, ctx, 'hierarchy/tree', {
          select: listSelect(view, 4),
          limit: 500,
        }),
        config: {
          title: tableTitle(view.table),
          parentColumn: view.hierarchyColumn,
          labelColumn: view.displayColumn,
        },
      },
    ];
  },
};

/** Annex — "(actor FK | user_id) + timestamp + verb-ish text →
 * `activity-feed`". */
const feedsActivity: CandidateRule = {
  id: 'feeds.actor-timestamp-verb',
  family: 'feeds',
  match(view, ctx) {
    const actor = personFk(view);
    const axis = timeAxis(view);
    const verb = view.columns.find(
      (c) => TEXTISH_TYPES.has(c.logicalType) && VERBISH_RE.test(normalize(c.name)),
    );
    if (actor === null || axis === null || verb === undefined) return [];
    return [
      {
        widget: 'activity-feed',
        score: score(0.7, byRowCount(view)),
        shape: 'record-list',
        family: 'feeds',
        rule: 'feeds.actor-timestamp-verb',
        reason: `actor FK "${actor.name}" + "${axis.name}" + verb text "${verb.name}" — activity feed`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          orderBy: [{ column: axis.name, dir: 'desc' }],
          limit: 50,
        }),
        config: { title: `${tableTitle(view.table)} Activity` },
      },
    ];
  },
};

/** Annex — "`read`/`seen` boolean → `notification-feed` with unread logic". */
const feedsNotification: CandidateRule = {
  id: 'feeds.read-flag',
  family: 'feeds',
  match(view, ctx) {
    const flag = view.columns.find(
      (c) =>
        (c.logicalType === 'boolean' || c.semantic === 'boolean-flag') &&
        READ_FLAG_RE.test(normalize(c.name)),
    );
    if (flag === undefined) return [];
    const axis = timeAxis(view);
    return [
      {
        widget: 'notification-feed',
        score: score(0.8, byRowCount(view)),
        shape: 'record-list',
        family: 'feeds',
        rule: 'feeds.read-flag',
        reason: `read/unread flag "${flag.name}" — notification feed with unread logic`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          ...(axis === null ? {} : { orderBy: [{ column: axis.name, dir: 'desc' as const }] }),
          limit: 50,
        }),
        config: { title: tableTitle(view.table), readColumn: flag.name },
      },
    ];
  },
};

/** Annex — "high write-rate tables → `realtime-feed` candidate". */
const feedsRealtime: CandidateRule = {
  id: 'feeds.high-write-rate',
  family: 'feeds',
  match(view, ctx) {
    const velocity = view.stats.writeVelocity;
    if (velocity === null || velocity < 10_000) return [];
    const axis = timeAxis(view);
    if (axis === null) return [];
    return [
      {
        widget: 'realtime-feed',
        score: score(0.5, byRowCount(view)),
        shape: 'stream',
        family: 'feeds',
        rule: 'feeds.high-write-rate',
        reason: `write velocity ${velocity} — streamed realtime feed`,
        binding: descriptor(view, ctx, 'stream', {
          select: listSelect(view),
          orderBy: [{ column: axis.name, dir: 'desc' }],
          limit: 50,
        }),
        config: { title: `${tableTitle(view.table)} Live` },
      },
    ];
  },
};

/** Annex — "version-string column + date → changelog `timeline-vertical`". */
const feedsTimeline: CandidateRule = {
  id: 'feeds.version-timeline',
  family: 'feeds',
  match(view, ctx) {
    const axis = timeAxis(view);
    const version = view.columns.find(
      (c) => TEXTISH_TYPES.has(c.logicalType) && VERSION_RE.test(normalize(c.name)),
    );
    const trace = view.shape === 'log' || view.role === 'log';
    if (axis === null || (version === undefined && !trace)) return [];
    return [
      {
        widget: 'timeline-vertical',
        score: score(version === undefined ? 0.45 : 0.55, byRowCount(view)),
        shape: 'record-list',
        family: 'feeds',
        rule: 'feeds.version-timeline',
        reason:
          version === undefined
            ? `log table with time axis "${axis.name}" — vertical trace timeline`
            : `version column "${version.name}" + "${axis.name}" — changelog timeline`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          orderBy: [{ column: axis.name, dir: 'desc' }],
          limit: 50,
        }),
        config: { title: `${tableTitle(view.table)} Timeline` },
      },
    ];
  },
};

/** Annex — "date/timestamp column + title-ish text column → `calendar-month` +
 * `day-agenda`". */
const calendarMonth: CandidateRule = {
  id: 'calendar.date-title',
  family: 'calendar',
  match(view, ctx) {
    const date = eventDate(view) ?? dateRangeStart(view);
    if (date === null || view.displayColumn === null) return [];
    const rowScore = byRowCount(view);
    const eventsShape = byName(view.shape === 'events', 1.05, 1);
    const binding = (): QueryDescriptor =>
      descriptor(view, ctx, 'calendar-events', {
        select: listSelect(view),
        orderBy: [{ column: date.name, dir: 'asc' }],
        limit: 500,
      });
    const config = {
      titleColumn: view.displayColumn,
      startColumn: date.name,
      ...(date.pair?.role === 'start' ? { endColumn: date.pair.partner } : {}),
    };
    return [
      {
        widget: 'calendar-month',
        score: score(0.85, rowScore, eventsShape),
        shape: 'calendar-events',
        family: 'calendar',
        rule: 'calendar.date-title',
        reason: `date "${date.name}" + title "${view.displayColumn}" — month calendar`,
        binding: binding(),
        config: { title: tableTitle(view.table), ...config },
      },
      {
        widget: 'day-agenda',
        score: score(0.6, rowScore, eventsShape),
        shape: 'calendar-events',
        family: 'calendar',
        rule: 'calendar.date-title',
        reason: `date "${date.name}" + title "${view.displayColumn}" — day agenda beside the calendar`,
        binding: binding(),
        config: { title: 'Agenda', ...config },
      },
    ];
  },
};

/** Annex — "FK-to-people + date + enum(type) → `schedule-matrix`". */
const calendarScheduleMatrix: CandidateRule = {
  id: 'calendar.person-date-shift',
  family: 'calendar',
  match(view, ctx) {
    const person = personFk(view);
    const date = eventDate(view) ?? dateRangeStart(view);
    if (person === null || date === null) return [];
    const type = enumColumns(view).find(
      (c) => SHIFT_TYPE_RE.test(normalize(c.name)) || c.semantic === 'category-enum',
    );
    if (type === undefined) return [];
    return [
      {
        widget: 'schedule-matrix',
        score: score(
          0.75,
          byRowCount(view),
          byName(SHIFT_TYPE_RE.test(normalize(type.name)) || view.shape === 'events'),
        ),
        shape: 'record-list',
        family: 'calendar',
        rule: 'calendar.person-date-shift',
        reason: `person FK "${person.name}" × date "${date.name}" × type "${type.name}" — shift matrix`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          orderBy: [{ column: date.name, dir: 'asc' }],
          limit: 500,
        }),
        config: {
          title: tableTitle(view.table),
          personColumn: person.name,
          dateColumn: date.name,
          typeColumn: type.name,
        },
      },
    ];
  },
};

/** Annex — "numeric hours + FK person + FK project → `capacity-board`". */
const calendarCapacityBoard: CandidateRule = {
  id: 'calendar.hours-per-project',
  family: 'calendar',
  match(view, ctx) {
    const person = personFk(view);
    const project = projectFk(view);
    const hours = view.columns.find(
      (c) => NUMERIC_TYPES.has(c.logicalType) && !c.isPrimaryKey && HOURS_RE.test(normalize(c.name)),
    );
    if (person === null || project === null || hours === undefined) return [];
    return [
      {
        widget: 'capacity-board',
        score: score(0.75, byRowCount(view)),
        shape: 'record-list',
        family: 'calendar',
        rule: 'calendar.hours-per-project',
        reason: `hours "${hours.name}" × person "${person.name}" × project "${project.name}" — capacity board`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          limit: 500,
        }),
        config: {
          title: tableTitle(view.table),
          personColumn: person.name,
          projectColumn: project.name,
          hoursColumn: hours.name,
        },
      },
    ];
  },
};

/**
 * Annex — "status-like enum (≤6 values, names matching `todo|progress|…` or
 * LLM-classified as workflow states) → kanban candidate alongside the
 * `data-grid`; **second orthogonal enum or team FK → swimlanes**; numeric
 * `pct/progress` column → card progress bar".
 *
 * One rule, two widget ids: the lane dimension *is* the discriminator between
 * `kanban-board` and `kanban-swimlane-grid` (annex lists them as one
 * composition, "`kanban-board`/`kanban-swimlane-grid` … optional lane
 * dimension"). Emitting both and letting them fight over `page-board`'s slot on
 * score would make the winner an artefact of modifier arithmetic; picking here
 * makes it an artefact of the schema, which is the point.
 */
const boardsKanban: CandidateRule = {
  id: 'boards.workflow-enum',
  family: 'boards',
  match(view, ctx) {
    const status = firstWithSemantic(view, 'status-workflow');
    if (status === null || status.enumValues.length === 0 || status.enumValues.length > 6) return [];
    const boardish = status.enumValues.filter((v) => BOARD_STATE_RE.test(v.trim())).length;
    if (boardish === 0) return [];

    const lane =
      enumColumns(view).find((c) => c.name !== status.name && c.semantic === 'category-enum') ??
      personFk(view) ??
      projectFk(view) ??
      null;
    const progress = firstWithSemantic(view, 'percent');
    return [
      {
        widget: lane === null ? 'kanban-board' : 'kanban-swimlane-grid',
        score: score(
          0.85,
          byRowCount(view),
          byCardinality(status.enumValues.length, 6, 6),
          byName(boardish === status.enumValues.length),
        ),
        shape: 'record-list',
        family: 'boards',
        rule: 'boards.workflow-enum',
        reason:
          lane === null
            ? `workflow enum "${status.name}" with ${status.enumValues.length} states — kanban columns`
            : `workflow enum "${status.name}" × lane dimension "${lane.name}" — swimlane grid`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          limit: 200,
        }),
        config: {
          title: tableTitle(view.table),
          statusColumn: status.name,
          columns: [...status.enumValues],
          ...(lane === null ? {} : { laneColumn: lane.name }),
          ...(view.displayColumn === null ? {} : { titleColumn: view.displayColumn }),
          ...(progress === null ? {} : { progressColumn: progress.name }),
        },
      },
    ];
  },
};

/** Annex — "paired `lat`/`lng` … numeric columns → `map-bubble`". */
const geoMapBubble: CandidateRule = {
  id: 'geo.lat-lng-pair',
  family: 'geo',
  match(view, ctx) {
    const lat = view.columns.find((c) => c.semantic === 'geo-point' && c.pair?.role === 'lat');
    const lng = view.columns.find((c) => c.semantic === 'geo-point' && c.pair?.role === 'lng');
    if (lat === undefined || lng === undefined) return [];
    return [
      {
        widget: 'map-bubble',
        score: score(0.9, byRowCount(view)),
        shape: 'geo-points',
        family: 'geo',
        rule: 'geo.lat-lng-pair',
        reason: `lat/lng pair "${lat.name}"/"${lng.name}" — bubble map`,
        binding: descriptor(view, ctx, 'geo-points', {
          select: listSelect(view),
          limit: 1000,
        }),
        config: { title: tableTitle(view.table), latColumn: lat.name, lngColumn: lng.name },
      },
    ];
  },
};

/** Annex — "column typed storage-URL or named file|attachment|… →
 * `attachment-list`". */
const mediaAttachmentList: CandidateRule = {
  id: 'media.file-ref',
  family: 'media',
  match(view, ctx) {
    const file = firstWithSemantic(view, 'file-ref');
    if (file === null) return [];
    return [
      {
        widget: 'attachment-list',
        score: score(0.7, byRowCount(view)),
        shape: 'record-list',
        family: 'media',
        rule: 'media.file-ref',
        reason: `file reference "${file.name}" — attachment list`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          limit: 50,
        }),
        config: { title: `${tableTitle(view.table)} Attachments`, fileColumn: file.name },
      },
    ];
  },
};

/** Annex — "`image-board`/`card-gallery` thumbnails when multiple images". */
const mediaImageBoard: CandidateRule = {
  id: 'media.image-url',
  family: 'media',
  match(view, ctx) {
    const images = withSemantic(view, 'image-url');
    if (images.length === 0) return [];
    const image = images[0] as ViewColumn;
    return [
      {
        widget: 'image-board',
        score: score(0.5, byRowCount(view), byName(images.length > 1)),
        shape: 'record-list',
        family: 'media',
        rule: 'media.image-url',
        reason: `image column "${image.name}" — thumbnail board`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          limit: 60,
        }),
        config: { title: `${tableTitle(view.table)} Media`, imageColumn: image.name },
      },
    ];
  },
};

/** Annex — "table with name+size+parent self-FK → `file-browser`". */
const mediaFileBrowser: CandidateRule = {
  id: 'media.file-shaped-table',
  family: 'media',
  match(view, ctx) {
    if (!isFileShaped(view)) return [];
    return [
      {
        widget: 'file-browser',
        score: score(0.9, byRowCount(view)),
        shape: 'record-list',
        family: 'media',
        rule: 'media.file-shaped-table',
        reason: `file-shaped table (name + size + file reference) — file browser`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          limit: 200,
        }),
        config: {
          title: tableTitle(view.table),
          ...(view.displayColumn === null ? {} : { nameColumn: view.displayColumn }),
          ...(view.hierarchyColumn === null ? {} : { parentColumn: view.hierarchyColumn }),
        },
      },
    ];
  },
};

/** Annex — "URL columns → `link-list`". */
const mediaLinkList: CandidateRule = {
  id: 'media.url-column',
  family: 'media',
  match(view, ctx) {
    const url = firstWithSemantic(view, 'url');
    if (url === null) return [];
    return [
      {
        widget: 'link-list',
        score: score(0.4, byRowCount(view)),
        shape: 'record-list',
        family: 'media',
        rule: 'media.url-column',
        reason: `URL column "${url.name}" — link list`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          limit: 50,
        }),
        config: { title: `${tableTitle(view.table)} Links`, urlColumn: url.name },
      },
    ];
  },
};

/**
 * Annex — "table pair shaped like conversations(id, participants) +
 * messages(conversation_fk, sender_fk, body, created_at) →
 * `conversation-inbox`
 * + `chat-thread` page". Emitted on the **conversation** side (the page's
 * subject); the thread binds to the messages child.
 */
const communicationPair: CandidateRule = {
  id: 'communication.conversation-message-pair',
  family: 'communication',
  match(view, ctx) {
    const messages = messagesChildOf(view, ctx);
    if (messages === null) return [];
    const axis = timeAxis(messages);
    const rowScore = byRowCount(view);
    return [
      {
        widget: 'conversation-inbox',
        score: score(0.9, rowScore),
        shape: 'record-list',
        family: 'communication',
        rule: 'communication.conversation-message-pair',
        reason: `conversation table paired with messages "${messages.table.id}" — inbox rail`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          limit: 100,
        }),
        config: { title: tableTitle(view.table) },
      },
      {
        widget: 'chat-thread',
        score: score(0.85, rowScore),
        shape: 'record-list',
        family: 'communication',
        rule: 'communication.conversation-message-pair',
        reason: `messages "${messages.table.id}" of ${view.table.id} — chat thread pane`,
        binding: siblingDescriptor(messages, ctx, 'record-list', {
          select: listSelect(messages),
          ...(axis === null ? {} : { orderBy: [{ column: axis.name, dir: 'asc' as const }] }),
          limit: 200,
        }),
        config: { title: 'Thread' },
      },
    ];
  },
};

/** Annex — "self-FK on a people table (`manager_id`) → `org-chart`". */
const domainOrgChart: CandidateRule = {
  id: 'domain.people-self-fk',
  family: 'domain',
  match(view, ctx) {
    if (view.hierarchyColumn === null) return [];
    if (view.shape !== 'people' && view.role !== 'people') return [];
    return [
      {
        widget: 'org-chart',
        score: score(0.9, byRowCount(view)),
        shape: 'hierarchy/tree',
        family: 'domain',
        rule: 'domain.people-self-fk',
        reason: `people table with self-FK "${view.hierarchyColumn}" — org chart`,
        binding: descriptor(view, ctx, 'hierarchy/tree', {
          select: listSelect(view),
          limit: 500,
        }),
        config: {
          title: tableTitle(view.table),
          parentColumn: view.hierarchyColumn,
          ...(view.displayColumn === null ? {} : { labelColumn: view.displayColumn }),
        },
      },
    ];
  },
};

/** Annex — "start+end dates + phase FK → `gantt-chart`". */
const domainGanttChart: CandidateRule = {
  id: 'domain.start-end-phase',
  family: 'domain',
  match(view, ctx) {
    const start = dateRangeStart(view);
    if (start === null || start.pair === null) return [];
    const progress = firstWithSemantic(view, 'percent');
    const phase = projectFk(view);
    if (progress === null && phase === null) return [];
    return [
      {
        widget: 'gantt-chart',
        score: score(0.85, byRowCount(view), byName(progress !== null && phase !== null)),
        shape: 'record-list',
        family: 'domain',
        rule: 'domain.start-end-phase',
        reason: `start/end pair "${start.name}"/"${start.pair.partner}"${
          phase === null ? '' : ` + phase FK "${phase.name}"`
        } — gantt chart`,
        binding: descriptor(view, ctx, 'record-list', {
          select: listSelect(view),
          orderBy: [{ column: start.name, dir: 'asc' }],
          limit: 200,
        }),
        config: {
          title: tableTitle(view.table),
          startColumn: start.name,
          endColumn: start.pair.partner,
          ...(view.displayColumn === null ? {} : { labelColumn: view.displayColumn }),
          ...(progress === null ? {} : { progressColumn: progress.name }),
          ...(phase === null ? {} : { groupColumn: phase.name }),
        },
      },
    ];
  },
};

/* ------------------------------------------------- cross-table predicates */

/** Annex `page-files` shape: a display name + a size numeric or a file ref. */
export function isFileShaped(view: CandidateView): boolean {
  if (view.displayColumn === null) return false;
  const hasSize = view.columns.some(
    (c) => NUMERIC_TYPES.has(c.logicalType) && !c.isPrimaryKey && SIZE_RE.test(normalize(c.name)),
  );
  const hasFileRef = view.columns.some((c) => c.semantic === 'file-ref');
  // name + size + parent self-FK (the annex's literal trigger), or the weaker
  // name + explicit file reference — an attachments table with a storage URL and
  // no size column, which is what the "or storage integration" clause covers.
  return (hasSize && view.hierarchyColumn !== null) || hasFileRef;
}

/**
 * The messages child of a conversation container (annex): a `messages`-role
 * table with an FK back to `view`. Returns the child's view, or null.
 */
export function messagesChildOf(
  view: CandidateView,
  ctx: CandidateContext,
): CandidateView | null {
  if (ctx.model === undefined) return null;
  if (view.role === 'messages') return null; // the child never hosts the pair page
  const conversationish =
    CONVERSATION_RE.test(normalize(bareName(view.table.id))) || view.role === 'entity';
  if (!conversationish) return null;
  const children = ctx.model
    .filter((entry) => entry.classified.role === 'messages' && entry.table.id !== view.table.id)
    .filter((entry) =>
      entry.table.columns.some((c) => (c.references ?? null)?.tableId === view.table.id),
    )
    .sort((a, b) => a.table.id.localeCompare(b.table.id));
  const child = children[0];
  return child === undefined ? null : buildCandidateView(child.table, child.classified);
}

/* -------------------------------------------------------------- rule table */

/**
 * Every rule, in family order (`candidateRules`). Order here is only a
 * reading aid — {@link emitCandidates} imposes a total order on the output.
 */
export const candidateRules: readonly CandidateRule[] = [
  // KPI / Stat
  kpiCountTotal,
  kpiMoneySum,
  kpiNewThisPeriod,
  kpiStatusCount,
  kpiScoreGauge,
  kpiStorageUsage,
  // Charts
  chartsHeroTimeseries,
  chartsTimeHeatmap,
  chartsCategoricalDonut,
  chartsScatter,
  chartsDurationBoxplot,
  chartsGeoRegion,
  // Tables & Lists
  tablesDataGrid,
  tablesMasterDetail,
  tablesCardGallery,
  tablesLogTable,
  tablesTree,
  // Feeds
  feedsActivity,
  feedsNotification,
  feedsRealtime,
  feedsTimeline,
  // Calendar
  calendarMonth,
  calendarScheduleMatrix,
  calendarCapacityBoard,
  // Boards
  boardsKanban,
  // Geo
  geoMapBubble,
  // Media
  mediaAttachmentList,
  mediaImageBoard,
  mediaFileBrowser,
  mediaLinkList,
  // Communication
  communicationPair,
  // Domain
  domainOrgChart,
  domainGanttChart,
];

/**
 * H2 per-family caps. The listing fixes the dashboard-facing ones — "≤4 KPI
 * candidates per dashboard, exactly 1 hero chart, ≤4 secondary charts" (charts
 * = 1 + 4) — and the remaining families cap at the widest slot any template
 * offers them, so pruning can never starve a template.
 */
export const FAMILY_CAPS: Readonly<Record<WidgetFamily, number>> = {
  kpi: 4,
  charts: 5,
  tables: 4,
  feeds: 2,
  calendar: 3,
  boards: 2,
  geo: 1,
  media: 4,
  communication: 2,
  forms: 0, // page chrome, not candidates — the crud form owns them
  chrome: 0, // app shell, mounted by the template's `chrome` block
  system: 0, // states/pills wired by the host widgets themselves
  domain: 2,
};

/** Total order: score desc → rule id → widget id → emission order. */
function compareCandidates(
  a: { candidate: WidgetCandidate; order: number },
  b: { candidate: WidgetCandidate; order: number },
): number {
  return (
    b.candidate.score - a.candidate.score ||
    a.candidate.rule.localeCompare(b.candidate.rule) ||
    a.candidate.widget.localeCompare(b.candidate.widget) ||
    a.order - b.order
  );
}

/**
 * **H1 + H2** for one table: run every {@link candidateRules} `match`, drop ids
 * the live registry does not know (`ctx.isRegistered`), then sort by the total
 * order above and apply {@link FAMILY_CAPS}.
 *
 * Pure and deterministic — the same `(table, classified, ctx)` always yields the
 * same array, including score values and ordering.
 */
export function emitCandidates(
  table: CandidateTable,
  classified: ClassifiedTableInput,
  ctx: CandidateContext,
): WidgetCandidate[] {
  const view = buildCandidateView(table, classified);
  // System and join tables are never paged — they get no widgets.
  if (view.role === 'system' || view.role === 'join-table') return [];

  const emitted: { candidate: WidgetCandidate; order: number }[] = [];
  for (const rule of candidateRules) {
    for (const candidate of rule.match(view, ctx)) {
      if (ctx.isRegistered !== undefined && !ctx.isRegistered(candidate.widget)) continue;
      if (candidate.score <= 0) continue;
      emitted.push({ candidate, order: emitted.length });
    }
  }

  emitted.sort(compareCandidates);

  const used = new Map<WidgetFamily, number>();
  const out: WidgetCandidate[] = [];
  for (const entry of emitted) {
    const family = entry.candidate.family;
    const taken = used.get(family) ?? 0;
    if (taken >= FAMILY_CAPS[family]) continue;
    used.set(family, taken + 1);
    out.push(entry.candidate);
  }
  return out;
}

/**
 * **H1 for a whole model** — `emitCandidates(schemaModel)`, keyed by table id.
 * `ctx.model` is threaded through automatically so cross-table rules (annex
 * conversation+message pair) see every table.
 */
export function emitModelCandidates(
  model: readonly CandidateTableInput[],
  ctx: CandidateContext,
): Map<string, WidgetCandidate[]> {
  const withModel: CandidateContext = { ...ctx, model };
  const out = new Map<string, WidgetCandidate[]>();
  for (const entry of [...model].sort((a, b) => a.table.id.localeCompare(b.table.id))) {
    out.set(entry.table.id, emitCandidates(entry.table, entry.classified, withModel));
  }
  return out;
}
