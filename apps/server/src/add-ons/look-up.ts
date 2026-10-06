// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE TYPED VALUE, LOOKED UP ACROSS AN ADD-ON'S CODE TABLES (`addOn.lookUp`).
 *
 * A desk types or scans a code — a card's, a voucher's, a discount word — or
 * a customer's address. Adminium, not the add-on's code, finds the row: by
 * the routing word the value starts with, else among the kinds that have
 * none, else as a bare scanned code. The answer is rows, never a judgement:
 * what the found row holds of the columns the add-on listed (`show`), as far
 * as the caller's own role reads them, and the kind's history.
 *
 * What no answer ever holds: the code itself (the page shows what was
 * typed), a secret, a code staff never see, a column outside `show`, a column
 * the caller's role does not read, a personal column in clear for somebody
 * who may not read personal data. "Nothing has this value", "it is in a table
 * you may not read" and "this is not a code at all" are one answer.
 *
 * Plain reads, one after another, on the pool: no transaction, no lock, no
 * write.
 */
import { addOnManifestSchema, lookUpOf, type LookUp, type LookUpKind, type Manifest } from '@adminium/manifest';
import { appTablesRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { sql, type Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { canonicalCode, findByCode, plausibleCode, routeTypedCode, spellingOf, type CodeSpelling } from '../crud/code-lookup.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { staffInstants } from '../crud/instants.js';
import { canReadPii, maskRow, type Row } from '../crud/mask.js';
import { readViewFor } from '../crud/read-view.js';
import { booleanOf, sameValue } from '../crud/write-values.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { AppError, NotFoundError } from '../errors.js';

export interface LookUpDeps {
  meta: MetaDb;
  manager: ConnectionManager;
}

export type LookUpAnswer =
  | { found: false }
  | {
      found: true;
      /** The matched kind's id; the word `address` for an address match. */
      kind: string;
      by: 'code' | 'address';
      /** The add-on's own name for the table. */
      table: string;
      key: string;
      /** Of the stored code, cut here; null for a row found by an address. */
      last4: string | null;
      record: Row;
      /** The kind's history, newest first; null when it declares none or the caller may not read it. */
      rows: Row[] | null;
      /** An address only: how many further rows it matched. */
      more?: number;
    };

const NOT_FOUND: LookUpAnswer = { found: false };
const HISTORY_ROWS = 50;
/** An address as one is kept: something, an at, a host with a dot. */
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Reader {
  db: Kysely<SourceDatabase>;
  dialect: Awaited<ReturnType<ConnectionManager['data']>>['dialect'];
  request: FastifyRequest;
  connectionId: string;
  readView: SnapshotView;
  /** One of the add-on's own tables, or null when it is not there. */
  tableOf(ref: string): ResolvedTable | null;
  mayRead(table: ResolvedTable): Promise<boolean>;
}

/** Whether a found row is this kind's: each condition on it holds. */
function meets(row: Row, where: LookUpKind['where']): boolean {
  for (const condition of where ?? []) {
    const value = row[condition.column];
    const one = (wanted: unknown): boolean => sameValue(typeof wanted === 'boolean' ? booleanOf(value) : value, wanted);
    if (condition.eq !== undefined ? !one(condition.eq) : !(condition.in ?? []).some(one)) return false;
  }
  return true;
}

/** The listed columns of a row, as this caller reads the table: hidden ones left out, personal ones masked, no code ever. */
async function shown(reader: Reader, table: ResolvedTable, row: Row, columns: readonly string[]): Promise<Row> {
  const readTable = reader.readView.table(table.id);
  const masked = staffInstants(maskRow(row, readTable, await canReadPii(reader.request, reader.connectionId, table.id)), readTable, reader.dialect);
  const out: Row = {};
  for (const name of columns) {
    const column = readTable.columns.get(name);
    const rule = table.table?.columns.find((candidate) => candidate.name === name);
    if (column === undefined || column.unreadable === true || rule?.code !== undefined) continue;
    out[name] = masked[name];
  }
  return out;
}

/** A kind's history for one row: the listed columns the caller reads, newest first. */
async function historyOf(reader: Reader, rows: LookUpKind['rows'], key: unknown): Promise<Row[] | null> {
  if (rows === undefined) return null;
  const table = reader.tableOf(rows.table);
  if (table === null || table.primaryKey.length !== 1 || !(await reader.mayRead(table))) return null;
  const found = await reader.db
    .selectFrom(table.id as never)
    .selectAll()
    .where(sql.ref(rows.via), '=', key as never)
    .orderBy(sql.ref(table.primaryKey[0]!), 'desc')
    .limit(HISTORY_ROWS)
    .execute();
  const out: Row[] = [];
  for (const row of found as Row[]) out.push(await shown(reader, table, row, rows.columns));
  return out;
}

/** The last four letters or digits of a stored code. */
function lastFour(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const bare = code.replace(/[^0-9A-Za-z]/g, '');
  return bare === '' ? null : bare.slice(-4).toUpperCase();
}

async function byCode(reader: Reader, lookUp: LookUp, typed: string): Promise<LookUpAnswer> {
  const canonical = canonicalCode(typed);
  // Text that could be no code makes no query at all.
  if (!plausibleCode(canonical)) return NOT_FOUND;
  const kinds: { kind: LookUpKind; table: ResolvedTable; prefix?: string | undefined; spelling: CodeSpelling }[] = [];
  for (const kind of lookUp.kinds) {
    const table = reader.tableOf(kind.table);
    if (table === null || table.primaryKey.length !== 1) continue;
    kinds.push({ kind, table, prefix: kind.prefix, spelling: spellingOf(table.table?.columns.find((column) => column.name === kind.code)) });
  }
  for (const { kind: at, needle } of routeTypedCode(canonical, kinds)) {
    // A table the caller may not read answers as a code nobody has.
    if (needle === '' || !(await reader.mayRead(at.table))) continue;
    const row = await findByCode(reader.db, at.table.id, at.kind.code, at.spelling, needle);
    // A row of another kind kept in the same table (a pack typed as a voucher) is not this kind's.
    if (row === null || !meets(row, at.kind.where)) continue;
    const key = row[at.table.primaryKey[0]!];
    return {
      found: true,
      kind: at.kind.id,
      by: 'code',
      table: at.kind.table,
      key: String(key),
      // Of a code Adminium made. A word an owner typed in may be four letters long: the page shows what was typed.
      last4: 'made' in at.spelling ? lastFour(row[at.kind.code]) : null,
      record: await shown(reader, at.table, row, at.kind.show),
      rows: await historyOf(reader, at.kind.rows, key),
    };
  }
  return NOT_FOUND;
}

async function byAddress(reader: Reader, lookUp: LookUp, typed: string): Promise<LookUpAnswer> {
  const address = lookUp.address!;
  const wanted = typed.toLowerCase();
  const table = reader.tableOf(address.table);
  if (!ADDRESS.test(wanted) || table === null || table.primaryKey.length !== 1 || !(await reader.mayRead(table))) return NOT_FOUND;
  // A column the caller's role does not read is not theirs to search by either, as a list's filter on it is refused.
  const searched = reader.readView.table(table.id).columns.get(address.column);
  if (searched === undefined || searched.unreadable === true) return NOT_FOUND;
  const key = table.primaryKey[0]!;
  // One more than is answered, so the page can say there are others.
  const found = (await reader.db.selectFrom(table.id as never).selectAll().where(sql.ref(address.column), '=', wanted as never).orderBy(sql.ref(key), 'asc').limit(2).execute()) as Row[];
  const row = found[0];
  if (row === undefined) return NOT_FOUND;
  // Credit has the history of the kind kept in the same table: the first that declares one.
  const history = lookUp.kinds.find((kind) => kind.table === address.table && kind.rows !== undefined)?.rows;
  return {
    found: true,
    kind: 'address',
    by: 'address',
    table: address.table,
    key: String(row[key]),
    last4: null,
    record: await shown(reader, table, row, address.show),
    rows: await historyOf(reader, history, row[key]),
    ...(found.length > 1 ? { more: found.length - 1 } : {}),
  };
}

/**
 * Looks one typed value up for the caller of `request`. 404 when the add-on
 * is not installed or declares no look-up; 409 `FEATURE_OFF` while it is
 * switched off, being updated or broken — its tables can still be read, and a
 * look-up into it would be the one door left open.
 */
export async function lookUp(deps: LookUpDeps, request: FastifyRequest, addOnKey: string, value: string): Promise<LookUpAnswer> {
  const row = await deps.meta.db.selectFrom('adminium_manifests').select(['manifest', 'status', 'connectionId']).where('manifestKey', '=', addOnKey).where('kind', '=', 'add-on').executeTakeFirst();
  const parsed = row === undefined ? null : addOnManifestSchema.safeParse(typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest);
  const declared = parsed?.success === true ? lookUpOf(parsed.data as unknown as Manifest) : null;
  if (row === undefined || declared === null || row.connectionId === null) throw new NotFoundError('This add-on has no look-up here.', { addOn: addOnKey });
  if (row.status !== 'installed') throw new AppError(409, 'FEATURE_OFF', 'This add-on is not available right now.', { addOn: addOnKey, status: row.status });

  const connectionId = row.connectionId;
  const view = await loadSnapshotView(deps.meta, connectionId);
  const records = (await appTablesRepo(deps.meta).forConnection(connectionId)).filter((record) => record.appKey === addOnKey && (record.state === 'created' || record.state === 'adopted'));
  const { db, dialect } = await deps.manager.data(connectionId);
  const reader: Reader = {
    db,
    dialect,
    request,
    connectionId,
    readView: await readViewFor(request, view),
    tableOf(ref) {
      const record = records.find((candidate) => candidate.ref === ref);
      const model = record === undefined ? undefined : view.model.tables.find((table) => table.name === record.tableName);
      if (model === undefined) return null;
      try {
        return view.table(model.id);
      } catch {
        // A table that is there and not served (an owner left it out): as if it were not there.
        return null;
      }
    },
    mayRead: (table) => request.can(`table:${connectionId}:${table.id}:read`),
  };
  const typed = value.trim();
  if (typed === '') return NOT_FOUND;
  if (typed.includes('@')) return declared.address === undefined ? NOT_FOUND : byAddress(reader, declared, typed);
  return byCode(reader, declared, typed);
}
