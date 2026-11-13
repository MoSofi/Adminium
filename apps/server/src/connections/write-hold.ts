// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A hold on a source database's growth: while it holds, nothing that adds to
 * the database runs, and everything that takes away still does.
 *
 * Trial mode's size cap (`trial/size-cap.ts`) is the one hold today: a
 * database over its limit takes no INSERT, no UPDATE and no DDL that adds
 * (a table, a column, an index), while DELETE, TRUNCATE and DROP run, so the
 * person can get back under the limit. It is a state of its own, apart from
 * the connection's `readOnly` flag, which every connection probe rewrites.
 *
 * Two places enforce it, so no door is left open:
 *
 *  - the statement itself, at the connection the driver hands Kysely
 *    ({@link holdingDialect}): every statement sent on a held connection's
 *    data handle is read before it leaves, raw SQL and compiled DDL included.
 *    Statements that add are refused there. An UPDATE is not: a delete
 *    keeps a parent's totals in step with UPDATEs of its own, and those must
 *    run for the delete to.
 *  - the write service, for a person's create or change of a row
 *    ({@link refuseHeldWrite}): that is where an UPDATE is told from the
 *    settles a delete makes, and where the refusal comes before any hook.
 *
 * The same reading of each statement tells the watch what ran, so the size
 * is measured again after a delete, an import or a bulk write.
 *
 * The watch's holds live in memory. A statement that adds or changes, and a
 * person's create or change, first wait for the watch to have measured the
 * database since its handle opened ({@link WriteWatch.settle}): after a
 * restart, a wake or a change of the connection, nothing is added to a
 * database over its limit in the moment before it is measured again.
 */
import type { CompiledQuery, DatabaseConnection, Dialect, Driver, Kysely, QueryResult, TransactionSettings } from 'kysely';

import { OffByOperatorError } from '../trial/refuse.js';
import type { PolicyQuestion, PolicyReason } from '../trial/policy.js';

/** Why a connection is held: what the refusal says. */
export interface WriteHold {
  question: PolicyQuestion;
  reason: PolicyReason;
  /** In English: what is refused and how to get out of it. */
  message: string;
}

/** What one statement does to the size of a database. */
export type StatementEffect = 'grow' | 'update' | 'shrink' | 'read';

/**
 * What the manager asks of a hold, per connection: whether it holds now, and
 * told of each statement that changed something (after it ran).
 */
export interface WriteWatch {
  held(connectionId: string): WriteHold | null;
  /** Resolves once the connection has been measured since its handle opened (at once after that); throws 403 when it could not be. */
  settle(connectionId: string): Promise<void>;
  /** A data handle for the connection was just opened: a restart, a resume, or a changed connection string. */
  opened(connectionId: string): void;
  wrote(connectionId: string, effect: Exclude<StatementEffect, 'read'>): void;
  /** Measured now, then refused while held: what an import asks before it starts. */
  beforeImport(connectionId: string): Promise<void>;
}

/** Comments and leading space, which say nothing about what a statement does. */
const LEADING_NOISE = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\()+/;

/** The first word of one statement, lower-cased. */
function firstWord(statement: string): string {
  const rest = statement.replace(LEADING_NOISE, '');
  return /^[a-z]+/i.exec(rest)?.[0].toLowerCase() ?? '';
}

const ADDS = new Set(['insert', 'merge', 'replace', 'copy', 'create', 'upsert', 'load', 'import']);
const TAKES_AWAY = new Set(['delete', 'truncate', 'drop']);

function effectOfOne(statement: string): StatementEffect {
  const word = firstWord(statement);
  if (word === '') return 'read';
  if (ADDS.has(word)) return 'grow';
  if (word === 'update') return 'update';
  if (TAKES_AWAY.has(word)) return 'shrink';
  if (word === 'alter') {
    // A column, a constraint or an index dropped, or a name changed: nothing added. Anything else may add.
    const text = statement.replace(LEADING_NOISE, '');
    const dropsOrRenames = /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"[^"]*"|`[^`]*`|[\w$]+)(?:\s*\.\s*(?:"[^"]*"|`[^`]*`|[\w$]+))?\s+(?:drop|rename)\b/i.test(text);
    // Read without the quoted names: a column called "type" changes nothing.
    const alsoChanges = /\b(?:add|modify|change|type|set|alter\s+column)\b/i.test(text.replace(/^alter\s+table\b/i, '').replace(/"[^"]*"|`[^`]*`/g, ''));
    return dropsOrRenames && !alsoChanges ? 'shrink' : 'grow';
  }
  if (word === 'with') {
    // A data-changing common table expression: what it changes is somewhere inside.
    if (/\b(?:insert\s+into|merge\s+into)\b/i.test(statement)) return 'grow';
    if (/\bupdate\b[\s\S]*\bset\b/i.test(statement)) return 'update';
    if (/\bdelete\s+from\b/i.test(statement)) return 'shrink';
    return 'read';
  }
  return 'read';
}

const RANK: Record<StatementEffect, number> = { read: 0, shrink: 1, update: 2, grow: 3 };

/**
 * What a statement does, read from its SQL: the most it does across every
 * statement in the text (a raw text may hold more than one). Reads, and
 * statements that only set a session or a transaction, are `read`.
 */
export function statementEffect(sqlText: string): StatementEffect {
  let effect: StatementEffect = 'read';
  for (const statement of sqlText.split(';')) {
    const one = effectOfOne(statement);
    if (RANK[one] > RANK[effect]) effect = one;
  }
  return effect;
}

/** Refused: the statement would add to a held database. */
function refuse(hold: WriteHold): never {
  throw new OffByOperatorError(hold.question, hold.reason, hold.message);
}

/** The held check and the after-the-fact notice around one connection's statements. */
function watchedConnection(connection: DatabaseConnection, connectionId: string, watch: WriteWatch): DatabaseConnection {
  const before = async (query: CompiledQuery): Promise<StatementEffect> => {
    const effect = statementEffect(query.sql);
    if (effect === 'grow' || effect === 'update') await watch.settle(connectionId);
    if (effect === 'grow') {
      const hold = watch.held(connectionId);
      if (hold !== null) refuse(hold);
    }
    return effect;
  };
  const after = (effect: StatementEffect): void => {
    if (effect !== 'read') watch.wrote(connectionId, effect);
  };
  const watched: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery, options?: Parameters<DatabaseConnection['executeQuery']>[1]): Promise<QueryResult<R>> {
      const effect = await before(query);
      const result = await connection.executeQuery<R>(query, options);
      after(effect);
      return result;
    },
    async *streamQuery<R>(query: CompiledQuery, chunkSize: number, options?: Parameters<DatabaseConnection['streamQuery']>[2]): AsyncIterableIterator<QueryResult<R>> {
      const effect = await before(query);
      yield* connection.streamQuery<R>(query, chunkSize, options);
      after(effect);
    },
  };
  if (connection.cancelQuery !== undefined) watched.cancelQuery = connection.cancelQuery.bind(connection);
  if (connection.killSession !== undefined) watched.killSession = connection.killSession.bind(connection);
  if (connection.collectSessionInfo !== undefined) watched.collectSessionInfo = connection.collectSessionInfo.bind(connection);
  return watched;
}

/**
 * `dialect` with every statement of its connections read first
 * ({@link statementEffect}): one that adds is refused while `watch` holds
 * `connectionId`, and `watch` hears of each one that changed something.
 */
export function holdingDialect(dialect: Dialect, connectionId: string, watch: WriteWatch): Dialect {
  return {
    createAdapter: () => dialect.createAdapter(),
    createQueryCompiler: () => dialect.createQueryCompiler(),
    createIntrospector: (db) => dialect.createIntrospector(db),
    createDriver: () => holdingDriver(dialect.createDriver(), connectionId, watch),
  };
}

function holdingDriver(driver: Driver, connectionId: string, watch: WriteWatch): Driver {
  // The driver is handed back its own connections: a wrapped one has none of its private state.
  const own = new WeakMap<DatabaseConnection, DatabaseConnection>();
  const unwrap = (connection: DatabaseConnection): DatabaseConnection => own.get(connection) ?? connection;
  const held: Driver = {
    init: (options) => driver.init(options),
    acquireConnection: async (options) => {
      const connection = await driver.acquireConnection(options);
      const watched = watchedConnection(connection, connectionId, watch);
      own.set(watched, connection);
      return watched;
    },
    beginTransaction: (connection, settings: TransactionSettings) => driver.beginTransaction(unwrap(connection), settings),
    commitTransaction: (connection) => driver.commitTransaction(unwrap(connection)),
    rollbackTransaction: (connection) => driver.rollbackTransaction(unwrap(connection)),
    releaseConnection: (connection, options) => driver.releaseConnection(unwrap(connection), options),
    destroy: (options) => driver.destroy(options),
  };
  if (driver.savepoint !== undefined) {
    const savepoint = driver.savepoint.bind(driver);
    held.savepoint = (connection, name, compile) => savepoint(unwrap(connection), name, compile);
  }
  if (driver.rollbackToSavepoint !== undefined) {
    const rollback = driver.rollbackToSavepoint.bind(driver);
    held.rollbackToSavepoint = (connection, name, compile) => rollback(unwrap(connection), name, compile);
  }
  if (driver.releaseSavepoint !== undefined) {
    const release = driver.releaseSavepoint.bind(driver);
    held.releaseSavepoint = (connection, name, compile) => release(unwrap(connection), name, compile);
  }
  return held;
}

/** The hold over each data handle the manager opened under a watch: what the write service asks. */
const HOLDS = new WeakMap<object, { held: () => WriteHold | null; settle: () => Promise<void> }>();

/** Tie a data handle to its connection's hold. */
export function registerWriteHold(db: Kysely<never> | object, hold: { held: () => WriteHold | null; settle: () => Promise<void> }): void {
  HOLDS.set(db, hold);
}

/** The hold over a data handle now; null when none holds it (or it was opened without a watch). */
export function writeHoldOf(db: object): WriteHold | null {
  return HOLDS.get(db)?.held() ?? null;
}

/**
 * A person's create or change of a row, refused while the database is held,
 * once it has been measured since its handle opened. A delete is never
 * refused: deleting is the way out of the hold.
 */
export async function refuseHeldWrite(db: object, action: 'create' | 'update' | 'delete'): Promise<void> {
  if (action === 'delete') return;
  const watched = HOLDS.get(db);
  if (watched === undefined) return;
  await watched.settle();
  const hold = watched.held();
  if (hold !== null) refuse(hold);
}
