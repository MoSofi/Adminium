// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NAMED LOCKS — the locks a write takes before it reads or writes a row.
 *
 * A limit (the last seats of a show), a slot, a booking day and a number
 * without gaps are each kept by a lock only the writers of that one thing
 * contend for, held until the write commits: a writer let in before the
 * commit would count rows it cannot see yet. One write may need several —
 * an order for two shows' tickets, numbered — and takes them all in ONE
 * call, in one order: sorted by name, never by anything a person can change,
 * so two writers wanting the same two never wait on each other crosswise.
 * They come first, before any row is held; the order that follows them is
 * written down in the write service.
 *
 *  - Postgres: `pg_advisory_xact_lock` per name inside the transaction, which
 *    the commit itself releases. It joins a transaction already open.
 *  - MySQL: `GET_LOCK` per name on one pinned connection, BEFORE that
 *    connection opens its transaction, released in `finally` after the
 *    commit. A named lock cannot be held until a commit somebody else makes,
 *    so a caller's open transaction is refused (or, for a multi-row path that
 *    asks, run as it is, holding nothing).
 *  - SQLite: one connection serialises this process; `BEGIN IMMEDIATE` takes
 *    the write lock up front against a second process. With no name at all a
 *    plain transaction is opened, as it always was.
 *
 * Every name a call holds is recorded against the handle `run` receives, so a
 * reader under the locks can ask whether the lock it depends on is really
 * held ({@link heldNames}) — a judge that finds its own name missing knows the
 * row moved between naming and holding, and the write starts again.
 *
 * In front of the database's locks stands a queue in this process: writers
 * asking for the same names wait their turn in memory, one at a time and in
 * the order they came, BEFORE any of them takes a connection from the pool.
 * Twenty guests pressing Buy for the last seats of one show would otherwise
 * park twenty connections in a lock wait, and every other page of the venue —
 * the menu, what is left, the staff's lists — would wait behind them for a
 * connection. The database's locks stay the ones that count: a second server
 * has a queue of its own.
 */
import { createHash } from 'node:crypto';

import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { SourceDatabase } from '../../connections/manager.js';
import { AppError, ConflictError } from '../../errors.js';

type Db = Kysely<SourceDatabase>;

/** What a writer is told when another held the lock for longer than a writer waits. */
export type LockBusy = 'CAPACITY_BUSY' | 'BOOKING_BUSY' | 'NUMBER_BUSY';

/** One lock by name, and the refusal a writer hears when it cannot get it. */
export interface NamedLock {
  name: string;
  busy: LockBusy;
}

/** How long a MySQL writer waits for a name another writer holds, in seconds. */
const LOCK_WAIT_SECONDS = 10;

/** SQLite connections inside a `BEGIN IMMEDIATE` this module opened: kysely does not know they are in a transaction. */
const OPENED = new WeakSet<object>();

/** Whether a handle is inside a transaction: kysely's own, or one this module opened on SQLite by hand. */
export function inTransaction(db: Db): boolean {
  return db.isTransaction || OPENED.has(db);
}

/** The names held on a handle, by the call that handed it to `run` (or joined it). */
const HELD = new WeakMap<object, Set<string>>();

/** The names held for the transaction behind this handle: empty when none. */
export function heldNames(db: Db): ReadonlySet<string> {
  return HELD.get(db) ?? new Set();
}

function hold(db: Db, locks: readonly NamedLock[]): void {
  if (locks.length === 0) return;
  let names = HELD.get(db);
  if (names === undefined) HELD.set(db, (names = new Set()));
  for (const lock of locks) names.add(lock.name);
}

/**
 * The row a lock was named from moved between naming and holding (a line
 * moved to another show, a stay to other dates): the write names its locks
 * again and starts over. A door gives up after a few tries with 409
 * `WRITE_CONFLICT {retry: true}`.
 */
export class LockMoved extends Error {
  override readonly name = 'LockMoved';

  constructor(readonly lock: string) {
    super(`The row moved away from the lock it was named by (${lock}).`);
  }
}

/**
 * The queue in front of the database's locks, per set of names (the names in
 * order, joined): whoever holds a set's turn, and who waits for it, first
 * come first served. A set nobody holds or waits for is not kept.
 */
interface Turn {
  waiting: (() => void)[];
}
const TURNS = new WeakMap<object, Map<string, Turn>>();
/** Every queue with somebody in it, for {@link queuedTurns}. */
const LIVE = new Set<Map<string, Turn>>();

/**
 * Wait for this set's turn, then hold it: answers the function that hands it
 * on. A writer that waits longer than a database lock would make it wait is
 * told the first name is busy, as the database would have told it.
 */
function awaitTurn(db: Db, names: readonly NamedLock[], waitSeconds: number): Promise<() => void> {
  let turns = TURNS.get(db);
  if (turns === undefined) TURNS.set(db, (turns = new Map()));
  const queue = turns;
  const key = names.map((lock) => lock.name).join('\n');
  const handOn = () => {
    const next = queue.get(key)?.waiting.shift();
    if (next !== undefined) return next();
    queue.delete(key);
    if (queue.size === 0) LIVE.delete(queue);
  };
  const turn = queue.get(key);
  if (turn === undefined) {
    queue.set(key, { waiting: [] });
    LIVE.add(queue);
    return Promise.resolve(handOn);
  }
  return new Promise((resolve, reject) => {
    const mine = () => {
      clearTimeout(timer);
      resolve(handOn);
    };
    const timer = setTimeout(() => {
      const at = turn.waiting.indexOf(mine);
      if (at >= 0) turn.waiting.splice(at, 1);
      reject(busyError(names[0]!.busy));
    }, waitSeconds * 1000);
    turn.waiting.push(mine);
  });
}

/** How many writers of this process hold or wait for a set's turn: for tests. */
export function queuedTurns(): number {
  let count = 0;
  for (const queue of LIVE) for (const turn of queue.values()) count += 1 + turn.waiting.length;
  return count;
}

/** Postgres: a lock another transaction held past the wait (`lock_timeout`). */
const lockTimedOut = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === '55P03';

/** The refusal a writer hears when a name stays held by another. */
function busyError(busy: LockBusy): AppError {
  if (busy === 'NUMBER_BUSY') return new AppError(409, busy, 'Another record is taking the next number. Try again in a moment.');
  return new ConflictError('That time is busy. Try again in a moment.', busy);
}

/**
 * Postgres: take each name's transaction lock inside `trx`, in the order
 * given. An advisory lock waits as long as it takes unless told otherwise: as
 * long as a MySQL writer waits, then busy. Only for these locks — the rows
 * the write holds after them wait as they always have.
 */
export async function advisoryLocks(trx: Db, names: readonly NamedLock[], waitSeconds: number = LOCK_WAIT_SECONDS): Promise<void> {
  if (names.length === 0) return;
  const was = (await sql<{ was: string }>`select current_setting('lock_timeout') as was`.execute(trx)).rows[0]?.was ?? '0';
  await sql`select set_config('lock_timeout', ${`${String(waitSeconds * 1000)}ms`}, true)`.execute(trx);
  for (const lock of names) {
    try {
      await sql`select pg_advisory_xact_lock(hashtextextended(${lock.name}, 0))`.execute(trx);
    } catch (error) {
      if (lockTimedOut(error)) throw busyError(lock.busy);
      throw error;
    }
  }
  await sql`select set_config('lock_timeout', ${was}, true)`.execute(trx);
}

/** The locks once each, in name order: the one order every writer takes them in. */
function ordered(locks: readonly NamedLock[]): NamedLock[] {
  const byName = new Map<string, NamedLock>();
  for (const lock of [...locks].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!byName.has(lock.name)) byName.set(lock.name, lock);
  }
  return [...byName.values()];
}

export interface NamedLockOptions {
  /**
   * What a MySQL call does inside a transaction somebody else opened:
   * `refuse` (the default — the locks could not be held until that
   * transaction commits), or `run` it as it is, holding nothing, for a
   * multi-row path whose own steps keep the order another way (a series
   * without gaps steps past duplicates on its unique index).
   */
  openTransaction?: 'refuse' | 'run';
  /** How long a writer waits for its turn and each lock before it is told busy, in seconds (tests shorten it). */
  waitSeconds?: number;
}

/**
 * Run `run` inside one transaction, holding every lock in `locks` until it
 * commits. `run` receives the handle to write through; what it returns is
 * returned once committed. With no locks it is a plain transaction (joined
 * when one is open).
 */
export async function withNamedLocks<T>(
  target: { db: Db; dialect: Dialect },
  locks: readonly NamedLock[],
  run: (db: Db) => Promise<T>,
  opts: NamedLockOptions = {},
): Promise<T> {
  const { db } = target;
  const names = ordered(locks);
  if (names.length === 0) return inTransaction(db) ? run(db) : db.transaction().execute(run);
  // A call inside a transaction already open takes no connection, and its
  // caller may hold this very turn: it goes straight to the database.
  if (inTransaction(db)) return lockedIn(target, names, run, opts);
  const handOn = await awaitTurn(db, names, opts.waitSeconds ?? LOCK_WAIT_SECONDS);
  try {
    return await lockedIn(target, names, run, opts);
  } finally {
    handOn();
  }
}

async function lockedIn<T>(
  target: { db: Db; dialect: Dialect },
  names: readonly NamedLock[],
  run: (db: Db) => Promise<T>,
  opts: NamedLockOptions,
): Promise<T> {
  const { db, dialect } = target;
  const wait = opts.waitSeconds ?? LOCK_WAIT_SECONDS;
  if (dialect === 'postgres') {
    const locked = async (trx: Db) => {
      await advisoryLocks(trx, names, wait);
      hold(trx, names);
      return run(trx);
    };
    if (db.isTransaction) return locked(db);
    return db.transaction().execute(async (trx) => {
      try {
        return await locked(trx);
      } finally {
        HELD.delete(trx);
      }
    });
  }

  if (dialect === 'mysql') {
    if (db.isTransaction) {
      if (opts.openTransaction === 'run') return run(db);
      throw new Error('A guarded write on MySQL opens its own transaction; it cannot join one already open.');
    }
    return db.connection().execute(async (conn) => {
      const taken: string[] = [];
      try {
        for (const lock of names) {
          // MySQL's lock names stop at 64 characters.
          const key = `adm:${createHash('sha1').update(lock.name).digest('hex')}`;
          const got = (await sql<{ got: number | null }>`select get_lock(${key}, ${wait}) as got`.execute(conn)).rows[0]?.got;
          if (Number(got) !== 1) throw busyError(lock.busy);
          taken.push(key);
        }
        return await conn.transaction().execute(async (trx) => {
          hold(trx, names);
          try {
            return await run(trx);
          } finally {
            HELD.delete(trx);
          }
        });
      } finally {
        for (const key of taken) await sql`select release_lock(${key})`.execute(conn);
      }
    });
  }

  // SQLite: this process has one connection; BEGIN IMMEDIATE holds off a second.
  if (inTransaction(db)) {
    hold(db, names);
    return run(db);
  }
  return db.connection().execute(async (conn) => {
    await sql`begin immediate`.execute(conn);
    OPENED.add(conn);
    hold(conn, names);
    try {
      const out = await run(conn);
      await sql`commit`.execute(conn);
      return out;
    } catch (error) {
      await sql`rollback`.execute(conn);
      throw error;
    } finally {
      OPENED.delete(conn);
      HELD.delete(conn);
    }
  });
}
