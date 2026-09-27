// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE LIVE HOLD PER BUYER: a new hold replaces the buyer's old one, in the
 * same write.
 *
 * A guest who goes back and changes their tickets holds new ones; the places
 * the first hold took are let go at once, rather than counted until its time
 * runs out. "The buyer" is proved, never typed: the page's own-link session
 * (the one the create that made the old hold answered, or one opened by its
 * emailed link) — which then follows the page to the new hold, so a page that
 * sends the same session twice still holds once — or a signed-in person's
 * verified session (their other holds). An address typed into a create
 * touches nobody else's hold: otherwise anyone knowing a fan's address could
 * release their seats during an on-sale.
 *
 * Letting a hold go brings its end forward to just before the new write
 * began: it stops counting by the clock, as a hold whose time ran out does, and the
 * timed move that follows a lapse (held → expired) moves it on its next round,
 * with everything that move does. Only a hold whose end is a column of the row
 * itself can be brought forward; a hold read through another row is left.
 *
 * Races: the old rows are read holding them, inside the new write's
 * transaction, after every row outside it is held — the named locks, the
 * person's lock, the totals and parents the new rows climb into — as the
 * write's own rows are (the one lock order: a hold's timed lapse, which holds
 * the order's totals and then the order, never meets this write crosswise).
 * Two creates of one signed-in person queue on the person's lock on
 * Postgres, and on the rows themselves on MySQL (a locking read sees the
 * newest committed hold); SQLite has one writer. Two creates sent with one
 * page session queue on the row it points at: the session is moved to the
 * new hold inside the first write, so the second, once it holds that row,
 * finds the session moved on, follows it to the first's new hold and lets
 * that one go instead.
 */
import { createHash } from 'node:crypto';

import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { SourceDatabase } from '../connections/manager.js';
import { ownedRules, rulesFor, stateColumn } from '../crud/capacity/rules.js';
import { writeConflict } from '../crud/db-errors.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { readInstant } from '../crud/moments.js';
import { bindWriteValue } from '../crud/write-values.js';

type Db = Kysely<SourceDatabase>;

/** A hold a row of this table carries: the column its state is in, the hold's states, and the column its end is. */
export interface RowHold {
  state: string;
  states: readonly string[];
  end: string;
}

/** The holds rows of this table carry, by their own columns (a held order's, whether it counts itself or its tickets). */
export function holdsOf(view: SnapshotView, table: ResolvedTable): RowHold[] {
  const out = new Map<string, { state: string; states: Set<string>; end: string }>();
  const add = (state: string | null, states: readonly string[], end: string) => {
    if (state === null) return;
    const key = `${state}\u0000${end}`;
    const known = out.get(key) ?? { state, states: new Set<string>(), end };
    for (const value of states) known.states.add(value);
    out.set(key, known);
  };
  for (const rule of rulesFor(view, table)) {
    const hold = rule.hold;
    if (hold?.level !== 'own' || hold.ends.length !== 1 || hold.ends[0]!.link !== null) continue;
    add(stateColumn(rule, 'own'), hold.states, hold.ends[0]!.column);
  }
  for (const owned of ownedRules(view, table)) {
    const hold = owned.rule.hold;
    if (owned.reads !== 'owner' || hold?.level !== 'owner' || hold.ends.length !== 1 || hold.ends[0]!.link !== null) continue;
    add(stateColumn(owned.rule, 'owner'), hold.states, hold.ends[0]!.column);
  }
  return [...out.values()].map((hold) => ({ state: hold.state, states: [...hold.states], end: hold.end }));
}

/** Whether a row holds, by one of these holds, at `at`: in a hold state, its end not yet come (no end holds). */
export function liveHold(holds: readonly RowHold[], row: Row, at: Date): boolean {
  return holds.some((hold) => {
    if (!hold.states.includes(String(row[hold.state]))) return false;
    const end = readInstant(row[hold.end]);
    return end === null || end.getTime() > at.getTime();
  });
}

/** The name of the Postgres lock one person's holds are replaced under. */
export function buyerLockName(connectionId: string, tableId: string, person: unknown): string {
  return `buyer|${connectionId}|${tableId}|${createHash('sha256').update(String(person)).digest('hex')}`;
}

export interface ReplaceInput {
  db: Db;
  dialect: Dialect;
  connectionId: string;
  table: ResolvedTable;
  holds: readonly RowHold[];
  /** When the new write began: what a let-go hold's end is brought forward to (never after the write's own clock). */
  begun: Date;
  /** A signed-in buyer: their other holds, by the table's column that names them. */
  person?: { column: string; value: unknown } | undefined;
  /**
   * The page's own-link session: the key of the row it points at now, read
   * afresh each time — and the row it named when the request came in, let go
   * whatever the session says since (a write that failed may have moved it on
   * to a hold that is not there, and back only later).
   */
  page?: { rowKey: () => Promise<unknown>; initial?: unknown } | undefined;
}

/**
 * The rows a new hold would let go, read as they are — no row held, no lock
 * taken: a quote judges its places as if they were let go, and a limit on
 * how many a buyer has open leaves them out.
 */
export async function heldToReplace(input: Omit<ReplaceInput, 'page'> & { page?: { key: unknown } | undefined }): Promise<Row[]> {
  const { db, table, holds, begun } = input;
  const key = table.primaryKey[0];
  if (holds.length === 0 || key === undefined || table.primaryKey.length !== 1) return [];
  const found: Row[] = [];
  if (input.person !== undefined) {
    const states = [...new Set(holds.flatMap((hold) => hold.states))];
    const stateColumns = [...new Set(holds.map((hold) => hold.state))];
    let query = db.selectFrom(table.id).selectAll().where(db.dynamic.ref(input.person.column), '=', input.person.value as never);
    query = query.where((eb) => eb.or(stateColumns.map((column) => eb(eb.ref(column as never), 'in', states as never))));
    found.push(...((await query.orderBy(key as never).execute()) as Row[]));
  }
  const at = input.page?.key;
  if (at !== null && at !== undefined && !found.some((row) => String(row[key]) === String(at))) {
    const row = (await db.selectFrom(table.id).selectAll().where(db.dynamic.ref(key), '=', at as never).executeTakeFirst()) as Row | undefined;
    if (row !== undefined) found.push(row);
  }
  return found.filter((row) => liveHold(holds, row, begun));
}

/** A hold let go as a new hold lets it go: its end a whole second before the new write began. */
export function letGo(holds: readonly RowHold[], row: Row, begun: Date): Row {
  const out = { ...row };
  const at = new Date(Math.floor(begun.getTime() / 1000) * 1000 - 1000);
  for (const hold of holds) if (hold.states.includes(String(row[hold.state]))) out[hold.end] = at;
  return out;
}

/**
 * One signed-in person's creates, one at a time (Postgres): the next one
 * reads the holds the last one made. Taken with the person's lock, before any
 * row is held; {@link replaceHolds} then reads their holds in the own rows' place.
 */
export async function holdBuyer(input: Pick<ReplaceInput, 'db' | 'dialect' | 'connectionId' | 'table' | 'holds' | 'person'>): Promise<void> {
  if (input.dialect !== 'postgres' || input.person === undefined || input.holds.length === 0) return;
  await sql`select pg_advisory_xact_lock(hashtextextended(${buyerLockName(input.connectionId, input.table.id, input.person.value)}, 0))`.execute(input.db);
}

/**
 * Let the buyer's other holds go, inside the new write's transaction and
 * before anything of it is counted. Returns how many were let go.
 */
export async function replaceHolds(input: ReplaceInput): Promise<number> {
  const { db, dialect, table, holds, begun } = input;
  const key = table.primaryKey[0];
  if (holds.length === 0 || key === undefined || table.primaryKey.length !== 1) return 0;
  const locked = <Q extends { forUpdate: () => Q; forNoKeyUpdate: () => Q }>(query: Q): Q =>
    dialect === 'postgres' ? query.forNoKeyUpdate() : dialect === 'mysql' ? query.forUpdate() : query;
  const found: Row[] = [];
  if (input.person !== undefined) {
    // Queued already on the person's lock ({@link holdBuyer}); taken again here for a caller that did not (re-entrant).
    if (dialect === 'postgres') await sql`select pg_advisory_xact_lock(hashtextextended(${buyerLockName(input.connectionId, table.id, input.person.value)}, 0))`.execute(db);
    const states = [...new Set(holds.flatMap((hold) => hold.states))];
    const stateColumns = [...new Set(holds.map((hold) => hold.state))];
    let query = db.selectFrom(table.id).selectAll().where(db.dynamic.ref(input.person.column), '=', input.person.value as never);
    query = query.where((eb) => eb.or(stateColumns.map((column) => eb(eb.ref(column as never), 'in', states as never))));
    found.push(...((await locked(query.orderBy(key as never)).execute()) as Row[]));
  }
  if (input.page !== undefined) {
    // The row the session named when the request came in, held first: let go whatever the session points at since.
    const initial = input.page.initial;
    if (initial !== null && initial !== undefined && !found.some((other) => String(other[key]) === String(initial))) {
      const row = (await locked(db.selectFrom(table.id).selectAll().where(db.dynamic.ref(key), '=', initial as never)).executeTakeFirst()) as Row | undefined;
      if (row !== undefined) found.push(row);
    }
    // The row the page's session points at, held; then asked again: a create sent with the same session a moment
    // earlier may have moved it on to its own new hold while this one waited — then that one is the page's hold.
    let at = await input.page.rowKey();
    for (let tries = 0; at !== null && at !== undefined; tries += 1) {
      if (tries === 3) throw writeConflict();
      const row = (await locked(db.selectFrom(table.id).selectAll().where(db.dynamic.ref(key), '=', at as never)).executeTakeFirst()) as Row | undefined;
      const now = await input.page.rowKey();
      if (String(now) !== String(at)) {
        at = now;
        continue;
      }
      if (row !== undefined && !found.some((other) => String(other[key]) === String(row[key]))) found.push(row);
      break;
    }
  }
  let released = 0;
  for (const row of found) {
    if (!liveHold(holds, row, begun)) continue;
    // A whole second before the write began: a column that keeps no fractions rounds (MySQL rounds up), never past it.
    const at = new Date(Math.floor(begun.getTime() / 1000) * 1000 - 1000).toISOString();
    for (const hold of holds) {
      if (!hold.states.includes(String(row[hold.state]))) continue;
      const column = table.columns.get(hold.end);
      if (column === undefined) continue;
      await db
        .updateTable(table.id)
        .set({ [hold.end]: bindWriteValue(column, at, dialect) } as never)
        .where(db.dynamic.ref(key), '=', row[key] as never)
        .execute();
    }
    released += 1;
  }
  return released;
}
