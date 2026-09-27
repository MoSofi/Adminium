// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE GUARD AT A WRITE'S DOOR — what a single-row create or change, and a
 * multi-row path, do with the table's limits.
 *
 *  - {@link withLimitLocks}: name the write's locks outside any transaction,
 *    take them (with its numbers' series) in one call, run the write; when
 *    the judge finds a row moved away from a lock it was named by, name them
 *    again from a fresh look and start over — three times, then 409
 *    `WRITE_CONFLICT {retry: true}`.
 *  - {@link judgeRows}: the judge, with its refusals handed to the caller's
 *    own error mapping — except a moved lock, which is the retry's.
 *  - {@link batchNeedsGuard}: whether one row of a multi-row write (bulk,
 *    a public batch) could take from a limit. Those paths hold no pool lock,
 *    so such a row is refused; a row leaving what counts (a bulk cancel) is
 *    not.
 */
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../../connections/manager.js';
import { writeConflict } from '../db-errors.js';
import type { Row } from '../mask.js';
import type { WriteAction, WriteTarget } from '../write-context.js';
import { has } from './count.js';
import { judgeCapacity } from './judge.js';
import { LockMoved, withNamedLocks, type NamedLock } from './locks.js';
import { ownColumns, ownedRules, rulesFor, type Rule } from './rules.js';
import type { CapacityJudgeOptions, JudgedRow, PoolState } from './types.js';

type Db = Kysely<SourceDatabase>;

/** How many times a write names its locks before it gives up. */
const ATTEMPTS = 3;

/**
 * Run `run` holding the locks `names` answers, named again (from a fresh
 * look) each time the judge finds a row moved away from its lock.
 */
export async function withLimitLocks<T>(target: Pick<WriteTarget, 'db' | 'dialect'>, names: () => Promise<NamedLock[]>, run: (db: Db) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withNamedLocks(target, await names(), run);
    } catch (error) {
      if (!(error instanceof LockMoved)) throw error;
      if (attempt >= ATTEMPTS) throw writeConflict();
    }
  }
}

/** Judge through `db`; a refusal goes through the caller's mapping, a moved lock back to the retry. */
export async function judgeRows(
  db: Db,
  rows: readonly JudgedRow[],
  opts: CapacityJudgeOptions,
  mapError: ((error: unknown) => never) | undefined,
): Promise<PoolState[]> {
  try {
    return await judgeCapacity(db, rows, opts);
  } catch (error) {
    if (error instanceof LockMoved) throw error;
    if (mapError !== undefined) mapError(error);
    throw error;
  }
}

/** The columns that decide which pool a row takes from (not how much, not whether it counts). */
function poolColumns(rule: Rule): string[] {
  const conditions = new Set(rule.conditions.filter((c) => c.level === 'own').map((c) => c.column));
  return ownColumns(rule).filter((column) => !conditions.has(column));
}

/** Whether a written value of a condition column is one that counts. */
function counted(rule: Rule, level: 'own' | 'owner', column: string, value: unknown): boolean {
  return rule.conditions.some((c) => c.level === level && c.column === column && value !== null && value !== undefined && c.values.includes(String(value)));
}

/**
 * Whether one row of a multi-row write could take from a limit: a create that
 * counts, or a change that moves a row's pool, what it takes, or sets a state
 * that counts (on the row, or on the rows it owns). A change out of counting
 * never does.
 */
export function batchNeedsGuard(target: Pick<WriteTarget, 'view' | 'table'>, action: WriteAction, values: Row): boolean {
  if (action === 'delete') return false;
  for (const rule of rulesFor(target.view, target.table)) {
    if (action === 'create') {
      const own = rule.conditions.filter((c) => c.level === 'own');
      if (own.every((c) => !has(values, c.column) || counted(rule, 'own', c.column, values[c.column]))) return true;
      continue;
    }
    if (poolColumns(rule).some((column) => has(values, column))) return true;
    if (rule.conditions.some((c) => c.level === 'own' && has(values, c.column) && counted(rule, 'own', c.column, values[c.column]))) return true;
  }
  if (action === 'update') {
    for (const owned of ownedRules(target.view, target.table)) {
      for (const column of owned.watched) {
        if (!has(values, column)) continue;
        const condition = owned.rule.conditions.some((c) => c.level === 'owner' && c.column === column);
        if (!condition || counted(owned.rule, 'owner', column, values[column])) return true;
      }
    }
  }
  return false;
}
