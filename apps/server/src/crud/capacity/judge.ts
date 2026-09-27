// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LIMIT GUARD — naming a write's locks, and judging its rows under them.
 *
 *  1. Before any transaction opens, {@link capacityLockNames} names every
 *     pool the write's rows may take from (reading, without a lock, what a
 *     name depends on and the row does not say yet).
 *  2. The write takes those names, with its numbers' series, in one
 *     `withNamedLocks` call, then reads its clock.
 *  3. With the rows written (or about to be), {@link judgeCapacity} counts
 *     each pool once, leaving the listed rows out of what it reads and adding
 *     their own amounts, and refuses the first that does not fit. It names
 *     each row's locks again from the row as it now stands: a name not held
 *     means the row moved since step 1 (`LockMoved`), and the write starts
 *     over.
 *
 * {@link capacityState} answers the same counts with no lock and no write:
 * availability and staff counts.
 *
 * Only a table whose limit is the released slot rule is guarded today, by
 * `capacity-guard.ts`; a table with any other limit is refused before it
 * gets here (`unbuilt-rules.ts`, `capacity`). So each function below answers
 * for a write that has no limit at all, and is not built yet for one that
 * does.
 */
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../../connections/manager.js';
import { notBuiltYet } from '../not-built.js';
import type { WriteTarget } from '../write-context.js';
import type { NamedLock } from './locks.js';
import type { CapacityAsk, CapacityJudgeOptions, JudgedRow, LockNameRow, PoolState } from './types.js';

type Db = Kysely<SourceDatabase>;

/** Whether a table keeps a limit of any kind. */
const limited = (target: WriteTarget): boolean => (target.table.table?.capacityRules?.length ?? 0) > 0;

/**
 * The locks a write's rows need, named outside any transaction, reading
 * through `db` (the pool's handle) without a lock what a name depends on
 * and the row does not say yet.
 */
export async function capacityLockNames(db: Db, rows: readonly LockNameRow[]): Promise<NamedLock[]> {
  void db;
  if (!rows.some((row) => limited(row.target))) return [];
  return notBuiltYet('capacityLockNames');
}

/**
 * Judge the rows of one write under its locks, through the transaction's
 * handle. Throws the first refusal (409 `CAPACITY_FULL`, `CAPACITY_TOO_LATE`,
 * or 422 with the field's code and `details.row`); answers every pool
 * counted.
 */
export async function judgeCapacity(db: Db, rows: readonly JudgedRow[], opts: CapacityJudgeOptions): Promise<PoolState[]> {
  void db;
  void opts;
  if (!rows.some((row) => limited(row.target))) return [];
  return notBuiltYet('judgeCapacity');
}

/** A table's pools as they stand at `now`, counted without a lock or a write. */
export async function capacityState(db: Db, target: WriteTarget, ask: CapacityAsk, now: Date): Promise<PoolState[]> {
  void db;
  void ask;
  void now;
  if (!limited(target)) return [];
  return notBuiltYet('capacityState');
}
