// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Query-descriptor draft model (04-widget-registry.md §5.1) — the pure half of
 * the builder's binding editor.
 *
 * A `QueryDescriptor` is a nested document (`source`, `aggregations[]`,
 * `bucket`, `window`, `orderBy[]`, `filters[]`); a form is flat. This module is
 * the two-way translation between them plus the per-shape validity rules, so
 * the editor component stays presentation and every rule is unit-testable
 * without a DOM.
 *
 * WHAT IT AUTHORS IS WHAT THE ENGINE WRITES. The generator emits bindings from
 * `packages/widgets/src/registry/candidates.ts` (its local `descriptor()`
 * helper); what {@link descriptorFromDraft} returns is that same object —
 * `kind: 'table-query'`, a `source`, one aliased aggregation, and the per-shape
 * extras. A hand-authored binding and a generated one are indistinguishable
 * downstream, which is the point: they reach the same compiler through the same
 * `extractBindings` collection path.
 *
 * WHY THE RULES ARE RESTATED HERE. `apps/server/src/widget-data/compiler.ts`
 * (`assertShapeRules`) rejects a structurally wrong descriptor with a 422 at
 * fetch time. {@link SHAPE_CONTROLS} is not a second authority — it is the
 * difference between a disabled Save button and a widget that saves clean and
 * then renders an error box on the next page load. The compiler is the source
 * of truth; this table mirrors it and must be updated with it. It is also what
 * decides which controls the editor RENDERS, so a shape can never offer a
 * control whose value the compiler would reject.
 */

import {
  COMPILABLE_DATA_SHAPES,
  isCompilableShape,
  type BucketUnit,
  type CompilableDataShape,
  type DataShape,
  type QueryDescriptor,
  type QueryFilter,
} from '@adminium/engine/config';

/**
 * The measure functions the editor offers. `percentile` is deliberately absent:
 * quantiles are what the `distribution` shape derives on its own (the compiler
 * rejects `aggregations` on it entirely), and a caller-spelled percentile may
 * not share a descriptor with any other function. Neither is a form field.
 */
export const MEASURE_FNS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;
export type MeasureFn = (typeof MEASURE_FNS)[number];

export const FILTER_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'like',
  'ilike',
  'is_null',
  'not_null',
  'between',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const BUCKET_UNITS = ['hour', 'day', 'week', 'month', 'quarter', 'year'] as const;

/** Ops that carry no operand — the value control hides for these. */
const VALUELESS_OPS: ReadonlySet<FilterOp> = new Set(['is_null', 'not_null']);
/** Ops whose operand is a list, entered as comma-separated text. */
const LIST_OPS: ReadonlySet<FilterOp> = new Set(['in', 'between']);

/**
 * The alias every generated measure carries (`candidates.ts` uses `value` for
 * all its single-measure rules, and the server's shaper reads that key back).
 */
export const MEASURE_ALIAS = 'value';

/** How a filter operand is typed back out of its text control. */
export type ValueKind = 'number' | 'boolean' | 'text';

export interface DraftFilter {
  column: string;
  op: FilterOp;
  /** Raw text as typed; coerced by {@link descriptorFromDraft} using {@link kind}. */
  value: string;
  kind: ValueKind;
}

/** The flat form state behind one `config.binding`. */
export interface BindingDraft {
  connectionId: string;
  /** pg schema; `''` for MySQL/SQLite, which omit it from the descriptor. */
  schema: string;
  table: string;
  sourceType: 'table' | 'view';
  shape: CompilableDataShape;
  measureFn: MeasureFn;
  /** `''` ⇔ `count(*)`. */
  measureColumn: string;
  /** Breakdown keys, positional: `[groupKey]`, or `[rowKey, columnKey]` for a matrix. */
  groupBy: string[];
  /** Time axis for the bucketed shapes. */
  bucketColumn: string;
  bucketUnit: BucketUnit;
  /** Rolling window; `metric+delta` compares it to the prior one. */
  windowColumn: string;
  windowLast: number;
  windowUnit: BucketUnit;
  /**
   * Projection. Positional for `calendar-events`
   * (`[date, title, category?, end?]`) and a single value column for
   * `distribution`; a plain column list for the row shapes.
   */
  select: string[];
  orderByColumn: string;
  orderByDir: 'asc' | 'desc';
  limit: number;
  filters: DraftFilter[];
}

/** Which control a {@link BindingDraft} is incomplete at. */
export type BindingIssue =
  | 'connection'
  | 'table'
  | 'measureColumn'
  | 'groupBy'
  | 'bucket'
  | 'window'
  | 'select'
  | 'filters';

export type BindingBuildResult =
  | { ok: true; descriptor: QueryDescriptor }
  | { ok: false; issues: BindingIssue[] };

/**
 * How the projection control behaves for a shape:
 *  - `none`   the shape aggregates and selects nothing;
 *  - `one`    exactly one value column (`distribution`);
 *  - `many`   a free column list (the row shapes);
 *  - `event`  the positional calendar mapping `[date, title, category?, end?]`
 *             — column ORDER names the roles, so this cannot be a checkbox set.
 */
export type SelectMode = 'none' | 'one' | 'many' | 'event';

/** Which controls a shape offers, and what it needs before it can be saved. */
export interface ShapeControls {
  /** Offers (and requires) an aggregation. */
  measure: boolean;
  /** Breakdown-key count the compiler demands. */
  groupBy: { min: number; max: number };
  /** Offers (and requires) a time bucket. */
  bucket: boolean;
  window: 'required' | 'optional' | 'off';
  select: SelectMode;
  /** Offers a sort — only meaningful where rows reach the widget. */
  order: boolean;
  /** Offers a row cap. Scalar shapes have nothing to cap. */
  limit: boolean;
  /** Default row cap, matching what the generator's rules emit. */
  defaultLimit: number;
}

const NO_GROUP = { min: 0, max: 0 } as const;
const ONE_GROUP = { min: 1, max: 1 } as const;

/**
 * Per-shape controls, mirroring the compiler's `assertShapeRules` clause for
 * clause. `satisfies` over the compilable set is the tripwire: widening
 * `COMPILABLE_DATA_SHAPES` (which is how the compiler announces a new shape)
 * turns a missing row here into a compile error rather than a shape the editor
 * silently cannot author.
 *
 * The `window` column is the one place this table is STRICTER than the server:
 * the compiler treats `window` as an ordinary WHERE range on any shape, but
 * choosing `metric+delta` in this editor *means* "compare to the prior period",
 * and without a window it produces exactly a `single-metric` — which the shape
 * picker offers one row up. Requiring it here keeps the two choices distinct.
 */
export const SHAPE_CONTROLS = {
  'single-metric': {
    measure: true,
    groupBy: NO_GROUP,
    bucket: false,
    window: 'optional',
    select: 'none',
    order: false,
    limit: false,
    defaultLimit: 100,
  },
  'metric+delta': {
    measure: true,
    groupBy: NO_GROUP,
    bucket: false,
    window: 'required',
    select: 'none',
    order: false,
    limit: false,
    defaultLimit: 100,
  },
  timeseries: {
    measure: true,
    groupBy: NO_GROUP,
    bucket: true,
    window: 'optional',
    select: 'none',
    order: false,
    limit: true,
    defaultLimit: 100,
  },
  'multi-timeseries': {
    measure: true,
    groupBy: ONE_GROUP,
    bucket: true,
    window: 'optional',
    select: 'none',
    order: false,
    limit: true,
    defaultLimit: 100,
  },
  categorical: {
    measure: true,
    groupBy: ONE_GROUP,
    bucket: false,
    window: 'off',
    select: 'none',
    order: false,
    limit: true,
    defaultLimit: 8,
  },
  matrix: {
    measure: true,
    groupBy: { min: 2, max: 2 },
    bucket: false,
    window: 'off',
    select: 'none',
    order: false,
    limit: true,
    defaultLimit: 100,
  },
  distribution: {
    // The compiler derives five fixed quantiles over `select[0]` and rejects a
    // descriptor that also carries `aggregations`.
    measure: false,
    groupBy: { min: 0, max: 1 },
    bucket: false,
    window: 'off',
    select: 'one',
    order: false,
    limit: false,
    defaultLimit: 100,
  },
  'record-list': {
    measure: false,
    groupBy: NO_GROUP,
    bucket: false,
    window: 'off',
    select: 'many',
    order: true,
    limit: true,
    defaultLimit: 50,
  },
  record: {
    measure: false,
    groupBy: NO_GROUP,
    bucket: false,
    window: 'off',
    select: 'many',
    order: true,
    // The server forces one row for `record`, so a cap control would lie.
    limit: false,
    defaultLimit: 1,
  },
  stream: {
    measure: false,
    groupBy: NO_GROUP,
    bucket: false,
    window: 'off',
    select: 'many',
    order: true,
    limit: true,
    defaultLimit: 50,
  },
  'calendar-events': {
    measure: false,
    groupBy: NO_GROUP,
    bucket: false,
    window: 'off',
    select: 'event',
    order: true,
    limit: true,
    defaultLimit: 500,
  },
} as const satisfies Record<CompilableDataShape, ShapeControls>;

export function controlsFor(shape: CompilableDataShape): ShapeControls {
  return SHAPE_CONTROLS[shape];
}

/** Positional roles of a `calendar-events` projection, in descriptor order. */
export const EVENT_SELECT_ROLES = ['date', 'title', 'category', 'end'] as const;
export type EventSelectRole = (typeof EVENT_SELECT_ROLES)[number];

/**
 * Shapes a widget accepts beyond its declared contract.
 *
 * `metric+delta` and `single-metric` are the same payload with two optional
 * keys — `asMetricDelta` (packages/widgets/src/lib/shapes.ts) reads `value` and
 * treats `prior`/`deltaPct` as absent-able — which is why the generator's
 * `kpi.count-total` rule already binds a `single-metric` descriptor to
 * `kpi-stat-card`, a widget whose `dataContract` says `metric+delta`. Offering
 * only the declared shape would leave the editor unable to author the binding
 * the product ships on every generated dashboard.
 */
const ALSO_ACCEPTS: Readonly<Partial<Record<DataShape, readonly DataShape[]>>> = {
  'metric+delta': ['single-metric'],
};

/**
 * The shapes this widget can be bound to today: its data contract, widened by
 * {@link ALSO_ACCEPTS}, narrowed to what the compiler can produce. Empty ⇔ the
 * widget's contract is outside the compiler's reach (04 §5.2) and no query can
 * feed it yet — the editor says so rather than offering a dead form.
 */
export function authorableShapes(contract: DataShape | DataShape[]): CompilableDataShape[] {
  const declared = Array.isArray(contract) ? contract : [contract];
  const out: CompilableDataShape[] = [];
  const push = (shape: DataShape): void => {
    if (isCompilableShape(shape) && !out.includes(shape)) out.push(shape);
  };
  for (const shape of declared) {
    push(shape);
    for (const extra of ALSO_ACCEPTS[shape] ?? []) push(extra);
  }
  // Stable order regardless of how the contract was declared — the shape picker
  // must not reorder itself between two widgets that accept the same set.
  return COMPILABLE_DATA_SHAPES.filter((shape) => out.includes(shape));
}

/** Whether the operand control applies to this operator. */
export function opTakesValue(op: FilterOp): boolean {
  return !VALUELESS_OPS.has(op);
}

/** A blank draft for a widget that has no binding yet. */
export function emptyDraft(connectionId: string, shape: CompilableDataShape): BindingDraft {
  return {
    connectionId,
    schema: '',
    table: '',
    sourceType: 'table',
    shape,
    measureFn: 'count',
    measureColumn: '',
    groupBy: [],
    bucketColumn: '',
    bucketUnit: 'month',
    windowColumn: '',
    windowLast: 30,
    windowUnit: 'day',
    select: [],
    orderByColumn: '',
    orderByDir: 'desc',
    limit: controlsFor(shape).defaultLimit,
    filters: [],
  };
}

/**
 * Re-key a draft onto another shape, keeping everything the new shape still has
 * a control for. Switching `categorical` → `timeseries` must not silently carry
 * a `groupBy` the compiler would then reject.
 */
export function withShape(draft: BindingDraft, shape: CompilableDataShape): BindingDraft {
  const controls = controlsFor(shape);
  return {
    ...draft,
    shape,
    groupBy: draft.groupBy.slice(0, controls.groupBy.max),
    ...(controls.measure ? {} : { measureFn: 'count' as const, measureColumn: '' }),
    ...(controls.bucket ? {} : { bucketColumn: '' }),
    ...(controls.window === 'off' ? { windowColumn: '' } : {}),
    ...(controls.select === 'none' ? { select: [] } : {}),
    ...(controls.order ? {} : { orderByColumn: '' }),
    limit: controls.defaultLimit,
  };
}

function valueKindOf(value: unknown): ValueKind {
  const sample = Array.isArray(value) ? value[0] : value;
  if (typeof sample === 'number') return 'number';
  if (typeof sample === 'boolean') return 'boolean';
  return 'text';
}

function valueTextOf(value: unknown): string {
  if (value === undefined || value === null) return '';
  return Array.isArray(value) ? value.map((entry) => String(entry)).join(', ') : String(value);
}

/**
 * Load an existing descriptor into the form. Anything the form cannot express
 * is dropped rather than silently mangled — {@link draftIsLossy} is what the
 * editor warns on before letting the user overwrite such a binding.
 */
export function draftFromDescriptor(descriptor: QueryDescriptor): BindingDraft {
  const shape: CompilableDataShape = isCompilableShape(descriptor.shape)
    ? descriptor.shape
    : 'single-metric';
  const base = emptyDraft(descriptor.connectionId, shape);
  const measure = descriptor.aggregations?.[0];
  const order = descriptor.orderBy?.[0];
  return {
    ...base,
    schema: descriptor.source.schema ?? '',
    table: descriptor.source.name,
    sourceType: descriptor.source.type,
    ...(measure !== undefined && (MEASURE_FNS as readonly string[]).includes(measure.fn)
      ? { measureFn: measure.fn as MeasureFn, measureColumn: measure.column ?? '' }
      : {}),
    groupBy: [...(descriptor.groupBy ?? [])],
    bucketColumn: descriptor.bucket?.column ?? '',
    bucketUnit: descriptor.bucket?.unit ?? base.bucketUnit,
    windowColumn: descriptor.window?.column ?? '',
    windowLast: descriptor.window?.last ?? base.windowLast,
    windowUnit: descriptor.window?.unit ?? base.windowUnit,
    select: [...(descriptor.select ?? [])],
    orderByColumn: order?.column ?? '',
    orderByDir: order?.dir ?? base.orderByDir,
    limit: descriptor.limit ?? base.limit,
    filters: (descriptor.filters ?? []).map((filter) => ({
      column: filter.column,
      op: filter.op,
      value: valueTextOf(filter.value),
      kind: valueKindOf(filter.value),
    })),
  };
}

/**
 * Whether {@link draftFromDescriptor} would lose part of this descriptor. The
 * LLM enrichment pass and the generator's `charts.duration-distribution` rule
 * emit multi-aggregation descriptors, and page controls publish `param`-bound
 * filters — none of which this form round-trips. The editor says so before the
 * user overwrites one.
 */
export function draftIsLossy(descriptor: QueryDescriptor): boolean {
  return (
    (descriptor.aggregations?.length ?? 0) > 1 ||
    (descriptor.orderBy?.length ?? 0) > 1 ||
    (descriptor.filters ?? []).some((filter) => filter.param !== undefined) ||
    descriptor.cursor !== undefined
  );
}

function coerceValue(raw: string, kind: ValueKind): unknown {
  if (kind === 'boolean') return raw.trim().toLowerCase() === 'true';
  if (kind === 'number') {
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
}

function toFilter(filter: DraftFilter): QueryFilter {
  if (!opTakesValue(filter.op)) return { column: filter.column, op: filter.op };
  if (LIST_OPS.has(filter.op)) {
    const parts = filter.value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    return {
      column: filter.column,
      op: filter.op,
      value: parts.map((part) => coerceValue(part, filter.kind)),
    };
  }
  return { column: filter.column, op: filter.op, value: coerceValue(filter.value, filter.kind) };
}

/**
 * The projection a shape stores, or `null` when the draft has not filled it in.
 *
 * `event` is positional, so a gap is a corruption rather than an omission: with
 * no category but an end column, the end lands in the category slot and the
 * calendar reads its own end date as a lane name. Hence the contiguity rule.
 */
function projectionOf(draft: BindingDraft, mode: SelectMode): string[] | null {
  if (mode === 'none') return [];
  const chosen = draft.select.map((column) => column ?? '');
  if (mode === 'one') {
    const column = chosen.find((entry) => entry !== '');
    return column === undefined ? null : [column];
  }
  if (mode === 'many') {
    const columns = chosen.filter((entry) => entry !== '');
    return columns.length === 0 ? null : columns;
  }
  const [date = '', title = '', category = '', end = ''] = chosen;
  if (date === '' || title === '') return null;
  if (category === '' && end !== '') return null;
  return [date, title, category, end].filter((entry) => entry !== '');
}

/**
 * Build the stored descriptor, or report which controls are still empty. The
 * per-shape requirements come from {@link SHAPE_CONTROLS}, so a shape can never
 * be validated against rules whose controls the editor did not render.
 */
export function descriptorFromDraft(draft: BindingDraft): BindingBuildResult {
  const controls = controlsFor(draft.shape);
  const issues: BindingIssue[] = [];

  const groupBy = draft.groupBy.slice(0, controls.groupBy.max).filter((column) => column !== '');
  const projection = projectionOf(draft, controls.select);

  if (draft.connectionId === '') issues.push('connection');
  if (draft.table === '') issues.push('table');
  // `count` is the only function with a `count(*)` form; every other one needs
  // its column, exactly as the compiler's `compileAggregation` requires.
  if (controls.measure && draft.measureFn !== 'count' && draft.measureColumn === '') {
    issues.push('measureColumn');
  }
  if (groupBy.length < controls.groupBy.min) issues.push('groupBy');
  if (controls.bucket && draft.bucketColumn === '') issues.push('bucket');
  if (controls.window === 'required' && draft.windowColumn === '') issues.push('window');
  if (projection === null) issues.push('select');
  if (draft.filters.some((filter) => filter.column === '')) issues.push('filters');
  if (issues.length > 0) return { ok: false, issues };

  const source: QueryDescriptor['source'] = { name: draft.table, type: draft.sourceType };
  if (draft.schema !== '') source.schema = draft.schema;

  const filters = draft.filters.map(toFilter);
  const window = controls.window !== 'off' && draft.windowColumn !== '';

  return {
    ok: true,
    descriptor: {
      kind: 'table-query',
      connectionId: draft.connectionId,
      source,
      shape: draft.shape,
      ...(controls.measure
        ? {
            aggregations: [
              draft.measureColumn === ''
                ? { fn: draft.measureFn, alias: MEASURE_ALIAS }
                : { fn: draft.measureFn, column: draft.measureColumn, alias: MEASURE_ALIAS },
            ],
          }
        : {}),
      ...(groupBy.length > 0 ? { groupBy } : {}),
      ...(controls.bucket ? { bucket: { column: draft.bucketColumn, unit: draft.bucketUnit } } : {}),
      ...(window
        ? {
            window: {
              column: draft.windowColumn,
              last: draft.windowLast,
              unit: draft.windowUnit,
              // The delta card's whole job; harmless (and unread) elsewhere.
              compareToPrior: draft.shape === 'metric+delta',
            },
          }
        : {}),
      ...((projection ?? []).length > 0 ? { select: projection as string[] } : {}),
      ...(controls.order && draft.orderByColumn !== ''
        ? { orderBy: [{ column: draft.orderByColumn, dir: draft.orderByDir }] }
        : {}),
      ...(controls.limit ? { limit: draft.limit } : {}),
      ...(filters.length > 0 ? { filters } : {}),
    },
  };
}

export interface BindingSummary {
  /** `public.orders`, or bare `orders` when the source carries no schema. */
  source: string;
  /** `count(*)` / `sum(total)`; null for the shapes that project instead. */
  measure: string | null;
  /** Projected column count for the projecting shapes; null otherwise. */
  columns: number | null;
  shape: DataShape;
  filterCount: number;
}

/**
 * Structural one-liner for the inspector's data-source row. Returns the parts
 * rather than a sentence — identifiers and SQL function names are not
 * translatable, but the words around them are, so the caller assembles.
 */
export function summarizeBinding(descriptor: QueryDescriptor): BindingSummary {
  const measure = descriptor.aggregations?.[0];
  return {
    source:
      descriptor.source.schema === undefined
        ? descriptor.source.name
        : `${descriptor.source.schema}.${descriptor.source.name}`,
    measure: measure === undefined ? null : `${measure.fn}(${measure.column ?? '*'})`,
    columns: measure === undefined ? (descriptor.select?.length ?? 0) : null,
    shape: descriptor.shape,
    filterCount: descriptor.filters?.length ?? 0,
  };
}
