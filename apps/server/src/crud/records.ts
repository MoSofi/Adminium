/**
 * Single-record helpers for the CRUD routes (08-server-api.md §2.7.2):
 * `:recordId` parsing (JSON tuple for composite PKs), PK-filtered fetches,
 * and the inbound-FK reference counts behind the cascade preflight.
 */

import type { Kysely } from 'kysely';

import { ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';

/** Coerce a path-segment string to the column's JS type for binding. */
function coerce(value: unknown, logicalType: string): unknown {
  if (typeof value !== 'string') return value;
  if (logicalType === 'integer' || logicalType === 'bigint') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  if (logicalType === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

/**
 * Parse `:recordId` into a full PK map. Single-column PKs take the raw
 * segment; composite PKs take a JSON-encoded object (`{"order_id":1,…}`)
 * or tuple aligned with the snapshot's PK column order.
 */
export function parseRecordId(table: ResolvedTable, raw: string): Row {
  if (table.primaryKey.length === 0) {
    throw new ValidationFailedError('Table has no primary key — record routes are unavailable.', {
      table: table.id,
    });
  }
  if (table.primaryKey.length === 1) {
    const pkName = table.primaryKey[0] as string;
    const column = table.columns.get(pkName);
    return { [pkName]: coerce(raw, column?.logicalType ?? 'text') };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationFailedError('Composite PK record ids are JSON-encoded.', { table: table.id });
  }
  const pk: Row = {};
  if (Array.isArray(parsed)) {
    if (parsed.length !== table.primaryKey.length) {
      throw new ValidationFailedError('PK tuple arity mismatch.', { expected: table.primaryKey });
    }
    table.primaryKey.forEach((name, i) => {
      pk[name] = parsed[i];
    });
    return pk;
  }
  if (typeof parsed === 'object' && parsed !== null) {
    for (const name of table.primaryKey) {
      const value = (parsed as Row)[name];
      if (value === undefined) {
        throw new ValidationFailedError(`PK component ${JSON.stringify(name)} missing.`, {
          expected: table.primaryKey,
        });
      }
      pk[name] = value;
    }
    return pk;
  }
  throw new ValidationFailedError('Composite PK record ids are JSON objects or tuples.', {
    table: table.id,
  });
}

/** Stable string form of a PK map (audit labels, bulk results). */
export function pkLabel(table: ResolvedTable, pk: Row): string {
  if (table.primaryKey.length === 1) return String(pk[table.primaryKey[0] as string]);
  return JSON.stringify(table.primaryKey.map((name) => pk[name]));
}

type Db = Kysely<SourceDatabase>;

export async function fetchByPk(db: Db, table: ResolvedTable, pk: Row): Promise<Row | undefined> {
  let qb = db.selectFrom(table.id).selectAll();
  for (const [column, value] of Object.entries(pk)) {
    qb = qb.where((eb) => eb(db.dynamic.ref(column), '=', value));
  }
  const row = await qb.executeTakeFirst();
  return row as Row | undefined;
}

export async function fetchManyByPk(db: Db, table: ResolvedTable, pks: Row[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const pk of pks) {
    const row = await fetchByPk(db, table, pk);
    if (row !== undefined) rows.push(row);
  }
  return rows;
}

export interface ReferenceCount {
  relationId: string;
  table: string;
  column: string;
  count: number;
}

/**
 * Inbound-FK counts for the cascade preflight
 * (`GET /data/:conn/:table/:id/references`, `DELETE ?dryRun=true`).
 */
export async function referenceCounts(
  db: Db,
  view: SnapshotView,
  table: ResolvedTable,
  pk: Row,
): Promise<ReferenceCount[]> {
  const out: ReferenceCount[] = [];
  for (const relation of view.inboundRelations(table)) {
    // Only count single-column FKs whose target is part of this PK (v1).
    const toColumn = relation.toColumns[0];
    const fromColumn = relation.fromColumns[0];
    if (toColumn === undefined || fromColumn === undefined) continue;
    const value = pk[toColumn] ?? (await fetchByPk(db, table, pk))?.[toColumn];
    if (value === undefined) continue;
    // Both identifiers come from the snapshot's relation graph, never the client.
    const row = await db
      .selectFrom(relation.fromTable)
      .select((eb) => eb.fn.countAll().as('count'))
      .where((eb) => eb(db.dynamic.ref(fromColumn), '=', value))
      .executeTakeFirst();
    out.push({
      relationId: relation.relationId,
      table: relation.fromTable,
      column: fromColumn,
      count: Number((row as { count?: unknown } | undefined)?.count ?? 0),
    });
  }
  return out;
}
