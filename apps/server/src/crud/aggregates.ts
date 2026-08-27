// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reverse-link aggregate columns for the CRUD read endpoints (`agg=` on the
 * list and single-record GETs): count the rows of a table whose FK points AT
 * the source table, aliased into each row — the inbound complement of
 * `lookup=` (crud/lookups.ts), e.g. `item_count:invoice_items.invoice_id:count`
 * on an invoices list.
 *
 * Wire grammar (one repeatable query param):
 *
 *     agg=<alias>:<table>.<fkColumn>:<aggregate>
 *
 * `<table>` is the REFERENCING table (qualified or default-schema bare name),
 * `<fkColumn>` its single-column FK onto the source table, and `<aggregate>`
 * is `count` — the token is parsed as a closed set so `sum(column)`/`min`/
 * `max` can extend the grammar without changing its shape. The relation is
 * validated against the effective model's inbound relations (declared FKs,
 * accepted overrides, inferred), falling back to the column's `references`
 * mirror, exactly like lookups' outbound resolution; identifiers that reach
 * SQL are the snapshot's own (§7 item-1), the client's strings only select
 * from allowlisted maps.
 *
 * Compilation is a correlated scalar COUNT subquery per aggregate — the outer
 * query's namespace stays untouched, so filters, quick search, sort, keyset
 * cursors and the count query keep exactly their single-table semantics. One
 * subquery per aggregate per row is the honest cost ceiling; fine at the
 * dashboard's ≤200-row pages, not a general analytics surface.
 *
 * Access is enforced per REFERENCING table, degrade-don't-break: an aggregate
 * over a table the caller cannot read — or whose FK column (or the base-side
 * column it correlates on) is masked for a caller without the unmask grant —
 * resolves to `null` and is listed in the row's `_masked` marker. A row count
 * is derived data; refusing it when the underlying rows are unreadable keeps
 * the permission boundary honest. Malformed specs and unknown/secret
 * identifiers stay hard 422s: page-author mistakes that must surface.
 */

import type { ExpressionBuilder, Kysely } from 'kysely';

import { ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';

/** Most aggregates one request may carry — mirrors lookups' MAX_LOOKUPS. */
export const MAX_AGGREGATES = 12;

/** The closed aggregate vocabulary; v1 ships `count` only. */
export const AGGREGATE_KINDS = ['count'] as const;
export type AggregateKind = (typeof AGGREGATE_KINDS)[number];

/** Aliases are row keys AND SQL aliases — keep them boring (lookups.ts). */
const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export interface ResolvedAggregate {
  alias: string;
  /** The referencing table (resolved snapshot identifiers). */
  refTable: ResolvedTable;
  /** Its single-column FK onto the source table. */
  fkColumn: string;
  /** The source-table column the FK references (usually its PK). */
  toColumn: string;
  agg: AggregateKind;
  /** Caller-specific refusal (permission / masking) → `null` + `_masked`. */
  refused: boolean;
}

interface ParsedAggregate {
  alias: string;
  table: string;
  fkColumn: string;
  agg: string;
}

function malformed(raw: string): never {
  throw new ValidationFailedError('`agg` must be `alias:table.fkColumn:aggregate`.', {
    agg: raw,
  });
}

function parseAggregateSpec(raw: string): ParsedAggregate {
  const firstColon = raw.indexOf(':');
  if (firstColon <= 0) malformed(raw);
  const alias = raw.slice(0, firstColon);
  if (!ALIAS_PATTERN.test(alias)) malformed(raw);
  const rest = raw.slice(firstColon + 1);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0 || lastColon === rest.length - 1) malformed(raw);
  const target = rest.slice(0, lastColon);
  const agg = rest.slice(lastColon + 1);
  // Qualified table names carry dots ("public.invoice_items") — the LAST dot
  // separates the FK column from the table name.
  const lastDot = target.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === target.length - 1) malformed(raw);
  return {
    alias,
    table: target.slice(0, lastDot),
    fkColumn: target.slice(lastDot + 1),
    agg,
  };
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

export interface ResolveAggregatesOptions {
  view: SnapshotView;
  table: ResolvedTable;
  /** Raw `agg=` values, in request order. */
  raw: readonly string[];
  canReadPii: boolean;
  /** Per-table read check (`table:<conn>:<id>:read`) for the referencing table. */
  canReadTable: (tableId: string) => Promise<boolean>;
  /** Aliases already claimed by this request's `lookup=` params. */
  takenAliases?: ReadonlySet<string> | undefined;
}

/**
 * Parse + resolve every `agg=` param against the snapshot. Throws 422 for
 * malformed specs, unsupported aggregates, unknown/secret identifiers,
 * non-inbound-FK columns, alias collisions (base columns, lookup aliases,
 * other aggregates); marks caller-specific refusals (permissions, masking)
 * as `refused` instead.
 */
export async function resolveAggregates(opts: ResolveAggregatesOptions): Promise<ResolvedAggregate[]> {
  const { view, table, raw, canReadPii, canReadTable } = opts;
  if (raw.length === 0) return [];
  if (raw.length > MAX_AGGREGATES) {
    throw new ValidationFailedError(`At most ${String(MAX_AGGREGATES)} aggregates per request.`, {
      max: MAX_AGGREGATES,
    });
  }
  const aggregates: ResolvedAggregate[] = [];
  const seen = new Set<string>(opts.takenAliases ?? []);
  for (const entry of raw) {
    const parsed = parseAggregateSpec(entry);
    if (!(AGGREGATE_KINDS as readonly string[]).includes(parsed.agg)) {
      throw new ValidationFailedError(
        `Unsupported aggregate ${JSON.stringify(parsed.agg)} — supported: ${AGGREGATE_KINDS.join(', ')}.`,
        { agg: parsed.agg },
      );
    }
    if (seen.has(parsed.alias)) {
      throw new ValidationFailedError(`Duplicate alias ${JSON.stringify(parsed.alias)}.`, {
        alias: parsed.alias,
      });
    }
    seen.add(parsed.alias);
    if (table.columns.has(parsed.alias)) {
      // The alias would shadow a real row key — refuse rather than corrupt.
      throw new ValidationFailedError(
        `Aggregate alias ${JSON.stringify(parsed.alias)} collides with a column of ${table.id}.`,
        { alias: parsed.alias, table: table.id },
      );
    }

    const refTable = view.table(parsed.table); // 422 unknown
    const fkColumn = view.column(refTable, parsed.fkColumn); // 422 unknown/secret
    const toColumn = inboundFk(view, table, refTable, parsed.fkColumn);
    if (toColumn === null) {
      throw new ValidationFailedError(
        `Column ${JSON.stringify(parsed.fkColumn)} on ${refTable.id} is not a single-column foreign key onto ${table.id}.`,
        { table: refTable.id, column: parsed.fkColumn, target: table.id },
      );
    }

    // A count over rows selected by a masked column derives from data the
    // caller may not read — same conservatism as lookups' masked hops.
    const masked = fkColumn.masked || table.columns.get(toColumn)?.masked === true;
    const refused = (masked && !canReadPii) || !(await canReadTable(refTable.id));

    aggregates.push({
      alias: parsed.alias,
      refTable,
      fkColumn: parsed.fkColumn,
      toColumn,
      agg: parsed.agg as AggregateKind,
      refused,
    });
  }
  return aggregates;
}

/** `ag0`, `ag1`, … never colliding with the base table's addressable name. */
function tableAlias(base: ResolvedTable, index: number): string {
  const candidate = `ag${String(index)}`;
  return candidate === base.name ? `${candidate}_` : candidate;
}

/**
 * The SELECT-list expressions for the grantable aggregates — one correlated
 * scalar COUNT subquery each, correlating the referencing table's FK on the
 * OUTER table's bare name (`FROM schema.table` makes the table addressable by
 * its unqualified name in all three dialects). Refused ones compile to
 * nothing — {@link applyAggregateMask} nulls them after the fetch, so refused
 * data never even leaves the database.
 */
export function aggregateSelections(
  eb: ExpressionBuilder<SourceDatabase, string>,
  db: Kysely<SourceDatabase>,
  base: ResolvedTable,
  aggregates: readonly ResolvedAggregate[],
) {
  const dynamic = db.dynamic;
  return aggregates
    .filter((aggregate) => !aggregate.refused)
    .map((aggregate, index) => {
      const alias = tableAlias(base, index);
      return eb
        .selectFrom(`${aggregate.refTable.id} as ${alias}`)
        .select((inner) => inner.fn.countAll().as('n'))
        .whereRef(
          dynamic.ref(`${alias}.${aggregate.fkColumn}`),
          '=',
          dynamic.ref(`${base.name}.${aggregate.toColumn}`),
        )
        .as(aggregate.alias);
    });
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
 * Post-fetch pass: normalize granted counts, null out refused aliases and add
 * them to the `_masked` marker (same shape `maskRow` writes) so the UI renders
 * the masked treatment instead of an empty cell that lies about being empty.
 */
export function applyAggregateMask(rows: Row[], aggregates: readonly ResolvedAggregate[]): Row[] {
  if (aggregates.length === 0) return rows;
  const refused = aggregates.filter((aggregate) => aggregate.refused).map((aggregate) => aggregate.alias);
  const granted = aggregates.filter((aggregate) => !aggregate.refused).map((aggregate) => aggregate.alias);
  for (const row of rows) {
    for (const alias of granted) row[alias] = normalizeCount(row[alias]);
    if (refused.length > 0) {
      for (const alias of refused) row[alias] = null;
      const marker = Array.isArray(row._masked) ? (row._masked as string[]) : [];
      row._masked = [...marker, ...refused];
    }
  }
  return rows;
}

/**
 * Fetch the aggregate values for ONE record (the single-record GET) — the
 * same expressions the list compiles, with the pk as the predicate. Returns
 * the alias → value map for grantable aggregates; refused ones are handled by
 * {@link applyAggregateMask} on the merged row.
 */
export async function fetchAggregateValues(
  db: Kysely<SourceDatabase>,
  table: ResolvedTable,
  pk: Row,
  aggregates: readonly ResolvedAggregate[],
): Promise<Row> {
  const granted = aggregates.filter((aggregate) => !aggregate.refused);
  if (granted.length === 0) return {};
  let qb = db
    .selectFrom(table.id)
    .select((eb) => aggregateSelections(eb as ExpressionBuilder<SourceDatabase, string>, db, table, granted));
  for (const [column, value] of Object.entries(pk)) {
    qb = qb.where((eb) => eb(db.dynamic.ref(column), '=', value));
  }
  const row = (await qb.executeTakeFirst()) as Row | undefined;
  const out: Row = {};
  for (const aggregate of granted) out[aggregate.alias] = row?.[aggregate.alias] ?? null;
  return out;
}
