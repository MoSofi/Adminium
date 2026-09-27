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

/** The refusal a writer hears when a name stays held by another. */
function busyError(busy: LockBusy): AppError {
  if (busy === 'NUMBER_BUSY') return new AppError(409, busy, 'Another record is taking the next number. Try again in a moment.');
  return new ConflictError('That time is busy. Try again in a moment.', busy);
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
  const { db, dialect } = target;
  const names = ordered(locks);
  if (names.length === 0) return inTransaction(db) ? run(db) : db.transaction().execute(run);

  if (dialect === 'postgres') {
    const locked = async (trx: Db) => {
      for (const lock of names) await sql`select pg_advisory_xact_lock(hashtextextended(${lock.name}, 0))`.execute(trx);
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
          const got = (await sql<{ got: number | null }>`select get_lock(${key}, ${LOCK_WAIT_SECONDS}) as got`.execute(conn)).rows[0]?.got;
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
