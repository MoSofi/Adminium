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
 * before this module existed. The one thing judged on every table is U+0000
 * in text, which one engine refuses and the other two store
 * (`unstorableText` in `crud/column-rules.ts`): it costs a walk over the
 * values and nothing more.
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
import type { TablePrivileges } from '@adminium/engine/adapter';

import { rollupValue } from '@adminium/manifest';

import { AppError, ConflictError, ValidationFailedError } from '../errors.js';
import type { StateLink } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { columnGranted, refuseUngrantedColumns } from '../connections/privileges.js';
import { getPrincipal } from '../rbac/principal.js';
import { capacityLockNames, touchesCapacity } from './capacity/judge.js';
import { batchNeedsGuard, judgeRows, withLimitLocks } from './capacity/door.js';
import { bookingCounts, bookingDay, bookingNeed, bookingRefusal, checkBooking, touchesBooking, withBookingLock } from './booking-guard.js';
import { decideRow, needsStored, stampFires, stampYields, type DecideContext } from './decide.js';
import { renewedColumns, withRenewRetry } from './code-renew.js';
import { isWriteConflict } from './db-errors.js';
import {
  attachRequiredGuards,
  checkRow,
  fillRow,
  guardedBy,
  requiredGuards,
  requiredGuardsOf,
  tableRulesFor,
  unstorableText,
  priceIssuesOf,
  withoutReadOnly,
  withoutRequiredWhen,
  type ColumnCode,
  type RequiredGuard,
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
import { attachExpect, attachGuard, createdBy, dayOf, deleteRefusal, expectOf, guardOf, guardedDelete, holdLinkedFirst, holdParentsFirst, instantOf, guardedInsert, guardedUpdate, rowMoved, StateMoveRefused, tiedToStates, type ClearColumns, type EffectWriter, type EffectWritten } from './states.js';
import { attachWindows, statesReadClock, waitVias, type StateWindow } from './state-conditions.js';
import { momentVias } from './moments.js';
import { refuseUnbuiltTable } from './unbuilt-rules.js';
import { venueClock } from './venue-time.js';
import { isOutboxWrite } from '../outbox/context.js';
import {
  claimSequences,
  generatedCodes,
  isUniqueViolation,
  regenerateCodes,
  resolveRow,
  sequenceKey,
  type CopyMemo,
  type SequenceStore,
} from './decided-columns.js';
import type { ResolvedColumn, ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import { fetchByPk } from './records.js';
import { venueLocalValue } from './venue-time.js';
import { priceValues, repricedBy } from './per-night.js';
import { followChanged, followColumns, followNow, followsFrom } from './follow.js';
import { stampNow, writeClock, type WriteClock } from './write-clock.js';
import type { ClimbStart, HeldBalances, HoldChain, SettleChain } from './climb.js';
import { TREE_MAX_ROWS, type CreateTree, type TreeNode, type TreeOutcome, type TreeWritten } from './write-tree.js';
import { judgeCapacity } from './capacity/judge.js';
import { LockMoved, withNamedLocks, type NamedLock } from './capacity/locks.js';
import type { JudgedRow, LockNameRow, PoolState } from './capacity/types.js';
import { bindWriteValue, booleanOf, normalizeWriteValue, sameValue, zonedWriteValue } from './write-values.js';
import type { WriteAction, WriteActor, WriteContext, WriteOrigin, WriteTarget } from './write-context.js';

// The write's own vocabulary lives in a leaf, because `column-rules.ts` reads
// it and this module reads the rules — see `write-context.ts`. Re-exported so
// every caller still finds them here. `WriteContext` joined them because the
// outbox's own context (`outbox/context.ts`) is read here and names it.
export type { WriteAction, WriteActor, WriteContext, WriteOrigin, WriteTarget } from './write-context.js';


/**
 * The origins whose value for a `code` column is never taken: a code is an
 * unguessable secret (a shared link's token), so a person never picks it —
 * a create makes one, a change leaves it be, and only the server's own "make
 * a new link" (an `action`) replaces it. A whole-record form that sends the
 * code back unchanged still saves: the value is dropped, not refused, as
 * every read-only column is. An undo restores what was there, and imports
 * are held to it in the import job (sample loads keep their own codes).
 */
const CODE_BLIND_ORIGINS: ReadonlySet<WriteOrigin> = new Set(['dashboard', 'bulk', 'public', 'automation']);

function withoutTypedCodes(rules: TableRules | null, context: WriteContext, values: Row): Row {
  const codes = rules?.codes ?? [];
  if (codes.length === 0 || !CODE_BLIND_ORIGINS.has(context.origin)) return values;
  if (!codes.some((code) => Object.prototype.hasOwnProperty.call(values, code.column))) return values;
  const out = { ...values };
  for (const code of codes) delete out[code.column];
  return out;
}

/** The rules a write is judged by: the outbox's own writes to its own table skip a `requiredWhen` (`withoutRequiredWhen`). */
function judgedBy(rules: TableRules | null, target: WriteTarget, context: WriteContext): TableRules | null {
  return isOutboxWrite(context, target.table.id) ? withoutRequiredWhen(rules) : rules;
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
 * And an instant for a MySQL `TIMESTAMP` is spelled as its UTC wall time — an
 * ISO one is refused there, and a Date read back (an undo) would be written in
 * this process's zone (`bindWriteValue`).
 */
function storable(table: ResolvedTable, values: CheckedRow, dialect: Dialect): CheckedRow {
  let out: Row | null = null;
  for (const [name, value] of Object.entries(values)) {
    if (dialect === 'mysql' && value !== null && value !== undefined) {
      const column = table.columns.get(name);
      const bound = column?.logicalType === 'timestamptz' ? bindWriteValue(column, value, dialect) : value;
      if (bound !== value) {
        out ??= { ...values };
        out[name] = bound;
        continue;
      }
    }
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
 * The conditions a column required by another was judged on
 * (`RequiredGuard`), in an UPDATE's WHERE: the column still holds an answer,
 * or the other column still holds none of the values. A value the rule lists
 * as `true` is `1` to a column that keeps a boolean as a number.
 */
function requiredWhere(query: AnyUpdate, table: ResolvedTable, dialect: Dialect, guards: readonly RequiredGuard[]): AnyUpdate {
  let out = query;
  for (const guard of guards) {
    if (guard.kind === 'filled') {
      out = out.where((eb) => eb(eb.ref(guard.column as never), 'is not', null));
      if (guard.text) out = out.where((eb) => eb(eb.fn('trim', [eb.ref(guard.column as never)]), '<>', ''));
      continue;
    }
    const numeric = table.columns.get(guard.other)?.logicalType !== 'boolean';
    const listed = guard.values.map((value) => (typeof value === 'boolean' && (numeric || dialect === 'sqlite') ? (value ? 1 : 0) : value));
    out = out.where((eb) => eb.or([eb(eb.ref(guard.other as never), 'is', null), eb(eb.ref(guard.other as never), 'not in', listed as never[])]));
  }
  return out;
}

/**
 * A value as the write carries it for its column, from the moment it is
 * filled to the statement: a zoned time bound for a zone-less `timestamp` is
 * this server's wall clock; a zone-less time bound for a column that keeps a
 * zone is the instant it names on this server's clock (`zonedWriteValue`),
 * so the database's session zone never decides it and a formula counting
 * hours reads the moment that is stored; and a yes or a no — in a boolean
 * column, or on SQLite in a number one a `requiredWhen` reads as one (SQLite
 * keeps an app's boolean as a number) — is `true` or `false`, stored as that
 * answer on every engine and compared as it by every rule. A number column
 * on Postgres or MySQL keeps its numbers, whatever a rule lists: `true` is
 * no integer there.
 */
function spelledForColumn(rules: TableRules | null, column: ResolvedColumn, value: unknown, dialect: Dialect, venueLocal = false): unknown {
  if (typeof value === 'string' && column.logicalType === 'timestamp') return normalizeWriteValue(column, value);
  if (column.logicalType === 'timestamptz') return venueLocal ? value : zonedWriteValue(column, value);
  const yesNo =
    column.logicalType === 'boolean' ||
    (dialect === 'sqlite' && (rules?.checks ?? []).some((check) => check.requiredWhen?.column === column.name && check.requiredWhen.in.some((listed) => typeof listed === 'boolean')));
  if (!yesNo || typeof value === 'boolean') return value;
  return booleanOf(value) ?? value;
}

/** The refusal a guarded update gets when the row it was judged on changed under it. */
function requiredRefusal(guards: readonly RequiredGuard[]): ValidationFailedError {
  return new ValidationFailedError('Some values were refused.', { fields: Object.fromEntries(guards.map((guard) => [guard.column, { code: 'required' }])) });
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
  // What a column required by another was judged on must still hold, in the same WHERE.
  const required = requiredGuardsOf(values);
  const stillRequired = required === undefined ? undefined : (query: AnyUpdate): AnyUpdate => requiredWhere(query, table, dialect, required);
  // What a before hook judged the write on must still hold, in the statement's own WHERE.
  const narrowed =
    expected === undefined && stillRequired === undefined
      ? refine
      : (query: AnyUpdate): AnyUpdate => {
          let out = refine === undefined ? query : refine(query);
          for (const [column, value] of Object.entries(expected ?? {})) {
            const resolved = table.columns.get(column);
            // A moment read back as a Date: on MySQL, spelled as the column holds it.
            const bound = resolved?.logicalType === 'timestamptz' ? bindWriteValue(resolved, value, dialect) : value;
            out = out.where((eb) => (bound === null || bound === undefined ? eb(eb.ref(column as never), 'is', null) : eb(eb.ref(column as never), '=', bound as never)));
          }
          return stillRequired === undefined ? out : stillRequired(out);
        };
  /** Whether the row, as it is now, still answers what the required rule judged it on. */
  const answers = async (tx: Db): Promise<boolean> => {
    let query = tx.updateTable(table.id).set(same as never) as unknown as AnyUpdate;
    for (const [column, value] of Object.entries(match)) query = query.where((eb) => eb(tx.dynamic.ref(column), '=', value));
    if (refine !== undefined) query = refine(query);
    return Number((await stillRequired!(query).executeTakeFirst()).numUpdatedRows) > 0;
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
      // Another writer changed the row since it was judged: refused as the check would refuse it now.
      if (count === 0 && required !== undefined && (await present(tx)) && !(await answers(tx))) throw requiredRefusal(required);
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
  const conditions = [
    sql`${sql.ref(rollup.via)} = ${parentKey}`,
    ...(rollup.unlessSet === undefined ? [] : [sql`${sql.ref(rollup.unlessSet)} is null`]),
    ...(rollup.where === undefined ? [] : [sql`${sql.ref(rollup.where.column)} = ${bindValue(dialect, rollup.where.eq)}`]),
  ];
  const where = sql.join(conditions, sql` and `);
  /*
   * SQLite adds decimals as floats: a line of 1.500 × 0.33 is a hair under
   * 0.495 there and rounds to 0.49, where Postgres and MySQL, adding exact
   * decimals, round to 0.50. So SQLite reads the rows and adds them up
   * exactly here (it has one writer: the read needs no lock); a count is
   * exact everywhere and stays in SQL.
   */
  if (dialect === 'sqlite' && rollup.count !== true) {
    const columns = [rollup.sum, ...(rollup.times === undefined ? [] : [rollup.times])];
    const rows = (await sql<Row>`select ${sql.join(columns.map((column) => sql.ref(column)))} from ${sql.table(rollup.child)} where ${where}`.execute(db)).rows;
    await db
      .updateTable(rollup.parent)
      .set({ [rollup.column]: rollupValue(rows, { sum: rollup.sum, times: rollup.times }, places) } as never)
      .where((eb) => eb(db.dynamic.ref(rollup.parentKey), '=', parentKey))
      .execute();
    return;
  }
  const amount = rollup.times === undefined ? sql`${sql.ref(rollup.sum)}` : sql`${sql.ref(rollup.sum)} * ${sql.ref(rollup.times)}`;
  // A count of rows is a whole number: nothing to round.
  const rounded = rollup.count === true ? sql`count(*)` : roundedSql(dialect, sql`coalesce(sum(${amount}), 0)`, places);
  const added = sql`(select ${rounded} from ${sql.table(rollup.child)} where ${where})`;
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
 * the row as it is now stored — read holding it, which on MySQL is also what
 * reads past the transaction's snapshot to the latest row. Held as the climb
 * and the states guard hold a parent (FOR NO KEY UPDATE on Postgres: see
 * `rowsByKey`), so no row is held two ways in one write: a FOR UPDATE taken
 * over it would wait for a writer that went in between with a row pointing
 * at it, which may be waiting for this one.
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
  if (dialect !== 'sqlite') query = dialect === 'postgres' ? query.forNoKeyUpdate() : query.forUpdate();
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
 * they are, before the write: a second payment on the same visit waits here
 * until the first commits, and then adds up a total that includes it (a
 * statement already waiting on the row would add up the old one). Held as
 * every row a write keeps is (FOR NO KEY UPDATE on Postgres, FOR UPDATE on
 * MySQL: see `states.ts` `heldRows`). SQLite writes one transaction at a time.
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
  if (dialect !== 'sqlite') query = dialect === 'postgres' ? query.forNoKeyUpdate() : query.forUpdate();
  const rows = (await query.execute()) as Row[];
  return new Map(rows.map((row) => [String(row[keyColumn]), row]));
}

/**
 * A row read and held for this transaction (SQLite writes one at a time): a
 * row the write changes FOR NO KEY UPDATE on Postgres, as every row a write
 * keeps is held (`states.ts` `heldRows`); one it deletes FOR UPDATE.
 */
async function fetchHeld(db: Db, target: WriteTarget, pk: Row, stays: boolean): Promise<Row | undefined> {
  let query = db.selectFrom(target.table.id).selectAll();
  for (const [column, value] of Object.entries(pk)) query = query.where((eb) => eb(db.dynamic.ref(column), '=', value));
  if (target.dialect !== 'sqlite') query = stays && target.dialect === 'postgres' ? query.forNoKeyUpdate() : query.forUpdate();
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

// --- totals that climb -------------------------------------------------------

/** A chain climbs this many rows high at most: option → line → order → customer. */
const CLIMB_HOPS = 3;

/** Where a write's rows start a chain: each total they feed, and the parents they feed it in — before and after a move. */
function chainStarts(rules: TableRules | null, rows: readonly { record: Row | null; before: Row | null }[]): ClimbStart[] {
  const out: ClimbStart[] = [];
  for (const rollup of rules?.rollupsInto ?? []) {
    const keys = new Map<string, unknown>();
    for (const row of rows) {
      for (const side of [row.record, row.before]) {
        const key = side?.[rollup.via];
        if (key !== null && key !== undefined) keys.set(String(key), key);
      }
    }
    if (keys.size > 0) out.push({ rollup, keys: [...keys.values()] });
  }
  return out;
}

/** One table's rows at one height of a chain: the totals that reach it, and their keys. */
interface ChainLevel {
  table: string;
  keyColumn: string;
  /** The totals of this table the chain moves (one parent's; they share its balances). */
  rollups: RollupInto[];
  keys: Map<string, unknown>;
}

/** The starts grouped by parent table, keys deduplicated. */
function chainLevel(start: readonly ClimbStart[]): Map<string, ChainLevel> {
  const out = new Map<string, ChainLevel>();
  for (const { rollup, keys } of start) {
    const level = out.get(rollup.parent) ?? { table: rollup.parent, keyColumn: rollup.parentKey, rollups: [], keys: new Map<string, unknown>() };
    if (!level.rollups.includes(rollup)) level.rollups.push(rollup);
    for (const key of keys) if (key !== null && key !== undefined) level.keys.set(String(key), key);
    out.set(rollup.parent, level);
  }
  return out;
}

/** The totals one height up from these, by the link each row climbs through. */
function climbsOf(level: ChainLevel): RollupInto[] {
  const out: RollupInto[] = [];
  for (const rollup of level.rollups) for (const climb of rollup.climbs) if (!out.includes(climb)) out.push(climb);
  return out;
}

/** A write-conflict refusal: a row moved between being found and being held. */
function climbMoved(table: string): ConflictError {
  return new ConflictError('A row these totals climb through moved at the same moment. Try again.', 'WRITE_CONFLICT', { retry: true, table });
}

/** Rows by key, with the columns asked for — held (`FOR UPDATE`, in key order) where the engine can, else read. */
async function rowsByKey(db: Db, dialect: Dialect, table: string, keyColumn: string, keys: Iterable<unknown>, columns: readonly string[], hold: boolean): Promise<Map<string, Row>> {
  const unique = new Map<string, unknown>();
  for (const key of keys) if (key !== null && key !== undefined) unique.set(String(key), key);
  if (unique.size === 0) return new Map();
  let query = db
    .selectFrom(table)
    .select([...new Set([keyColumn, ...columns])] as never)
    .where((eb) => eb(db.dynamic.ref(keyColumn), 'in', [...unique.values()] as never))
    .orderBy(keyColumn as never);
  /*
   * Held as the states guard holds a parent, so no row is held two ways in
   * one write (a lock upgrade). On Postgres that is FOR NO KEY UPDATE: it
   * keeps every other writer of the row out, and lets a row that only points
   * at it go in — a quote's order for a customer a save is settling never
   * waits on the save, nor the save on it.
   */
  if (hold && dialect !== 'sqlite') query = dialect === 'postgres' ? query.forNoKeyUpdate() : query.forUpdate();
  const rows = (await query.execute()) as Row[];
  return new Map(rows.map((row) => [String(row[keyColumn]), row]));
}

/**
 * HOLD a chain top-down: the rows a write's totals climb into, highest first,
 * each height sorted by table then key — every writer takes a customer
 * before an order and an order before its lines, so two never wait on each
 * other crosswise. The heights above the first are found by reading, without
 * a lock, the link each row climbs by; each row is read again once held, and
 * a row moved in between (a line moved to another order) is 409
 * `WRITE_CONFLICT {retry: true}`. The first height is held as a single-row
 * write always held it: its totals added up again first when it keeps a
 * balance (what is stored may lag), then its balances read — what a capped
 * balance is judged against. SQLite writes one transaction at a time and
 * takes no lock, and there the heights above the first are not read at all.
 */
export const holdChain: HoldChain = (db, dialect, start, currency) => holdChainWith(db, dialect, start, currency, true);

/** {@link holdChain}; `catchUp: false` holds the first height without adding its totals up again (it is read again later). */
async function holdChainWith(db: Db, dialect: Dialect, start: readonly ClimbStart[], currency: CurrencyOf, catchUp: boolean): Promise<HeldBalances> {
  const held: HeldBalances = new Map();
  const first = chainLevel(start);
  // Peek up: the heights above the first, and the link each row was found through.
  const heights: Map<string, ChainLevel>[] = [];
  const peeked = new Map<string, Map<string, unknown>>();
  if (dialect !== 'sqlite') {
    let current = [...first.values()];
    for (let hop = 1; hop < CLIMB_HOPS && current.length > 0; hop += 1) {
      const next = new Map<string, ChainLevel>();
      for (const level of current) {
        const climbs = climbsOf(level);
        if (climbs.length === 0) continue;
        const rows = await rowsByKey(db, dialect, level.table, level.keyColumn, level.keys.values(), [...new Set(climbs.map((climb) => climb.via))], false);
        for (const [key, row] of rows) {
          const links = peeked.get(`${level.table}\u0000${key}`) ?? new Map<string, unknown>();
          for (const climb of climbs) {
            const up = row[climb.via];
            links.set(climb.via, up ?? null);
            if (up === null || up === undefined) continue;
            const entry = next.get(climb.parent) ?? { table: climb.parent, keyColumn: climb.parentKey, rollups: [], keys: new Map<string, unknown>() };
            if (!entry.rollups.includes(climb)) entry.rollups.push(climb);
            entry.keys.set(String(up), up);
            next.set(climb.parent, entry);
          }
          peeked.set(`${level.table}\u0000${key}`, links);
        }
      }
      if (next.size > 0) heights.push(next);
      current = [...next.values()];
    }
  }
  /** Held rows' links, read holding them, against what the peek found. */
  const verify = (table: string, rows: Map<string, Row>): void => {
    for (const [key, row] of rows) {
      const links = peeked.get(`${table}\u0000${key}`);
      for (const [via, was] of links ?? []) {
        if (String(row[via] ?? null) !== String(was ?? null)) throw climbMoved(table);
      }
    }
  };
  const sorted = (levels: Map<string, ChainLevel>) => [...levels.values()].sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0));
  // Hold top-down: the highest rows first.
  for (const height of [...heights].reverse()) {
    for (const level of sorted(height)) {
      const vias = [...new Set(climbsOf(level).map((climb) => climb.via))];
      const balances = level.rollups[0]?.balances ?? [];
      const rows = await rowsByKey(db, dialect, level.table, level.keyColumn, level.keys.values(), [...vias, ...balances.map((b) => b.column)], true);
      verify(level.table, rows);
      const known = held.get(level.table) ?? new Map<string, Row>();
      for (const [key, row] of rows) known.set(key, row);
      held.set(level.table, known);
    }
  }
  // The first height, as a single-row write always held it.
  for (const level of sorted(first)) {
    const rollup = level.rollups[0]!;
    const vias = dialect === 'sqlite' ? [] : [...new Set(climbsOf(level).map((climb) => climb.via))];
    const found = await rowsByKey(db, dialect, level.table, level.keyColumn, level.keys.values(), [...vias, ...rollup.balances.map((b) => b.column)], true);
    verify(level.table, found);
    if (rollup.balances.length > 0 && catchUp) {
      for (const key of level.keys.values()) {
        if (!found.has(String(key))) continue;
        // A catch-up before this write's own rows go in: read plainly (see `rollupStatement`).
        await settleParent(db, dialect, rollup.siblings, key, rollup.balances, currency, 'plain');
      }
      held.set(level.table, await rowsByKey(db, dialect, level.table, level.keyColumn, level.keys.values(), rollup.balances.map((b) => b.column), true));
    } else {
      const known = held.get(level.table) ?? new Map<string, Row>();
      for (const [key, row] of found) known.set(key, row);
      held.set(level.table, known);
    }
  }
  return held;
}

/**
 * SETTLE a chain bottom-up: each parent the write moved adds up its totals,
 * works out the formulas that read them, then its balances; then the rows
 * one height up that add up what moved, and so on, three rows high at most.
 * Each height is settled from the one below it just written, so the order's
 * total takes the line amounts the line's options have just changed. A row
 * is settled once per total however many rows below it moved (an import of a
 * thousand options settles each line once and each order once).
 */
export const settleChain: SettleChain = async (db, dialect, start, currency, opts = {}) => {
  const read = opts.read ?? 'locking';
  const done = new Set<string>();
  let level: ClimbStart[] = [...start];
  for (let hop = 0; hop < CLIMB_HOPS && level.length > 0; hop += 1) {
    const climbing = new Map<string, ChainLevel>();
    for (const { rollup, keys } of level) {
      const unique = new Map<string, unknown>();
      for (const key of keys) if (key !== null && key !== undefined) unique.set(String(key), key);
      for (const [text, key] of unique) {
        const id = `${rollup.parent}.${rollup.column}\u0000${text}`;
        if (done.has(id)) continue;
        done.add(id);
        if (opts.only !== undefined && !opts.only(rollup.parent, key)) continue;
        await settleParent(db, dialect, [rollup], key, rollup.balances, currency, read);
        const cap = opts.cap;
        if (cap !== undefined && rollup.capped) {
          const was = cap === 'strict' ? undefined : cap.get(rollup.parent)?.get(text);
          const refusal = await capRefusal(db, rollup.parent, rollup.parentKey, key, guardedBy(rollup), was);
          if (refusal !== null) throw refusal;
        }
        if (rollup.climbs.length === 0) continue;
        const entry = climbing.get(rollup.parent) ?? { table: rollup.parent, keyColumn: rollup.parentKey, rollups: [], keys: new Map<string, unknown>() };
        if (!entry.rollups.includes(rollup)) entry.rollups.push(rollup);
        entry.keys.set(text, key);
        climbing.set(rollup.parent, entry);
      }
    }
    // One height up: each settled row's link to the rows that add it up, read as it is now (held on Postgres and MySQL).
    const next: ClimbStart[] = [];
    for (const entry of climbing.values()) {
      const climbs = climbsOf(entry);
      const rows = await rowsByKey(db, dialect, entry.table, entry.keyColumn, entry.keys.values(), [...new Set(climbs.map((climb) => climb.via))], read === 'locking');
      for (const climb of climbs) {
        const keys = [...rows.values()].map((row) => row[climb.via]).filter((key) => key !== null && key !== undefined);
        if (keys.length > 0) next.push({ rollup: climb, keys });
      }
    }
    level = next;
  }
};

/**
 * The columns a chain above this table's rows will write: every total the
 * write moves, and every one it climbs into — each with the formulas that read
 * it and the balances beside it — by table. What the connection's role must
 * be granted before the write's first statement.
 */
function chainColumns(rollups: readonly RollupInto[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const visit = (rollup: RollupInto, hop: number): void => {
    const columns = out.get(rollup.parent) ?? new Set<string>();
    const before = columns.size;
    for (const column of [rollup.column, ...rollup.derived, ...rollup.balances.map((b) => b.column)]) columns.add(column);
    out.set(rollup.parent, columns);
    if (hop + 1 >= CLIMB_HOPS || (columns.size === before && before > 0)) return;
    for (const climb of rollup.climbs) visit(climb, hop + 1);
  };
  for (const rollup of rollups) visit(rollup, 0);
  return out;
}

// --- a create with its child rows -------------------------------------------

/** One row of a tree write: its node, its table with the role's grants, where it hangs. */
interface TreeRow {
  node: TreeNode;
  target: WriteTarget;
  parent: TreeRow | null;
  /** Its place among the rows of the same list under the same parent. */
  index: number;
  depth: number;
}

/**
 * How a tree's transaction ends without committing, and without a refusal: a
 * quote (always rolled back), a retry of a create already made, or a twin
 * with the same retry key that committed first.
 */
class TreeSignal extends Error {
  override readonly name = 'TreeSignal';

  constructor(
    readonly kind: 'dry' | 'replayed' | 'twin',
    readonly outcome: TreeOutcome | null,
    readonly original?: unknown,
  ) {
    super(kind);
  }
}

/** A row's key as text (its one key column's value, or its columns' values), or null while any is empty. */
function keyOf(table: ResolvedTable, row: Row): string | null {
  const values = table.primaryKey.map((column) => row[column]);
  if (values.length === 0 || values.some((value) => value === null || value === undefined)) return null;
  return values.length === 1 ? String(values[0]) : JSON.stringify(values.map(String));
}

/** A quote of a change: the states judge it on rows read as they are, holding none it does not write. */
function quoteOnly(values: Row): void {
  const guard = guardOf(values);
  if (guard !== undefined) guard.quote = true;
}

/** Rows by key held for this transaction — for update, or for share — in key order; SQLite has one writer and holds nothing. */
async function holdKeys(db: Db, dialect: Dialect, table: string, keyColumn: string, keys: Iterable<unknown>, share: boolean): Promise<void> {
  if (dialect === 'sqlite') return;
  const unique = new Map<string, unknown>();
  for (const key of keys) if (key !== null && key !== undefined) unique.set(String(key), key);
  if (unique.size === 0) return;
  const query = db
    .selectFrom(table)
    .select(sql<number>`1`.as('adm_one'))
    .where((eb) => eb(db.dynamic.ref(keyColumn), 'in', [...unique.values()] as never))
    .orderBy(keyColumn as never);
  // A parent held as the states guard holds one (FOR NO KEY UPDATE on Postgres: see `rowsByKey`).
  await (share ? query.forShare() : dialect === 'postgres' ? query.forNoKeyUpdate() : query.forUpdate()).execute();
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
        : bindValue(target.dialect, zonedWriteValue(column, normalizeWriteValue(column, value)));
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
  /**
   * `dry`: the change tried and rolled back — a quote of it. No named lock is
   * taken, nothing is kept and nothing announced; the outcome carries the row
   * as the change would leave it. A save by default.
   */
  mode?: 'save' | 'dry' | undefined;
  /**
   * The row as the change leaves it, inside its transaction, against the
   * figure the caller expected: throws to refuse the change (a save only).
   */
  expect?: ((db: Kysely<SourceDatabase>, after: Row) => Promise<void>) | undefined;
  /**
   * The row as the change leaves it, inside its transaction, before the price
   * check: throws to refuse the change — a save and a quote alike (an entry's
   * agreements: a stay's guests within what its room sleeps).
   */
  inside?: ((db: Kysely<SourceDatabase>, after: Row) => Promise<void>) | undefined;
  /**
   * Rows the same change writes below this one (a staff form's child rows on
   * a table with limits): named with the row's own locks before the
   * transaction, written inside it once the row is changed, and judged under
   * those locks. `write` answers the rows it wrote or changed.
   */
  children?: { names(): Promise<LockNameRow[]>; write(db: Kysely<SourceDatabase>, after: Row, values: Row): Promise<JudgedRow[]> } | undefined;
  /** A public entry's windows read from moments: the change is refused outside them, judged holding the row. */
  windows?: readonly StateWindow[] | undefined;
}

export interface UpdateOutcome {
  /** The row before the write; null when nobody read it (the public API without hooks). */
  before: Row | null;
  /** The row after the write, read again; null when it cannot be found. */
  after: Row | null;
  values: Row;
  count: number;
  /** The rows of other tables this write's moves moved too (`states.effects`), for the caller to announce. */
  effects?: EffectWritten[] | undefined;
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
  capacity?: 'refuse' | 'unchecked' | 'judged';
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

/** How a quote of a change ends: rolled back, with the row as the change would have left it. */
class UpdateQuoted extends Error {
  override readonly name = 'UpdateQuoted';

  constructor(
    readonly after: Row | null,
    readonly count: number,
  ) {
    super('quoted');
  }
}

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
  /** A create with its child rows, every row or none; or a quote of one (`write-tree.ts`). */
  createTree: CreateTree;
  update(input: UpdateRecordInput): Promise<UpdateOutcome>;
  delete(input: DeleteRecordInput): Promise<number>;
  /**
   * The refusal deleting these rows would meet from the table's states (a
   * numbered or locked row, a sent invoice's line), or null — read before the
   * delete, so a person is told straight away rather than asked first to
   * confirm what goes with the row. The delete judges again, holding it.
   */
  deleteRefusal(target: WriteTarget, context: WriteContext, rows: readonly Row[]): Promise<AppError | null>;
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
  /**
   * What the connection's data role may write in a table
   * (`ConnectionManager.tablePrivileges`), for a target that does not carry
   * it. Every write reads it — an import, an automation step, the public API,
   * a child row — so a column the role may not write is refused when sent and
   * never filled, whichever door the write came through.
   */
  rights?: ((connectionId: string, tableId: string) => Promise<TablePrivileges | null>) | undefined;
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

/**
 * Text no engine keeps alike (U+0000, `unstorableText`), judged on the values
 * as the caller sent them, before FILL reads anything with them — a copy
 * looked up by a key holding one would reach Postgres, and be refused there
 * as a 500, before CHECK ever saw it. CHECK judges it again after the hooks.
 */
function earlyIssues(target: WriteTarget, values: Row): FieldIssues | null {
  return unstorableText(values, target.table.columns);
}

function refuseEarly(target: WriteTarget, action: 'create' | 'update', values: Row, mapError: ((error: unknown) => never) | undefined): void {
  refuseUngrantedColumns(target.rights, target.table, action, Object.keys(values));
  const issues = earlyIssues(target, values);
  if (issues === null) return;
  const error = refusal(issues);
  if (mapError !== undefined) mapError(error);
  throw error;
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
    relations: target.view?.model?.relations,
    rights: target.rights,
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

/**
 * The values without the columns Adminium stamps: a fingerprint, when
 * something happened and who did it — its own record of a write, never the
 * writer's. Two kinds stay open: a date worked out from another (a due date
 * the desk may move later), and a `byOrigin` word with no staff word (staff
 * say it themselves; a guest never does). An import keeps what it brings.
 */
function withoutStamped(rules: TableRules | null, values: Row, origin: WriteOrigin): Row {
  if (origin === 'import' || origin === 'undo') return values;
  const guest = origin === 'public';
  const kept = (stamp: { set: unknown }): boolean => {
    const set = stamp.set;
    if (typeof set !== 'object' || set === null) return false;
    if ('addDays' in set) return !guest;
    // A deadline or a hold's end staff may move by hand (a reminder that gives a day more); the stamp wins when it fires.
    if ('addMinutes' in set || 'deadline' in set) return !guest;
    if ('byOrigin' in set) return !guest && (set as { byOrigin: { staff?: string } }).byOrigin.staff === undefined;
    return false;
  };
  const dropped = [...(rules?.stamps ?? []).filter((stamp) => !kept(stamp)), ...(rules?.seals ?? [])].map((stamp) => stamp.column);
  if (!dropped.some((column) => Object.prototype.hasOwnProperty.call(values, column))) return values;
  const out = { ...values };
  for (const column of dropped) delete out[column];
  return out;
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

  /** The target with the role's grants on it, looked up when it came without them. */
  const withRights = async (target: WriteTarget): Promise<WriteTarget> =>
    target.rights !== undefined || opts.rights === undefined
      ? target
      : { ...target, rights: await opts.rights(target.connectionId, target.table.id) };

  /**
   * The columns a write's totals will write in other rows — each parent's
   * total, the formulas that read it and the balances beside it, and every
   * row they climb into — refused by name before the first statement when the
   * connection's role may not write them. Left to the database, the refusal
   * would come at the settle and name only a table.
   */
  const refuseUngrantedChain = async (target: WriteTarget, rollups: readonly RollupInto[]): Promise<void> => {
    if (rollups.length === 0 || opts.rights === undefined) return;
    for (const [table, columns] of chainColumns(rollups)) {
      const rights = table === target.table.id && target.rights !== undefined ? target.rights : await opts.rights(target.connectionId, table);
      refuseUngrantedColumns(rights, { id: table }, 'update', [...columns]);
    }
  };

  /** The connection's currency, read at most once per write, and only when a `currency` scale asks for it. */
  const currencyFor = (target: WriteTarget): CurrencyOf => {
    let memo: Promise<string | null> | undefined;
    return () => (memo ??= opts.settings?.currency(target.connectionId) ?? Promise.resolve(null));
  };

  /** Whether any scale of the table is a currency's, so the connection's currency may be needed. */
  const readsCurrency = (rules: TableRules | null): boolean =>
    (rules?.scales ?? []).some((s) => s.scale === 'currency') || (rules?.formulas ?? []).some((f) => f.scale === 'currency');

  /**
   * PRICE, then FORMULA: a price by the night worked out (`crud/per-night.ts`),
   * then the scaled decimals rounded and the touched formulas worked out, over
   * the stored row (an update) with the values over it.
   */
  const formulate = async (rules: TableRules | null, action: WriteAction, target: WriteTarget, values: Row, stored: Row | null, origin?: WriteOrigin): Promise<Row> => {
    if (rules === null || action === 'delete') return values;
    const currency = currencyFor(target);
    const priced = await priceValues(rules, action, target.db, values, stored, { origin, currency });
    return workOut(rules, action, priced, stored, readsCurrency(rules) ? await currency() : null);
  };

  const fill = (
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    values: Row,
    now: Date,
  ): Row => {
    const out = normalizeText(
      rules,
      withoutStamped(
        rules,
        withoutReadOnly(
          rules,
          fillRow(rules, action, values, {
            dialect: target.dialect,
            now,
            actor: context.actor,
            ...(target.rights == null || action === 'delete'
              ? {}
              : { granted: (column: string) => columnGranted(target.rights, column, action) }),
          }),
          context.origin,
        ),
        context.origin,
      ),
    );
    // A new document starts in its first state.
    const states = rules?.states;
    if (action !== 'create' || states === undefined || Object.prototype.hasOwnProperty.call(out, states.column)) return out;
    return { ...out, [states.column]: states.initial };
  };

  /** The venue's zone for a table whose rules read a clock; undefined for every other. */
  async function zoneFor(rules: TableRules | null, target: WriteTarget): Promise<string | undefined> {
    const readsDay = (rules?.stamps ?? []).some((stamp) => stamp.set === 'today') || (rules?.bounds ?? []).some((bound) => bound.notAfter !== undefined);
    // A move waiting for a time, a late or timed move, a stamp worked out from a moment: all read the venue's clock.
    const readsClock = statesReadClock(rules?.states, rules?.stamps);
    if (rules?.capacity === undefined && rules?.capacityRules === undefined && rules?.capacityOwners === undefined && rules?.booking === undefined && (rules?.venueLocal?.length ?? 0) === 0 && !readsDay && !readsClock) return undefined;
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
    const zone = (await zoneFor(rules, target)) ?? 'UTC';
    const moment = (column: string) => ['timestamp', 'timestamptz'].includes(target.table.columns.get(column)?.logicalType ?? '');
    /** A value's day on the venue's calendar: a moment where the venue is, a date as itself. */
    const venueDay = (column: string, value: unknown): string | null => {
      if (!moment(column)) return dayOf(value);
      const at = instantOf(value);
      return at === null ? null : venueClock(new Date(at), zone).day;
    };
    for (const bound of rules!.bounds!) {
      // Judged when the date is written, and when the row it is bounded by changes (a payment moved to another invoice).
      const via = bound.notBefore?.through?.via;
      const written = Object.prototype.hasOwnProperty.call(values, bound.column) || (via !== undefined && Object.prototype.hasOwnProperty.call(values, via));
      if (!written) continue;
      const day = venueDay(bound.column, row[bound.column]);
      if (day === null) continue;
      let refused = false;
      if (bound.notAfter === 'today') refused = day > venueClock(new Date(), zone).day;
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
    const judged = judgedBy(rules, target, context);
    const issues = mergeIssues(checkRow(judged, action, values, { dialect: target.dialect, stored, columns: target.table.columns }), await boundIssues(rules, action, target, context, values, stored));
    // What the check read of the stored row goes with the values, for the statement to hold it to.
    if (issues === null) return brand(attachRequiredGuards(values, requiredGuards(judged, action, values, stored)));
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
    clock: WriteClock,
  ): Promise<CheckedRow> {
    if (rules === null || context.origin === 'undo') return values;
    const history = context.origin === 'import';
    let out: Row = values;
    // The outbox's own writes keep their own moves — on the outbox's own table only.
    if (tiedToStates(target.table) && !isOutboxWrite(context, target.table.id)) {
      const roleMoves = Object.values(rules.states?.moves ?? {}).some((moves) => moves.some((move) => typeof move === 'object' && move.roles !== undefined));
      // An import's move of a row already there is a move like anyone's: its roles too.
      const roles = action === 'update' && roleMoves ? ((await opts.rolesOf?.(context.actor ?? null)) ?? new Set<string>()) : new Set<string>();
      // Only what this write's rules really wrote is theirs: a stamp that fired and gave nothing is not.
      const decided = [
        ...(rules.stamps ?? [])
          .filter((stamp) => stampFires(stamp, action, values, stored) && stampYields(stamp, context.origin, context.claimed ?? null))
          .map((stamp) => stamp.column),
        ...(rules.seals ?? []).filter((stamp) => stampFires(stamp, action, values, stored)).map((stamp) => stamp.column),
        ...(rules.formulas ?? []).map((formula) => formula.column),
        ...renewedColumns(values),
      ];
      out = attachGuard(out, {
        history,
        roles,
        decided,
        clock,
        ...(history ? { created: createdBy(context) } : {}),
        zone: await zoneFor(rules, target),
        origin: context.origin,
        declared: context.declared,
        effect: action === 'update' && (rules.states?.effects?.length ?? 0) > 0 ? effectWriter(target, context, clock) : undefined,
      });
    }
    const seals = history || action === 'delete' ? [] : (rules.seals ?? []).filter((stamp) => stampFires(stamp, action, values, stored));
    if (seals.length > 0) out = attachSeals(out, { view: target.view, stamps: seals, currency: await currencyFor(target)() });
    return brand(out);
  }

  /**
   * The row an effect moves (`states.effects`), prepared for its move by the
   * same steps as any update of that row — fill, stamps, formulas, checks,
   * and what its statement judges it by — as the app's declared move of it,
   * read through `db`: the write's own transaction, or (naming the write's
   * locks before it opens) the pool, holding nothing. Null when the row is
   * gone. A table whose move could not be judged in the one write is
   * refused, by the manifest's check too (`states.ts`): one kept by a
   * booking guard (its lock is its own, taken per day), one whose rows are a
   * document's lines (their parent would be held after this write's own
   * rows), one whose move sets off effects, waits for another row, or is
   * judged late by another row's time (read after them, for the same
   * reason). Nor is one a hook watches: its hooks cannot run inside another
   * row's write.
   */
  async function prepareEffect(
    db: Db,
    from: WriteTarget,
    context: WriteContext,
    clock: WriteClock,
    link: StateLink,
    key: unknown,
    column: string,
    state: string,
  ): Promise<PreparedEffect | null> {
    const moved = await withRights({ ...from, table: from.view.table(link.table), db, rights: undefined });
    const rules = rulesOf(moved);
    const effective = moved.table.table;
    const kept =
      rules?.booking !== undefined ||
      (effective?.stateParents?.length ?? 0) > 0 ||
      (effective?.states?.effects?.length ?? 0) > 0 ||
      // Its move may wait only for its own row: the rows it would read are taken after this write's own.
      Object.values(effective?.states?.moves ?? {}).some((list) =>
        list.some((move) => typeof move === 'object' && move.to === state && waitVias(move.requires).length > 0),
      ) ||
      // Nor be judged late by a time read through another row, for the same reason.
      (effective?.states?.late ?? []).some((late) => late.to === state && momentVias(late.moment).length > 0);
    if (kept) {
      throw new StateMoveRefused(`A move of ${from.table.name} cannot move a ${moved.table.name} row too: that table keeps a booking guard or a parent, or its move waits for another row.`, {
        column,
        to: state,
        effect: moved.table.name,
      });
    }
    const declared: WriteContext = { ...context, declared: { to: state } };
    // A table a hook watches is not moved this way: its hooks could not run inside this write.
    const hooks = current();
    if ((await hooks.wants('before', 'update', moved, declared)) || (await hooks.wants('after', 'update', moved, declared))) {
      throw new StateMoveRefused(`A move of ${from.table.name} cannot move a ${moved.table.name} row too: a hook watches ${moved.table.name}, and it could not run inside this write.`, {
        column,
        to: state,
        effect: moved.table.name,
        hooked: true,
      });
    }
    const pk = { [link.key]: key };
    const before = (await fetchByPk(db, moved.table, pk)) ?? null;
    if (before === null) return null;
    const zone = await zoneFor(rules, moved);
    let values = await prepareValues(rules, 'update', moved, declared, { [column]: state }, clock.startedAt);
    values = await decideRow(rules, 'update', values, before, decideContext(moved, declared, stampNow(clock), zone));
    values = await formulate(rules, 'update', moved, values, before, declared.origin);
    const checked = await carry(rules, 'update', moved, declared, await checkAllOrThrow(rules, 'update', moved, declared, values, before, undefined), before, clock);
    return { target: { ...moved, timezone: zone ?? moved.timezone }, rules, pk, before, checked };
  }

  /** The rules of each table a change's effects would move a row of (the effects its new state sets off). */
  function effectTablesOf(target: WriteTarget, values: Row): (TableRules | null)[] {
    const states = target.table.table?.states;
    if (states === undefined || !Object.prototype.hasOwnProperty.call(values, states.column)) return [];
    const out: (TableRules | null)[] = [];
    for (const effect of (states.effects ?? []).filter((e) => sameValue(values[states.column], e.on.to))) {
      const link = (target.table.table?.stateLinks ?? []).find((candidate) => candidate.via === effect.via);
      if (link === undefined) continue;
      try {
        out.push(rulesOf({ ...target, table: target.view.table(link.table) }));
      } catch {
        // A table the model no longer has: the effect refuses the write when it runs.
      }
    }
    return out;
  }

  /** Whether a table keeps a limit, or owns rows a limit counts by their owner. */
  const keepsLimits = (rules: TableRules | null): boolean => rules?.capacityRules !== undefined || rules?.capacityOwners !== undefined;

  /**
   * The rows a change's effects will move, prepared — each read, without a
   * lock, through the link of the row as stored now — for a write to name
   * their limits' locks or hold the totals they climb into before its
   * transaction takes anything else. What a peek misread the judge finds
   * again under the locks (the write starts over).
   */
  async function effectRows(db: Db, target: WriteTarget, context: WriteContext, clock: WriteClock, values: Row, storedRow: Promise<Row | null>): Promise<PreparedEffect[]> {
    const states = target.table.table?.states;
    if (states === undefined || !Object.prototype.hasOwnProperty.call(values, states.column)) return [];
    const stored = await storedRow;
    if (stored === null) return [];
    const to = values[states.column];
    const out: PreparedEffect[] = [];
    for (const effect of (states.effects ?? []).filter((e) => sameValue(to, e.on.to))) {
      const link = (target.table.table?.stateLinks ?? []).find((candidate) => candidate.via === effect.via);
      const key = { ...stored, ...values }[effect.via];
      if (link === undefined || key === null || key === undefined) continue;
      const [column, state] = Object.entries(effect.set)[0]!;
      const prepared = await prepareEffect(db, target, context, clock, link, key, column, String(state));
      if (prepared !== null && !sameValue(prepared.before[column], state)) out.push(prepared);
    }
    return out;
  }

  /**
   * An effect's move of the row a link points at (`states.effects`), inside
   * the write's transaction on its handle, judged as the app's declared move
   * of that row by the writer who made the first: its limits (a change of what
   * its rows' places count by, under the locks the write named for it), the
   * totals it climbs into and its own balances, and its table's states. The
   * row was held for update before the write's own rows. A quote's effect is
   * judged the same way and written nowhere: it holds no row, and waits on no
   * save.
   */
  function effectWriter(target: WriteTarget, context: WriteContext, clock: WriteClock): EffectWriter {
    return async (db, link, key, column, state, guard) => {
      const prepared = await prepareEffect(db, target, context, clock, link, key, column, state);
      if (prepared === null) return null;
      const { rules, pk, before, checked } = prepared;
      const within: WriteTarget = { ...prepared.target, db };
      const quote = guard.quote === true;
      if (quote) quoteOnly(checked);
      if (keepsLimits(rules)) {
        try {
          await judgeCapacity(db, [{ target: within, pk, row: { ...before, ...checked }, before, values: checked }], { clock, origin: context.origin, mode: quote ? 'dry' : 'save' });
        } catch (error) {
          // A write that named no lock for it (a bulk edit, an import) cannot hold the pools this row counts in.
          if (error instanceof LockMoved && guard.effectsNamed !== true) throw new GuardedBatchError(within.table.name);
          throw error;
        }
      }
      if (quote) {
        // Judged as its statement judges it — its move, its lock — and written nowhere.
        await guardedUpdate(db, within.dialect, within.table, checked, pk, async () => 1);
        return { table: link.table, pk, before, after: { ...before, ...checked } };
      }
      const currency = currencyFor(within);
      // The totals it climbs into move only when it writes what they read; its own balances when it writes theirs.
      const rolls = movesTotal(rules, rules?.rollupsInto ?? [], checked);
      if (rolls) await refuseUngrantedChain(within, rules?.rollupsInto ?? []);
      const held = rolls ? await holdParents(rules, within, [{ record: { ...before, ...checked }, before }], currency) : undefined;
      const ownMoved = movedBalances(rules, checked, before);
      const ownBefore = ownMoved.some((balance) => balance.cappedBy.length > 0) ? await holdOwn(rules, within, pk, ownMoved, currency) : undefined;
      const count = await updateRows(db, within.dialect, within.table, checked, pk);
      if (count === 0) return null;
      let after = (await fetchByPk(db, within.table, pk)) ?? null;
      if (rolls || ownMoved.length > 0) {
        if (rolls) await settleRows(rules, within, [{ record: after, before }], currency, held);
        if (ownMoved.length > 0) await settleOwn(rules, within, 'update', after, checked, currency, ownBefore);
        const sealing = sealsOf(checked);
        if (sealing !== undefined) await sealRows(db, within.table, pk, sealing, writeSeals);
        after = (await fetchByPk(db, within.table, pk)) ?? null;
      }
      return { table: link.table, pk, before, after };
    };
  }

  /**
   * Times, as the column keeps them: a venue-local column's wall time is the
   * instant it names where the venue is, and a zoned instant bound for a
   * zone-less column is this server's wall clock — what the data routes have
   * always written, now whoever writes, so a guest's booking and a till's
   * name the same slot the same way. A zone-less time bound for a column that
   * keeps a zone is the instant it names on this server's clock, and a yes or
   * a no is `true` or `false` (`spelledForColumn`). The same object when
   * nothing changes.
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
      const column = target.table.columns.get(name);
      if (column === undefined) continue;
      // A venue-local time was read on the venue's clock just above, never on this server's.
      const spelled = spelledForColumn(rules, column, value, target.dialect, (rules?.venueLocal ?? []).includes(name));
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
        localize(rules, target, fill(rules, action, target, context, withoutTypedCodes(rules, context, values), now), await zoneFor(rules, target)),
        memo,
        context.origin === 'undo',
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
    // Every row the totals climb into, top-down: the grandparents before the parents.
    return holdChain(target.db, target.dialect, chainStarts(rules, rows), currency);
  }

  /**
   * The parents a row feeds or is tied to, held BEFORE the row itself. Every
   * writer takes a document before its lines — a send holds the invoice and
   * then counts its lines, and a line edit now holds the invoice too before
   * its line — so the two never wait on each other crosswise (a deadlock on
   * MySQL). The row is read as it is, without a lock, only to learn which
   * parents; SQLite writes one transaction at a time and needs none of it.
   */
  async function holdFirst(rules: TableRules | null, target: WriteTarget, pk: Row, values?: Row, also: readonly ClimbStart[] = []): Promise<void> {
    if (target.dialect === 'sqlite') return;
    if ((rules?.rollupsInto?.length ?? 0) > 0 || also.length > 0) {
      const peek = (rules?.rollupsInto?.length ?? 0) > 0 ? ((await fetchByPk(target.db, target.table, pk)) ?? null) : null;
      // The whole chain above the row — and above the rows its effects move — top-down; the balances are read again once the row is held.
      await holdChainWith(target.db, target.dialect, [...chainStarts(rules, [{ record: values ?? null, before: peek }]), ...also], NO_CURRENCY, false);
    }
    await holdParentsFirst(target.db, target.dialect, target.table, pk, values);
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
    // Bottom-up: each parent, then the rows above it that add it up.
    await settleChain(target.db, target.dialect, chainStarts(rules, rows), currency, { cap });
  }

  /**
   * FOLLOW: the child rows whose copies follow a changed row (`crud/follow.ts`),
   * brought into step inside its write, and their totals settled into it —
   * judged against its balances as they were (`prior`), so a paid stay
   * shortened below what was paid is refused. A quote reads the child rows
   * without holding them, and settles only the row it shows.
   */
  async function followAndSettle(target: WriteTarget, rules: TableRules | null, prior: Row, after: Row, currency: CurrencyOf, dry: boolean): Promise<void> {
    const followed = await followChanged({
      db: target.db,
      dialect: target.dialect,
      view: target.view,
      rules,
      before: prior,
      after,
      currency,
      hold: !dry,
      // Adminium's own columns (a copy, the formulas over it): written as a settle writes, judged by no state or seal.
      write: async (table, pk, set) => {
        const bound = Object.fromEntries(Object.entries(set).map(([column, value]) => [column, bindValue(target.dialect, value)]));
        let update = target.db.updateTable(table.id).set(bound as never);
        for (const [column, value] of Object.entries(pk)) update = update.where((eb) => eb(target.db.dynamic.ref(column), '=', value));
        await update.execute();
      },
    });
    const own = target.table.id;
    for (const moved of followed) {
      const starts = chainStarts(moved.rules, moved.rows).filter((start) => start.rollup.parent === own);
      if (starts.length === 0) continue;
      const key = String(after[starts[0]!.rollup.parentKey]);
      await settleChain(target.db, target.dialect, starts, currency, dry ? { only: (table) => table === own } : { cap: new Map([[own, new Map([[key, prior]])]]) });
    }
  }

  /** The child columns a follow writes, refused by name before the first statement when the role may not write them. */
  const refuseUngrantedFollow = async (target: WriteTarget, rules: TableRules | null): Promise<void> => {
    if (opts.rights === undefined) return;
    for (const [child, columns] of followColumns(target.view, rules)) {
      refuseUngrantedColumns(await opts.rights(target.connectionId, child), { id: child }, 'update', columns);
    }
  };

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
    // A new row's totals, and the formulas that read them, and what climbs from them; its balances just below.
    if (action === 'create') await settleChain(target.db, target.dialect, own.map((rollup) => ({ rollup, keys: [key] })), currency);
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
    // A change of rows other rows follow (a bulk edit of stays, an import's updates, an undo): the followers are brought into step too.
    const following = action === 'update' && rows.some((row) => row.before !== null && (rules?.follows ?? []).some((follow) => !sameValue(row.before![follow.from], row.record[follow.from])));
    if (rows.length === 0 || (!settles(rules) && !following)) return;
    await refuseUngrantedChain(target, [...(rules?.rollupsInto ?? []), ...(action === 'delete' ? [] : (rules?.ownRollups ?? []))]);
    if (following) await refuseUngrantedFollow(target, rules);
    const currency = currencyFor(target);
    const sides = rows.map((row) => (action === 'delete' ? { record: null, before: row.record } : { record: row.record, before: row.before }));
    const run = async (db: Db): Promise<void> => {
      const within = { ...target, db };
      if (holdsParent(rules)) await holdParents(rules, within, sides, currency);
      if (following) {
        for (const row of rows) {
          if (row.before === null) continue;
          // The row as it now stands, held: its followers are taken after it, as a single change takes them.
          const after = (await fetchHeld(db, target, pkOf(target.table, row.record), true)) ?? null;
          if (after !== null) await followAndSettle(within, rules, row.before, after, currency, false);
        }
      }
      await settleRows(rules, within, sides, currency, settleOpts?.cap === true ? 'strict' : undefined);
      if (action === 'delete' || (rules?.ownRollups?.length ?? 0) === 0) return;
      const keys = rows.map((row) => row.record[rules!.ownRollups![0]!.parentKey]).filter((key) => key !== null && key !== undefined);
      // Its own totals too, and what they feed: a restored or edited row may carry child rows written beside it.
      if (keys.length > 0) await settleChain(db, target.dialect, rules!.ownRollups!.map((rollup) => ({ rollup, keys })), currency);
    };
    await (holdsParent(rules) || (rules?.balances?.length ?? 0) > 0 || following ? atomically(target, run) : run(target.db));
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
    if (capped.length > 0 && !target.db.isTransaction && !(capacity === 'judged' && inTransaction(target.db)) && (action !== 'update' || rows.some((row) => movesTotal(rules, capped, row)))) {
      throw new BalanceBatchError(target.table.name);
    }
    if (action === 'delete') return;
    // A limit is kept only under its pool's lock: a row that could take from one is refused; one leaving what counts passes.
    const limited = rules?.capacityRules !== undefined || rules?.capacityOwners !== undefined;
    // `judged`: rows written under their pools' locks by a caller that judges them there (a form's child rows).
    if (limited && capacity !== 'judged' && rows.some((row) => batchNeedsGuard(target, action, row))) throw new GuardedBatchError(target.table.name);
    if (rules?.booking === undefined) return;
    if (action === 'update' && !rows.some((row) => movesBooking(rules.booking!, row))) return;
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

  /** A create's row as `prepareOne` leaves it: checked, carried, and what its INSERT needs. */
  /** The row an effect moves, prepared for its move (`prepareEffect`). */
  interface PreparedEffect {
    /** Its table, on the venue's clock. */
    target: WriteTarget;
    rules: TableRules | null;
    pk: Row;
    /** The row as read: held, inside the write. */
    before: Row;
    checked: CheckedRow;
  }

  interface PreparedCreate {
    rules: TableRules | null;
    zone: string | undefined;
    /** The values after FORMULA. */
    values: Row;
    checked: CheckedRow;
    /** The codes generated here, and left alone by the hooks: made again when one collides. */
    codes: ColumnCode[];
  }

  /**
   * A new row prepared, the one way a single create and a create with its
   * child rows both do it: FILL, RESOLVE, DECIDE, the before hooks (when
   * asked: a save's own row, outside any transaction), FORMULA, CHECK, then
   * what its numbers need and what its statement is judged by. A quote
   * (`dry`) takes no number: a column that must hold one is given the next
   * as it stands, unclaimed. `grants` refuses, by name, every column the
   * INSERT will write that the role may not — the decided ones included.
   */
  async function prepareOne(input: {
    target: WriteTarget;
    values: Row;
    context: WriteContext;
    clock: WriteClock;
    mode: 'save' | 'dry';
    hooks: boolean;
    recheck?: ((values: Row) => Promise<void>) | undefined;
    mapError?: ((error: unknown) => never) | undefined;
    grants?: boolean | undefined;
  }): Promise<PreparedCreate> {
    const { target, context, clock, mapError } = input;
    refuseUnbuiltTable(target);
    refuseEarly(target, 'create', input.values, mapError);
    const hooks = current();
    const rules = rulesOf(target);
    const zone = await zoneFor(rules, target);
    const filled = localize(rules, target, fill(rules, 'create', target, context, withoutTypedCodes(rules, context, input.values), clock.startedAt), zone);
    const resolved = await fillFromElsewhere(rules, 'create', target, await resolveRow(rules, 'create', target, filled, undefined, context.origin === 'undo'), opts.settings);
    // DECIDE: what creating the row makes Adminium write (a stamp), before the hooks and CHECK.
    const decided = await decideRow(rules, 'create', resolved, null, decideContext(target, context, stampNow(clock), zone));
    // A total, a formula and a number are Adminium's alone, whatever a hook set.
    const hooked =
      input.hooks && (await hooks.wants('before', 'create', target, context))
        ? withoutReadOnly(rules, await runBefore(hooks, 'create', target, context, decided, null), context.origin)
        : decided;
    const values = await formulate(rules, 'create', target, hooked, null, context.origin);
    if (values !== input.values && input.recheck !== undefined) await input.recheck(values);
    const judged = await checkAllOrThrow(rules, 'create', target, context, values, null, mapError);
    // What a number without gaps needs at its INSERT, read before any lock is taken; a quote takes none.
    const numbered = input.mode === 'save' ? await prepareNumbers(rules, 'create', target, judged, context.origin, opts.settings) : await unclaimedNumbers(rules, target, judged);
    const checked = await carry(rules, 'create', target, context, brand(numbered), null, clock);
    // A quote's row is judged on rows read as they are: it holds none it does not write, and waits on no save.
    if (input.mode === 'dry') quoteOnly(checked);
    if (input.grants === true) refuseUngrantedColumns(target.rights, target.table, 'create', Object.keys(checked));
    // Only the codes generated here, and left alone by the hooks, are made again.
    const codes = generatedCodes(rules, filled, context.origin === 'undo').filter((code) => values[code.column] === resolved[code.column]);
    return { rules, zone, values, checked, codes };
  }

  /**
   * A quote's running numbers: none claimed from the counter, none taken in a
   * series. A column that must hold one is given the counter's next as it
   * stands; any other is left empty (the reply never shows one).
   */
  async function unclaimedNumbers(rules: TableRules | null, target: WriteTarget, values: Row): Promise<Row> {
    let out: Row | null = null;
    for (const sequence of rules?.sequences ?? []) {
      if (Object.prototype.hasOwnProperty.call(values, sequence.column) || target.table.columns.get(sequence.column)?.nullable !== false) continue;
      const next = (await opts.sequences?.read(sequenceKey(target.connectionId, target.table, sequence.column)))?.next ?? sequence.start;
      out ??= { ...values };
      out[sequence.column] = sequence.logicalType === 'text' || sequence.logicalType === 'varchar' ? String(next) : next;
    }
    return out ?? values;
  }

  /**
   * A tree row's values as sent, with each link a copy fills (a ticket's
   * event, copied through its type) read through its source without a lock —
   * what its locks and the rows it is tied to are named from. A copy through
   * the row's own parent in the tree reads the parent's values.
   */
  async function peekLinks(row: TreeRow, values: Row, parent: Row | null): Promise<Row> {
    const rules = rulesOf(row.target);
    const links = new Set([
      ...(rules?.rollupsInto ?? []).map((rollup) => rollup.via),
      ...(row.target.table.table?.stateParents ?? []).flatMap((p) => [p.via, ...(p.links ?? []).map((link) => link.via)]),
    ]);
    let out: Row | null = null;
    for (const copy of rules?.copies ?? []) {
      if (!links.has(copy.column)) continue;
      const sent = values[copy.column];
      if (copy.mode === 'default' && sent !== null && sent !== undefined) continue;
      out ??= { ...values };
      if (copy.via === row.node.via?.column) {
        out[copy.column] = parent?.[copy.from] ?? null;
        continue;
      }
      const link = values[copy.via];
      if (link === null || link === undefined) continue;
      const db = row.target.db;
      const found = (await db
        .selectFrom(copy.toTable)
        .select(sql<unknown>`${sql.ref(copy.from)}`.as('value'))
        .where((eb) => eb(db.dynamic.ref(copy.toColumn), '=', link))
        .executeTakeFirst()) as { value?: unknown } | undefined;
      out[copy.column] = found?.value ?? null;
    }
    return out ?? values;
  }

  /**
   * Every row outside a tree that its rows are tied to, held for ALL of them
   * at once, before the root's INSERT, in the one order every writer takes:
   * the totals they climb into, top-down; then the parents whose states
   * judge them; then the rows they link to, for share. A row's own parent in
   * the tree is new, and nobody else can hold it.
   */
  async function holdOutside(db: Db, dialect: Dialect, rows: readonly TreeRow[], peeked: ReadonlyMap<TreeRow, Row>, currency: CurrencyOf): Promise<HeldBalances> {
    const starts: ClimbStart[] = [];
    const parents = new Map<string, { table: string; key: string; keys: unknown[] }>();
    const linked = new Map<string, { table: string; key: string; keys: unknown[] }>();
    const add = (into: typeof parents, table: string, key: string, value: unknown) => {
      if (value === null || value === undefined) return;
      const entry = into.get(`${table}\u0000${key}`) ?? { table, key, keys: [] };
      entry.keys.push(value);
      into.set(`${table}\u0000${key}`, entry);
    };
    for (const row of rows) {
      const values = peeked.get(row) ?? row.node.values;
      const own = row.node.via?.column;
      for (const rollup of rulesOf(row.target)?.rollupsInto ?? []) {
        const key = values[rollup.via];
        if (rollup.via !== own && key !== null && key !== undefined) starts.push({ rollup, keys: [key] });
      }
      for (const parent of row.target.table.table?.stateParents ?? []) {
        if (parent.via !== own) add(parents, parent.table, parent.key, values[parent.via]);
        for (const link of parent.links ?? []) add(linked, link.table, link.key, values[link.via]);
      }
      // What a new row waits for through its links (`states.create`): read for share, with the others, not row by row.
      for (const link of (row.target.table.table?.stateLinks ?? []).filter((l) => l.via !== own && waitVias(row.target.table.table?.states?.create?.requires).includes(l.via))) {
        add(linked, link.table, link.key, values[link.via]);
      }
    }
    const held = await holdChain(db, dialect, starts, currency);
    const sorted = (map: typeof parents) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, entry]) => entry);
    for (const entry of sorted(parents)) await holdKeys(db, dialect, entry.table, entry.key, entry.keys, false);
    for (const entry of sorted(linked)) await holdKeys(db, dialect, entry.table, entry.key, entry.keys, true);
    return held;
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
      // A row that moved away from the lock it was named by (an effect's, judged inside the statement) is the retry's, never a refusal.
      if (error instanceof LockMoved) throw error;
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
      if (action !== 'delete') refuseUnbuiltTable(target);
      const rules = rulesOf(target);
      refuseGuardedBatch(rules, action, target, rows, checkOpts?.capacity);
      const clock = writeClock(context);
      const now = clock.startedAt;
      const memo: CopyMemo = new Map();
      const out: (CheckedRow | null)[] = [];
      const issues: (FieldIssues | null)[] = [];
      for (const row of rows) {
        const early = earlyIssues(target, row);
        if (early !== null) {
          issues.push(early);
          out.push(null);
          continue;
        }
        // No stored row here: an update's formulas are worked out by a path that reads one (`beforeEach`).
        const values = await formulate(rules, action, target, await prepareValues(rules, action, target, context, row, now, memo), null, context.origin);
        const issue = mergeIssues(checkRow(judgedBy(rules, target, context), action, values, { dialect: target.dialect, columns: target.table.columns }), await boundIssues(rules, action, target, context, values, null));
        issues.push(issue);
        out.push(issue === null ? await carry(rules, action, target, context, await numbered(rules, action, target, context, brand(values)), null, clock) : null);
      }
      return { rows: out, issues };
    },

    async create(input) {
      const { context } = input;
      const target = await withRights(input.target);
      const hooks = current();
      // One clock for the write: its start for what is prepared here, its locked instant for what is judged under the locks.
      const clock = writeClock(context);
      const { rules, zone, checked, codes } = await prepareOne({
        target,
        values: input.values,
        context,
        clock,
        mode: 'save',
        hooks: true,
        recheck: input.recheck,
        mapError: input.mapError,
      });
      const currency = currencyFor(target);
      await refuseUngrantedChain(target, [...(rules?.rollupsInto ?? []), ...(rules?.ownRollups ?? [])]);
      const booking = rules?.booking;
      const need = booking === undefined ? null : bookingNeed(booking, checked, null);
      const now = new Date();
      const limits = (rules?.capacityRules?.length ?? 0) > 0;
      const write = async (db: Db) => {
        const within = { ...target, db, timezone: zone, origin: context.origin };
        // The limits this row takes from, judged under their locks (the write's clock is read first, inside).
        if (limits) await judgeRows(db, [{ target: within, pk: null, row: checked, before: null }], { clock, origin: context.origin, mode: 'save' }, input.mapError);
        // "Anyone" comes back as the person the guard picked, written and reported with the row.
        const placed =
          booking !== undefined && need !== null
            ? brand({ ...checked, ...(await guardedValue(() => checkBooking(booking, within, { row: checked, before: null, need, now }), input.mapError)) })
            : checked;
        // The parents whose totals this row moves, held before it is written.
        const held = await holdParents(rules, within, [{ record: placed, before: null }], currency);
        // A copy that follows its parent, read again from the parent as held: a change of it meanwhile would not have reached this row.
        const followed = brand(await followNow({ db, dialect: target.dialect, rules, values: placed, currency }));
        const counted = brand(await claimSequences(rules, 'create', within, followed, opts.sequences));
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
          limits
            ? // The pools' locks and the numbers' series, in one call: one order for every writer.
              withLimitLocks(
                target,
                async () => [
                  ...(await capacityLockNames(target.db, [{ target: { ...target, timezone: zone }, row: checked, before: null, prepared: true }])),
                  ...(series === null ? [] : seriesOf(rules, target.table, checked).map((name) => ({ name, busy: 'NUMBER_BUSY' as const }))),
                ],
                write,
                clock,
              )
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

    async createTree(input) {
      const { context, mode } = input;
      const hooks = current();
      const clock = writeClock(context);
      const dry = mode === 'dry';
      /** A refusal about one row of the tree, through the door's own mapping. */
      const at = async <T>(node: TreeNode, run: () => Promise<T>): Promise<T> => {
        try {
          return await run();
        } catch (error) {
          if (error instanceof LockMoved || error instanceof TreeSignal) throw error;
          return input.mapError(error, node.at);
        }
      };

      // 1. Every row's place, level by level, and what the role may write in each table — read outside any transaction.
      const rights = new Map<string, WriteTarget>();
      const withGrants = async (target: WriteTarget): Promise<WriteTarget> => {
        const known = rights.get(target.table.id);
        if (known !== undefined) return { ...target, rights: known.rights };
        const granted = await withRights(target);
        rights.set(target.table.id, granted);
        return granted;
      };
      const rootRow: TreeRow = { node: input.root, target: await withGrants(input.root.target), parent: null, index: 0, depth: 0 };
      const levels: TreeRow[][] = [[rootRow]];
      for (let depth = 0; depth < 2; depth += 1) {
        const next: TreeRow[] = [];
        for (const row of levels[depth]!) {
          const counted = new Map<string, number>();
          for (const child of row.node.children) {
            const index = counted.get(child.name) ?? 0;
            counted.set(child.name, index + 1);
            next.push({ node: child, target: await withGrants(child.target), parent: row, index, depth: depth + 1 });
          }
        }
        if (next.length === 0) break;
        levels.push(next);
      }
      const everyRow = levels.flat();
      // So many rows below one create and no more, whichever door sent them.
      if (everyRow.length - 1 > TREE_MAX_ROWS) {
        await at(rootRow.node, () => Promise.reject(new ValidationFailedError(`A create carries ${String(TREE_MAX_ROWS)} rows below it at most.`, { child: levels[1]![0]!.node.name, reason: 'too-many' })));
      }
      // A child table a before hook runs for cannot take rows here: a hook may write through its own connection, which waits on this transaction.
      for (const row of everyRow.slice(1)) {
        refuseUnbuiltTable(row.target);
        if (rulesOf(row.target)?.booking !== undefined) await at(row.node, () => Promise.reject(new GuardedBatchError(row.target.table.name)));
        if (await hooks.wants('before', 'create', row.target, context)) {
          await at(row.node, () =>
            Promise.reject(
              new ValidationFailedError(`${row.target.table.name} runs a hook, so its rows cannot be written with the row they belong to.`, {
                child: row.node.name,
                reason: 'hooked',
              }),
            ),
          );
        }
      }
      if (rulesOf(rootRow.target)?.booking !== undefined) await at(rootRow.node, () => Promise.reject(new GuardedBatchError(rootRow.target.table.name)));

      // 2. The root, prepared as a single create prepares its row; its before hooks run for a save only.
      const root = await at(rootRow.node, () =>
        prepareOne({ target: rootRow.target, values: rootRow.node.values, context, clock, mode, hooks: !dry, grants: true }),
      );
      // Every column the tree's totals write in other rows, granted, before anything is written.
      for (const target of rights.values()) {
        const rules = rulesOf(target);
        await at(rootRow.node, () => refuseUngrantedChain(target, [...(rules?.rollupsInto ?? []), ...(rules?.ownRollups ?? [])]));
      }
      const currency = currencyFor(rootRow.target);

      // A retry of a create already made answers the rows it stored, with nothing written.
      const replayed = async (db: Db): Promise<TreeOutcome | null> => {
        if (dry || input.replay === undefined) return null;
        const found = await input.replay(db);
        return found === null ? null : { mode, root: found.root, rows: found.rows, capacity: [], replayed: true };
      };
      const before = await replayed(rootRow.target.db);
      if (before !== null) return before;

      // What each row says of the rows outside the tree it will be tied to: its values as sent, a copied link read through its source.
      const peeked = new Map<TreeRow, Row>();
      if (!dry) {
        for (const row of everyRow) {
          const own = row === rootRow ? (root.checked as Row) : row.node.values;
          peeked.set(row, row === rootRow ? own : await peekLinks(row, own, peeked.get(row.parent!) ?? null));
        }
      }

      // 3. The locks a save names: every limit the rows may take from, and every series they number in.
      const lockNames = async (): Promise<NamedLock[]> => {
        if (dry) return [];
        const limits = await capacityLockNames(
          rootRow.target.db,
          everyRow.map((row) => ({
            target: { ...row.target, timezone: row.target.timezone ?? root.zone },
            row: row === rootRow ? (root.checked as Row) : row.node.values,
            before: null,
            prepared: row === rootRow,
          })),
        );
        const series = everyRow.flatMap((row) =>
          seriesOf(rulesOf(row.target), row.target.table, row === rootRow ? root.checked : row.node.values).map((name) => ({ name, busy: 'NUMBER_BUSY' as const })),
        );
        return [...limits, ...series];
      };

      /** The whole write, inside one transaction holding `names`. */
      const run = async (trx: Db): Promise<TreeOutcome> => {
        // The instant every rule of this write judges by: now, under the locks.
        clock.locked(trx);
        // 5. The retry key again, under the locks: a twin that waited on them finds the rows the first one made.
        const again = await replayed(trx);
        if (again !== null) throw new TreeSignal('replayed', again);
        // 6. The person found or made by address (a save only; never a quote).
        const person = dry || input.identity === undefined ? {} : await at(rootRow.node, () => input.identity!(trx));
        // 7. Every row outside the tree it is tied to, held for ALL rows at once in the one order: totals top-down, parents, linked rows for share.
        const held = dry ? new Map<string, Map<string, Row>>() : await at(rootRow.node, () => holdOutside(trx, rootRow.target.dialect, everyRow, peeked, currency));
        const heldKey = new Set<string>();
        for (const [table, rows] of held) for (const key of rows.keys()) heldKey.add(`${table}\u0000${key}`);

        // 8. The rows, root first, then each level in request order.
        const written = new Map<TreeRow, Row>();
        // Each row as prepared: what its fingerprints are sealed from again once the totals below it are in.
        const preparedOf = new Map<TreeRow, CheckedRow>();
        const inTree = new Set<string>();
        const writeRow = async (row: TreeRow, prepared: PreparedCreate): Promise<Row> => {
          preparedOf.set(row, prepared.checked);
          // A quote's parent among its own rows is emptied as a save's would be; a real row it leaves alone.
          const guard = dry ? guardOf(prepared.checked) : undefined;
          if (guard !== undefined) guard.quoteOwns = (table, key) => inTree.has(`${table}\u0000${String(key)}`);
          const within: WriteTarget = { ...row.target, db: trx, timezone: prepared.zone ?? row.target.timezone };
          const parent = row.parent === null ? null : written.get(row.parent)!;
          await input.checks?.(trx, row.node, prepared.checked, parent);
          const counted = dry ? prepared.checked : brand(await claimSequences(prepared.rules, 'create', within, prepared.checked, opts.sequences));
          let out: { row: Row; values: CheckedRow };
          try {
            out = await insertWithCodes(within, counted, prepared.codes, undefined);
          } catch (error) {
            // A twin with the same retry key committed first: its rows are answered once this transaction is gone.
            if (row === rootRow && input.replay !== undefined && !dry && isUniqueViolation(error)) throw new TreeSignal('twin', null, error);
            throw error;
          }
          written.set(row, out.row);
          const key = keyOf(row.target.table, out.row);
          if (key !== null) inTree.add(`${row.target.table.id}\u0000${key}`);
          return out.row;
        };
        await at(rootRow.node, async () => {
          const values = Object.keys(person).length === 0 ? root : { ...root, checked: brand({ ...root.checked, ...person }) };
          const made = await writeRow(rootRow, values);
          await input.inside?.(trx, made);
        });
        for (let depth = 1; depth <= 2; depth += 1) {
          const level = levels[depth] ?? [];
          for (const row of level) {
            await at(row.node, async () => {
              const parent = written.get(row.parent!)!;
              const via = row.node.via;
              const values: Row = {
                ...row.node.values,
                ...(via === undefined ? {} : { [via.column]: parent[via.parentKey] }),
                ...(row.node.position === undefined ? {} : { [row.node.position]: row.index + 1 }),
              };
              // The same steps as the root's, on this transaction; no before hook runs inside one.
              const prepared = await prepareOne({ target: { ...row.target, db: trx }, values, context, clock, mode, hooks: false, grants: true });
              // A row tied to a total outside the tree whose link a peek misread: held too late to keep the one order.
              // A link to no row at all is not a race: it is refused as a quote refuses it (the reference, then the key).
              if (!dry) {
                for (const rollup of prepared.rules?.rollupsInto ?? []) {
                  const key = prepared.checked[rollup.via];
                  if (key === null || key === undefined || inTree.has(`${rollup.parent}\u0000${String(key)}`)) continue;
                  if (heldKey.has(`${rollup.parent}\u0000${String(key)}`)) continue;
                  if ((await rowsByKey(trx, row.target.dialect, rollup.parent, rollup.parentKey, [key], [], false)).size > 0) throw climbMoved(rollup.parent);
                }
              }
              await writeRow(row, prepared);
            });
          }
          // Each child list of each row one level up, once all of it is written — an empty one too: what its rows come to together.
          if (input.siblings === undefined) continue;
          for (const parent of levels[depth - 1] ?? []) {
            const byName = new Map<string, TreeWritten[]>((parent.node.lists ?? []).map((name) => [name, []]));
            for (const row of level) {
              if (row.parent !== parent) continue;
              const list = byName.get(row.node.name) ?? [];
              list.push({ node: row.node, record: written.get(row)! });
              byName.set(row.node.name, list);
            }
            for (const [name, rows] of byName) {
              await at(parent.node, () => input.siblings!(trx, { node: parent.node, record: written.get(parent)! }, name, rows));
            }
          }
        }

        // 9. The limits, judged once over every row written.
        const judged = everyRow.map((row) => {
          const record = written.get(row)!;
          const key = keyOf(row.target.table, record) === null ? null : pkOf(row.target.table, record);
          return { target: { ...row.target, db: trx, timezone: row.target.timezone ?? root.zone }, pk: key, row: record, before: null, path: row.node.at };
        });
        let capacity: PoolState[];
        try {
          capacity = await judgeCapacity(trx, judged, { clock, origin: context.origin, mode });
        } catch (error) {
          if (error instanceof LockMoved) throw error;
          const index = (error as { details?: { row?: unknown } }).details?.row;
          const row = typeof index === 'number' ? everyRow[index] : undefined;
          return input.mapError(error, row?.node.at ?? []);
        }

        // 10. The totals, bottom-up, climbing; a quote settles only its own rows.
        const only = dry ? (table: string, key: unknown) => inTree.has(`${table}\u0000${String(key)}`) : undefined;
        const read = dry ? ('plain' as const) : ('locking' as const);
        for (const level of [...levels].reverse()) {
          for (const row of level) {
            const rules = rulesOf(row.target);
            const record = written.get(row)!;
            await at(row.node, async () => {
              const own = rules?.ownRollups ?? [];
              const key = own[0] === undefined ? undefined : record[own[0].parentKey];
              if (key !== null && key !== undefined) {
                await settleChain(trx, row.target.dialect, own.map((rollup) => ({ rollup, keys: [key] })), currency, { only, read });
                const balances = rules?.balances ?? [];
                if (balances.length > 0) {
                  await settleBalances(trx, row.target.dialect, row.target.table.id, own[0]!.parentKey, balances, key, { currencyColumn: rules?.currencyColumn, currency });
                  const refusal = await capRefusal(trx, row.target.table.id, own[0]!.parentKey, key, balances, undefined);
                  if (refusal !== null) throw refusal;
                }
              }
              await settleChain(trx, row.target.dialect, chainStarts(rules, [{ record, before: null }]), currency, { only, read, cap: dry ? undefined : held });
            });
          }
        }
        // Every row as its totals left it, sealed again over them.
        const rows: TreeWritten[] = [];
        for (const row of everyRow) {
          const rules = rulesOf(row.target);
          let record = written.get(row)!;
          if (keepsOwnTotals(rules)) {
            const sealing = sealsOf(preparedOf.get(row) ?? record);
            if (sealing !== undefined && keyOf(row.target.table, record) !== null) await sealRows(trx, row.target.table, pkOf(row.target.table, record), sealing, writeSeals);
            record = await readAgain(trx, row.target.table, record);
          }
          rows.push({ node: row.node, record });
        }
        const outcome: TreeOutcome = { mode, root: rows[0]!.record, rows, capacity, replayed: false };
        // 11. The price the caller expected (a save only), then 12: commit — or a quote rolled back.
        if (!dry) await input.expect?.(trx, outcome.root, rows);
        if (dry) throw new TreeSignal('dry', outcome);
        return outcome;
      };

      let outcome: TreeOutcome;
      try {
        // A row moved away from the lock it was named by: named again from a fresh read, a few times, then 409 WRITE_CONFLICT.
        outcome = await conflicted(() => withLimitLocks(rootRow.target, lockNames, run, clock), (error) => input.mapError(error, []));
      } catch (error) {
        if (error instanceof AppError && error.code === 'WRITE_CONFLICT' && !(error instanceof TreeSignal)) return input.mapError(error, []);
        if (!(error instanceof TreeSignal)) throw error;
        if (error.kind === 'dry' || error.kind === 'replayed') return error.outcome!;
        // The twin's rows, read once its transaction and this one are both over.
        const twin = await replayed(rootRow.target.db);
        if (twin !== null) return twin;
        return input.mapError(error.original, rootRow.node.at);
      }

      // After the commit, root first, then each level in request order: announced, then the after hooks.
      for (const row of outcome.rows) {
        await input.announce(row);
        const target = rights.get(row.node.target.table.id) ?? row.node.target;
        if (await hooks.wants('after', 'create', target, context)) {
          await hooks.after({ action: 'create', target, record: row.record, before: null, context });
        }
      }
      return outcome;
    },

    async update(input) {
      const { context, pk } = input;
      const target = await withRights(input.target);
      refuseUnbuiltTable(target);
      refuseEarly(target, 'update', input.values, input.mapError);
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
      const clock = writeClock(context);
      let values = await prepareValues(rules, 'update', target, context, input.values, clock.startedAt);
      // A quote runs no hook: it says so (`exact`), as a quote of a create does.
      const wantsBefore = input.mode !== 'dry' && (await hooks.wants('before', 'update', target, context));
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
          () => decideRow(rules, 'update', values, before, decideContext(target, context, stampNow(clock), zone)),
          input.mapError,
        );
      }
      // A row the caller cannot see is not a hook's business: the UPDATE below
      // matches nothing and the caller answers as it always has.
      if (wantsBefore && before !== null) {
        values = withoutReadOnly(rules, await runBefore(hooks, 'update', target, context, values, before), context.origin);
      }
      // A price by the night this change moves (its dates, its rate): worked out again below, from the row as held.
      const perNight = rules?.perNight;
      const repricing =
        perNight !== undefined &&
        before !== null &&
        repricedBy(perNight, values) &&
        !(context.origin === 'import' && values[perNight.column] !== null && values[perNight.column] !== undefined && values[perNight.column] !== '');
      // PRICE and FORMULA, over the stored row: a change of `qty` alone still has the `rate` it multiplies.
      values = await formulate(rules, 'update', target, values, before, context.origin);
      if (values !== input.values && input.recheck !== undefined) await input.recheck(values);
      // CHECK, and what the statement judges this write by: a document's states, and the fingerprints it seals.
      const carried = await carry(rules, 'update', target, context, await checkAllOrThrow(rules, 'update', target, context, values, before, input.mapError), before, clock);
      // A public entry's windows read from moments go with the values to the statement, which judges them holding the row.
      const checkedValues = input.windows === undefined ? carried : brand(attachWindows(carried, input.windows));
      // A change that moves what a limit counts — its own rows', or the rows it owns — is judged under the pools' locks.
      const limits = (rules?.capacityRules !== undefined || rules?.capacityOwners !== undefined) && touchesCapacity(target, values);
      const booking = rules?.booking !== undefined && touchesBooking(rules.booking, values) ? rules.booking : undefined;
      // The formulas this change moves: worked out again below from the row as held.
      const worked = (rules?.formulas ?? []).filter((formula) => Object.prototype.hasOwnProperty.call(checkedValues, formula.column));
      // A changed fee (or what is taken off it, or a total a formula works out) moves this row's own balances.
      const moved = movedBalances(rules, checkedValues);
      // A change that can move a column the rows of another table follow (a stay's nights, under its extras).
      const following = followsFrom(rules, checkedValues);
      const rolls = (rules?.rollupsInto?.length ?? 0) > 0 || moved.length > 0 || worked.length > 0 || repricing || following;
      const now = new Date();
      // A quote of the change (`dry`) runs it and rolls it back; a price check runs inside the change's transaction.
      const dry = input.mode === 'dry';
      const quoted = dry || input.expect !== undefined || input.inside !== undefined;
      // A quote reads as things are and holds no row it does not write: it never waits on a save, nor a save on it.
      if (dry) quoteOnly(checkedValues);
      // The rows this move's effects move (a room, an order): their limits are named with this row's, the totals they climb into held with its own.
      const effectTables = effectTablesOf(target, checkedValues);
      const effectLimits = !dry && effectTables.some((rules) => keepsLimits(rules));
      const effectTotals = !dry && effectTables.some((rules) => (rules?.rollupsInto?.length ?? 0) > 0);
      if (effectLimits) {
        const guard = guardOf(checkedValues);
        if (guard !== undefined) guard.effectsNamed = true;
      }
      if (rolls) await refuseUngrantedChain(target, rules?.rollupsInto ?? []);
      if (following) await refuseUngrantedFollow(target, rules);
      /** The day the booking lock was named by; the write refuses to go on under a different one. */
      let lockedDay: string | null = null;
      const write = async (db: Db) => {
        const within = { ...target, db, timezone: zone, origin: context.origin };
        // The row as stored, read under the lock: what the guard leaves out
        // of its sum, the parent a moved child leaves, and what a formula
        // reads. Held too when it feeds a parent's total or works a formula
        // out: a writer moving it meanwhile would leave this one settling the
        // wrong parent, and a line settled meanwhile a subtotal read too early.
        // The document before its line: every writer takes the parent first (see `holdFirst`).
        // A quote holds neither: it reads as things are (the rows its own statements write aside).
        if (!dry) {
          // The totals the rows its effects move climb into, named from a look at them now (held again, and judged, when they move).
          const also = effectTotals
            ? (await statement(() => effectRows(db, within, context, clock, checkedValues, fetchByPk(db, target.table, pk).then((row) => row ?? null)), input.mapError))
                .filter((effect) => movesTotal(effect.rules, effect.rules?.rollupsInto ?? [], effect.checked))
                .flatMap((effect) => chainStarts(effect.rules, [{ record: { ...effect.before, ...effect.checked }, before: effect.before }]))
            : [];
          await holdFirst(rules, within, pk, checkedValues, also);
        }
        // Then the rows its links point at (its conditions, its effects' rows): before its own row, held next.
        if (!dry) await holdLinkedFirst(db, target.dialect, target.table, checkedValues, pk);
        const prior =
          limits || booking !== undefined || rolls
            ? ((!dry && (holdsParent(rules) || worked.length > 0 || limits || repricing || following) ? await fetchHeld(db, target, pk, true) : await fetchByPk(db, target.table, pk)) ?? null)
            : null;
        if (limits && prior !== null) {
          // A quote of the change counts the same pools, holding none: its own places are left out by its key.
          await judgeRows(db, [{ target: within, pk, row: { ...prior, ...checkedValues }, before: prior, values: checkedValues }], { clock, origin: context.origin, mode: dry ? 'dry' : 'save' }, input.mapError);
        }
        let written = checkedValues;
        if (booking !== undefined && prior !== null) {
          const need = bookingNeed(booking, checkedValues, prior);
          if (need !== null) {
            // Another writer moved the row between the lock's naming and now:
            // start again under the day it will really hold.
            if (!dry && bookingDay(booking, { ...prior, ...checkedValues }, zone ?? 'UTC') !== lockedDay) throw new DayMoved();
            const merged = { ...prior, ...checkedValues };
            const picked = await guardedValue(() => checkBooking(booking, within, { row: merged, before: prior, need, now }), input.mapError);
            if (Object.keys(picked).length > 0) written = brand({ ...checkedValues, ...picked });
          }
        }
        // A copy that follows its parent, when the change moves the row to another parent: read from that parent as held.
        if (!dry && (rules?.copies ?? []).some((copy) => copy.follow === true && Object.prototype.hasOwnProperty.call(written, copy.via))) {
          // The copies only: the formulas that read them are worked out again just below, from the row as held.
          const fresh = await followNow({ db, dialect: target.dialect, rules, values: { ...(prior ?? {}), ...written }, written: Object.keys(written), currency });
          const copied: Row = { ...written };
          for (const copy of rules?.copies ?? []) if (copy.follow === true && Object.prototype.hasOwnProperty.call(written, copy.via)) copied[copy.column] = fresh[copy.column];
          written = brand(copied);
        }
        // The price by the night again, from the row as held: another writer may have moved the dates it reads meanwhile.
        if (repricing && prior !== null) {
          const again = await priceValues(rules, 'update', db, written, prior, { origin: context.origin, currency });
          const refused = priceIssuesOf(again);
          if (refused !== undefined) await guardedValue(() => Promise.reject(refusal(refused)), input.mapError);
          written = brand({ ...written, [perNight!.column]: again[perNight!.column] });
        }
        // Worked out again from the row as held: a total over child rows may have moved since it was first read.
        if (worked.length > 0 && prior !== null) {
          const connection = readsCurrency(rules) ? await currency() : null;
          written = brand({ ...written, ...evaluateAll(worked, { ...prior, ...written }, rules?.currencyColumn, connection) });
        }
        // The parents whose totals the write moves, and this row's own capped
        // balances, held — and read as they are — before the statement.
        const held = dry ? new Map<string, Map<string, Row>>() : await holdParents(rules, within, [{ record: { ...(prior ?? {}), ...written }, before: prior }], currency);
        // This row's own balances, when the write really changes what they are worked out from.
        const ownMoved = movedBalances(rules, written, prior);
        const ownBefore = !ownMoved.some((balance) => balance.cappedBy.length > 0)
          ? undefined
          : dry
            ? ((await fetchByPk(db, target.table, pk)) ?? undefined)
            : await holdOwn(rules, within, pk, ownMoved, currency);
        // A renewed code that collides with a stored one is made again (`crud/code-renew.ts`).
        const renewing = await statement(() => withRenewRetry(db, target.dialect, written, (row) => updateRows(db, target.dialect, target.table, row, pk, input.refine)), input.mapError);
        written = renewing.values;
        const changed = renewing.result;
        if (changed > 0 && rolls) {
          const after = (await fetchByPk(db, target.table, pk)) ?? null;
          await guarded(async () => {
            // The rows that follow this one (a stay's extras), brought into step, and their totals settled into it — before its own balances are judged.
            if (following && prior !== null && after !== null) await followAndSettle(within, rules, prior, after, currency, dry);
            // A quote shows its own row: the totals it feeds elsewhere are not its to settle.
            if (!dry) await settleRows(rules, within, [{ record: after, before: prior }], currency, held);
            if (ownMoved.length > 0) await settleOwn(rules, within, 'update', after, written, currency, ownBefore);
          }, input.mapError);
          // SEAL again over the totals the settle just wrote beside the row.
          const sealing = sealsOf(written);
          if (sealing !== undefined) await sealRows(db, target.table, pk, sealing, writeSeals);
        }
        if (written !== checkedValues) values = written;
        // A form's child rows, written under the same locks and judged there.
        if (input.children !== undefined && changed > 0) {
          const after = (await fetchByPk(db, target.table, pk)) ?? null;
          if (after !== null) await judgeRows(db, await input.children.write(db, after, written), { clock, origin: context.origin, mode: 'save' }, input.mapError);
        }
        if (quoted && changed > 0) {
          const after = (await fetchByPk(db, target.table, pk)) ?? null;
          if (after !== null) await input.inside?.(db, after);
          if (!dry && after !== null) await input.expect?.(db, after);
          // A quote ends here: nothing it wrote is kept.
          if (dry) throw new UpdateQuoted(after, changed);
        }
        return changed;
      };
      let count: number;
      try {
        count = await conflicted(async () => {
          // A quote takes no named lock: it waits for nobody, and nobody waits for it.
          if (dry) return await withNamedLocks(target, [], write);
          if (limits || input.children !== undefined || effectLimits) {
            // The locks are named by the pools the row will take from, from a fresh look each time.
            return await withLimitLocks(target, async () => {
              const current = limits || effectLimits ? ((await fetchByPk(target.db, target.table, pk)) ?? null) : null;
              const below = input.children === undefined ? [] : await input.children.names();
              // The rows its effects move, as they will stand: their pools, and the rows they own.
              const moved = effectLimits ? (await statement(() => effectRows(target.db, { ...target, timezone: zone }, context, clock, checkedValues, Promise.resolve(current)), input.mapError)).filter((effect) => keepsLimits(effect.rules)) : [];
              return capacityLockNames(target.db, [
                ...(current === null || !limits ? [] : [{ target: { ...target, timezone: zone }, row: { ...current, ...checkedValues }, before: current, prepared: true }]),
                ...below,
                ...moved.map((effect) => ({ target: effect.target, row: { ...effect.before, ...effect.checked }, before: effect.before, prepared: true })),
              ]);
            }, write, clock);
          }
          if (booking !== undefined) {
            return await bookedUpdate(booking, target, zone, pk, checkedValues, (day) => {
              lockedDay = day;
            }, write, rolls || quoted, input.mapError);
          }
          return rolls || quoted || effectTotals ? await atomically(target, write) : await write(target.db);
        }, input.mapError);
      } catch (error) {
        if (!(error instanceof UpdateQuoted)) throw error;
        return { before, after: error.after, values, count: error.count };
      }
      if (count === 0 && input.skipIfNone === true) return { before, after: null, values, count };
      const after = (await fetchByPk(target.db, target.table, pk)) ?? null;
      const effects = guardOf(checkedValues)?.effected;
      const outcome: UpdateOutcome = { before, after, values, count, ...(effects === undefined || effects.length === 0 ? {} : { effects }) };
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
      if (rolls) await refuseUngrantedChain(target, rules?.rollupsInto ?? []);
      // A document's states judge the delete — unless the caller's scope could not see the row, which then matches nothing.
      const judged =
        input.refine !== undefined && before === null ? undefined : { dialect: target.dialect, prepared: await carry(rules, 'delete', target, context, brand({}), before, writeClock(context)) };
      const count = rolls
        ? await conflicted(() => atomically(target, async (db) => {
            // The parent the row fed, held first; then the row, read — and held — before it goes.
            const within = { ...target, db };
            await holdFirst(rules, within, pk);
            const gone = (await fetchHeld(db, target, pk, false)) ?? null;
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

    async deleteRefusal(target, context, rows) {
      if (!tiedToStates(target.table)) return null;
      const rules = rulesOf(target);
      for (const row of rows) {
        const refused = await deleteRefusal(target.db, target.table, row, guardOf(await carry(rules, 'delete', target, context, brand({}), row, writeClock(context))));
        if (refused !== null) return refused;
      }
      return null;
    },

    async beforeEach(action, givenTarget, context, rows, beforeOpts) {
      const target = action === 'delete' ? givenTarget : await withRights(givenTarget);
      if (action !== 'delete') refuseUnbuiltTable(target);
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
      const clock = writeClock(context);
      const now = clock.startedAt;
      const memo: CopyMemo = new Map();
      const zone = withRules ? await zoneFor(rules, target) : undefined;
      /**
       * FORMULA over the row as stored, CHECK, then SEQUENCE for a row that
       * passed — carrying what its statement judges it by.
       */
      const prepare = async (values: Row, record: Row | null): Promise<{ values: CheckedRow; issues: FieldIssues | null }> => {
        if (!withRules) return { values: brand(values), issues: null };
        const worked = await formulate(rules, action, target, values, record, context.origin);
        const judged = judgedBy(rules, target, context);
        const issues = mergeIssues(checkRow(judged, action, worked, { dialect: target.dialect, stored: record, columns: target.table.columns }), await boundIssues(rules, action, target, context, worked, record));
        // A refused row is not written, so it is given no number.
        if (issues !== null) return { values: brand(worked), issues };
        const guarded = brand(attachRequiredGuards(worked, requiredGuards(judged, action, worked, record)));
        return { values: await carry(rules, action, target, context, await numbered(rules, action, target, context, guarded), record, clock), issues };
      };
      const start = (values: Row): Promise<Row> =>
        withRules ? prepareValues(rules, action, target, context, values, now, memo) : Promise.resolve(values);
      /** DECIDE against the stored row, as a single-row write does; a refusal is that row's own issue. */
      const decided = async (values: Row, record: Row | null): Promise<{ values: Row; refused: FieldIssues | null }> => {
        if (!withRules || action === 'delete' || (action === 'update' && !needsStored(rules))) return { values, refused: null };
        try {
          return { values: await decideRow(rules, action, values, record, decideContext(target, context, stampNow(clock), zone)), refused: null };
        } catch (error) {
          const column = String(((error as { details?: { column?: unknown } }).details?.column ?? '') || 'row');
          return { values, refused: { [column]: { code: 'not-allowed' } } };
        }
      };
      /** A row whose values hold text no engine keeps alike is refused before anything reads with them; an undo restores history as it was. */
      const early = (row: PlannedRow): FieldIssues | null => (withRules && action !== 'delete' ? earlyIssues(target, row.values) : null);
      const storedOf = async (row: PlannedRow): Promise<Row | null> =>
        row.record !== undefined ? row.record : row.match === undefined ? null : ((await fetchByPk(target.db, target.table, row.match)) ?? null);
      if (!(await hooks.wants('before', action, target, context))) {
        const out: PreparedRow[] = [];
        for (const row of rows) {
          const unstorable = early(row);
          if (unstorable !== null) {
            out.push({ values: brand(row.values), issues: unstorable, record: undefined });
            continue;
          }
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
        const unstorable = early(row);
        if (unstorable !== null) {
          prepared.push({ values: brand(row.values), record: undefined, issues: unstorable });
          continue;
        }
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
