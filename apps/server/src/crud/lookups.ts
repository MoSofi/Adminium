// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cross-table lookup columns for the CRUD read endpoints (`lookup=` on the
 * list and single-record GETs): follow an outbound FK chain from the source
 * table and alias one column of the reached table into each row, e.g.
 * `client_name:client_id.name` or two hops `company:client_id.company_id.name`.
 *
 * Wire grammar (one repeatable query param):
 *
 *     lookup=<alias>:<fkColumn>[.<fkColumn>…].<targetColumn>
 *
 * Every hop is a single-column outbound FK of the table reached so far,
 * resolved against the effective model's relations (declared FKs, accepted
 * overrides, inferred relations — composite FKs are refused). Identifiers that
 * reach SQL are the snapshot's own, per the §7 item-1 rule the rest of the
 * CRUD surface follows; the client's strings only ever select from allowlisted
 * maps.
 *
 * Compilation is a correlated scalar subquery per lookup (nested per hop), not
 * a JOIN — the outer query's namespace stays untouched, so filters, quick
 * search, sort, keyset cursors and the count query keep exactly their
 * single-table semantics. Referenced tables are aliased (`lk0`, `lk1`, …) so
 * self-referential FKs correlate correctly.
 *
 * Access is enforced per REACHED table, degrade-don't-break: a lookup whose
 * chain crosses a table the caller cannot read, or whose target (or any hop
 * column) is masked for a caller without the unmask grant, resolves to `null`
 * and is listed in the row's `_masked` marker — the page keeps rendering for
 * a low-privilege caller instead of 403ing wholesale. Malformed specs and
 * unknown/secret identifiers stay hard 422s: those are page-author mistakes
 * that must surface, not per-caller conditions.
 */

import type { ExpressionBuilder, Kysely } from 'kysely';

import { ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';

/** Most lookups one request may carry — a page has no business exceeding it. */
export const MAX_LOOKUPS = 12;
/** Max FK hops per lookup ("a third table" = 2; one spare). */
export const MAX_LOOKUP_HOPS = 3;

/** Aliases are row keys AND SQL aliases — keep them boring. */
const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export interface LookupHop {
  /** FK column on the table this hop leaves from. */
  fkColumn: string;
  /** Referenced table (resolved snapshot identifiers). */
  refTable: ResolvedTable;
  /** Referenced column (usually its PK). */
  refColumn: string;
}

export interface ResolvedLookup {
  alias: string;
  hops: LookupHop[];
  /** Column of the LAST hop's refTable whose value the alias carries. */
  target: ResolvedColumn;
  /** Caller-specific refusal (permission / masking) → `null` + `_masked`. */
  refused: boolean;
}

interface ParsedLookup {
  alias: string;
  /** FK column names, one per hop. */
  path: string[];
  /** Column of the final referenced table. */
  select: string;
}

function malformed(raw: string): never {
  throw new ValidationFailedError(
    '`lookup` must be `alias:fkColumn[.fkColumn…].targetColumn`.',
    { lookup: raw },
  );
}

function parseLookupSpec(raw: string): ParsedLookup {
  const colon = raw.indexOf(':');
  if (colon <= 0 || colon === raw.length - 1) malformed(raw);
  const alias = raw.slice(0, colon);
  if (!ALIAS_PATTERN.test(alias)) malformed(raw);
  const parts = raw.slice(colon + 1).split('.');
  if (parts.length < 2 || parts.some((part) => part.length === 0)) malformed(raw);
  const select = parts.at(-1) as string;
  const path = parts.slice(0, -1);
  if (path.length > MAX_LOOKUP_HOPS) {
    throw new ValidationFailedError(`At most ${String(MAX_LOOKUP_HOPS)} lookup hops.`, { lookup: raw });
  }
  return { alias, path, select };
}

/**
 * The single-column outbound FK of `table` on `fkColumn`, from the effective
 * model's relations (covers declared FKs, accepted `relation.add` overrides
 * and inferred relations), falling back to the column's `references` mirror.
 * Returns null when the column is not a usable FK.
 */
function outboundFk(
  view: SnapshotView,
  table: ResolvedTable,
  fkColumn: string,
): { tableId: string; column: string } | null {
  const candidates = view.model.relations.filter(
    (relation) =>
      relation.through === null &&
      relation.from.tableId === table.id &&
      relation.from.columns.length === 1 &&
      relation.from.columns[0] === fkColumn &&
      relation.to.columns.length === 1,
  );
  // Declared/override relations carry confidence 1 — prefer the surest.
  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  if (best !== undefined) {
    return { tableId: best.to.tableId, column: best.to.columns[0] as string };
  }
  const mirror = table.table.columns.find((column) => column.name === fkColumn)?.references;
  return mirror ?? null;
}

export interface ResolveLookupsOptions {
  view: SnapshotView;
  table: ResolvedTable;
  /** Raw `lookup=` values, in request order. */
  raw: readonly string[];
  canReadPii: boolean;
  /** Per-table read check (`table:<conn>:<id>:read`) for every reached table. */
  canReadTable: (tableId: string) => Promise<boolean>;
}

/**
 * Parse + resolve every `lookup=` param against the snapshot. Throws 422 for
 * malformed specs, unknown/secret identifiers, non-FK hops, alias collisions;
 * marks caller-specific refusals (permissions, masking) as `refused` instead.
 */
export async function resolveLookups(opts: ResolveLookupsOptions): Promise<ResolvedLookup[]> {
  const { view, table, raw, canReadPii, canReadTable } = opts;
  if (raw.length === 0) return [];
  if (raw.length > MAX_LOOKUPS) {
    throw new ValidationFailedError(`At most ${String(MAX_LOOKUPS)} lookups per request.`, {
      max: MAX_LOOKUPS,
    });
  }
  const lookups: ResolvedLookup[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const parsed = parseLookupSpec(entry);
    if (seen.has(parsed.alias)) {
      throw new ValidationFailedError(`Duplicate lookup alias ${JSON.stringify(parsed.alias)}.`, {
        alias: parsed.alias,
      });
    }
    seen.add(parsed.alias);
    if (table.columns.has(parsed.alias)) {
      // The alias would shadow a real row key — refuse rather than corrupt.
      throw new ValidationFailedError(
        `Lookup alias ${JSON.stringify(parsed.alias)} collides with a column of ${table.id}.`,
        { alias: parsed.alias, table: table.id },
      );
    }

    const hops: LookupHop[] = [];
    let current = table;
    let masked = false;
    for (const fkColumn of parsed.path) {
      const column = view.column(current, fkColumn); // 422 unknown/secret
      masked ||= column.masked;
      const ref = outboundFk(view, current, fkColumn);
      if (ref === null) {
        throw new ValidationFailedError(
          `Column ${JSON.stringify(fkColumn)} on ${current.id} is not a single-column foreign key.`,
          { table: current.id, column: fkColumn },
        );
      }
      const refTable = view.table(ref.tableId); // 422 if the snapshot lost it
      hops.push({ fkColumn, refTable, refColumn: ref.column });
      current = refTable;
    }

    const target = view.column(current, parsed.select); // 422 unknown/secret
    masked ||= target.masked;

    let refused = masked && !canReadPii;
    if (!refused) {
      for (const hop of hops) {
        if (!(await canReadTable(hop.refTable.id))) {
          refused = true;
          break;
        }
      }
    }

    lookups.push({ alias: parsed.alias, hops, target, refused });
  }
  return lookups;
}

/** `lk0`, `lk1`, … never colliding with the base table's addressable name. */
function hopAlias(base: ResolvedTable, index: number): string {
  const candidate = `lk${String(index)}`;
  return candidate === base.name ? `${candidate}_` : candidate;
}

/**
 * The correlated scalar subquery for one lookup — built outermost-hop first,
 * nesting toward the base row. Hop 0 correlates on the OUTER table's bare
 * name (`FROM schema.table` makes the table addressable by its unqualified
 * name in all three dialects); every referenced table is aliased so
 * self-referential chains bind unambiguously. A NULL FK at any hop yields
 * SQL NULL, exactly like an unmatched LEFT JOIN.
 */
function lookupExpression(
  eb: ExpressionBuilder<SourceDatabase, string>,
  db: Kysely<SourceDatabase>,
  base: ResolvedTable,
  lookup: ResolvedLookup,
  hopIndex: number,
) {
  const dynamic = db.dynamic;
  const hop = lookup.hops[hopIndex] as LookupHop;
  const alias = hopAlias(base, hopIndex);
  const isLast = hopIndex === lookup.hops.length - 1;
  const selectColumn = isLast
    ? lookup.target.name
    : (lookup.hops[hopIndex + 1] as LookupHop).fkColumn;

  let subquery = eb
    .selectFrom(`${hop.refTable.id} as ${alias}`)
    .select(dynamic.ref(`${alias}.${selectColumn}`))
    .limit(1);
  subquery =
    hopIndex === 0
      ? subquery.whereRef(
          dynamic.ref(`${alias}.${hop.refColumn}`),
          '=',
          dynamic.ref(`${base.name}.${hop.fkColumn}`),
        )
      : subquery.where(
          dynamic.ref(`${alias}.${hop.refColumn}`),
          '=',
          lookupExpression(eb, db, base, lookup, hopIndex - 1),
        );
  return subquery;
}

/**
 * The SELECT-list expressions for the grantable lookups. Refused ones compile
 * to nothing — {@link applyLookupMask} nulls them after the fetch, so refused
 * data never even leaves the database.
 */
export function lookupSelections(
  eb: ExpressionBuilder<SourceDatabase, string>,
  db: Kysely<SourceDatabase>,
  base: ResolvedTable,
  lookups: readonly ResolvedLookup[],
) {
  return lookups
    .filter((lookup) => !lookup.refused)
    .map((lookup) => lookupExpression(eb, db, base, lookup, lookup.hops.length - 1).as(lookup.alias));
}

/** SQLite's driver may hand back BigInt for integer lookups — normalize like base columns. */
function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(-Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  return value;
}

/**
 * Post-fetch pass over MASKED rows: null out refused aliases and add them to
 * the `_masked` marker (same shape `maskRow` writes) so the UI renders the
 * masked treatment instead of an empty cell that lies about being empty.
 */
export function applyLookupMask(rows: Row[], lookups: readonly ResolvedLookup[]): Row[] {
  if (lookups.length === 0) return rows;
  const refused = lookups.filter((lookup) => lookup.refused).map((lookup) => lookup.alias);
  const granted = lookups.filter((lookup) => !lookup.refused).map((lookup) => lookup.alias);
  for (const row of rows) {
    for (const alias of granted) row[alias] = normalizeValue(row[alias]);
    if (refused.length > 0) {
      for (const alias of refused) row[alias] = null;
      const marker = Array.isArray(row._masked) ? (row._masked as string[]) : [];
      row._masked = [...marker, ...refused];
    }
  }
  return rows;
}

/**
 * Fetch the lookup values for ONE record (the single-record GET) — the same
 * expressions the list compiles, with the pk as the predicate. Returns the
 * alias → value map for grantable lookups; refused ones are handled by
 * {@link applyLookupMask} on the merged row.
 */
export async function fetchLookupValues(
  db: Kysely<SourceDatabase>,
  table: ResolvedTable,
  pk: Row,
  lookups: readonly ResolvedLookup[],
): Promise<Row> {
  const granted = lookups.filter((lookup) => !lookup.refused);
  if (granted.length === 0) return {};
  let qb = db
    .selectFrom(table.id)
    .select((eb) => lookupSelections(eb as ExpressionBuilder<SourceDatabase, string>, db, table, granted));
  for (const [column, value] of Object.entries(pk)) {
    qb = qb.where((eb) => eb(db.dynamic.ref(column), '=', value));
  }
  const row = (await qb.executeTakeFirst()) as Row | undefined;
  const out: Row = {};
  for (const lookup of granted) out[lookup.alias] = row?.[lookup.alias] ?? null;
  return out;
}
