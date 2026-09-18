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
 *   2. FILL — a column rule puts a value in an absent key (`crud/column-rules.ts`);
 *   3. before hooks run, and may change the values or reject the write;
 *   4. CHECK — the filled values are judged; a refusal is 422 with the column named;
 *   5. the statement runs;
 *   6. the caller announces the write (audit, files, realtime, record events);
 *   7. after hooks run. Their errors are recorded and never undo the write.
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
import type { Kysely, UpdateQueryBuilder, UpdateResult } from 'kysely';
import type { Dialect } from '@adminium/engine';

import { AppError, ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import { getPrincipal } from '../rbac/principal.js';
import { checkRow, fillRow, tableRulesFor, type FieldIssues, type TableRules } from './column-rules.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';
import { fetchByPk } from './records.js';
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
export async function insertRow(
  db: Db,
  dialect: Dialect,
  table: ResolvedTable,
  values: CheckedRow,
): Promise<Row> {
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
export async function insertRows(db: Db, table: ResolvedTable, rows: readonly CheckedRow[]): Promise<void> {
  await db
    .insertInto(table.id)
    .values(rows as never)
    .execute();
}

/**
 * UPDATE the rows whose columns equal `match` (a primary key, or the CSV
 * import's match column), optionally narrowed further. Returns the count.
 */
export async function updateRows(
  db: Db,
  table: ResolvedTable,
  values: CheckedRow,
  match: Row,
  refine?: (query: AnyUpdate) => AnyUpdate,
): Promise<number> {
  let query = db.updateTable(table.id).set(values as never) as unknown as AnyUpdate;
  for (const [column, value] of Object.entries(match)) {
    query = query.where((eb) => eb(db.dynamic.ref(column), '=', value));
  }
  if (refine !== undefined) query = refine(query);
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** DELETE the rows whose columns equal `match`. Returns the count. */
export async function deleteRows(db: Db, table: ResolvedTable, match: Row): Promise<number> {
  let query = db.deleteFrom(table.id);
  for (const [column, value] of Object.entries(match)) {
    query = query.where((eb) => eb(db.dynamic.ref(column), '=', value));
  }
  const result = await query.executeTakeFirst();
  return Number(result.numDeletedRows);
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
  /** The row being deleted; every caller has read it already. */
  before: Row;
  context: WriteContext;
  mapError?: ((error: unknown) => never) | undefined;
  announce: (count: number) => Promise<void>;
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
  ): { rows: (CheckedRow | null)[]; issues: (FieldIssues | null)[] };
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
  /** After hooks for rows that were written, in order. Never throws. */
  afterEach(action: WriteAction, target: WriteTarget, context: WriteContext, rows: WrittenRow[]): Promise<void>;
}

export interface WriteServiceOptions {
  /** Read on every write, so a reload swaps the hooks for the next one. */
  hooks?: (() => RecordHooks) | undefined;
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

    check(action, target, context, rows) {
      const rules = rulesOf(target);
      const now = new Date();
      const out: (CheckedRow | null)[] = [];
      const issues: (FieldIssues | null)[] = [];
      for (const row of rows) {
        const values = fill(rules, action, target, context, row, now);
        const issue = checkRow(rules, action, values, { dialect: target.dialect });
        issues.push(issue);
        out.push(issue === null ? brand(values) : null);
      }
      return { rows: out, issues };
    },

    async create(input) {
      const { target, context } = input;
      const hooks = current();
      const rules = rulesOf(target);
      const filled = fill(rules, 'create', target, context, input.values, new Date());
      const values = (await hooks.wants('before', 'create', target, context))
        ? await runBefore(hooks, 'create', target, context, filled, null)
        : filled;
      if (values !== input.values && input.recheck !== undefined) await input.recheck(values);
      const checkedValues = checkOrThrow(rules, 'create', target, values, input.mapError);
      const row = await statement(
        () => insertRow(target.db, target.dialect, target.table, checkedValues),
        input.mapError,
      );
      await input.announce(row, values);
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
      let values = fill(rules, 'update', target, context, input.values, new Date());
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
      const count = await statement(
        () => updateRows(target.db, target.table, checkedValues, pk, input.refine),
        input.mapError,
      );
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
      const { target, context, pk, before } = input;
      const hooks = current();
      if (await hooks.wants('before', 'delete', target, context)) {
        await runBefore(hooks, 'delete', target, context, {}, before);
      }
      const count = await statement(() => deleteRows(target.db, target.table, pk), input.mapError);
      await input.announce(count);
      if (count > 0 && (await hooks.wants('after', 'delete', target, context))) {
        await hooks.after({ action: 'delete', target, record: before, before: null, context });
      }
      return count;
    },

    async beforeEach(action, target, context, rows, opts) {
      const hooks = current();
      const withRules = opts?.rules !== false;
      const rules = withRules ? rulesOf(target) : null;
      const now = new Date();
      const prepare = (values: Row): { values: CheckedRow; issues: FieldIssues | null } => {
        if (!withRules) return { values: brand(values), issues: null };
        const issues = checkRow(rules, action, values, { dialect: target.dialect });
        return { values: brand(values), issues };
      };
      if (!(await hooks.wants('before', action, target, context))) {
        return rows.map((row) => {
          const values = withRules ? fill(rules, action, target, context, row.values, now) : row.values;
          return { ...prepare(values), record: undefined };
        });
      }
      const prepared: PreparedRow[] = [];
      for (const row of rows) {
        const filled = withRules ? fill(rules, action, target, context, row.values, now) : row.values;
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
        prepared.push({ ...prepare(action === 'delete' ? filled : values), record });
      }
      return prepared;
    },

    async afterEach(action, target, context, rows) {
      if (rows.length === 0) return;
      const hooks = current();
      if (!(await hooks.wants('after', action, target, context))) return;
      for (const row of rows) {
        await hooks.after({ action, target, record: row.record, before: row.before, context });
      }
    },
  };
}
