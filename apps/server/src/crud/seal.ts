// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SEAL — a fingerprint of what somebody accepted (`column.stamp` of `hashOf`).
 *
 * When a proposal is accepted (or first signed), Adminium stores the SHA-256
 * of what it said at that moment: the named columns of the row, its child
 * rows (the lines), and a row it points at with that row's own children (the
 * terms version and its clauses). Anyone holding the same rows can work it
 * out again and compare — `fingerprintOf` is that check.
 *
 * It is the LAST step of the write that accepts: after the before hooks,
 * the formulas and every child row the same save wrote, inside the same
 * transaction — so it covers exactly what was stored, never what a hook or a
 * later line changed first. History (an import, sample data) is sealed by
 * nobody: a fingerprint says somebody accepted it here.
 *
 * ─── The canonical form (the same on every database) ───────────────────────
 *
 *   { "columns": { <name>: <value>, … },
 *     "children": [ [ { <name>: <value>, … }, … ], … ],   // in declared order
 *     "linked":   [ { "columns": {…}, "children": [ … ] }, … ] }
 *
 * - keys sorted, JSON with no spaces; the SHA-256 of its UTF-8 bytes, as
 *   lowercase hex;
 * - a decimal with a scale: exactly that many places (`12.50`), the
 *   currency's own for `currency` (the row's `currency`, else the
 *   connection's); a decimal without one: no trailing zeros (`12.5`); a whole
 *   number as digits — whatever the driver handed back (`"12.5000"`, `12.5`);
 * - a boolean `true` / `false` (SQLite and MySQL keep 1 / 0);
 * - a date `YYYY-MM-DD`; a moment in ISO 8601 UTC;
 * - text in Unicode NFC; an empty value `null`;
 * - child rows by their `orderBy` column, then by key.
 */
import { createHash } from 'node:crypto';

import { sql, type Kysely } from 'kysely';
import { ratioText, toRatio } from '@adminium/manifest';

import type { EffectiveColumn, HashChild, HashOf } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ColumnStamp } from './column-rules.js';
import { placesFor } from './formulas.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';
import { dayOf, instantOf } from './states.js';

type Db = Kysely<SourceDatabase>;

/** What a prepared row carries to its statement: the fingerprints it seals, and how to read what they cover. */
export interface SealPlan {
  view: SnapshotView;
  stamps: ColumnStamp[];
  /** The connection's currency, for a `currency` scale on a row that names none. */
  currency: string | null;
}

const SEALS = Symbol('adminium.seals');

type Carrier = Row & { [SEALS]?: SealPlan };

export function attachSeals<T extends Row>(row: T, plan: SealPlan): T {
  const out = { ...row } as T & Carrier;
  out[SEALS] = plan;
  return out;
}

export function sealsOf(row: Row): SealPlan | undefined {
  return (row as Carrier)[SEALS];
}

/** Sorted keys, no spaces: the same text for the same values on every run. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** No trailing zeros: `12.5000` and `12.5` are one decimal. */
function plainDecimal(value: unknown): string | null {
  const exact = toRatio(value);
  if (exact === null) return null;
  const text = ratioText(exact, 12);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** One value as the canonical form spells it. */
export function canonicalValue(column: Pick<EffectiveColumn, 'logicalType' | 'scale'> | undefined, value: unknown, row: Row, currency: string | null): unknown {
  if (value === null || value === undefined) return null;
  switch (column?.logicalType) {
    case 'integer':
    case 'bigint':
      return plainDecimal(value);
    case 'decimal':
    case 'float': {
      if (column.scale === undefined) return plainDecimal(value);
      const exact = toRatio(value);
      return exact === null ? String(value) : ratioText(exact, placesFor(column.scale, row, 'currency' in row ? 'currency' : undefined, currency));
    }
    case 'boolean':
      return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
    case 'date':
      return dayOf(value);
    case 'timestamp':
    case 'timestamptz': {
      // One spelling on every engine: the instant in UTC. SQLite hands back the
      // wall clock it was written in (this server's), Postgres and MySQL a Date.
      const at = instantOf(value);
      return at === null ? String(value) : new Date(at).toISOString();
    }
    case 'json':
      return typeof value === 'string' ? (() => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return value.normalize('NFC');
        }
      })() : value;
    default:
      return typeof value === 'string' ? value.normalize('NFC') : value instanceof Date ? value.toISOString() : value;
  }
}

function columnsOf(table: ResolvedTable, row: Row, names: readonly string[], currency: string | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of names) out[name] = canonicalValue(table.table?.columns.find((c) => c.name === name), row[name], row, currency);
  return out;
}

async function childrenOf(db: Db, view: SnapshotView, children: readonly HashChild[], key: unknown, currency: string | null): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const child of children) {
    const table = view.table(child.table);
    let query = db
      .selectFrom(table.id)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(child.via), '=', key));
    if (child.orderBy !== undefined) query = query.orderBy(sql`${sql.ref(child.orderBy)}`);
    for (const column of table.primaryKey) query = query.orderBy(sql`${sql.ref(column)}`);
    const rows = (await query.execute()) as Row[];
    out.push(rows.map((row) => columnsOf(table, row, child.columns, currency)));
  }
  return out;
}

/** The canonical document a fingerprint is the hash of. */
export async function fingerprintDocument(db: Db, view: SnapshotView, table: ResolvedTable, row: Row, hashOf: HashOf, currency: string | null): Promise<unknown> {
  const key = row[table.primaryKey[0] ?? ''];
  const linked: unknown[] = [];
  for (const link of hashOf.linked ?? []) {
    const relation = view.model.relations.find(
      (r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === link.via,
    );
    const pointsAt = row[link.via];
    const other = view.table(link.table);
    const found =
      relation === undefined || pointsAt === null || pointsAt === undefined
        ? undefined
        : ((await db
            .selectFrom(other.id)
            .selectAll()
            .where((eb) => eb(db.dynamic.ref(relation.to.columns[0] as string), '=', pointsAt))
            .executeTakeFirst()) as Row | undefined);
    linked.push(
      found === undefined
        ? null
        : { columns: columnsOf(other, found, link.columns, currency), children: await childrenOf(db, view, link.children ?? [], found[other.primaryKey[0] ?? ''], currency) },
    );
  }
  return {
    columns: columnsOf(table, row, hashOf.columns, currency),
    children: await childrenOf(db, view, hashOf.children ?? [], key, currency),
    linked,
  };
}

/** The fingerprint of a row as it is stored now: what a later check compares with the one sealed. */
export async function fingerprintOf(db: Db, view: SnapshotView, table: ResolvedTable, row: Row, hashOf: HashOf, currency: string | null): Promise<string> {
  const document = await fingerprintDocument(db, view, table, row, hashOf, currency);
  return createHash('sha256').update(canonical(document), 'utf8').digest('hex');
}

/**
 * SEAL the rows matching `match`: each fingerprint the write carries,
 * worked out over the row as it is now stored, and written beside it.
 */
/** Writes a row's fingerprints: the statement lives in the write service, the one place a source row is written. */
export type WriteSeals = (db: Db, table: ResolvedTable, key: Row, set: Record<string, string>) => Promise<void>;

export async function sealRows(db: Db, table: ResolvedTable, match: Row, plan: SealPlan | undefined, write: WriteSeals): Promise<void> {
  if (plan === undefined || plan.stamps.length === 0) return;
  let query = db.selectFrom(table.id).selectAll();
  for (const [column, value] of Object.entries(match)) query = query.where((eb) => eb(db.dynamic.ref(column), '=', value));
  for (const row of (await query.execute()) as Row[]) {
    const set: Record<string, string> = {};
    for (const stamp of plan.stamps) {
      if (typeof stamp.set !== 'object' || !('hashOf' in stamp.set)) continue;
      set[stamp.column] = await fingerprintOf(db, plan.view, table, row, stamp.set.hashOf, plan.currency);
    }
    if (Object.keys(set).length === 0) continue;
    await write(db, table, Object.fromEntries(table.primaryKey.map((column) => [column, row[column]])), set);
  }
}
