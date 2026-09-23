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
 *   3. RESOLVE — a copied value and a code are put in (`crud/decided-columns.ts`);
 *   4. before hooks run, and may change the values or reject the write;
 *   5. CHECK — the filled values are judged; a refusal is 422 with the column named;
 *   6. GUARD — on a table with a booking limit, the slot is locked and its
 *      room counted (`crud/capacity-guard.ts`); 6–8 then run in one transaction;
 *   7. SEQUENCE — a running number is claimed, only now, so a refusal burns none;
 *   8. the statement runs (a create whose generated code collides runs again
 *      with a fresh one), and ROLLUP keeps a parent's total in step with it;
 *   9. the caller announces the write (audit, files, realtime, record events);
 *  10. after hooks run. Their errors are recorded and never undo the write.
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

import { AppError, ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import { getPrincipal } from '../rbac/principal.js';
import { checkCapacity, touchesGuard, withSlotLock } from './capacity-guard.js';
import {
  checkRow,
  fillRow,
  tableRulesFor,
  type ColumnCode,
  type FieldIssues,
  type RollupInto,
  type TableRules,
} from './column-rules.js';
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
import { normalizeWriteValue } from './write-values.js';
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
  const values = storable(table, checked, dialect);
  if (dialect !== 'mysql') {
    return (await db
      .insertInto(table.id)
      .values(values as never)
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
  let query = db.updateTable(table.id).set(storable(table, values, dialect) as never) as unknown as AnyUpdate;
  for (const [column, value] of Object.entries(match)) {
    query = query.where((eb) => eb(db.dynamic.ref(column), '=', value));
  }
  if (refine !== undefined) query = refine(query);
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows);
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
): Promise<number> {
  let query = db.deleteFrom(table.id) as unknown as AnyDelete;
  for (const [column, value] of Object.entries(match)) {
    query = query.where((eb) => eb(db.dynamic.ref(column), '=', value));
  }
  if (refine !== undefined) query = refine(query);
  const result = await query.executeTakeFirst();
  return Number(result.numDeletedRows);
}

/**
 * Set a parent's total to what its child rows add up to now — `column.rollup`,
 * kept in step with every write to a child. Rounded in SQL to the total's own
 * places, since SQLite adds money up as a float. A child whose `unlessSet`
 * column holds a value (a voided line) adds nothing.
 */
export async function settleRollup(
  db: Db,
  dialect: Dialect,
  rollup: RollupInto,
  child: ResolvedTable,
  parentKey: unknown,
): Promise<void> {
  const amount = rollup.times === undefined ? sql`${sql.ref(rollup.sum)}` : sql`${sql.ref(rollup.sum)} * ${sql.ref(rollup.times)}`;
  const total = sql`coalesce(sum(${amount}), 0)`;
  // Postgres rounds only a numeric; MySQL and SQLite round what they are given.
  const rounded =
    dialect === 'postgres'
      ? sql`round(cast(${total} as numeric), ${sql.lit(rollup.scale)})`
      : sql`round(${total}, ${sql.lit(rollup.scale)})`;
  await db
    .updateTable(rollup.parent)
    .set({
      [rollup.column]:
        rollup.unlessSet === undefined
          ? sql`(select ${rounded} from ${sql.table(child.id)} where ${sql.ref(rollup.via)} = ${parentKey})`
          : sql`(select ${rounded} from ${sql.table(child.id)} where ${sql.ref(rollup.via)} = ${parentKey} and ${sql.ref(rollup.unlessSet)} is null)`,
    } as never)
    .where((eb) => eb(db.dynamic.ref(rollup.parentKey), '=', parentKey))
    .execute();
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
   * import's fast path. `record` is the row as written (or as it was, for a
   * delete).
   */
  settle(action: WriteAction, target: WriteTarget, rows: WrittenRow[]): Promise<void>;
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

export function createWriteService(opts: WriteServiceOptions = {}): RecordWriteService {
  const current = (): RecordHooks => opts.hooks?.() ?? NO_RECORD_HOOKS;

  const rulesOf = (target: WriteTarget): TableRules | null => tableRulesFor(target);

  const fill = (
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    values: Row,
    now: Date,
  ): Row => fillRow(rules, action, values, { dialect: target.dialect, now, actor: context.actor });

  /** The venue's zone for a table whose rules read a clock; undefined for every other. */
  async function zoneFor(rules: TableRules | null, target: WriteTarget): Promise<string | undefined> {
    if (rules?.capacity === undefined && (rules?.venueLocal?.length ?? 0) === 0) return undefined;
    return target.timezone ?? (await opts.timezoneOf?.(target.connectionId)) ?? 'UTC';
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

  /** FILL (with the venue's clock), then RESOLVE. */
  const prepareValues = async (
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
    values: Row,
    now: Date,
    memo?: CopyMemo,
  ): Promise<Row> =>
    resolveRow(
      rules,
      action,
      target,
      localize(rules, target, fill(rules, action, target, context, values, now), await zoneFor(rules, target)),
      memo,
    );

  /** SEQUENCE, on a row that passed CHECK. */
  const numbered = async (rules: TableRules | null, action: WriteAction, target: WriteTarget, values: CheckedRow) =>
    brand(await claimSequences(rules, action, target, values, opts.sequences));

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

  /** Every parent total a written row feeds — before and after a move. */
  async function settleRows(
    rules: TableRules | null,
    target: WriteTarget,
    rows: readonly { record: Row | null; before: Row | null }[],
  ): Promise<void> {
    for (const rollup of rules?.rollupsInto ?? []) {
      const parents = new Set<unknown>();
      for (const row of rows) {
        for (const side of [row.record, row.before]) {
          const key = side?.[rollup.via];
          if (key !== null && key !== undefined) parents.add(key);
        }
      }
      for (const key of parents) await settleRollup(target.db, target.dialect, rollup, target.table, key);
    }
  }

  async function settle(action: WriteAction, target: WriteTarget, rows: WrittenRow[]): Promise<void> {
    const rules = rulesOf(target);
    if ((rules?.rollupsInto?.length ?? 0) === 0 || rows.length === 0) return;
    await settleRows(
      rules,
      target,
      rows.map((row) => (action === 'delete' ? { record: null, before: row.record } : { record: row.record, before: row.before })),
    );
  }

  /** One transaction for a write and the totals it moves, unless one is open. */
  async function atomically<T>(target: WriteTarget, run: (db: Db) => Promise<T>): Promise<T> {
    return target.db.isTransaction ? run(target.db) : target.db.transaction().execute(run);
  }

  /** Whether a multi-row write must be refused: rows that each need their slot held. */
  function refuseGuardedBatch(
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    rows: readonly Row[],
    capacity: BeforeEachOptions['capacity'],
  ): void {
    if (capacity === 'unchecked' || rules?.capacity === undefined || action === 'delete') return;
    if (action === 'update' && !rows.some((row) => touchesGuard(rules.capacity!, row))) return;
    throw new GuardedBatchError(target.table.name);
  }

  /** Check, or throw the caller's own version of the refusal. */
  function checkOrThrow(
    rules: TableRules | null,
    action: WriteAction,
    target: WriteTarget,
    values: Row,
    mapError: ((error: unknown) => never) | undefined,
  ): CheckedRow {
    const issues = checkRow(rules, action, values, { dialect: target.dialect });
    if (issues === null) return brand(values);
    const error = refusal(issues);
    if (mapError !== undefined) mapError(error);
    throw error;
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
    return valuesAfterHooks(target, values, event.values);
  }

  async function statement<T>(run: () => Promise<T>, mapError: ((error: unknown) => never) | undefined): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (mapError !== undefined) mapError(error);
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
        const values = await prepareValues(rules, action, target, context, row, now, memo);
        const issue = checkRow(rules, action, values, { dialect: target.dialect });
        issues.push(issue);
        out.push(issue === null ? await numbered(rules, action, target, brand(values)) : null);
      }
      return { rows: out, issues };
    },

    async create(input) {
      const { target, context } = input;
      const hooks = current();
      const rules = rulesOf(target);
      const zone = await zoneFor(rules, target);
      const filled = localize(rules, target, fill(rules, 'create', target, context, input.values, new Date()), zone);
      const resolved = await resolveRow(rules, 'create', target, filled);
      const values = (await hooks.wants('before', 'create', target, context))
        ? await runBefore(hooks, 'create', target, context, resolved, null)
        : resolved;
      if (values !== input.values && input.recheck !== undefined) await input.recheck(values);
      const checked = checkOrThrow(rules, 'create', target, values, input.mapError);
      // Only the codes generated here, and left alone by the hooks, are made again.
      const codes = generatedCodes(rules, filled).filter((code) => values[code.column] === resolved[code.column]);
      const write = async (db: Db) => {
        const within = { ...target, db, timezone: zone };
        const capacity = rules?.capacity;
        if (capacity !== undefined) await guarded(() => checkCapacity(capacity, within, checked, null), input.mapError);
        const out = await insertWithCodes(within, await numbered(rules, 'create', within, checked), codes, input.mapError);
        await settleRows(rules, within, [{ record: out.row, before: null }]);
        return out;
      };
      const { row, values: written } =
        rules?.capacity !== undefined
          ? await withSlotLock(rules.capacity, target, checked, write)
          : (rules?.rollupsInto?.length ?? 0) > 0
            ? await atomically(target, write)
            : await write(target.db);
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
      if ((wantsBefore || wantsAfter) && input.before === undefined) {
        before = input.load !== undefined ? await input.load() : ((await fetchByPk(target.db, target.table, pk)) ?? null);
      }
      // A row the caller cannot see is not a hook's business: the UPDATE below
      // matches nothing and the caller answers as it always has.
      if (wantsBefore && before !== null) values = await runBefore(hooks, 'update', target, context, values, before);
      if (values !== input.values && input.recheck !== undefined) await input.recheck(values);
      const checkedValues = checkOrThrow(rules, 'update', target, values, input.mapError);
      const capacity = rules?.capacity !== undefined && touchesGuard(rules.capacity, values) ? rules.capacity : undefined;
      const rolls = (rules?.rollupsInto?.length ?? 0) > 0;
      const write = async (db: Db) => {
        const within = { ...target, db, timezone: zone, origin: context.origin };
        // The row as stored, read under the lock: what the guard leaves out
        // of its sum, and the parent a moved child leaves.
        const prior = capacity !== undefined || rolls ? ((await fetchByPk(db, target.table, pk)) ?? null) : null;
        if (capacity !== undefined && prior !== null) {
          await guarded(() => checkCapacity(capacity, within, checkedValues, prior), input.mapError);
        }
        const changed = await statement(() => updateRows(db, target.dialect, target.table, checkedValues, pk, input.refine), input.mapError);
        if (changed > 0 && rolls) {
          await settleRows(rules, within, [{ record: (await fetchByPk(db, target.table, pk)) ?? null, before: prior }]);
        }
        return changed;
      };
      let count: number;
      if (capacity !== undefined) {
        // The lock is named by the slot the row will hold.
        const current = before ?? ((await fetchByPk(target.db, target.table, pk)) ?? null);
        count = await withSlotLock(capacity, target, { ...(current ?? {}), ...checkedValues }, write);
      } else {
        count = rolls ? await atomically(target, write) : await write(target.db);
      }
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
      const rolls = (rules?.rollupsInto?.length ?? 0) > 0;
      const count = rolls
        ? await atomically(target, async (db) => {
            // The parent the row fed, read before it goes.
            const gone = before ?? ((await fetchByPk(db, target.table, pk)) ?? null);
            const removed = await statement(() => deleteRows(db, target.table, pk, input.refine), input.mapError);
            if (removed > 0) await settleRows(rules, { ...target, db }, [{ record: null, before: gone }]);
            return removed;
          })
        : await statement(() => deleteRows(target.db, target.table, pk, input.refine), input.mapError);
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
      const prepare = async (values: Row): Promise<{ values: CheckedRow; issues: FieldIssues | null }> => {
        if (!withRules) return { values: brand(values), issues: null };
        const issues = checkRow(rules, action, values, { dialect: target.dialect });
        // A refused row is not written, so it is given no number.
        return { values: issues === null ? await numbered(rules, action, target, brand(values)) : brand(values), issues };
      };
      const start = (values: Row): Promise<Row> =>
        withRules ? prepareValues(rules, action, target, context, values, now, memo) : Promise.resolve(values);
      if (!(await hooks.wants('before', action, target, context))) {
        const out: PreparedRow[] = [];
        for (const row of rows) out.push({ ...(await prepare(await start(row.values))), record: undefined });
        return out;
      }
      const prepared: PreparedRow[] = [];
      for (const row of rows) {
        const filled = await start(row.values);
        let record: Row | null = null;
        if (action !== 'create') {
          record =
            row.record !== undefined
              ? row.record
              : row.match === undefined
                ? null
                : ((await fetchByPk(target.db, target.table, row.match)) ?? null);
          if (record === null) {
            // The row is gone; the caller reports it. Nothing is checked,
            // because nothing will be written.
            prepared.push({ values: brand(filled), record: null, issues: null });
            continue;
          }
        }
        const values = await runBefore(hooks, action, target, context, action === 'delete' ? {} : filled, record);
        prepared.push({ ...(await prepare(action === 'delete' ? filled : values)), record });
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
  };
}
