// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S COPIES ON OTHER TABLES, ROW BY ROW: which rows of a copy table
 * are theirs, and which columns of each row. The search (`sources.ts`) finds
 * and downloads them with it; the erasure (`erase-rows.ts`) empties them.
 *
 * A row is theirs when one of the person's copies on it is:
 *  - a copy whose link names one of their rows;
 *  - an address copy that holds their address;
 *  - a phone copy that holds one of their phone numbers (a booking taken by
 *    phone, with no address and no link back). Their numbers are the phone
 *    columns of their own rows and the phone copies already found by a link
 *    or the address. Two numbers are the same when their digits are, or when
 *    one ends with the other's eight or more (a leading 0 or a country code).
 *
 * On such a row the columns that are theirs:
 *  - each copy found as above;
 *  - each other copy of the person on the row whose link is empty: nobody
 *    else is named by it (an unlinked enquiry's name, a booking's mobile);
 *  - when nobody else is on the row, every column marked (or guessed)
 *    personal: their own words on it (a stay's note, an enquiry's message).
 *
 * Somebody else is on the row when one of the person's copies links to
 * another row of the people table (a quote sent to Ben and accepted by
 * Marta), or an unlinked address copy holds another address. Then only the
 * copies that are theirs by a link, their address or their number go; the
 * rest of the row is the other person's too.
 *
 * Never a key, never a link, never a column another table's link points at,
 * never a secret. Reads only.
 */
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { DeclaredCopy } from '../people/declared.js';
import { rowKeyOf } from '../payments/payables.js';
import type { ErasedRole } from './erase-values.js';
import { isAddress } from './values.js';

/** One row of a copy table that is the person's, with the columns of it that are theirs. */
export interface TheirCopyRow {
  key: string;
  row: Row;
  /** Each column of theirs on the row, with what it is to them. */
  columns: Map<string, ErasedRole>;
  /** The links on the row that name one of their rows (the download shows them). */
  links: string[];
}

/** One copy table of one people entry: its copies, and the rows that are theirs. */
export interface TheirCopyTable {
  table: ResolvedTable;
  copies: DeclaredCopy[];
  rows: TheirCopyRow[];
}

export interface CopyRowsInput {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  /** The people entry's copies, by the copy table's id (as declared). */
  copies: readonly DeclaredCopy[];
  address: string;
  /** Their rows' key values on the people table: what a copy's link points at. */
  pks: readonly unknown[];
  /** Their own rows on the people table, as found: their phone columns give their numbers. */
  ownRows: readonly Row[];
  ownTable: ResolvedTable | null;
  /** Resolves a copy table by its declared id (null when it is gone). */
  tableOf: (id: string) => ResolvedTable | null;
  /** The most rows a table gives (the search's cap); none for the erasure. */
  limit?: number;
}

/** The fewest digits a number has to share at its end to be the same number written another way. */
const SAME_TAIL = 8;
/** The most digits one way of writing a number may add in front: a country code (a number from another country is not it). */
const MOST_IN_FRONT = 3;
/** The fewest digits a phone number has. */
const PHONE_MIN = 7;

/** A phone number's digits, without the leading zeros or a "(0)" after a country code; null when it holds too few to be a number. */
export function phoneDigits(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const digits = String(value).replace(/\(\s*0\s*\)/g, '').replace(/\D+/g, '').replace(/^0+/, '');
  return digits.length >= PHONE_MIN ? digits : null;
}

/** Whether two numbers' digits are the same number: equal, or one ending with eight or more of the other's and at most a country code in front. */
export function samePhone(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= SAME_TAIL && long.length - short.length <= MOST_IN_FRONT && long.endsWith(short);
}

const holdsPhone = (value: unknown, phones: readonly string[]): boolean => {
  const digits = phoneDigits(value);
  return digits !== null && phones.some((one) => samePhone(one, digits));
};

const isSet = (value: unknown): boolean => value !== null && value !== undefined && String(value).trim() !== '';

/** The columns any link of the model starts from or points at. */
export function linkColumnsOf(view: SnapshotView, tableId: string): Set<string> {
  const out = new Set<string>();
  for (const relation of view.model.relations) {
    if (relation.from.tableId === tableId) for (const column of relation.from.columns) out.add(column);
    if (relation.to.tableId === tableId) for (const column of relation.to.columns) out.add(column);
  }
  return out;
}

/** `column in (values)`, a chunk at a time so no engine meets too long a list. */
export function inList(column: string, values: readonly unknown[]): ReturnType<typeof sql<boolean>>[] {
  const out: ReturnType<typeof sql<boolean>>[] = [];
  for (let at = 0; at < values.length; at += 500) {
    out.push(sql<boolean>`${sql.ref(column)} in (${sql.join(values.slice(at, at + 500).map((value) => sql`${value as never}`))})`);
  }
  return out;
}

/** `lower(trim(column)) = address`. */
const addressIs = (column: string, address: string) => sql<boolean>`lower(trim(${sql.ref(column)})) = ${address}`;

async function rowsWhere(db: Kysely<SourceDatabase>, table: ResolvedTable, conditions: ReturnType<typeof sql<boolean>>[], limit: number | undefined): Promise<Row[]> {
  if (conditions.length === 0) return [];
  let query = db
    .selectFrom(table.id as never)
    .selectAll()
    .where(sql<boolean>`(${sql.join(conditions, sql` or `)})`);
  if (limit !== undefined) query = query.limit(limit);
  return (await query.execute()) as Row[];
}

/** The phone columns of a table, as the schema reads them. */
function phoneColumnsOf(table: ResolvedTable): string[] {
  return table.table.columns.filter((column) => column.semantics?.primary === 'phone' && table.columns.get(column.name)?.secret !== true).map((column) => column.name);
}

/** What of one row is theirs (see the header); null when nothing on it is. */
function judge(table: ResolvedTable, row: Row, copies: readonly DeclaredCopy[], pkSet: ReadonlySet<string>, address: string, phones: readonly string[], links: ReadonlySet<string>): TheirCopyRow | null {
  let matched = false;
  // Found by a link or the address: a shared number alone does not make a row theirs to empty.
  let surely = false;
  let someoneElse = false;
  const direct = new Set<string>();
  const linkedTo = new Set<string>();
  for (const copy of copies) {
    const via = copy.via === null ? null : row[copy.via];
    const linked = copy.via !== null && isSet(via) && pkSet.has(String(via));
    if (linked) linkedTo.add(copy.via!);
    if (copy.via !== null && isSet(via) && !linked) someoneElse = true;
    const value = row[copy.column];
    const holdsTheirs = (copy.holds === 'email' && isAddress(value, address)) || (copy.holds === 'phone' && holdsPhone(value, phones));
    if (linked || holdsTheirs) {
      matched = true;
      if (linked || copy.holds === 'email') surely = true;
      direct.add(copy.column);
    } else if (copy.holds === 'email' && !isSet(via) && isSet(value)) {
      // An unlinked address of somebody else's: the row is theirs too.
      someoneElse = true;
    }
  }
  if (!matched) return null;
  // Matched by the number alone (a household's or a switchboard's may be shared): the number goes, nothing else.
  if (!surely) someoneElse = true;
  const columns = new Map<string, ErasedRole>();
  const take = (column: string, role: ErasedRole) => {
    const resolved = table.columns.get(column);
    if (resolved === undefined || resolved.isPrimaryKey || resolved.secret || links.has(column) || columns.has(column)) return;
    columns.set(column, role);
  };
  for (const copy of copies) {
    const viaEmpty = copy.via === null || !isSet(row[copy.via]);
    if (direct.has(copy.column) || (!someoneElse && viaEmpty)) take(copy.column, copy.holds === 'email' ? 'email' : copy.holds === 'name' ? 'name' : 'other');
  }
  // Nobody else on the row: their own words on it go with them.
  if (!someoneElse) for (const column of table.columns.values()) if (column.masked) take(column.name, 'other');
  return { key: rowKeyOf(table, row), row, columns, links: [...linkedTo] };
}

/**
 * Every copy table of one people entry, with the rows of it that are the
 * person's (see the header). A table is left out when no row of it is.
 */
export async function theirCopyRows(input: CopyRowsInput): Promise<TheirCopyTable[]> {
  const { db, view, address, pks, limit } = input;
  const pkSet = new Set(pks.map((pk) => String(pk)));
  const byTable = new Map<string, DeclaredCopy[]>();
  for (const copy of input.copies) byTable.set(copy.table, [...(byTable.get(copy.table) ?? []), copy]);

  // Their numbers: their own rows' phone columns, then the phone copies a link or the address finds.
  const phones: string[] = [];
  const addPhone = (value: unknown) => {
    const digits = phoneDigits(value);
    if (digits !== null && !phones.includes(digits)) phones.push(digits);
  };
  if (input.ownTable !== null) for (const row of input.ownRows) for (const column of phoneColumnsOf(input.ownTable)) addPhone(row[column]);

  const out: TheirCopyTable[] = [];
  const tables: { table: ResolvedTable; copies: DeclaredCopy[]; links: Set<string>; rows: Map<string, TheirCopyRow> }[] = [];
  for (const [copyTableId, copies] of byTable) {
    const table = input.tableOf(copyTableId);
    if (table === null || table.primaryKey.length === 0) continue;
    const links = linkColumnsOf(view, table.id);
    const conditions = copies.flatMap((copy) => [...(copy.holds === 'email' ? [addressIs(copy.column, address)] : []), ...(copy.via !== null && pks.length > 0 ? inList(copy.via, pks) : [])]);
    const rows = new Map<string, TheirCopyRow>();
    for (const row of await rowsWhere(db, table, conditions, limit)) {
      const theirs = judge(table, row, copies, pkSet, address, phones, links);
      if (theirs === null) continue;
      rows.set(theirs.key, theirs);
      for (const copy of copies) if (copy.holds === 'phone' && theirs.columns.has(copy.column)) addPhone(row[copy.column]);
    }
    tables.push({ table, copies, links, rows });
  }

  // Rows found by their number alone: a booking with no address and no link back.
  if (phones.length > 0) {
    for (const held of tables) {
      const phoneCopies = held.copies.filter((copy) => copy.holds === 'phone');
      if (phoneCopies.length === 0 || held.table.primaryKey.length !== 1) continue;
      const pk = held.table.primaryKey[0]!;
      const candidates = (await db
        .selectFrom(held.table.id as never)
        .select([pk, ...new Set(phoneCopies.map((copy) => copy.column))] as never)
        .where(sql<boolean>`(${sql.join(
          phoneCopies.map((copy) => sql<boolean>`${sql.ref(copy.column)} is not null`),
          sql` or `,
        )})`)
        .execute()) as Row[];
      const keys = candidates.filter((row) => phoneCopies.some((copy) => holdsPhone(row[copy.column], phones))).map((row) => row[pk]);
      const fresh = keys.filter((key) => !held.rows.has(rowKeyOf(held.table, { [pk]: key })));
      if (fresh.length === 0) continue;
      const found = await rowsWhere(db, held.table, inList(pk, fresh), limit === undefined ? undefined : Math.max(0, limit - held.rows.size));
      for (const row of found) {
        const theirs = judge(held.table, row, held.copies, pkSet, address, phones, held.links);
        if (theirs !== null) held.rows.set(theirs.key, theirs);
      }
    }
  }

  for (const held of tables) if (held.rows.size > 0) out.push({ table: held.table, copies: held.copies, rows: [...held.rows.values()] });
  return out;
}
