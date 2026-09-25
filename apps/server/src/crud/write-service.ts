// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ONE WAY A ROW IN A SOURCE DATABASE IS WRITTEN.
 *
 * Every insert, update and delete Adminium makes in a connected database goes
 * through this module: the data API (single rows, bulk and undo), the public
 * API, automation steps, CSV imports and project code. The statements live
 * here and nowhere else, and `test/source-write-guard.test.ts` fails when a
 * new one appears outside.
 *
 * ─── The order of a write ──────────────────────────────────────────────────
 *
 *   1. the caller prepares the values (allow-listing, coercion, defaults);
 *   2. FILL — a column rule puts a value in an absent key (`crud/column-rules.ts`),
 *      and a venue-local column's wall time is read on the venue's clock;
 *   3. RESOLVE — a copied value and a code are put in (`crud/decided-columns.ts`),
 *      then DECIDE — what the change itself makes Adminium write, judged
 *      against the stored row: a stamp, a late cancellation's flag (`crud/decide.ts`);
 *   4. before hooks run, and may change the values or reject the write;
 *   5. FORMULA — every scaled decimal is rounded and every formula the write
 *      touches is worked out, over the stored row with the new values over it
 *      (`crud/formulas.ts`), so nothing a hook set survives in one;
 *   6. CHECK — the filled values are judged; a refusal is 422 with the column named;
 *   7. GUARD — on a table with a booking limit, the slot is locked and its
 *      room counted (`crud/capacity-guard.ts`); 7–9 then run in one transaction;
 *   8. SEQUENCE — a running number is claimed, only now, so a refusal burns none;
 *      a number without gaps is taken later still, inside the INSERT's own
 *      transaction (`crud/gapless.ts`);
 *   9. the statement runs (a create whose generated code collides runs again
 *      with a fresh one), and SETTLE keeps a parent in step with it: its
 *      totals over child rows, then the formulas that read them, then its
 *      balances — in that order, so a balance is taken from the new total;
 *  10. the caller announces the write (audit, files, realtime, record events);
 *  11. after hooks run. Their errors are recorded and never undo the write.
 *
 * {@link RecordWriteService.create}, `update` and `delete` hold that order for
 * one row. The multi-row paths (bulk, undo, import) keep their own
 * transactions, so they use the steps directly: {@link RecordWriteService.beforeEach}
 * before the transaction, the statements inside it, the announcement, then
 * {@link RecordWriteService.afterEach}. Before hooks run OUTSIDE a transaction
 * on purpose: a hook may read or write through its own connection, and on
 * SQLite that connection would wait for the transaction to finish.
 *
 * ─── A row that skipped the rules does not compile ─────────────────────────
 *
 * The statements take a {@link CheckedRow} — a branded type only this module's
 * check step produces. That is what covers the paths a behavioural test would
 * miss: the CSV import's fast path writes a whole chunk without ever asking
 * for a before hook, and a `beforeEach` that filled and checked would never
 * have run for it. There is exactly one named escape,
 * {@link uncheckedForUndo}: an undo restores HISTORY, including rows written
 * before a rule existed, and refusing to put one back would be a data loss
 * dressed as a validation.
 *
 * ─── With no hooks and no rules, nothing changes ───────────────────────────
 *
 * The hook steps ask {@link RecordHooks.wants} first, and the rule steps ask
 * `tableRulesFor` — which answers `null` for a table with nothing to fill and
 * nothing to check, and then brands the SAME OBJECT. No rows are read, no
 * values copied and no queries added, so every path answers exactly as it did
 * before this module existed.
 *
 * ─── What stays outside, and why ───────────────────────────────────────────
 *
 * - Schema changes, including the SQLite table rebuild that copies rows into
 *   the rebuilt table (`schema-ddl/sqlite-rebuild.ts`): the rows do not change.
 * - The tables an app or add-on installation creates (`add-ons/install-ddl.ts`):
 *   DDL only, no rows.
 * - The placeholder rows the desktop app writes into a database it has just
 *   created (`routes/desktop-local-db/handlers.ts`): no connection, no
 *   project, and no user's record yet.
 * - Adminium's own `adminium_*` tables in the meta store.
 */

import type { FastifyRequest } from 'fastify';
import { sql, type DeleteQueryBuilder, type DeleteResult, type Kysely, type UpdateQueryBuilder, type UpdateResult } from 'kysely';
import type { Dialect } from '@adminium/engine';

import { AppError, ConflictError, ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import { getPrincipal } from '../rbac/principal.js';
import { checkCapacity, touchesGuard, withSlotLock } from './capacity-guard.js';
import { bookingCounts, bookingDay, bookingNeed, bookingRefusal, checkBooking, touchesBooking, withBookingLock } from './booking-guard.js';
import { decideRow, needsStored, stampFires, type DecideContext } from './decide.js';
import { isWriteConflict } from './db-errors.js';
import {
  checkRow,
  fillRow,
  guardedBy,
  tableRulesFor,
  withoutReadOnly,
  type ColumnCode,
  type FieldIssues,
  type RollupInto,
  type Scale,
  type TableBalance,
  type TableRules,
} from './column-rules.js';
import { inTransaction, withNamedLock } from './capacity-guard.js';
import { evaluateAll, placesFor, touchedFormulas, workOut } from './formulas.js';
import { claimsNumbers, insertNumbered, numberLockName, prepareNumbers, seriesOf, withSeriesLocks } from './gapless.js';
import { fillFromElsewhere, type RuleSettingsReader } from './rule-settings.js';
import { attachSeals, sealRows, sealsOf, type WriteSeals } from './seal.js';
import { attachExpect, attachGuard, dayOf, expectOf, guardOf, guardedDelete, guardedInsert, guardedUpdate, rowMoved, tiedToStates, type ClearColumns } from './states.js';
import { venueClock } from './venue-time.js';
import { isOutboxWrite } from '../outbox/context.js';
import {
  claimSequences,
  generatedCodes,
  isUniqueViolation,
  regenerateCodes,
  resolveRow,
  type CopyMemo,
  type SequenceStore,
} from './decided-columns.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';
import { fetchByPk } from './records.js';
import { venueLocalValue } from './venue-time.js';
import { normalizeWriteValue, sameValue } from './write-values.js';
import type { WriteAction, WriteActor, WriteOrigin } from './write-context.js';

// The write's own vocabulary lives in a leaf, because `column-rules.ts` reads
// it and this module reads the rules — see `write-context.ts`. Re-exported so
// every caller still finds them here.
export type { WriteAction, WriteActor, WriteOrigin } from './write-context.js';

export interface WriteContext {
  origin: WriteOrigin;
  /**
   * How many hook and automation writes deep this one is: 0 for a person's
   * write. The same counter automations keep (`crud/after-record-write.ts`).
   */
  hops: number;
  actor: WriteActor | null;
  /** The HTTP request behind the write, when there is one. */
  request: FastifyRequest | null;
  /**
   * The signed-in person's own row, on a public write made in a session: a
   * stamp of `claim` reads their email or name from it. Absent, such a stamp
   * writes nothing.
   */
  claimed?: Row | null | undefined;
}

/** The context of a write that a signed-in person or an API key asked for. */
export function requestWriteContext(request: FastifyRequest, origin: WriteOrigin): WriteContext {
  const principal = getPrincipal(request);
  return {
    origin,
    hops: 0,
    actor: principal === null ? null : { kind: principal.kind, id: principal.id, label: principal.label },
    request,
  };
}

/** The table a write lands in, and the handle it goes through. */
export interface WriteTarget {
  connectionId: string;
  view: SnapshotView;
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  /**
   * The venue's time zone (IANA), where a rule reads a wall clock: a booking
   * limit's hours and window, a venue-local column. The public API passes its
   * key's; otherwise the connection's is looked up when a rule needs it, and
   * UTC stands in when the connection names none.
   */
  timezone?: string | undefined;
}

// --- the hooks seam ----------------------------------------------------------

export type HookTiming = 'before' | 'after';

export interface BeforeWriteEvent {
  action: WriteAction;
  target: WriteTarget;
  /** The values about to be written; empty for a delete. Hooks may change them. */
  values: Row;
  /** The row as it is now (update, delete); null for a create. */
  record: Row | null;
  context: WriteContext;
  /**
   * What the hook judged the write on, that must still hold when it runs:
   * each `column = value` joins the UPDATE's own WHERE, so a decision taken
   * on the row as the hook saw it is never applied to a row that has moved
   * since (a message the outbox sent meanwhile). An update that then matches
   * nothing, on a row that is still there, is refused with 409
   * `STATE_MOVE_REFUSED`. A create has nothing to compare, and ignores it.
   */
  expect?: Row;
}

export interface AfterWriteEvent {
  action: WriteAction;
  target: WriteTarget;
  /** The row as written (create, update), or as it was (delete). */
  record: Row;
  /** The row before an update; null otherwise. */
  before: Row | null;
  context: WriteContext;
}

/**
 * What runs around a write. The project's hooks implement it
 * (`project/code/hooks.ts`); {@link NO_RECORD_HOOKS} is everything else.
 */
export interface RecordHooks {
  /** Whether any hook runs for this write, so a caller can skip reading rows. */
  wants(timing: HookTiming, action: WriteAction, target: WriteTarget, context: WriteContext): Promise<boolean>;
  /** Runs the before hooks in order. Throws {@link HookRejectedError} or {@link HookFailedError}. */
  before(event: BeforeWriteEvent): Promise<void>;
  /** Runs the after hooks in order. Never throws. */
  after(event: AfterWriteEvent): Promise<void>;
}

export const NO_RECORD_HOOKS: RecordHooks = {
  wants: () => Promise.resolve(false),
  before: () => Promise.resolve(),
  after: () => Promise.resolve(),
};

/**
 * A before hook called `reject(message)`. The write fails with 422 and the
 * hook's own words, the same shape as any other refused value.
 */
export class HookRejectedError extends AppError {
  override readonly name = 'HookRejectedError';

  constructor(
    message: string,
    readonly hook: string,
  ) {
    super(422, 'VALIDATION_FAILED', message, { hook, rejected: true });
  }
}

/** A before hook threw or ran out of time. The write does not happen. */
export class HookFailedError extends AppError {
  override readonly name = 'HookFailedError';

  constructor(
    readonly hook: string,
    readonly reason: string,
  ) {
    super(
      500,
      'HOOK_FAILED',
      `The change was not saved: the project hook ${hook} failed. The details are in the server log.`,
      { hook },
    );
  }
}

// --- the brand ---------------------------------------------------------------

declare const checked: unique symbol;

/**
 * A row that has been through FILL and CHECK. Nothing outside this module can
 * make one: the symbol is declared, never exported and never assigned, so the
 * only ways to hold a `CheckedRow` are {@link RecordWriteService.check} and
 * {@link uncheckedForUndo}.
 */
export type CheckedRow = Row & { readonly [checked]: true };

function brand(row: Row): CheckedRow {
  return row as CheckedRow;
}

/**
 * THE ONE NAMED ESCAPE. An undo puts back a row exactly as it was, and a rule
 * added since then must not stop it: the alternative is a restore that refuses
 * history, which loses the row for good. Loud on purpose — a new caller of
 * this function is a change somebody has to argue for.
 */
export function uncheckedForUndo(rows: readonly Row[]): CheckedRow[] {
  return rows.map(brand);
}

// --- statements --------------------------------------------------------------

type Db = Kysely<SourceDatabase>;
type AnyUpdate = UpdateQueryBuilder<SourceDatabase, string, string, UpdateResult>;
type AnyDelete = DeleteQueryBuilder<SourceDatabase, string, DeleteResult>;

/**
 * INSERT one row and return the STORED row (defaults resolved), per dialect.
 *
 * Postgres and SQLite do it in one round trip with `RETURNING *`. MySQL has
 * no RETURNING — kysely's MysqlQueryCompiler still compiles the clause, so
 * `.returningAll()` dies with ER_PARSE_ERROR 1064 ("near 'returning *'"),
 * which 500'd every generated-app create on mysql. Instead, insert bare and
 * re-select by key (as the adapter-mysql live suite does): prefer the CLIENT-PROVIDED PK values whenever the payload carries
 * them — provided keys cover char/uuid PKs (northwind customers, char(5))
 * and composite PKs (order_details) where `LAST_INSERT_ID()` is 0 — and fall
 * back to the driver's `insertId` only for a single missing auto-increment
 * column. A NULL PK value counts as "not provided": that is mysql's own
 * "generate it" spelling. If the new row is unaddressable (multi-column
 * DB-generated key, non-auto default), echo the payload rather than guess.
 */
/**
 * A JSON column's object or array, as the JSON text the column stores. The
 * drivers disagree about a bare array and none of them writes it as JSON:
 * node-postgres binds it as a Postgres array literal, mysql2 expands it into a
 * list of parameters (a column-count error), and better-sqlite3 refuses it.
 * better-sqlite3 refuses a boolean too, so on SQLite one is bound as 1 or 0.
 */
function storable(table: ResolvedTable, values: CheckedRow, dialect: Dialect): CheckedRow {
  let out: Row | null = null;
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'boolean' && dialect === 'sqlite') {
      out ??= { ...values };
      out[name] = bindValue(dialect, value);
      continue;
    }
    if (typeof value !== 'object' || value === null || value instanceof Date || value instanceof Uint8Array) continue;
    // SQLite keeps JSON in a TEXT column, so it is not typed json there.
    if (table.columns.get(name)?.logicalType !== 'json' && dialect !== 'sqlite') continue;
    out ??= { ...values };
    out[name] = JSON.stringify(value);
  }
  return (out ?? values) as CheckedRow;
}

export async function insertRow(
  db: Db,
  dialect: Dialect,
  table: ResolvedTable,
  checked: CheckedRow,
): Promise<Row> {
  // A row tied to a document's states is judged here, holding its parent;
  // a number without gaps is taken here too, inside the INSERT's own
  // transaction, whoever opened it; and a fingerprint is sealed over the row
  // as stored.
  return guardedInsert(db, dialect, table, checked, async (tx) => {
    const row = await insertNumbered(tx, dialect, table, checked, (within, numbered) => insertOne(within, dialect, table, numbered as CheckedRow));
    const plan = sealsOf(checked);
    if (plan !== undefined && table.primaryKey.every((column) => row[column] !== null && row[column] !== undefined)) {
      await sealRows(tx, table, Object.fromEntries(table.primaryKey.map((column) => [column, row[column]])), plan, writeSeals);
      return (await fetchByPk(tx, table, Object.fromEntries(table.primaryKey.map((column) => [column, row[column]])))) ?? row;
    }
    return row;
  }, clearColumns);
}

/**
 * Empty columns of one row — a parent's `clearOnCreate` when a child of it is
 * created (a recorded payment clears the client's "I've paid"). Adminium's own
 * write, beside the statement the writer asked for, in its transaction.
 */
const clearColumns: ClearColumns = async (db, table, keyColumn, key, columns) => {
  await db
    .updateTable(table)
    .set(Object.fromEntries(columns.map((column) => [column, null])) as never)
    .where((eb) => eb(db.dynamic.ref(keyColumn), '=', key))
    .execute();
};

/** Write a row's fingerprints (`crud/seal.ts` works them out), beside the statement that sealed it. */
export const writeSeals: WriteSeals = async (db, table, key, set) => {
  let update = db.updateTable(table.id).set(set as never);
  for (const [column, value] of Object.entries(key)) update = update.where((eb) => eb(db.dynamic.ref(column), '=', value));
  await update.execute();
};

async function insertOne(db: Db, dialect: Dialect, table: ResolvedTable, checked: CheckedRow): Promise<Row> {
  const values = storable(table, checked, dialect);
  if (dialect !== 'mysql') {
    // A row of nothing but defaults (its only sent values were totals, which a
    // settle writes): Postgres and SQLite refuse `() values ()`.
    const insert = db.insertInto(table.id);
    return (await (Object.keys(values).length === 0 ? insert.defaultValues() : insert.values(values as never))
      .returningAll()
      .executeTakeFirstOrThrow()) as Row;
  }
  const result = await db
    .insertInto(table.id)
    .values(values as never)
    .executeTakeFirstOrThrow();
  const pk: Row = {};
  const missing: string[] = [];
  for (const name of table.primaryKey) {
    const provided = values[name];
    if (provided === undefined || provided === null) missing.push(name);
    else pk[name] = provided;
  }
  if (missing.length > 0) {
    // kysely's mysql driver leaves insertId undefined when the packet
    // reports 0 (i.e. no auto-increment column took part in this insert).
    const insertId = result.insertId;
    if (missing.length > 1 || insertId === undefined || insertId <= 0n) {
      return { ...values };
    }
    // Bind as a plain number while it is exactly representable (the driver
    // returns bigint); past 2^53 fall back to the decimal string — mysql
    // still resolves the PK lookup over an implicit conversion.
    pk[missing[0] as string] =
      insertId <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(insertId) : insertId.toString();
  }
  return (await fetchByPk(db, table, pk)) ?? { ...values };
}

/** INSERT several rows in one statement, returning nothing (the CSV import's chunk). */
export async function insertRows(db: Db, dialect: Dialect, table: ResolvedTable, rows: readonly CheckedRow[]): Promise<void> {
  // Rows that take a number without gaps take it one at a time, each right
  // before its own INSERT; so do rows judged by a document's states, or sealed.
  if (rows.some((row) => claimsNumbers(row) || (guardOf(row) !== undefined && tiedToStates(table)) || sealsOf(row) !== undefined)) {
    for (const row of rows) await insertRow(db, dialect, table, row);
    return;
  }
  await db
    .insertInto(table.id)
    .values(rows.map((row) => storable(table, row, dialect)) as never)
    .execute();
}

/**
 * UPDATE the rows whose columns equal `match` (a primary key, or the CSV
 * import's match column), optionally narrowed further. Returns the count.
 */
export async function updateRows(
  db: Db,
  // The dialect decides how a value binds: better-sqlite3 refuses a boolean, so
  // an UPDATE that sets one (a ticket put on hold) was a 500 on SQLite.
  dialect: Dialect,
  table: ResolvedTable,
  values: CheckedRow,
  match: Row,
  refine?: (query: AnyUpdate) => AnyUpdate,
): Promise<number> {
  const statement = async (tx: Db, set: Record<string, unknown>) => {
    let query = tx.updateTable(table.id).set(set as never) as unknown as AnyUpdate;
    for (const [column, value] of Object.entries(match)) {
      query = query.where((eb) => eb(tx.dynamic.ref(column), '=', value));
    }
    if (narrowed !== undefined) query = narrowed(query);
    const result = await query.executeTakeFirst();
    return Number(result.numUpdatedRows);
  };
  /** Whether the row is still there for the caller, whatever it holds now. */
  const present = async (tx: Db): Promise<boolean> => {
    let query = tx.updateTable(table.id).set(same as never) as unknown as AnyUpdate;
    for (const [column, value] of Object.entries(match)) query = query.where((eb) => eb(tx.dynamic.ref(column), '=', value));
    if (refine !== undefined) query = refine(query);
    return Number((await query.executeTakeFirst()).numUpdatedRows) > 0;
  };
  // Every column the writer sent was Adminium's to decide (a total, a formula
  // sent back by a whole-row form): the key set to itself still answers
  // whether the row is there, through the same WHERE.
  const same = { [table.primaryKey[0]!]: sql.ref(table.primaryKey[0]!) };
  const set = Object.keys(values).length > 0 ? storable(table, values, dialect) : same;
  const plan = sealsOf(values);
  const expected = expectOf(values);
  // What a before hook judged the write on must still hold, in the statement's own WHERE.
  const narrowed =
    expected === undefined
      ? refine
      : (query: AnyUpdate): AnyUpdate => {
          let out = refine === undefined ? query : refine(query);
          for (const [column, value] of Object.entries(expected)) {
            out = out.where((eb) => (value === null || value === undefined ? eb(eb.ref(column as never), 'is', null) : eb(eb.ref(column as never), '=', value as never)));
          }
          return out;
        };
  // A row of a document's states is judged holding it; `visible` asks the
  // caller's own scope whether the row is theirs to hear about, by the same
  // statement setting nothing.
  return guardedUpdate(
    db,
    dialect,
    table,
    values,
    match,
    async (tx) => {
      const count = await statement(tx, set);
      if (count === 0 && expected !== undefined && (await present(tx))) throw rowMoved(expected);
      if (count > 0 && plan !== undefined) await sealRows(tx, table, match, plan, writeSeals);
      return count;
    },
    refine === undefined ? undefined : present,
  );
}

/**
 * DELETE the rows whose columns equal `match`, optionally narrowed further
 * (the public API's scope, in the statement's own WHERE). Returns the count.
 */
export async function deleteRows(
  db: Db,
  table: ResolvedTable,
  match: Row,
  refine?: (query: AnyDelete) => AnyDelete,
  /**
   * A write that is a person's (or a rule's, or a guest's) — judged by the
   * table's states: the row prepared for it by the write service carries the
   * guard. Absent, the row is deleted as it is (an undo of a create, the
   * sample data's own rows going).
   */
  judged?: { dialect: Dialect; prepared: Row } | undefined,
): Promise<number> {
  const run = async (tx: Db) => {
    let query = tx.deleteFrom(table.id) as unknown as AnyDelete;
    for (const [column, value] of Object.entries(match)) {
      query = query.where((eb) => eb(tx.dynamic.ref(column), '=', value));
    }
    if (refine !== undefined) query = refine(query);
    const result = await query.executeTakeFirst();
    return Number(result.numDeletedRows);
  };
  if (judged === undefined) return run(db);
  return guardedDelete(db, judged.dialect, table, match, guardOf(judged.prepared), run);
}

/**
 * The connection's currency, read only when a `currency` scale needs it and
 * the row names none of its own.
 */
export type CurrencyOf = () => Promise<string | null>;

const NO_CURRENCY: CurrencyOf = () => Promise.resolve(null);

/** The parent row a settle works on: its table, key and own currency column. */
interface SettledRow {
  table: string;
  keyColumn: string;
  currencyColumn?: string | undefined;
}

/**
 * The places each scale means for one stored row. A `currency` scale reads
 * the row's own currency column, so a document keeps the places of the
 * currency it was written in, whatever the connection says later.
 */
async function placesOf(db: Db, row: SettledRow, key: unknown, scales: readonly Scale[], currency: CurrencyOf): Promise<(scale: Scale) => number> {
  if (!scales.includes('currency')) return (scale) => (typeof scale === 'number' ? scale : 2);
  let own: unknown = null;
  if (row.currencyColumn !== undefined) {
    const found = (await db
      .selectFrom(row.table)
      .select(sql<unknown>`${sql.ref(row.currencyColumn)}`.as('currency'))
      .where((eb) => eb(db.dynamic.ref(row.keyColumn), '=', key))
      .executeTakeFirst()) as { currency?: unknown } | undefined;
    own = found?.currency ?? null;
  }
  const connection = typeof own === 'string' && own.trim() !== '' ? null : await currency();
  return (scale) => placesFor(scale, { currency: own }, 'currency', connection);
}

/** Postgres rounds only a numeric; MySQL and SQLite round what they are given. */
function roundedSql(dialect: Dialect, value: ReturnType<typeof sql>, places: number) {
  return dialect === 'postgres' ? sql`round(cast(${value} as numeric), ${sql.lit(places)})` : sql`round(${value}, ${sql.lit(places)})`;
}

/**
 * Set a parent's total to what its child rows add up to now — `column.rollup`,
 * kept in step with every write to a child. Rounded in SQL to the total's own
 * places, since SQLite adds money up as a float. A child whose `unlessSet`
 * column holds a value (a voided line) adds nothing, nor one that fails the
 * rollup's `where` (a voided payment).
 */
async function rollupStatement(
  db: Db,
  dialect: Dialect,
  rollup: RollupInto,
  parentKey: unknown,
  places: number,
  read: 'locking' | 'plain' = 'locking',
): Promise<void> {
  const amount = rollup.times === undefined ? sql`${sql.ref(rollup.sum)}` : sql`${sql.ref(rollup.sum)} * ${sql.ref(rollup.times)}`;
  const rounded = roundedSql(dialect, sql`coalesce(sum(${amount}), 0)`, places);
  const conditions = [
    sql`${sql.ref(rollup.via)} = ${parentKey}`,
    ...(rollup.unlessSet === undefined ? [] : [sql`${sql.ref(rollup.unlessSet)} is null`]),
    ...(rollup.where === undefined ? [] : [sql`${sql.ref(rollup.where.column)} = ${bindValue(dialect, rollup.where.eq)}`]),
  ];
  const added = sql`(select ${rounded} from ${sql.table(rollup.child)} where ${sql.join(conditions, sql` and `)})`;
  /*
   * MySQL reads the rows an UPDATE's subquery adds up with shared locks, gap
   * included — up to the end of the index for the newest parent. Taken BEFORE
   * a writer's own INSERT (the catch-up below), two writers on two documents
   * each hold the gap the other must insert into: a deadlock, proved with
   * concurrent documents. So the catch-up adds up with a plain read (the
   * parent is already held, so no writer of its rows is in flight) and writes
   * the figure; the settle after the INSERT keeps the locking read.
   */
  const value = read === 'plain' && dialect === 'mysql' ? ((await sql<{ value: unknown }>`select ${added} as value`.execute(db)).rows[0]?.value ?? 0) : added;
  await db
    .updateTable(rollup.parent)
    .set({ [rollup.column]: value } as never)
    .where((eb) => eb(db.dynamic.ref(rollup.parentKey), '=', parentKey))
    .execute();
}

/**
 * The parent's formulas that read a total just settled, worked out again from
 * the row as it is now stored — read holding it (`FOR UPDATE`), which on MySQL
 * is also what reads past the transaction's snapshot to the latest row.
 */
async function formulaStatement(
  db: Db,
  dialect: Dialect,
  row: SettledRow,
  formulas: RollupInto['formulas'],
  key: unknown,
  currency: CurrencyOf,
): Promise<void> {
  if (formulas.length === 0) return;
  let query = db
    .selectFrom(row.table)
    .selectAll()
    .where((eb) => eb(db.dynamic.ref(row.keyColumn), '=', key));
  if (dialect !== 'sqlite') query = query.forUpdate();
  const stored = (await query.executeTakeFirst()) as Row | undefined;
  if (stored === undefined) return;
  const own = row.currencyColumn === undefined ? null : stored[row.currencyColumn];
  const needsConnection = formulas.some((formula) => formula.scale === 'currency') && !(typeof own === 'string' && own.trim() !== '');
  const worked = evaluateAll(formulas, stored, row.currencyColumn, needsConnection ? await currency() : null);
  await db
    .updateTable(row.table)
    .set(worked as never)
    .where((eb) => eb(db.dynamic.ref(row.keyColumn), '=', key))
    .execute();
}

/**
 * SETTLE one parent row, in the one order that is right: the totals over its
 * child rows, then the formulas that read them (`tax` over `subtotal`,
 * `total` over both), then its balances — each a statement of its own, so
 * each reads what the one before it wrote, on every engine. `rollups` are the
 * totals to add up again (one parent's); `balances` the balances to work out
 * again afterwards.
 */
export async function settleParent(
  db: Db,
  dialect: Dialect,
  rollups: readonly RollupInto[],
  parentKey: unknown,
  balances: readonly TableBalance[],
  currency: CurrencyOf = NO_CURRENCY,
  read: 'locking' | 'plain' = 'locking',
): Promise<void> {
  const first = rollups[0];
  if (first === undefined) return;
  const row: SettledRow = { table: first.parent, keyColumn: first.parentKey, currencyColumn: first.currencyColumn };
  const derived = new Set(rollups.flatMap((rollup) => rollup.derived));
  const formulas = first.formulas.filter((formula) => derived.has(formula.column));
  const places = await placesOf(db, row, parentKey, [...rollups.map((r) => r.scale), ...balances.map((b) => b.scale)], currency);
  for (const rollup of rollups) await rollupStatement(db, dialect, rollup, parentKey, places(rollup.scale), read);
  await formulaStatement(db, dialect, row, formulas, parentKey, currency);
  await balanceStatement(db, dialect, row.table, row.keyColumn, balances, parentKey, places);
}

/**
 * Work a row's balances out again — `of − Σminus − total` — from the columns
 * as they are STORED, in a statement of its own. One statement that set a
 * total and read it back for the balance would read the new total on MySQL
 * (which evaluates SET left to right) and the old one elsewhere; a second
 * statement reads what the first wrote on every engine, and covers a `minus`
 * that is another table's total (a write-off) settled by a different write.
 */
export async function settleBalances(
  db: Db,
  dialect: Dialect,
  table: string,
  keyColumn: string,
  balances: readonly TableBalance[],
  key: unknown,
  opts: { currencyColumn?: string | undefined; currency?: CurrencyOf } = {},
): Promise<void> {
  if (balances.length === 0) return;
  const places = await placesOf(db, { table, keyColumn, currencyColumn: opts.currencyColumn }, key, balances.map((b) => b.scale), opts.currency ?? NO_CURRENCY);
  await balanceStatement(db, dialect, table, keyColumn, balances, key, places);
}

async function balanceStatement(
  db: Db,
  dialect: Dialect,
  table: string,
  keyColumn: string,
  balances: readonly TableBalance[],
  key: unknown,
  places: (scale: Scale) => number,
): Promise<void> {
  if (balances.length === 0) return;
  const set: Record<string, unknown> = {};
  for (const balance of balances) {
    const parts = [balance.total, ...balance.minus].map((column) => sql` - coalesce(${sql.ref(column)}, 0)`);
    set[balance.column] = roundedSql(dialect, sql`coalesce(${sql.ref(balance.of)}, 0)${sql.join(parts, sql``)}`, places(balance.scale));
  }
  await db
    .updateTable(table)
    .set(set as never)
    .where((eb) => eb(db.dynamic.ref(keyColumn), '=', key))
    .execute();
}

/**
 * Hold the rows a write will move a balance of, and read those balances as
 * they are, before the write. On Postgres and MySQL `FOR UPDATE`: a second
 * payment on the same visit waits here until the first commits, and then
 * adds up a total that includes it (a statement already waiting on the row
 * would add up the old one). SQLite writes one transaction at a time.
 */
export async function holdBalances(
  db: Db,
  dialect: Dialect,
  table: string,
  keyColumn: string,
  keys: readonly unknown[],
  balances: readonly TableBalance[],
): Promise<Map<string, Row>> {
  const unique = new Map<string, unknown>();
  for (const key of keys) if (key !== null && key !== undefined) unique.set(String(key), key);
  if (unique.size === 0) return new Map();
  // In key order, so two writes that hold the same two rows never wait on each other crosswise.
  let query = db
    .selectFrom(table)
    .select([keyColumn, ...balances.map((balance) => balance.column)] as never)
    .where((eb) => eb(db.dynamic.ref(keyColumn), 'in', [...unique.values()] as never))
    .orderBy(keyColumn as never);
  if (dialect !== 'sqlite') query = query.forUpdate();
  const rows = (await query.execute()) as Row[];
  return new Map(rows.map((row) => [String(row[keyColumn]), row]));
}

/** A row read and held for this transaction (`FOR UPDATE`; SQLite writes one at a time). */
async function fetchHeld(db: Db, target: WriteTarget, pk: Row): Promise<Row | undefined> {
  let query = db.selectFrom(target.table.id).selectAll();
  for (const [column, value] of Object.entries(pk)) query = query.where((eb) => eb(db.dynamic.ref(column), '=', value));
  if (target.dialect !== 'sqlite') query = query.forUpdate();
  return (await query.executeTakeFirst()) as Row | undefined;
}

/** A row's key. */
function pkOf(table: ResolvedTable, row: Row): Row {
  return Object.fromEntries(table.primaryKey.map((column) => [column, row[column]]));
}

/**
 * A written row read again by its key: what a settle wrote beside it (its own
 * totals, its balances) is in the row the caller hands back. The row as given
 * when its key is not all there (a MySQL row the INSERT could not address).
 */
async function readAgain(db: Db, table: ResolvedTable, row: Row): Promise<Row> {
  const pk: Row = {};
  for (const column of table.primaryKey) {
    const value = row[column];
    if (value === null || value === undefined) return row;
    pk[column] = value;
  }
  return (await fetchByPk(db, table, pk)) ?? row;
}

/** A money value as a number, or null. */
function amountOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The refusal a capped balance gives, or null. A write may not take a
 * balance below zero, nor further below it; a row whose balance was already
 * below zero (old data, a rule added since) can still be written in any way
 * that does not lower it.
 */
export async function capRefusal(
  db: Db,
  table: string,
  keyColumn: string,
  key: unknown,
  balances: readonly TableBalance[],
  before: Row | undefined,
): Promise<ConflictError | null> {
  const capped = balances.filter((balance) => balance.cappedBy.length > 0);
  if (capped.length === 0) return null;
  const after = (await db
    .selectFrom(table)
    .select(capped.map((balance) => balance.column) as never)
    .where((eb) => eb(db.dynamic.ref(keyColumn), '=', key))
    .executeTakeFirst()) as Row | undefined;
  for (const balance of capped) {
    const now = amountOf(after?.[balance.column]);
    const was = amountOf(before?.[balance.column]);
    if (now === null || now >= -1e-9 || (was !== null && now >= was - 1e-9)) continue;
    return new ConflictError('That is more than the balance.', 'BALANCE_EXCEEDED', {
      column: balance.column,
      balance: was === null ? null : Math.max(was, 0),
    });
  }
  return null;
}

// --- values after hooks --------------------------------------------------------

/** better-sqlite3 refuses boolean binds; the import has always converted them. */
export function bindValue(dialect: Dialect, value: unknown): unknown {
  return dialect === 'sqlite' && typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

/**
 * The first key in `values` that is not a column of the table, or null. Any
 * column counts, secret ones included: project code may fill a password hash.
 */
export function unknownColumn(table: ResolvedTable, values: Row): string | null {
  for (const key of Object.keys(values)) {
    if (!table.columns.has(key)) return key;
  }
  return null;
}

/**
 * The values the before hooks left. The hook runner has already refused
 * unknown columns and named the hook; this is the backstop for a runner that
 * did not. A value a hook changed is spelled the way the data API spells it.
 */
function valuesAfterHooks(target: WriteTarget, original: Row, changed: Row): Row {
  const unknown = unknownColumn(target.table, changed);
  if (unknown !== null) {
    throw new HookFailedError('a project hook', `${target.table.id} has no column ${JSON.stringify(unknown)}.`);
  }
  const out: Row = {};
  for (const [key, value] of Object.entries(changed)) {
    if (value === undefined) continue;
    const column = target.table.columns.get(key);
    out[key] =
      column === undefined || original[key] === value
        ? value
        : bindValue(target.dialect, normalizeWriteValue(column, value));
  }
  return out;
}

// --- the service -------------------------------------------------------------

export interface CreateRecordInput {
  target: WriteTarget;
  values: Row;
  context: WriteContext;
  /**
   * The caller's own checks (file columns), run again when before hooks
   * changed the values. The caller runs them once itself, where it always has.
   */
  recheck?: ((values: Row) => Promise<void>) | undefined;
  /** Turns a failed statement into the caller's own error. */
  mapError?: ((error: unknown) => never) | undefined;
  announce: (row: Row, values: Row) => Promise<void>;
}

export interface UpdateRecordInput {
  target: WriteTarget;
  pk: Row;
  values: Row;
  context: WriteContext;
  /** The row now, when the caller has read it. */
  before?: Row | undefined;
  /**
   * How to read the row now when a hook needs it and `before` is absent. The
   * public API passes a read that carries its scope, so a hook never sees,
   * and a rejection never reveals, a row the caller could not update.
   */
  load?: (() => Promise<Row | null>) | undefined;
  /** More conditions for the UPDATE itself (the public API's scope). */
  refine?: ((query: AnyUpdate) => AnyUpdate) | undefined;
  /** Stop quietly, with nothing announced, when no row matched. */
  skipIfNone?: boolean | undefined;
  recheck?: ((values: Row) => Promise<void>) | undefined;
  mapError?: ((error: unknown) => never) | undefined;
  announce: (outcome: UpdateOutcome) => Promise<void>;
}

export interface UpdateOutcome {
  /** The row before the write; null when nobody read it (the public API without hooks). */
  before: Row | null;
  /** The row after the write, read again; null when it cannot be found. */
  after: Row | null;
  values: Row;
  count: number;
}

export interface DeleteRecordInput {
  target: WriteTarget;
  pk: Row;
  /** The row being deleted, when the caller has read it (the dashboard always has). */
  before?: Row | undefined;
  /**
   * How to read the row when `before` is absent. The public API passes a read
   * that carries its scope, so a before hook never sees — and a rejection
   * never reveals — a row the caller could not delete.
   */
  load?: (() => Promise<Row | null>) | undefined;
  /** More conditions for the DELETE itself (the public API's scope). */
  refine?: ((query: AnyDelete) => AnyDelete) | undefined;
  /**
   * Stop quietly — no hook, no statement, nothing announced — when the row
   * cannot be read, and announce nothing when the DELETE matched no row.
   */
  skipIfNone?: boolean | undefined;
  context: WriteContext;
  mapError?: ((error: unknown) => never) | undefined;
  /** `before` is the row as read; null only when nobody read it. */
  announce: (count: number, before: Row | null) => Promise<void>;
}

/** One row of a multi-row write, before its hooks. */
export interface PlannedRow {
  /** How to find the row now (update, delete); ignored for a create. */
  match?: Row | undefined;
  /** The values to write; ignored for a delete. */
  values: Row;
  /** The row now, when the caller has it. */
  record?: Row | null | undefined;
}

/** A multi-row write's row, after its fill, its before hooks and its check. */
export interface PreparedRow {
  values: CheckedRow;
  /** The row the hooks saw; undefined when no hook ran. */
  record: Row | null | undefined;
  /** What the check refused, or null. The caller decides what a bad row costs:
   *  the bulk route fails the request, the import fails the row and goes on. */
  issues: FieldIssues | null;
}

export interface BeforeEachOptions {
  /**
   * Fill and check every row (the default).
   *
   * `false` is the UNDO path and the only caller that passes it: a restore
   * puts back history, so the rules that judge a NEW value must not judge an
   * OLD one (see {@link uncheckedForUndo}). This flag is that escape, spelled
   * where the undo route can reach it.
   */
  rules?: boolean;
  /**
   * A table with a booking limit takes its rows one at a time, each holding
   * its slot (`create` and `update`); a multi-row write to one is refused.
   * `unchecked` is the operator bringing in HISTORY — an import, an app's
   * sample data — where yesterday's bookings are not new ones to be judged.
   */
  capacity?: 'refuse' | 'unchecked';
}

/**
 * A multi-row write to a table whose rows each hold a slot. The slot is
 * locked and counted per row inside `create` and `update`, which a batch
 * of rows written in one statement cannot do.
 */
export class GuardedBatchError extends AppError {
  override readonly name = 'GuardedBatchError';

  constructor(table: string) {
    super(409, 'CONFLICT', `${table} limits how much of a time slot its rows take, so they are written one at a time.`, {
      reason: 'CAPACITY_ONE_AT_A_TIME',
    });
  }
}

/**
 * A multi-row write to a table whose rows move a balance kept at zero or
 * above. Each row is written, settled and checked in its own transaction.
 */
export class BalanceBatchError extends AppError {
  override readonly name = 'BalanceBatchError';

  constructor(table: string) {
    super(409, 'CONFLICT', `${table} keeps a balance that may not go below zero, so its rows are written one at a time.`, {
      reason: 'BALANCE_ONE_AT_A_TIME',
    });
  }
}

/** The row moved to another day between naming the booking lock and holding it. */
class DayMoved extends Error {}

/** The balances of the rows a write holds, per parent table, per key, as they were before it. */
type Held = Map<string, Map<string, Row>>;

export interface WrittenRow {
  record: Row;
  before: Row | null;
}

export interface RecordWriteService {
  /** The hooks in force right now. */
  readonly hooks: RecordHooks;
  /**
   * FILL + CHECK for rows written through the statements directly, with no
   * before hook in the way — the CSV import's fast path. Reports per row and
   * never throws for a bad row: a caller that writes a thousand rows decides
   * for itself whether one refusal stops the other 999.
   */
  check(
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    rows: readonly Row[],
    opts?: Pick<BeforeEachOptions, 'capacity'>,
  ): Promise<{ rows: (CheckedRow | null)[]; issues: (FieldIssues | null)[] }>;
  create(input: CreateRecordInput): Promise<Row>;
  update(input: UpdateRecordInput): Promise<UpdateOutcome>;
  delete(input: DeleteRecordInput): Promise<number>;
  /** Whether a multi-row write needs {@link beforeEach} or {@link afterEach} at all. */
  wants(timing: HookTiming, action: WriteAction, target: WriteTarget, context: WriteContext): Promise<boolean>;
  /**
   * Before hooks for several rows, in order, before any of them is written.
   * A rejection stops the whole write. Rows that no longer exist are passed
   * through untouched; the caller reports them.
   */
  beforeEach(
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    rows: PlannedRow[],
    opts?: BeforeEachOptions,
  ): Promise<PreparedRow[]>;
  /**
   * After hooks for rows that were written, in order, once every parent total
   * they feed is settled. Hooks never throw.
   */
  afterEach(action: WriteAction, target: WriteTarget, context: WriteContext, rows: WrittenRow[]): Promise<void>;
  /**
   * Settle the parent totals rows written without `afterEach` feed — the
   * import's fast path, a parent form's child rows. `record` is the row as
   * written (or as it was, for a delete). `cap` refuses a capped balance
   * left below zero; only a caller still inside the rows' transaction can
   * ask for it.
   */
  settle(action: WriteAction, target: WriteTarget, rows: WrittenRow[], opts?: { cap?: boolean }): Promise<void>;
  /**
   * One transaction for rows prepared by {@link beforeEach} or {@link check},
   * holding the lock of every series without gaps they take a number in until
   * it commits. A multi-row path opens its transaction here: on MySQL a named
   * lock cannot be taken inside a transaction someone else opened, and twenty
   * writers numbering inside their own would wait on each other's gap locks.
   */
  transaction<T>(
    target: WriteTarget,
    rows: readonly Row[],
    run: (db: Kysely<SourceDatabase>) => Promise<T>,
    /** Child rows the transaction will add, each with what it already knows (its parent's key, on an edit). */
    children?: readonly { target: WriteTarget; row: Row }[],
  ): Promise<T>;
  /**
   * Created or updated rows as their own totals left them, once `afterEach`
   * or `settle` ran: read again from the table that keeps totals on its own
   * rows, and handed back as they are from any other. What a multi-row path
   * replies with, so the caller shows the balance that is stored.
   */
  stored(target: WriteTarget, rows: readonly Row[]): Promise<Row[]>;
}

export interface WriteServiceOptions {
  /** Read on every write, so a reload swaps the hooks for the next one. */
  hooks?: (() => RecordHooks) | undefined;
  /**
   * The meta store's counters, for a column with a running number. A table
   * with one, written through a service without them, is refused rather
   * than written unnumbered.
   */
  sequences?: SequenceStore | undefined;
  /** The connection's time zone, looked up only for a table with a rule that reads a clock. */
  timezoneOf?: ((connectionId: string) => Promise<string | null>) | undefined;
  /**
   * The meta store's settings a rule reads: the connection's currency (a
   * `currency` scale, a document's currency) and an add-on's settings (a
   * default, a prefix, a start). Without one, a `currency` scale keeps 2
   * places and a fill from an add-on's setting fills nothing.
   */
  settings?: RuleSettingsReader | undefined;
  /**
   * The role slugs a writer holds (`any` for Super Admin), for a move only
   * some roles may make. Without it, such a move is refused: nobody can be
   * shown to hold the role.
   */
  rolesOf?: ((actor: WriteActor | null) => Promise<ReadonlySet<string> | 'any'>) | undefined;
  /**
   * Whether something after the write compares a table's rows before and
   * after (an app's email queued when a column changes to a value): an
   * update of it then reads the stored row first, so the event carries it.
   */
  watched?: ((connectionId: string, tableId: string) => Promise<boolean>) | undefined;
}

/** How many times a create whose generated code collided is tried again. */
const CODE_RETRIES = 4;

/**
 * Run `insert` so a refusal leaves the transaction usable: Postgres aborts a
 * whole transaction on a failed statement, so inside one the attempt runs
 * under a savepoint. Outside a transaction, and on the other two engines, a
 * failed INSERT leaves nothing to undo.
 */
async function underSavepoint<T>(target: WriteTarget, insert: () => Promise<T>): Promise<T> {
  if (target.dialect !== 'postgres' || !target.db.isTransaction) return insert();
  await sql`savepoint adminium_code`.execute(target.db);
  try {
    const out = await insert();
    await sql`release savepoint adminium_code`.execute(target.db);
    return out;
  } catch (error) {
    await sql`rollback to savepoint adminium_code`.execute(target.db);
    throw error;
  }
}

/**
 * The refusal a failed check raises. It travels the caller's own `mapError`
 * when there is one, because the surfaces disagree about how much a refusal
 * may say: the dashboard wants the column named, and the public API must not
 * name it — `details.fields` would tell an anonymous caller which columns are
 * required and which enum values exist, a membership oracle `refuseWrite`
 * exists to prevent.
 */
function refusal(fields: FieldIssues): ValidationFailedError {
  return new ValidationFailedError('Some values were refused.', { fields });
}

/** What DECIDE needs to know about a write. */
function decideContext(target: WriteTarget, context: WriteContext, now: Date, zone: string | undefined): DecideContext {
  return {
    db: target.db,
    dialect: target.dialect,
    table: target.table,
    origin: context.origin,
    actor: context.actor,
    now,
    zone,
    claimed: context.claimed ?? null,
  };
}

/** Text a rule keeps trimmed, or trimmed and in lower case (an address). The same object when nothing changes. */
function normalizeText(rules: TableRules | null, values: Row): Row {
  let out: Row | null = null;
  for (const { column, how } of rules?.normalizes ?? []) {
    const value = values[column];
    if (typeof value !== 'string') continue;
    const next = how === 'email' ? value.trim().toLowerCase() : value.trim();
    if (next === value) continue;
    out ??= { ...values };
    out[column] = next;
  }
  return out ?? values;
}

/** Two refusals as one: a column named twice keeps its first issue. */
function mergeIssues(a: FieldIssues | null, b: FieldIssues | null): FieldIssues | null {
  if (a === null) return b;
  if (b === null) return a;
  return { ...b, ...a };
}

export function createWriteService(opts: WriteServiceOptions = {}): RecordWriteService {
  const current = (): RecordHooks => opts.hooks?.() ?? NO_RECORD_HOOKS;

  const rulesOf = (target: WriteTarget): TableRules | null => tableRulesFor(target);

  /** The connection's currency, read at most once per write, and only when a `currency` scale asks for it. */
  const currencyFor = (target: WriteTarget): CurrencyOf => {
    let memo: Promise<string | null> | undefined;
    return () => (memo ??= opts.settings?.currency(target.connectionId) ?? Promise.resolve(null));
  };

  /** Whether any scale of the table is a currency's, so the connection's currency may be needed. */
  const readsCurrency = (rules: TableRules | null): boolean =>
    (rules?.scales ?? []).some((s) => s.scale === 'currency') || (rules?.formulas ?? []).some((f) => f.scale === 'currency');

  /**
   * FORMULA: the scaled decimals rounded and the touched formulas worked out,
   * over the stored row (an update) with the values over it.
   */
  const formulate = async (rules: TableRules | null, action: WriteAction, target: WriteTarget, values: Row, stored: Row | null): Promise<Row> => {
    if (rules === null || action === 'delete') return values;
    const currency = readsCurrency(rules) ? await currencyFor(target)() : null;
    return workOut(rules, action, values, stored, currency);
  };

  const fill = (
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    values: Row,
    now: Date,
  ): Row => {
    const out = normalizeText(rules, withoutReadOnly(rules, fillRow(rules, action, values, { dialect: target.dialect, now, actor: context.actor }), context.origin));
    // A new document starts in its first state.
    const states = rules?.states;
    if (action !== 'create' || states === undefined || Object.prototype.hasOwnProperty.call(out, states.column)) return out;
    return { ...out, [states.column]: states.initial };
  };

  /** The venue's zone for a table whose rules read a clock; undefined for every other. */
  async function zoneFor(rules: TableRules | null, target: WriteTarget): Promise<string | undefined> {
    const readsDay = (rules?.stamps ?? []).some((stamp) => stamp.set === 'today') || (rules?.bounds ?? []).some((bound) => bound.notAfter !== undefined);
    if (rules?.capacity === undefined && rules?.booking === undefined && (rules?.venueLocal?.length ?? 0) === 0 && !readsDay) return undefined;
    return target.timezone ?? (await opts.timezoneOf?.(target.connectionId)) ?? 'UTC';
  }

  /**
   * Dates kept within dates (`column.bounds`): never later than today on the
   * venue's calendar, never earlier than another date — the row's own, or
   * the row a foreign key points at, read through the write's own handle.
   * History is not judged: an import brings in what happened.
   */
  async function boundIssues(
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    values: Row,
    stored: Row | null,
  ): Promise<FieldIssues | null> {
    if ((rules?.bounds?.length ?? 0) === 0 || action === 'delete' || context.origin === 'import' || context.origin === 'undo') return null;
    let issues: FieldIssues | null = null;
    const row = { ...(stored ?? {}), ...values };
    for (const bound of rules!.bounds!) {
      if (!Object.prototype.hasOwnProperty.call(values, bound.column)) continue;
      const day = dayOf(values[bound.column]);
      if (day === null) continue;
      let refused = false;
      if (bound.notAfter === 'today') refused = day > venueClock(new Date(), (await zoneFor(rules, target)) ?? 'UTC').day;
      const before = bound.notBefore;
      if (!refused && before !== undefined) {
        let other: unknown = row[before.column];
        if (before.through !== undefined) {
          const key = row[before.through.via];
          other =
            key === null || key === undefined
              ? null
              : (
                  (await target.db
                    .selectFrom(before.through.table)
                    .select(sql<unknown>`${sql.ref(before.column)}`.as('value'))
                    .where((eb) => eb(target.db.dynamic.ref(before.through!.key), '=', key))
                    .executeTakeFirst()) as { value?: unknown } | undefined
                )?.value;
        }
        const floor = dayOf(other);
        refused = floor !== null && day < floor;
      }
      if (refused) (issues ??= {})[bound.column] = { code: 'out-of-range' };
    }
    return issues;
  }

  /** CHECK, then the dates a rule keeps within dates; the caller's own refusal when there is one. */
  async function checkAllOrThrow(
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    values: Row,
    stored: Row | null,
    mapError: ((error: unknown) => never) | undefined,
  ): Promise<CheckedRow> {
    const issues = mergeIssues(checkRow(rules, action, values, { dialect: target.dialect }), await boundIssues(rules, action, target, context, values, stored));
    if (issues === null) return brand(values);
    const error = refusal(issues);
    if (mapError !== undefined) mapError(error);
    throw error;
  }

  /**
   * What a checked row carries to its statement: the guard a document's
   * states judge it by (whether it is history, the writer's roles, the
   * columns this write's own rules decided), and the fingerprints it seals.
   * The outbox's own writes and an undo carry no guard: the outbox keeps its
   * own moves, and an undo on a table tied to states is refused before it
   * gets here.
   */
  async function carry(
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    values: CheckedRow,
    stored: Row | null,
  ): Promise<CheckedRow> {
    if (rules === null || context.origin === 'undo') return values;
    const history = context.origin === 'import';
    let out: Row = values;
    if (tiedToStates(target.table) && !isOutboxWrite(context)) {
      const roleMoves = Object.values(rules.states?.moves ?? {}).some((moves) => moves.some((move) => typeof move === 'object' && move.roles !== undefined));
      const roles = !history && action === 'update' && roleMoves ? ((await opts.rolesOf?.(context.actor ?? null)) ?? new Set<string>()) : new Set<string>();
      const decided = [
        ...[...(rules.stamps ?? []), ...(rules.seals ?? [])].filter((stamp) => stampFires(stamp, action, values, stored)).map((stamp) => stamp.column),
        ...(rules.formulas ?? []).map((formula) => formula.column),
      ];
      out = attachGuard(out, { history, roles, decided });
    }
    const seals = history || action === 'delete' ? [] : (rules.seals ?? []).filter((stamp) => stampFires(stamp, action, values, stored));
    if (seals.length > 0) out = attachSeals(out, { view: target.view, stamps: seals, currency: await currencyFor(target)() });
    return brand(out);
  }

  /**
   * Times, as the column keeps them: a venue-local column's wall time is the
   * instant it names where the venue is, and a zoned instant bound for a
   * zone-less column is this server's wall clock — what the data routes have
   * always written, now whoever writes, so a guest's booking and a till's
   * name the same slot the same way. The same object when nothing changes.
   */
  const localize = (rules: TableRules | null, target: WriteTarget, values: Row, zone: string | undefined): Row => {
    let out: Row | null = null;
    for (const name of rules?.venueLocal ?? []) {
      const column = target.table.columns.get(name);
      if (zone === undefined || column === undefined || typeof values[name] !== 'string') continue;
      out ??= { ...values };
      out[name] = venueLocalValue(column, values[name], zone);
    }
    for (const [name, value] of Object.entries(out ?? values)) {
      if (typeof value !== 'string') continue;
      const column = target.table.columns.get(name);
      if (column?.logicalType !== 'timestamp') continue;
      const spelled = normalizeWriteValue(column, value);
      if (spelled === value) continue;
      out ??= { ...values };
      out[name] = spelled;
    }
    return out ?? values;
  };

  /** FILL (with the venue's clock, text normalised, a new document's first state), then RESOLVE — a copy, a code, then what a create fills from elsewhere. */
  const prepareValues = async (
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    values: Row,
    now: Date,
    memo?: CopyMemo,
  ): Promise<Row> =>
    fillFromElsewhere(
      rules,
      action,
      target,
      await resolveRow(
        rules,
        action,
        target,
        localize(rules, target, fill(rules, action, target, context, values, now), await zoneFor(rules, target)),
        memo,
      ),
      opts.settings,
    );

  /**
   * SEQUENCE, on a row that passed CHECK: a counted number claimed now, and
   * what a number without gaps needs at its INSERT attached to the row.
   */
  const numbered = async (rules: TableRules | null, action: WriteAction, target: WriteTarget, context: WriteContext, values: CheckedRow) =>
    brand(
      await prepareNumbers(
        rules,
        action,
        target,
        await claimSequences(rules, action, target, values, opts.sequences),
        context.origin,
        opts.settings,
      ),
    );

  /**
   * INSERT, trying again with fresh codes when a code this create generated
   * collided with one already stored. Returns the stored row and the values
   * that were written.
   */
  async function insertWithCodes(
    target: WriteTarget,
    values: CheckedRow,
    codes: readonly ColumnCode[],
    mapError: ((error: unknown) => never) | undefined,
  ): Promise<{ row: Row; values: CheckedRow }> {
    let current = values;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const row = await underSavepoint(target, () => insertRow(target.db, target.dialect, target.table, current));
        return { row, values: current };
      } catch (error) {
        if (codes.length > 0 && attempt < CODE_RETRIES && isUniqueViolation(error)) {
          current = brand(regenerateCodes(current, codes));
          continue;
        }
        if (mapError !== undefined) mapError(error);
        throw error;
      }
    }
  }

  /** A guard's refusal travels the caller's own `mapError`, like a check's. */
  async function guarded(run: () => Promise<void>, mapError: ((error: unknown) => never) | undefined): Promise<void> {
    try {
      await run();
    } catch (error) {
      if (mapError !== undefined) mapError(error);
      throw error;
    }
  }

  /**
   * An update to a booking table. Nothing is locked when the stored row says
   * the write asks the guard nothing (a status step). Otherwise the lock is
   * named by the day the row WILL hold, read from the stored row outside the
   * lock, and the write re-reads it inside: if another writer moved it in
   * between, the day is named again, up to three times.
   */
  async function bookedUpdate(
    booking: NonNullable<TableRules['booking']>,
    target: WriteTarget,
    zone: string | undefined,
    pk: Record<string, unknown>,
    values: Row,
    setDay: (day: string | null) => void,
    write: (db: Db) => Promise<number>,
    rolls: boolean,
    mapError: ((error: unknown) => never) | undefined,
  ): Promise<number> {
    for (let attempt = 0; ; attempt += 1) {
      const current = (await fetchByPk(target.db, target.table, pk)) ?? null;
      const need = current === null ? null : bookingNeed(booking, values, current);
      if (need === null) {
        setDay(null);
        return rolls ? await atomically(target, write) : await write(target.db);
      }
      const day = bookingDay(booking, { ...current, ...values }, zone ?? 'UTC');
      if (day === null) await guarded(() => Promise.reject(bookingRefusal('BOOKING_OUT_OF_RANGE', booking.start)), mapError);
      setDay(day);
      try {
        return await withBookingLock({ ...target, timezone: zone }, day!, write);
      } catch (error) {
        if (!(error instanceof DayMoved) || attempt >= 2) throw error;
      }
    }
  }

  /** A guard's answer, or its refusal through the caller's own `mapError`. */
  async function guardedValue<T>(run: () => Promise<T>, mapError: ((error: unknown) => never) | undefined): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (mapError !== undefined) mapError(error);
      throw error;
    }
  }

  /** The parents a written row feeds, per total — before and after a move. */
  function parentsOf(rollup: RollupInto, rows: readonly { record: Row | null; before: Row | null }[]): unknown[] {
    const parents = new Map<string, unknown>();
    for (const row of rows) {
      for (const side of [row.record, row.before]) {
        const key = side?.[rollup.via];
        if (key !== null && key !== undefined) parents.set(String(key), key);
      }
    }
    return [...parents.values()];
  }

  /**
   * Hold every parent row whose totals the write will move, in table then key
   * order — whether or not it keeps a balance: two writers adding lines to one
   * proposal at once would otherwise each add its subtotal up without the
   * other's line. A parent that keeps a balance has its totals added up again
   * from the rows as they are (what is stored may lag: a rule added since, a
   * write made elsewhere) and its balances read: that is the "before" a
   * capped write is judged against.
   */
  async function holdParents(
    rules: TableRules | null,
    target: WriteTarget,
    rows: readonly { record: Row | null; before: Row | null }[],
    currency: CurrencyOf,
  ): Promise<Held> {
    const held: Held = new Map();
    const byParent = new Map<string, { rollup: RollupInto; keys: unknown[] }>();
    for (const rollup of rules?.rollupsInto ?? []) {
      const entry = byParent.get(rollup.parent) ?? { rollup, keys: [] };
      entry.keys.push(...parentsOf(rollup, rows));
      byParent.set(rollup.parent, entry);
    }
    for (const parent of [...byParent.keys()].sort()) {
      const { rollup, keys } = byParent.get(parent)!;
      const found = await holdBalances(target.db, target.dialect, parent, rollup.parentKey, keys, rollup.balances);
      if (rollup.balances.length === 0) continue;
      for (const key of keys) {
        if (!found.has(String(key))) continue;
        // A catch-up before this write's own rows go in: read plainly (see `rollupStatement`).
        await settleParent(target.db, target.dialect, rollup.siblings, key, rollup.balances, currency, 'plain');
      }
      held.set(parent, await holdBalances(target.db, target.dialect, parent, rollup.parentKey, keys, rollup.balances));
    }
    return held;
  }

  /** Hold a row whose own capped balance a write moves; add its totals up again; read its balances. */
  async function holdOwn(
    rules: TableRules | null,
    target: WriteTarget,
    pk: Row,
    balances: TableBalance[],
    currency: CurrencyOf,
  ): Promise<Row | undefined> {
    const own = rules?.ownRollups ?? [];
    const keyColumn = own[0]?.parentKey;
    if (keyColumn === undefined) return undefined;
    const key = pk[keyColumn];
    if ((await holdBalances(target.db, target.dialect, target.table.id, keyColumn, [key], balances)).size === 0) return undefined;
    await settleParent(target.db, target.dialect, own, key, rules?.balances ?? [], currency);
    return (await holdBalances(target.db, target.dialect, target.table.id, keyColumn, [key], balances)).get(String(key));
  }

  /**
   * Every parent total a written row feeds — before and after a move — and
   * the balances they move. `cap` judges each capped balance the write moved:
   * against what {@link holdParents} read before it, or — `strict`, for a
   * write already made in this transaction — against zero.
   */
  async function settleRows(
    rules: TableRules | null,
    target: WriteTarget,
    rows: readonly { record: Row | null; before: Row | null }[],
    currency: CurrencyOf,
    cap?: Held | 'strict',
  ): Promise<void> {
    for (const rollup of rules?.rollupsInto ?? []) {
      for (const key of parentsOf(rollup, rows)) {
        await settleParent(target.db, target.dialect, [rollup], key, rollup.balances, currency);
        if (cap === undefined || !rollup.capped) continue;
        const was = cap === 'strict' ? undefined : cap.get(rollup.parent)?.get(String(key));
        const refusal = await capRefusal(target.db, rollup.parent, rollup.parentKey, key, guardedBy(rollup), was);
        if (refusal !== null) throw refusal;
      }
    }
  }

  /** Whether a write to this table settles a total: a parent's, or its own. */
  const settles = (rules: TableRules | null): boolean => (rules?.rollupsInto?.length ?? 0) + (rules?.ownRollups?.length ?? 0) > 0;

  /** Whether a settle writes to the written row itself: a total over its own child rows, and the balances beside it. */
  const keepsOwnTotals = (rules: TableRules | null): boolean => (rules?.ownRollups?.length ?? 0) > 0;

  /** Whether a written row moves a parent's total, and the parent is then held while it is written. */
  const holdsParent = (rules: TableRules | null): boolean => (rules?.rollupsInto?.length ?? 0) > 0;

  /**
   * The balances of this table a change of `values` moves: its `of` or a
   * `minus` is written — or the link a copied `of` comes through changes (a
   * new visit type, a new fee). With `record`, only a value that differs from
   * the stored one moves it: a whole-row edit sends the fee back unchanged.
   */
  const movedBalances = (rules: TableRules | null, values: Row, record?: Row | null): TableBalance[] => {
    const differs = (column: string) =>
      Object.prototype.hasOwnProperty.call(values, column) && (record === undefined || record === null || !sameValue(values[column], record[column]));
    const copiedThrough = (column: string) => (rules?.copies ?? []).filter((copy) => copy.column === column).map((copy) => copy.via);
    return (rules?.balances ?? []).filter((balance) =>
      [balance.of, ...balance.minus].some((column) => differs(column) || copiedThrough(column).some(differs)),
    );
  };

  /**
   * A row's own totals and balances. A new row's totals are added up (to
   * nothing, usually) and its balances worked out; a changed `of` or `minus`
   * works its balances out again. Given the balances as they were (`before`),
   * a capped one taken below zero refuses the write.
   */
  async function settleOwn(
    rules: TableRules | null,
    target: WriteTarget,
    action: 'create' | 'update',
    row: Row | null,
    values: Row,
    currency: CurrencyOf,
    before?: Row,
  ): Promise<void> {
    const own = rules?.ownRollups ?? [];
    const key = row?.[own[0]?.parentKey ?? ''];
    if (own.length === 0 || key === null || key === undefined) return;
    const moved = action === 'create' ? (rules?.balances ?? []) : movedBalances(rules, values);
    // A new row's totals, and the formulas that read them; its balances just below.
    if (action === 'create') await settleParent(target.db, target.dialect, own, key, [], currency);
    if (moved.length === 0) return;
    await settleBalances(target.db, target.dialect, target.table.id, own[0]!.parentKey, moved, key, {
      currencyColumn: rules?.currencyColumn,
      currency,
    });
    if (action === 'update' && before === undefined) return;
    const refusal = await capRefusal(target.db, target.table.id, own[0]!.parentKey, key, moved, before);
    if (refusal !== null) throw refusal;
  }

  /**
   * The totals rows written by a multi-row path move. Most run after their
   * commit, so nothing is refused: those paths may not write a capped balance
   * ({@link refuseGuardedBatch}) unless they bring in history. A parent form's
   * child rows are written inside its transaction, and `cap` judges them
   * there. A total that keeps a balance is settled holding its parent row, in
   * a transaction of its own when there is none.
   */
  async function settle(action: WriteAction, target: WriteTarget, rows: WrittenRow[], settleOpts?: { cap?: boolean }): Promise<void> {
    const rules = rulesOf(target);
    if (rows.length === 0 || !settles(rules)) return;
    const currency = currencyFor(target);
    const sides = rows.map((row) => (action === 'delete' ? { record: null, before: row.record } : { record: row.record, before: row.before }));
    const run = async (db: Db): Promise<void> => {
      const within = { ...target, db };
      if (holdsParent(rules)) await holdParents(rules, within, sides, currency);
      await settleRows(rules, within, sides, currency, settleOpts?.cap === true ? 'strict' : undefined);
      if (action === 'delete' || (rules?.ownRollups?.length ?? 0) === 0) return;
      for (const row of rows) {
        const key = row.record[rules!.ownRollups![0]!.parentKey];
        if (key === null || key === undefined) continue;
        // Its own totals too, and what they feed: a restored or edited row may carry child rows written beside it.
        await settleParent(db, target.dialect, rules!.ownRollups!, key, rules?.balances ?? [], currency);
      }
    };
    await (holdsParent(rules) || (rules?.balances?.length ?? 0) > 0 ? atomically(target, run) : run(target.db));
  }

  /** One transaction for a write and the totals it moves, unless one is open. */
  async function atomically<T>(target: WriteTarget, run: (db: Db) => Promise<T>): Promise<T> {
    return inTransaction(target.db) ? run(target.db) : target.db.transaction().execute(run);
  }

  /**
   * Whether one row of a batch update could need the booking guard: it moves
   * the visit, or sets a status that takes time (which may be a cancelled
   * visit booked again). A status step out of counting — marking visits seen
   * or no-show together — needs no lock and goes through as a batch.
   */
  function movesBooking(rule: NonNullable<TableRules['booking']>, row: Row): boolean {
    if ([rule.start, rule.minutes, rule.resource, rule.kind].some((column) => Object.prototype.hasOwnProperty.call(row, column))) return true;
    return Object.prototype.hasOwnProperty.call(row, rule.countWhere.column) && bookingCounts(rule, row);
  }

  /**
   * Whether an update of a child row can move one of these totals: it writes
   * what a total adds up, links, leaves out or counts — or an input of the
   * formula that works the added-up column out (a line's qty, under its
   * amount). Putting lines in another order moves no total.
   */
  function movesTotal(rules: TableRules | null, rollups: readonly RollupInto[], row: Row): boolean {
    const written = new Set(Object.keys(row));
    for (const formula of touchedFormulas(rules?.formulas ?? [], written)) written.add(formula.column);
    return rollups.some((rollup) =>
      [rollup.sum, rollup.times, rollup.via, rollup.unlessSet, rollup.where?.column].some((column) => column !== undefined && written.has(column)),
    );
  }

  /** Whether a multi-row write must be refused: rows that each need their slot held, or a balance kept at zero. */
  function refuseGuardedBatch(
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    rows: readonly Row[],
    capacity: BeforeEachOptions['capacity'],
  ): void {
    if (capacity === 'unchecked') return;
    // A multi-row path settles its totals after it commits, too late to take
    // back a payment the balance had no room for. A parent form's child rows
    // are the exception: written inside the form's transaction, and settled
    // and judged there (`settle` with `cap`).
    const capped = (rules?.rollupsInto ?? []).filter((rollup) => rollup.capped);
    if (capped.length > 0 && !target.db.isTransaction && (action !== 'update' || rows.some((row) => movesTotal(rules, capped, row)))) {
      throw new BalanceBatchError(target.table.name);
    }
    if (action === 'delete') return;
    if (rules?.capacity === undefined && rules?.booking === undefined) return;
    if (
      action === 'update' &&
      !rows.some(
        (row) =>
          (rules.capacity !== undefined && touchesGuard(rules.capacity, row)) ||
          (rules.booking !== undefined && movesBooking(rules.booking, row)),
      )
    ) {
      return;
    }
    throw new GuardedBatchError(target.table.name);
  }

  /**
   * A row of a multi-row update that changes a capped balance's `of` or
   * `minus` (a lower fee), judged once its values are resolved and its hooks
   * have run — against the stored row, so a whole-row edit that sends the
   * fee back unchanged is not one.
   */
  function refuseMovedBalance(
    rules: TableRules | null,
    target: WriteTarget,
    values: Row,
    record: Row | null,
    capacity: BeforeEachOptions['capacity'],
  ): void {
    if (capacity === 'unchecked' || target.db.isTransaction) return;
    if (movedBalances(rules, values, record).some((balance) => balance.cappedBy.length > 0)) throw new BalanceBatchError(target.table.name);
  }

  async function runBefore(
    hooks: RecordHooks,
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    values: Row,
    record: Row | null,
  ): Promise<Row> {
    const event: BeforeWriteEvent = { action, target, values: { ...values }, record, context };
    await hooks.before(event);
    const out = valuesAfterHooks(target, values, event.values);
    // What the hook judged on travels with the values to the UPDATE's own WHERE.
    return action === 'update' && event.expect !== undefined && Object.keys(event.expect).length > 0 ? attachExpect(out, event.expect) : out;
  }

  async function statement<T>(run: () => Promise<T>, mapError: ((error: unknown) => never) | undefined): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (mapError !== undefined) mapError(error);
      throw error;
    }
  }

  /**
   * A whole write, locks and commit included. A lock conflict can surface
   * where no `statement` is watching — the `FOR UPDATE` on a parent's
   * balance, a named lock, the COMMIT itself — so ONLY a lock conflict is
   * handed to the caller's `mapError` here (`db-errors.ts` rule 5). Anything
   * else has already been through it, or never should be.
   */
  async function conflicted<T>(run: () => Promise<T>, mapError: ((error: unknown) => never) | undefined): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (mapError !== undefined && isWriteConflict(error)) mapError(error);
      throw error;
    }
  }

  return {
    get hooks() {
      return current();
    },

    wants: (timing, action, target, context) => current().wants(timing, action, target, context),

    async check(action, target, context, rows, checkOpts) {
      const rules = rulesOf(target);
      refuseGuardedBatch(rules, action, target, rows, checkOpts?.capacity);
      const now = new Date();
      const memo: CopyMemo = new Map();
      const out: (CheckedRow | null)[] = [];
      const issues: (FieldIssues | null)[] = [];
      for (const row of rows) {
        // No stored row here: an update's formulas are worked out by a path that reads one (`beforeEach`).
        const values = await formulate(rules, action, target, await prepareValues(rules, action, target, context, row, now, memo), null);
        const issue = mergeIssues(checkRow(rules, action, values, { dialect: target.dialect }), await boundIssues(rules, action, target, context, values, null));
        issues.push(issue);
        out.push(issue === null ? await carry(rules, action, target, context, await numbered(rules, action, target, context, brand(values)), null) : null);
      }
      return { rows: out, issues };
    },

    async create(input) {
      const { target, context } = input;
      const hooks = current();
      const rules = rulesOf(target);
      const currency = currencyFor(target);
      const zone = await zoneFor(rules, target);
      const filled = localize(rules, target, fill(rules, 'create', target, context, input.values, new Date()), zone);
      const resolved = await fillFromElsewhere(rules, 'create', target, await resolveRow(rules, 'create', target, filled), opts.settings);
      // DECIDE: what creating the row makes Adminium write (a stamp), before the hooks and CHECK.
      const decided = await decideRow(rules, 'create', resolved, null, decideContext(target, context, new Date(), zone));
      // A total, a formula and a number are Adminium's alone, whatever a hook set.
      const hooked = (await hooks.wants('before', 'create', target, context))
        ? withoutReadOnly(rules, await runBefore(hooks, 'create', target, context, decided, null), context.origin)
        : decided;
      const values = await formulate(rules, 'create', target, hooked, null);
      if (values !== input.values && input.recheck !== undefined) await input.recheck(values);
      // What a number without gaps needs at its INSERT, read before any lock is taken.
      const checked = await carry(
        rules,
        'create',
        target,
        context,
        brand(await prepareNumbers(rules, 'create', target, await checkAllOrThrow(rules, 'create', target, context, values, null, input.mapError), context.origin, opts.settings)),
        null,
      );
      // Only the codes generated here, and left alone by the hooks, are made again.
      const codes = generatedCodes(rules, filled).filter((code) => values[code.column] === resolved[code.column]);
      const booking = rules?.booking;
      const need = booking === undefined ? null : bookingNeed(booking, checked, null);
      const now = new Date();
      const write = async (db: Db) => {
        const within = { ...target, db, timezone: zone, origin: context.origin };
        const capacity = rules?.capacity;
        if (capacity !== undefined) await guarded(() => checkCapacity(capacity, within, checked, null), input.mapError);
        // "Anyone" comes back as the person the guard picked, written and reported with the row.
        const placed =
          booking !== undefined && need !== null
            ? brand({ ...checked, ...(await guardedValue(() => checkBooking(booking, within, { row: checked, before: null, need, now }), input.mapError)) })
            : checked;
        // The parents whose totals this row moves, held before it is written.
        const held = await holdParents(rules, within, [{ record: placed, before: null }], currency);
        const counted = brand(await claimSequences(rules, 'create', within, placed, opts.sequences));
        const out = await insertWithCodes(within, counted, codes, input.mapError);
        await guarded(async () => {
          await settleRows(rules, within, [{ record: out.row, before: null }], currency, held);
          await settleOwn(rules, within, 'create', out.row, out.values, currency);
        }, input.mapError);
        // SEAL again over the row's own totals, once they are added up.
        const sealing = sealsOf(checked);
        if (sealing !== undefined && keepsOwnTotals(rules)) await sealRows(db, target.table, pkOf(target.table, out.row), sealing, writeSeals);
        // The row as its own totals left it: the INSERT returned it before they were added up.
        return keepsOwnTotals(rules) ? { ...out, row: await readAgain(db, target.table, out.row) } : out;
      };
      let day: string | null = null;
      if (booking !== undefined && need !== null) {
        day = bookingDay(booking, checked, zone ?? 'UTC');
        if (day === null) await guarded(() => Promise.reject(bookingRefusal('BOOKING_OUT_OF_RANGE', booking.start)), input.mapError);
      }
      // A number without gaps is taken under the series' lock, held until the row commits.
      const series = numberLockName(target.table, checked);
      const { row, values: written } = await conflicted(
        () =>
          rules?.capacity !== undefined
            ? withSlotLock(rules.capacity, target, checked, write)
            : day !== null
              ? withBookingLock({ ...target, timezone: zone }, day, write)
              : series !== null && !inTransaction(target.db)
                ? withNamedLock(target, series, 'NUMBER_BUSY', write)
                : settles(rules) || series !== null
                  ? atomically(target, write)
                  : write(target.db),
        input.mapError,
      );
      await input.announce(row, written);
      if (await hooks.wants('after', 'create', target, context)) {
        await hooks.after({ action: 'create', target, record: row, before: null, context });
      }
      return row;
    },

    async update(input) {
      const { target, context, pk } = input;
      const hooks = current();
      const rules = rulesOf(target);
      const currency = currencyFor(target);
      let before = input.before ?? null;
      /*
       * The FILLED values, from here on. `UpdateOutcome.values` is what the
       * PATCH route hands `issueUndo` as the entry's changed columns, so an
       * `updated_at` that never reached this variable would be left OUT of the
       * undo — and the restored row would come back carrying the timestamp of
       * the edit that was just taken back.
       */
      const zone = await zoneFor(rules, target);
      let values = await prepareValues(rules, 'update', target, context, input.values, new Date());
      const wantsBefore = await hooks.wants('before', 'update', target, context);
      const wantsAfter = await hooks.wants('after', 'update', target, context);
      // The stored row: for the hooks, and for what Adminium decides and works out from it.
      const stored = needsStored(rules);
      const watched = input.before === undefined && !(wantsBefore || wantsAfter || stored) && (await opts.watched?.(target.connectionId, target.table.id)) === true;
      if ((wantsBefore || wantsAfter || stored || watched) && input.before === undefined) {
        before = input.load !== undefined ? await input.load() : ((await fetchByPk(target.db, target.table, pk)) ?? null);
      }
      // DECIDE: what this change makes Adminium write (a late cancellation's
      // flag, a stamp), before the hooks and CHECK see the values — so it is
      // checked, written in the same statement, and carried into the undo entry.
      if (stored) {
        values = await guardedValue(
          () => decideRow(rules, 'update', values, before, decideContext(target, context, new Date(), zone)),
          input.mapError,
        );
      }
      // A row the caller cannot see is not a hook's business: the UPDATE below
      // matches nothing and the caller answers as it always has.
      if (wantsBefore && before !== null) {
        values = withoutReadOnly(rules, await runBefore(hooks, 'update', target, context, values, before), context.origin);
      }
      // FORMULA, over the stored row: a change of `qty` alone still has the `rate` it multiplies.
      values = await formulate(rules, 'update', target, values, before);
      if (values !== input.values && input.recheck !== undefined) await input.recheck(values);
      // CHECK, and what the statement judges this write by: a document's states, and the fingerprints it seals.
      const checkedValues = await carry(rules, 'update', target, context, await checkAllOrThrow(rules, 'update', target, context, values, before, input.mapError), before);
      const capacity = rules?.capacity !== undefined && touchesGuard(rules.capacity, values) ? rules.capacity : undefined;
      const booking = rules?.booking !== undefined && touchesBooking(rules.booking, values) ? rules.booking : undefined;
      // The formulas this change moves: worked out again below from the row as held.
      const worked = (rules?.formulas ?? []).filter((formula) => Object.prototype.hasOwnProperty.call(checkedValues, formula.column));
      // A changed fee (or what is taken off it, or a total a formula works out) moves this row's own balances.
      const moved = movedBalances(rules, checkedValues);
      const rolls = (rules?.rollupsInto?.length ?? 0) > 0 || moved.length > 0 || worked.length > 0;
      const now = new Date();
      /** The day the booking lock was named by; the write refuses to go on under a different one. */
      let lockedDay: string | null = null;
      const write = async (db: Db) => {
        const within = { ...target, db, timezone: zone, origin: context.origin };
        // The row as stored, read under the lock: what the guard leaves out
        // of its sum, the parent a moved child leaves, and what a formula
        // reads. Held too when it feeds a parent's total or works a formula
        // out: a writer moving it meanwhile would leave this one settling the
        // wrong parent, and a line settled meanwhile a subtotal read too early.
        const prior =
          capacity !== undefined || booking !== undefined || rolls
            ? ((holdsParent(rules) || worked.length > 0 ? await fetchHeld(db, target, pk) : await fetchByPk(db, target.table, pk)) ?? null)
            : null;
        if (capacity !== undefined && prior !== null) {
          await guarded(() => checkCapacity(capacity, within, checkedValues, prior), input.mapError);
        }
        let written = checkedValues;
        if (booking !== undefined && prior !== null) {
          const need = bookingNeed(booking, checkedValues, prior);
          if (need !== null) {
            // Another writer moved the row between the lock's naming and now:
            // start again under the day it will really hold.
            if (bookingDay(booking, { ...prior, ...checkedValues }, zone ?? 'UTC') !== lockedDay) throw new DayMoved();
            const merged = { ...prior, ...checkedValues };
            const picked = await guardedValue(() => checkBooking(booking, within, { row: merged, before: prior, need, now }), input.mapError);
            if (Object.keys(picked).length > 0) written = brand({ ...checkedValues, ...picked });
          }
        }
        // Worked out again from the row as held: a total over child rows may have moved since it was first read.
        if (worked.length > 0 && prior !== null) {
          const connection = readsCurrency(rules) ? await currency() : null;
          written = brand({ ...written, ...evaluateAll(worked, { ...prior, ...written }, rules?.currencyColumn, connection) });
        }
        // The parents whose totals the write moves, and this row's own capped
        // balances, held — and read as they are — before the statement.
        const held = await holdParents(rules, within, [{ record: { ...(prior ?? {}), ...written }, before: prior }], currency);
        // This row's own balances, when the write really changes what they are worked out from.
        const ownMoved = movedBalances(rules, written, prior);
        const ownBefore = ownMoved.some((balance) => balance.cappedBy.length > 0) ? await holdOwn(rules, within, pk, ownMoved, currency) : undefined;
        const changed = await statement(() => updateRows(db, target.dialect, target.table, written, pk, input.refine), input.mapError);
        if (changed > 0 && rolls) {
          const after = (await fetchByPk(db, target.table, pk)) ?? null;
          await guarded(async () => {
            await settleRows(rules, within, [{ record: after, before: prior }], currency, held);
            if (ownMoved.length > 0) await settleOwn(rules, within, 'update', after, written, currency, ownBefore);
          }, input.mapError);
          // SEAL again over the totals the settle just wrote beside the row.
          const sealing = sealsOf(written);
          if (sealing !== undefined) await sealRows(db, target.table, pk, sealing, writeSeals);
        }
        if (written !== checkedValues) values = written;
        return changed;
      };
      const count = await conflicted(async () => {
        if (capacity !== undefined) {
          // The lock is named by the slot the row will hold.
          const current = before ?? ((await fetchByPk(target.db, target.table, pk)) ?? null);
          return await withSlotLock(capacity, target, { ...(current ?? {}), ...checkedValues }, write);
        }
        if (booking !== undefined) {
          return await bookedUpdate(booking, target, zone, pk, checkedValues, (day) => {
            lockedDay = day;
          }, write, rolls, input.mapError);
        }
        return rolls ? await atomically(target, write) : await write(target.db);
      }, input.mapError);
      if (count === 0 && input.skipIfNone === true) return { before, after: null, values, count };
      const after = (await fetchByPk(target.db, target.table, pk)) ?? null;
      const outcome: UpdateOutcome = { before, after, values, count };
      await input.announce(outcome);
      if (count > 0 && after !== null && wantsAfter) {
        await hooks.after({ action: 'update', target, record: after, before, context });
      }
      return outcome;
    },

    async delete(input) {
      const { target, context, pk } = input;
      const hooks = current();
      const before = input.before ?? (input.load === undefined ? null : await input.load());
      if (before === null && input.load !== undefined && input.skipIfNone === true) return 0;
      if (before !== null && (await hooks.wants('before', 'delete', target, context))) {
        await runBefore(hooks, 'delete', target, context, {}, before);
      }
      const rules = rulesOf(target);
      const currency = currencyFor(target);
      const rolls = (rules?.rollupsInto?.length ?? 0) > 0;
      // A document's states judge the delete — unless the caller's scope could not see the row, which then matches nothing.
      const judged =
        input.refine !== undefined && before === null ? undefined : { dialect: target.dialect, prepared: await carry(rules, 'delete', target, context, brand({}), before) };
      const count = rolls
        ? await conflicted(() => atomically(target, async (db) => {
            // The parent the row fed, read — and held — before it goes.
            const gone = (await fetchHeld(db, target, pk)) ?? null;
            const within = { ...target, db };
            const held = await holdParents(rules, within, [{ record: null, before: gone }], currency);
            const removed = await statement(() => deleteRows(db, target.table, pk, input.refine, judged), input.mapError);
            if (removed > 0) await guarded(() => settleRows(rules, within, [{ record: null, before: gone }], currency, held), input.mapError);
            return removed;
          }), input.mapError)
        : await conflicted(() => statement(() => deleteRows(target.db, target.table, pk, input.refine, judged), input.mapError), input.mapError);
      if (count === 0 && input.skipIfNone === true) return 0;
      await input.announce(count, before);
      if (count > 0 && before !== null && (await hooks.wants('after', 'delete', target, context))) {
        await hooks.after({ action: 'delete', target, record: before, before: null, context });
      }
      return count;
    },

    async beforeEach(action, target, context, rows, beforeOpts) {
      const hooks = current();
      const withRules = beforeOpts?.rules !== false;
      const rules = withRules ? rulesOf(target) : null;
      refuseGuardedBatch(
        rules,
        action,
        target,
        rows.map((row) => row.values),
        beforeOpts?.capacity,
      );
      const now = new Date();
      const memo: CopyMemo = new Map();
      const zone = withRules ? await zoneFor(rules, target) : undefined;
      /**
       * FORMULA over the row as stored, CHECK, then SEQUENCE for a row that
       * passed — carrying what its statement judges it by.
       */
      const prepare = async (values: Row, record: Row | null): Promise<{ values: CheckedRow; issues: FieldIssues | null }> => {
        if (!withRules) return { values: brand(values), issues: null };
        const worked = await formulate(rules, action, target, values, record);
        const issues = mergeIssues(checkRow(rules, action, worked, { dialect: target.dialect }), await boundIssues(rules, action, target, context, worked, record));
        // A refused row is not written, so it is given no number.
        if (issues !== null) return { values: brand(worked), issues };
        return { values: await carry(rules, action, target, context, await numbered(rules, action, target, context, brand(worked)), record), issues };
      };
      const start = (values: Row): Promise<Row> =>
        withRules ? prepareValues(rules, action, target, context, values, now, memo) : Promise.resolve(values);
      /** DECIDE against the stored row, as a single-row write does; a refusal is that row's own issue. */
      const decided = async (values: Row, record: Row | null): Promise<{ values: Row; refused: FieldIssues | null }> => {
        if (!withRules || action === 'delete' || (action === 'update' && !needsStored(rules))) return { values, refused: null };
        try {
          return { values: await decideRow(rules, action, values, record, decideContext(target, context, now, zone)), refused: null };
        } catch (error) {
          const column = String(((error as { details?: { column?: unknown } }).details?.column ?? '') || 'row');
          return { values, refused: { [column]: { code: 'not-allowed' } } };
        }
      };
      const storedOf = async (row: PlannedRow): Promise<Row | null> =>
        row.record !== undefined ? row.record : row.match === undefined ? null : ((await fetchByPk(target.db, target.table, row.match)) ?? null);
      if (!(await hooks.wants('before', action, target, context))) {
        const out: PreparedRow[] = [];
        for (const row of rows) {
          const filled = await start(row.values);
          if (action === 'update' && withRules && movedBalances(rules, filled).some((balance) => balance.cappedBy.length > 0)) {
            refuseMovedBalance(rules, target, filled, await storedOf(row), beforeOpts?.capacity);
          }
          if (withRules && (action === 'create' || needsStored(rules))) {
            const record = action === 'create' ? null : await storedOf(row);
            const { values, refused } = await decided(filled, record);
            out.push(refused === null ? { ...(await prepare(values, record)), record: undefined } : { values: brand(values), issues: refused, record: undefined });
            continue;
          }
          out.push({ ...(await prepare(filled, null)), record: undefined });
        }
        return out;
      }
      const prepared: PreparedRow[] = [];
      for (const row of rows) {
        const filled = await start(row.values);
        let record: Row | null = null;
        if (action !== 'create') {
          record = await storedOf(row);
          if (record === null) {
            // The row is gone; the caller reports it. Nothing is checked,
            // because nothing will be written.
            prepared.push({ values: brand(filled), record: null, issues: null });
            continue;
          }
        }
        const { values: settled, refused } = await decided(filled, record);
        if (refused !== null) {
          prepared.push({ values: brand(settled), record, issues: refused });
          continue;
        }
        const values = withoutReadOnly(rules, await runBefore(hooks, action, target, context, action === 'delete' ? {} : settled, record), context.origin);
        if (action === 'update') refuseMovedBalance(rules, target, values, record, beforeOpts?.capacity);
        prepared.push({ ...(await prepare(action === 'delete' ? settled : values, record)), record });
      }
      return prepared;
    },

    async afterEach(action, target, context, rows) {
      if (rows.length === 0) return;
      await settle(action, target, rows);
      const hooks = current();
      if (!(await hooks.wants('after', action, target, context))) return;
      for (const row of rows) {
        await hooks.after({ action, target, record: row.record, before: row.before, context });
      }
    },

    settle,

    transaction: (target, rows, run, children = []) =>
      withSeriesLocks(
        target.db,
        target.dialect,
        [
          ...rows.flatMap((row) => numberLockName(target.table, row) ?? []),
          ...children.flatMap((child) => seriesOf(rulesOf(child.target), child.target.table, child.row)),
        ],
        run,
      ),

    async stored(target, rows) {
      if (!keepsOwnTotals(rulesOf(target))) return [...rows];
      const out: Row[] = [];
      for (const row of rows) out.push(await readAgain(target.db, target.table, row));
      return out;
    },
  };
}
