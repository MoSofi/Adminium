// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Measures — folds over the rows of a table whose FK points AT the row being
 * listed (36-derived-columns.md §3.4). The compiler behind BOTH projection
 * families: `agg=`'s row counts (up-converted, D15) and `compute=`'s
 * `sum`/`avg`/`min`/`max` over an expression.
 *
 * ONE RESOLVER, ONE COMPILER, ONE MASKING POLICY. `agg=` keeps its wire
 * grammar and its nine pinned tests (`crud/aggregates.ts` is now just that
 * parser); everything downstream of the parse happens here. A parallel legacy
 * path would drift, and the thing it would drift on is a permission check.
 *
 * WHAT A MEASURE COMPILES TO. One correlated scalar subquery per measure per
 * row — the outer query's namespace stays untouched, so filters, quick
 * search, sort, keyset cursors and the count query keep exactly their
 * single-table semantics. The fold body is a precedence-flat sum of signed
 * products emitted through a `sql` template interpolating `db.dynamic.ref`:
 *
 *     sum(("ag0"."qty" * "ag0"."rate") - ("ag0"."line_total"))
 *
 * That form is not a style choice. Measured against this repo's kysely
 * 0.29.5, `eb(dynamic.ref('a'), '*', dynamic.ref('b'))` compiles the
 * right-hand REFERENCE to a bound parameter, and nested `eb()` emits
 * `sum("a" + "b" * "c")` with no parentheses — a silently wrong money number.
 * The `sql` template is the shipped house form (`widget-data/compiler.ts`),
 * and parenthesizing every term makes mis-parenthesization structurally
 * impossible rather than merely absent (D5).
 *
 * WHAT NEVER REACHES THE SQL. Division: `sum(qty*rate*d/100)` returns 6
 * against a truth of 6.90 on SQLite integer storage, and `select 7/100` is 0
 * on Postgres. A constant divisor rides as `of.factor` and is applied AFTER
 * the fetch in exact BigInt, which `k·Σx = Σ(k·x)` licenses and which is
 * exact on all three dialects (D6). `emptyAs` is applied after the fetch too,
 * not as a `coalesce()`, so the emitted SQL is identical whatever it says and
 * "this invoice has no line items" stays a state distinct from "you may not
 * read that table" (D18).
 *
 * ACCESS is per REFERENCING table, degrade-don't-break: a measure over a
 * table the caller cannot read — or one that touches a masked column without
 * the unmask grant, or a SECRET column at all — resolves to `null` and is
 * listed in the row's `_masked` marker. Malformed specs and unknown
 * identifiers stay hard 422s: page-author mistakes that must surface.
 */

import { sql, type ExpressionBuilder, type Kysely, type RawBuilder } from 'kysely';

import {
  WORKING_SCALE,
  emptyPolicyOf,
  formatDecimal,
  mulDecimal,
  parseDecimal,
  type Decimal,
  type Measure,
  type MeasureEmpty,
  type MeasureFn,
} from '@adminium/engine/config';

import { ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';

/** One resolved term of a fold body: snapshot-owned column names only. */
export interface ResolvedTerm {
  sign: 'plus' | 'minus';
  factors: string[];
}

export interface ResolvedMeasure {
  alias: string;
  /** The referencing table (resolved snapshot identifiers). */
  refTable: ResolvedTable;
  /** Its single-column FK onto the source table. */
  fkColumn: string;
  /** The source-table column the FK references (usually its PK). */
  toColumn: string;
  fn: MeasureFn;
  /** Empty for `count`; otherwise the fold body, in emission order. */
  terms: ResolvedTerm[];
  /** Decimal string applied to the RESULT after the fetch, or null. */
  factor: string | null;
  emptyAs: MeasureEmpty;
  /** Caller-specific refusal (permission / masking) → `null` + `_masked`. */
  refused: boolean;
}

/**
 * The single-column inbound relation `refTable.fkColumn → base`, from the
 * effective model's relations (declared FKs, accepted overrides, inferred),
 * falling back to the column's `references` mirror. Returns the base-side
 * column the FK correlates on, or null when the column is not an FK onto
 * `base`.
 */
function inboundFk(
  view: SnapshotView,
  base: ResolvedTable,
  refTable: ResolvedTable,
  fkColumn: string,
): string | null {
  const candidates = view.model.relations.filter(
    (relation) =>
      relation.through === null &&
      relation.from.tableId === refTable.id &&
      relation.from.columns.length === 1 &&
      relation.from.columns[0] === fkColumn &&
      relation.to.tableId === base.id &&
      relation.to.columns.length === 1,
  );
  // Declared/override relations carry confidence 1 — prefer the surest.
  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  if (best !== undefined) return best.to.columns[0] as string;
  const mirror = refTable.table.columns.find((column) => column.name === fkColumn)?.references;
  return mirror != null && mirror.tableId === base.id ? mirror.column : null;
}

export interface ResolveMeasuresOptions {
  view: SnapshotView;
  table: ResolvedTable;
  /** Validated measure specs — from `compute=` or up-converted from `agg=`. */
  specs: readonly Measure[];
  canReadPii: boolean;
  /** Per-table read check (`table:<conn>:<id>:read`) for the referencing table. */
  canReadTable: (tableId: string) => Promise<boolean>;
  /** Called once per refusal, for the audit trail (D16). */
  onRefusal?: ((refusal: MeasureRefusal) => void) | undefined;
}

/** What was refused and why — the audit row's payload (36-T09). */
export interface MeasureRefusal {
  alias: string;
  table: string;
  reason: 'table-read' | 'masked-column' | 'secret-column';
}

/**
 * Resolve validated measure specs against the snapshot.
 *
 * Throws 422 for unknown tables/columns and non-inbound-FK columns; marks
 * caller-specific refusals (permissions, masking) as `refused` instead. The
 * ALIAS namespace is already settled by `parseCrudDerived` / the `agg=`
 * parser before anything gets here.
 */
export async function resolveMeasures(opts: ResolveMeasuresOptions): Promise<ResolvedMeasure[]> {
  const { view, table, specs, canReadPii, canReadTable, onRefusal } = opts;
  const measures: ResolvedMeasure[] = [];
  for (const spec of specs) {
    const refTable = view.table(spec.table); // 422 unknown
    const fkColumn = view.column(refTable, spec.fkColumn); // 422 unknown/secret
    const toColumn = inboundFk(view, table, refTable, spec.fkColumn);
    if (toColumn === null) {
      throw new ValidationFailedError(
        `Column ${JSON.stringify(spec.fkColumn)} on ${refTable.id} is not a single-column foreign key onto ${table.id}.`,
        { table: refTable.id, column: spec.fkColumn, target: table.id },
      );
    }

    /*
     * Every column that reaches the subquery joins the refusal check, not
     * just the FK: the aggregated columns are the ones whose values the
     * number actually discloses (D16). Two states, and they are not the same
     * state — which is the defect this closes. `columnPolicyFor` puts a
     * column in EITHER the secret set or the masked set, never both, so a
     * SECRET base-side correlate reads `masked: false` and used to refuse
     * nothing at all. Secret means nobody, unmask grant included (`maskRow`
     * drops secret columns even for admins); masked means nobody without the
     * grant.
     */
    let secretTouched = false;
    let maskedTouched = fkColumn.masked;
    const baseColumn = table.columns.get(toColumn);
    if (baseColumn?.secret === true) secretTouched = true;
    else if (baseColumn?.masked === true) maskedTouched = true;

    const terms: ResolvedTerm[] = [];
    for (const term of spec.of?.terms ?? []) {
      const factors: string[] = [];
      for (const factor of term.factors) {
        // 422 for unknown or secret: a factor is the client naming a column
        // it wants folded, and a secret column is invisible (05 §7.1 rule 1),
        // so naming one is an author mistake and not a degrade.
        const column = view.column(refTable, factor);
        maskedTouched ||= column.masked;
        factors.push(column.name);
      }
      terms.push({ sign: term.sign, factors });
    }

    let reason: MeasureRefusal['reason'] | null = null;
    if (secretTouched) reason = 'secret-column';
    else if (maskedTouched && !canReadPii) reason = 'masked-column';
    else if (!(await canReadTable(refTable.id))) reason = 'table-read';
    if (reason !== null) onRefusal?.({ alias: spec.id, table: refTable.id, reason });

    measures.push({
      alias: spec.id,
      refTable,
      fkColumn: fkColumn.name,
      toColumn,
      fn: spec.fn,
      terms,
      factor: spec.of?.factor ?? null,
      emptyAs: emptyPolicyOf(spec),
      refused: reason !== null,
    });
  }
  return measures;
}

/** `ag0`, `ag1`, … never colliding with the base table's addressable name. */
function tableAlias(base: ResolvedTable, index: number): string {
  const candidate = `ag${String(index)}`;
  return candidate === base.name ? `${candidate}_` : candidate;
}

/**
 * The fold body: `(a * b) - (c)`, every term parenthesized.
 *
 * The redundant parentheses on a single-factor term are the point. `×` binds
 * tighter than `+` in all three dialects, so a flat sum of parenthesized
 * products cannot be mis-grouped, and there is no case analysis to get wrong
 * later. Column references are qualified with the subquery's own alias: an
 * unqualified name would resolve to the OUTER table if the snapshot ever went
 * stale against the live schema, turning a missing column into a correlated
 * reference and a silently wrong number instead of a SQL error.
 */
function foldBody(
  dynamic: Kysely<SourceDatabase>['dynamic'],
  alias: string,
  terms: readonly ResolvedTerm[],
): RawBuilder<unknown> {
  const fragments = terms.map((term) =>
    sql`(${sql.join(
      term.factors.map((factor) => dynamic.ref(`${alias}.${factor}`)),
      sql` * `,
    )})`,
  );
  const first = fragments[0] as RawBuilder<unknown>;
  let body = (terms[0] as ResolvedTerm).sign === 'minus' ? sql`-${first}` : first;
  for (let i = 1; i < fragments.length; i += 1) {
    const next = fragments[i] as RawBuilder<unknown>;
    body = (terms[i] as ResolvedTerm).sign === 'minus' ? sql`${body} - ${next}` : sql`${body} + ${next}`;
  }
  return body;
}

/**
 * The SELECT-list expressions for the grantable measures — one correlated
 * scalar subquery each, correlating the referencing table's FK on the OUTER
 * table's bare name (`FROM schema.table` makes the table addressable by its
 * unqualified name in all three dialects). Refused ones compile to nothing —
 * {@link applyMeasureMask} nulls them after the fetch, so refused data never
 * even leaves the database.
 */
export function measureSelections(
  eb: ExpressionBuilder<SourceDatabase, string>,
  db: Kysely<SourceDatabase>,
  base: ResolvedTable,
  measures: readonly ResolvedMeasure[],
) {
  const dynamic = db.dynamic;
  return measures
    .filter((measure) => !measure.refused)
    .map((measure, index) => {
      const alias = tableAlias(base, index);
      return eb
        .selectFrom(`${measure.refTable.id} as ${alias}`)
        .select((inner) =>
          measure.fn === 'count'
            ? // Byte-identical to what `agg=count` has always emitted.
              inner.fn.countAll().as('n')
            : foldSelection(measure.fn, foldBody(dynamic, alias, measure.terms)).as('n'),
        )
        .whereRef(
          dynamic.ref(`${alias}.${measure.fkColumn}`),
          '=',
          dynamic.ref(`${base.name}.${measure.toColumn}`),
        )
        .as(measure.alias);
    });
}

function foldSelection(fn: MeasureFn, body: RawBuilder<unknown>): RawBuilder<unknown> {
  switch (fn) {
    case 'sum':
      return sql`sum(${body})`;
    case 'avg':
      return sql`avg(${body})`;
    case 'min':
      return sql`min(${body})`;
    default:
      return sql`max(${body})`;
  }
}

/**
 * COUNT comes back as BigInt from SQLite's driver and as an int8 STRING from
 * node-postgres — normalize to a plain number like base columns (safe-range
 * checked; a count past 2^53 keeps its string form rather than lying).
 */
function normalizeCount(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(-Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value;
  }
  return value;
}

/**
 * A driver value → the canonical decimal STRING every non-count measure
 * crosses the wire as.
 *
 * Postgres and MySQL hand every aggregate back as a string, SQLite hands back
 * a JS number, and the same seeded data must produce byte-identical output on
 * all three — so the driver's own spelling cannot be passed through. Trailing
 * zeros beyond the value are trimmed: this is the shortest EXACT
 * representation, and how many decimals to SHOW is the display layer's
 * decision (D8), not the wire's.
 */
export function canonicalDecimal(value: unknown): string | null {
  const parsed = parseDecimal(value);
  return parsed === null ? null : formatCanonical(parsed);
}

/**
 * An already-parsed {@link Decimal} in the same canonical shape.
 *
 * Separate from {@link canonicalDecimal} on purpose: a `Decimal` IS a bigint,
 * and `parseDecimal` reads a bigint as an integer count of units — so feeding
 * a parsed value back through the driver-value path multiplies it by 10^6.
 */
function formatCanonical(value: Decimal): string {
  const formatted = formatDecimal(value, WORKING_SCALE);
  return formatted.includes('.') ? formatted.replace(/0+$/, '').replace(/\.$/, '') : formatted;
}

/** The post-fetch value of one granted measure: factor, empty policy, shape. */
function measureValue(measure: ResolvedMeasure, raw: unknown): unknown {
  if (measure.fn === 'count') return normalizeCount(raw);
  if (raw === null || raw === undefined) {
    // An invoice with no line items reads $0.00; the average of nothing does
    // not read zero. Applied here, never as a coalesce in the SQL (D18).
    return measure.emptyAs === 'zero' ? '0' : null;
  }
  const parsed = parseDecimal(raw);
  if (parsed === null) return null;
  const factor = measure.factor === null ? null : parseDecimal(measure.factor);
  return formatCanonical(factor === null ? parsed : mulDecimal(parsed, factor));
}

/**
 * Post-fetch pass: normalize granted measures, null out refused aliases and
 * add them to the `_masked` marker (same shape `maskRow` writes) so the UI
 * renders the masked treatment instead of an empty cell that lies about being
 * empty.
 */
export function applyMeasureMask(rows: Row[], measures: readonly ResolvedMeasure[]): Row[] {
  if (measures.length === 0) return rows;
  const refused = measures.filter((measure) => measure.refused).map((measure) => measure.alias);
  const granted = measures.filter((measure) => !measure.refused);
  for (const row of rows) {
    for (const measure of granted) row[measure.alias] = measureValue(measure, row[measure.alias]);
    if (refused.length > 0) {
      for (const alias of refused) row[alias] = null;
      const marker = Array.isArray(row._masked) ? (row._masked as string[]) : [];
      row._masked = [...marker, ...refused];
    }
  }
  return rows;
}

/**
 * Fetch the measure values for ONE record (the single-record GET) — the same
 * expressions the list compiles, with the pk as the predicate. Returns the
 * alias → value map for grantable measures; refused ones are handled by
 * {@link applyMeasureMask} on the merged row.
 */
export async function fetchMeasureValues(
  db: Kysely<SourceDatabase>,
  table: ResolvedTable,
  pk: Row,
  measures: readonly ResolvedMeasure[],
): Promise<Row> {
  const granted = measures.filter((measure) => !measure.refused);
  if (granted.length === 0) return {};
  let qb = db
    .selectFrom(table.id)
    .select((eb) =>
      measureSelections(eb as ExpressionBuilder<SourceDatabase, string>, db, table, granted),
    );
  for (const [column, value] of Object.entries(pk)) {
    qb = qb.where((eb) => eb(db.dynamic.ref(column), '=', value));
  }
  const row = (await qb.executeTakeFirst()) as Row | undefined;
  const out: Row = {};
  for (const measure of granted) out[measure.alias] = row?.[measure.alias] ?? null;
  return out;
}
