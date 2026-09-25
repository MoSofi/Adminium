// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NUMBERS WITHOUT GAPS — `column.sequence { gapless }` and the text written
 * from it (`column.format`, `INV-0042`).
 *
 * A tax office expects an unbroken series: no number twice, none skipped. The
 * meta store's counter (`decided-columns.ts`) cannot promise that — a create
 * that fails after its claim leaves a gap — so a gapless number is not
 * counted anywhere. It is the largest number the table holds (per parent row,
 * with `scope`) plus one, floored by the start, TAKEN INSIDE THE TRANSACTION
 * THAT INSERTS THE ROW, right before its INSERT. A failed insert rolls its
 * number back with it, and the next create takes the same one.
 *
 * Every create path reaches the INSERT through `insertRow` / `insertRows`,
 * whoever opened the transaction — a single create, a parent form's child
 * rows, "repeat" rows, the public batch, an import, the sample load. So the
 * claim lives there, and the path only has to have prepared the row through
 * the write service (`check`, `beforeEach` or `create`), which attaches what
 * the claim needs: the resolved start and prefix, read from their settings
 * before any transaction opened. A row with nothing attached (an undo putting
 * a row back with its own number) claims nothing.
 *
 * Two writers must never read the same largest number. How each engine holds
 * the others off:
 *
 *  - Postgres: `pg_advisory_xact_lock` on the series' name, which joins an
 *    open transaction and is released by its commit. The largest number is
 *    read after the lock, in a statement of its own, so it sees what the
 *    previous holder committed.
 *  - SQLite: one writer at a time; a write outside a transaction takes the
 *    write lock up front (`BEGIN IMMEDIATE`).
 *  - MySQL, outside a transaction: `GET_LOCK` around a transaction of its
 *    own, released after the commit (`withNamedLock`).
 *  - MySQL, inside a caller's transaction: a named lock cannot be held until
 *    a commit somebody else makes, and a locking read of the largest number
 *    (`… order by n desc limit 1 for update`) was PROVED on two real
 *    connections at MySQL's default isolation to deadlock one of every two
 *    concurrent writers — both take the gap lock above the largest row, and
 *    both then insert into it. So the claim is made against the series'
 *    UNIQUE INDEX instead: insert the next number the transaction can see,
 *    and on a duplicate of that index (MySQL keeps the transaction open after
 *    one) try the number after it. A duplicate of a number another writer has
 *    not committed yet WAITS for that writer: a rolled-back claim is taken
 *    again, never skipped. A table whose series has no unique index falls
 *    back to the locking read, where a deadlock answers 409 `NUMBER_BUSY`.
 *
 * An import is history (it brings its own numbers): nothing is claimed. Its
 * text keeps its number, and the number column takes the text's digits when
 * the text is the table's prefix followed by digits; the series then carries
 * on after the largest.
 */
import { createHash } from 'node:crypto';

import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { SourceDatabase } from '../connections/manager.js';
import { AppError } from '../errors.js';
import { inTransaction, withNamedLock } from './capacity-guard.js';
import type { GaplessSequence, TableRules } from './column-rules.js';
import { isUniqueViolation } from './decided-columns.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import { settingValue, type RuleSettingsReader } from './rule-settings.js';
import type { WriteAction, WriteOrigin } from './write-context.js';

type Db = Kysely<SourceDatabase>;

/** One number to take at the INSERT, with its start and prefix already read. */
interface Claim {
  sequence: GaplessSequence;
  start: number;
  prefix: string;
}

/**
 * Carried on the prepared row itself, so it reaches the INSERT through every
 * caller's hands. A symbol: no column is ever called that, and neither a
 * statement nor a JSON copy of the row (an undo entry) sees it.
 */
const CLAIMS = Symbol('adminium.gapless-claims');

type Carrier = Row & { [CLAIMS]?: readonly Claim[] };

/** How many duplicates a MySQL claim steps past before it gives up. */
const MAX_STEPS = 200;

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);

/** A whole number from a setting or a stored value; null for anything else. */
function wholeNumber(value: unknown): number | null {
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : Math.floor(n);
}

/** The text a number is written as: the prefix, then the digits padded with zeros. */
export function formatNumber(prefix: string, pad: number, n: number): string {
  return `${prefix}${String(n).padStart(pad, '0')}`;
}

/** The number in a text written the table's way (`INV-0042` → 42), or null. */
export function numberFromText(prefix: string, text: unknown): number | null {
  if (typeof text !== 'string' || !text.startsWith(prefix)) return null;
  const digits = text.slice(prefix.length);
  return /^\d{1,15}$/.test(digits) ? Number(digits) : null;
}

async function prefixOf(db: Db, sequence: GaplessSequence, reader: RuleSettingsReader | undefined): Promise<string> {
  const format = sequence.format;
  if (format === undefined) return '';
  if (format.prefixSetting !== undefined) {
    const value = await settingValue(db, format.prefixSetting, reader);
    if (typeof value === 'string') return value;
  }
  return format.prefix ?? '';
}

/**
 * NUMBER, the preparing half: run where a row is checked, before any
 * transaction opens. A create on a gapless table is given what its INSERT
 * will need to take the number; an import's row keeps its number, its digits
 * read into the number column. Returns the values to carry on (the same
 * object when there is nothing to do).
 */
export async function prepareNumbers(
  rules: TableRules | null,
  action: WriteAction,
  target: { db: Db },
  values: Row,
  origin: WriteOrigin,
  reader: RuleSettingsReader | undefined,
): Promise<Row> {
  const sequences = action === 'create' ? (rules?.gapless ?? []) : [];
  if (sequences.length === 0) return values;
  if (origin === 'import') {
    let out: Row | null = null;
    for (const sequence of sequences) {
      const format = sequence.format;
      // An explicit number, even an empty one (a sample row's `null`), is what the row says.
      if (has(values, sequence.column) || format === undefined) continue;
      const n = numberFromText(await prefixOf(target.db, sequence, reader), values[format.column]);
      out ??= { ...values };
      out[sequence.column] = n;
    }
    return out ?? values;
  }
  const claims: Claim[] = [];
  for (const sequence of sequences) {
    const setting = sequence.startSetting === undefined ? null : wholeNumber(await settingValue(target.db, sequence.startSetting, reader));
    claims.push({ sequence, start: Math.max(sequence.start, setting ?? 0, 1), prefix: await prefixOf(target.db, sequence, reader) });
  }
  const out: Carrier = { ...values };
  out[CLAIMS] = claims;
  return out;
}

/** Whether a prepared row still has a number to take at its INSERT. */
export function claimsNumbers(row: Row): boolean {
  return ((row as Carrier)[CLAIMS]?.length ?? 0) > 0;
}

/** The name the series is locked by: the table and column, and the parent row for a per-parent series. */
function seriesName(table: ResolvedTable, sequence: GaplessSequence, row: Row): string {
  const scope = sequence.scope === undefined ? '' : `:${JSON.stringify(row[sequence.scope] ?? null)}`;
  return `gapless:${table.id}.${sequence.column}${scope}`;
}

/**
 * The series a row of this table WILL take a number in, from the table's
 * rules rather than a prepared row: a parent form's child rows are prepared
 * inside the transaction, and their series must be held before it opens. A
 * per-parent series is named only when the row already says its parent.
 */
export function seriesOf(rules: TableRules | null, table: ResolvedTable, row: Row): string[] {
  return (rules?.gapless ?? [])
    .filter((sequence) => sequence.scope === undefined || (row[sequence.scope] !== undefined && row[sequence.scope] !== null))
    .map((sequence) => seriesName(table, sequence, row));
}

/** One name for every series a row takes a number in (a table with two is rare; one lock covers both). */
export function numberLockName(table: ResolvedTable, row: Row): string | null {
  const claims = (row as Carrier)[CLAIMS] ?? [];
  if (claims.length === 0) return null;
  return claims.map((claim) => seriesName(table, claim.sequence, row)).join('|');
}

/** How long a writer waits for a series another writer holds (MySQL's `GET_LOCK`), in seconds. */
const SERIES_WAIT_SECONDS = 10;

/**
 * One transaction for rows a caller prepared and is about to insert, holding
 * the lock of every series they take a number in until it commits. On MySQL
 * the named locks are taken BEFORE the transaction opens, on the connection
 * that then runs it — a named lock cannot be held until a commit somebody
 * else makes. On Postgres each INSERT takes its series' transaction lock
 * itself; SQLite has one writer.
 */
export async function withSeriesLocks<T>(db: Db, dialect: Dialect, series: readonly string[], run: (db: Db) => Promise<T>): Promise<T> {
  // In one order, so two writers holding the same two series never wait on each other crosswise.
  const names = [...new Set(series)].sort();
  if (dialect !== 'mysql' || names.length === 0 || inTransaction(db)) {
    return inTransaction(db) ? run(db) : db.transaction().execute(run);
  }
  return db.connection().execute(async (conn) => {
    const held: string[] = [];
    try {
      for (const name of names) {
        // MySQL's lock names stop at 64 characters.
        const key = `adm:${createHash('sha1').update(name).digest('hex')}`;
        const got = (await sql<{ got: number | null }>`select get_lock(${key}, ${SERIES_WAIT_SECONDS}) as got`.execute(conn)).rows[0]?.got;
        if (Number(got) !== 1) throw numberBusy();
        held.push(key);
      }
      return await conn.transaction().execute(run);
    } finally {
      for (const key of held) await sql`select release_lock(${key})`.execute(conn);
    }
  });
}

/** The rows of this series: the whole table, or one parent's rows. */
function inSeries(sequence: GaplessSequence, row: Row) {
  if (sequence.scope === undefined) return sql<boolean>`1 = 1`;
  const parent = row[sequence.scope];
  return parent === null || parent === undefined
    ? sql<boolean>`${sql.ref(sequence.scope)} is null`
    : sql<boolean>`${sql.ref(sequence.scope)} = ${parent}`;
}

/** The largest number in the series now, or 0. `lock` holds the top row (MySQL's fallback). */
async function largest(db: Db, table: ResolvedTable, sequence: GaplessSequence, row: Row, lock: boolean): Promise<number> {
  if (lock) {
    const top = (await db
      .selectFrom(table.id)
      .select(sql<unknown>`${sql.ref(sequence.column)}`.as('top'))
      .where(inSeries(sequence, row))
      .where(sql<boolean>`${sql.ref(sequence.column)} is not null`)
      .orderBy(sql`${sql.ref(sequence.column)}`, 'desc')
      .limit(1)
      .forUpdate()
      .executeTakeFirst()) as { top?: unknown } | undefined;
    return wholeNumber(top?.top) ?? 0;
  }
  const found = (await db
    .selectFrom(table.id)
    .select((eb) => eb.fn.max(db.dynamic.ref(sequence.column) as never).as('top'))
    .where(inSeries(sequence, row))
    .executeTakeFirst()) as { top?: unknown } | undefined;
  return wholeNumber(found?.top) ?? 0;
}

/**
 * MySQL, inside a caller's transaction: hold ONE row every writer of the
 * series holds first — the parent of a per-parent series, else the series'
 * lowest-numbered row (numbered rows are never deleted, so it stays the same
 * row) — by its key, which locks that row and no gap. Writers then take their
 * numbers one at a time: without it, twenty duplicates of one number waiting
 * on each other's gap locks deadlock. A series with no row yet has nothing to
 * hold; its first writers fall back to stepping past duplicates alone.
 */
async function holdAnchor(db: Db, table: ResolvedTable, sequence: GaplessSequence, row: Row): Promise<void> {
  const parent = sequence.scopeParent;
  const key = sequence.scope === undefined ? undefined : row[sequence.scope];
  if (parent !== undefined && key !== null && key !== undefined) {
    await sql`select 1 from ${sql.table(parent.table)} where ${sql.ref(parent.column)} = ${key} for update`.execute(db);
    return;
  }
  if (table.primaryKey.length === 0) return;
  const lowest = (await db
    .selectFrom(table.id)
    .select(table.primaryKey.map((column) => sql<unknown>`${sql.ref(column)}`.as(column)))
    .where(inSeries(sequence, row))
    .where(sql<boolean>`${sql.ref(sequence.column)} is not null`)
    .orderBy(sql`${sql.ref(sequence.column)}`, 'asc')
    .limit(1)
    .executeTakeFirst()) as Row | undefined;
  if (lowest === undefined) return;
  const match = sql.join(
    table.primaryKey.map((column) => sql`${sql.ref(column)} = ${lowest[column]}`),
    sql` and `,
  );
  await sql`select 1 from ${sql.table(table.id)} where ${match} for update`.execute(db);
}

/** The row with a claim's number, and its text, written in. */
function numbered(row: Row, claim: Claim, n: number): Row {
  const sequence = claim.sequence;
  const out: Row = { ...row, [sequence.column]: sequence.logicalType === 'text' || sequence.logicalType === 'varchar' ? String(n) : n };
  if (sequence.format !== undefined) out[sequence.format.column] = formatNumber(claim.prefix, sequence.format.pad, n);
  return out;
}

/** Whether a MySQL duplicate is on one of the series' unique indexes (its message names the key). */
function duplicateOfSeries(error: unknown, keys: readonly string[]): boolean {
  if (!isUniqueViolation(error)) return false;
  const message = String((error as { message?: unknown }).message ?? '');
  return keys.some((key) => message.includes(`'${key}'`) || message.includes(`.${key}'`));
}

/** A lock the series could not get, as the refusal a person reads. */
export function numberBusy(): AppError {
  return new AppError(409, 'NUMBER_BUSY', 'Another record is taking the next number. Try again in a moment.');
}

function isDeadlock(error: unknown): boolean {
  const e = error as { code?: unknown; errno?: unknown };
  return e.code === 'ER_LOCK_DEADLOCK' || e.errno === 1213 || e.code === 'ER_LOCK_WAIT_TIMEOUT' || e.errno === 1205;
}

/**
 * NUMBER, the taking half: called by `insertRow` for a row that carries
 * claims, with `insert` writing the row it is handed. Inside the caller's
 * transaction when there is one; otherwise in one of its own, holding the
 * series' lock until it commits.
 */
export async function insertNumbered<T>(
  db: Db,
  dialect: Dialect,
  table: ResolvedTable,
  row: Row,
  insert: (db: Db, row: Row) => Promise<T>,
): Promise<T> {
  const claims = (row as Carrier)[CLAIMS] ?? [];
  const bare: Row = { ...row };
  delete (bare as Carrier)[CLAIMS];
  if (claims.length === 0) return insert(db, bare);
  if (!inTransaction(db)) {
    // The lock is held until the commit: a writer let in before it would read a largest number without this one.
    return withNamedLock({ db, dialect }, numberLockName(table, row)!, 'NUMBER_BUSY', (trx) => take(trx, dialect, table, bare, claims, insert));
  }
  return take(db, dialect, table, bare, claims, insert);
}

async function take<T>(
  db: Db,
  dialect: Dialect,
  table: ResolvedTable,
  row: Row,
  claims: readonly Claim[],
  insert: (db: Db, row: Row) => Promise<T>,
): Promise<T> {
  if (dialect === 'postgres') {
    for (const claim of claims) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${seriesName(table, claim.sequence, row)}, 0))`.execute(db);
    }
  }
  if (dialect !== 'mysql') {
    let out = row;
    for (const claim of claims) out = numbered(out, claim, Math.max((await largest(db, table, claim.sequence, row, false)) + 1, claim.start));
    return insert(db, out);
  }
  const guarded = claims.every((claim) => claim.sequence.uniqueKeys.length > 0);
  if (!guarded) {
    try {
      let out = row;
      for (const claim of claims) out = numbered(out, claim, Math.max((await largest(db, table, claim.sequence, row, true)) + 1, claim.start));
      return await insert(db, out);
    } catch (error) {
      if (isDeadlock(error)) throw numberBusy();
      throw error;
    }
  }
  try {
    for (const claim of claims) await holdAnchor(db, table, claim.sequence, row);
  } catch (error) {
    if (isDeadlock(error)) throw numberBusy();
    throw error;
  }
  const next = new Map<Claim, number>();
  for (const claim of claims) next.set(claim, Math.max((await largest(db, table, claim.sequence, row, false)) + 1, claim.start));
  for (let step = 0; ; step += 1) {
    let out = row;
    for (const claim of claims) out = numbered(out, claim, next.get(claim)!);
    try {
      return await insert(db, out);
    } catch (error) {
      const hit = claims.filter((claim) => duplicateOfSeries(error, claim.sequence.uniqueKeys));
      if (hit.length === 0) {
        if (isDeadlock(error)) throw numberBusy();
        throw error;
      }
      if (step >= MAX_STEPS) throw numberBusy();
      // Taken, and committed: the next one. What this transaction's snapshot could not see is behind it.
      for (const claim of hit) next.set(claim, next.get(claim)! + 1);
    }
  }
}
