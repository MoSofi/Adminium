// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REMOVING A STRANGER'S FORM ANSWERS, as the engine does it.
 *
 * {@link deleteFormAnswers} is the one function every engine path that
 * deletes answers goes through: a person's erasure (`privacy/erase.ts`) and
 * the keeping sweep below. An answer's files go with it: the strangers' file
 * store is told first, here, so no path that deletes answers can leave their
 * files behind. The rows are deleted as the system, in batches, never through
 * a staff save (no role's reach, no rule fired: an answer is Adminium's own
 * record, written by Adminium alone).
 *
 * THE KEEPING SWEEP ({@link sweepFormAnswers}). A forms add-on says how long
 * its answers are kept in its own settings table (`answers_months`: a whole
 * number of months; empty keeps them until somebody removes them). The engine
 * reads it, and once a day deletes every answer submitted longer ago than
 * that, through the same function. The add-on runs no timer of its own.
 */
import type { Dialect } from '@adminium/engine';
import type { MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { bindWriteValue } from '../crud/write-values.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { ANSWERS_MONTHS_COLUMN, formsAddOnsOn, storedFormsAddOns, type FormsAddOnTables } from './installed.js';

/** How many answers one statement deletes. */
const BATCH = 200;

/** Where a forms add-on's answers are, and the files that hang off them. */
export interface AnswersTarget {
  db: Kysely<SourceDatabase>;
  answers: ResolvedTable;
  /** The strangers' files of the answers; null when the add-on keeps none. */
  files: ResolvedTable | null;
}

/** The answers' keys, in groups a statement takes. */
function batches<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += BATCH) out.push(items.slice(at, at + BATCH));
  return out;
}

/**
 * Deletes these answers (by their primary key's values) and everything that
 * goes with them. Answers how many answers were deleted.
 */
export async function deleteFormAnswers(target: AnswersTarget, keys: readonly unknown[]): Promise<number> {
  const key = target.answers.primaryKey[0];
  if (key === undefined || keys.length === 0) return 0;
  let deleted = 0;
  for (const group of batches(keys)) {
    // The answers' files are removed here, before the rows that name them, once the strangers' file store exists.
    const result = await target.db
      .deleteFrom(target.answers.id as never)
      .where(sql.ref(key), 'in', group as never)
      .executeTakeFirst();
    deleted += Number(result.numDeletedRows);
  }
  return deleted;
}

/** The instant `months` calendar months before `now` (the same day of the month, at the same time, in UTC). */
export function monthsBefore(now: number, months: number): number {
  const at = new Date(now);
  const day = at.getUTCDate();
  at.setUTCDate(1);
  at.setUTCMonth(at.getUTCMonth() - months);
  // The 31st of a month that has 30 days is its last day.
  const last = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
  at.setUTCDate(Math.min(day, last));
  return at.getTime();
}

/** How many months a forms add-on keeps its answers; null keeps them until somebody removes them. */
export async function answersMonths(db: Kysely<SourceDatabase>, addOn: Pick<FormsAddOnTables, 'settings'>): Promise<number | null> {
  const settings = addOn.settings;
  if (settings === null || !settings.columns.has(ANSWERS_MONTHS_COLUMN)) return null;
  let query = db.selectFrom(settings.id as never).select(sql.ref(ANSWERS_MONTHS_COLUMN).as('months') as never);
  for (const column of settings.primaryKey) query = query.orderBy(sql.ref(column) as never);
  const row = (await query.limit(1).executeTakeFirst()) as { months?: unknown } | undefined;
  const months = Number(row?.months);
  return row?.months === null || row?.months === undefined || !Number.isInteger(months) || months < 1 ? null : months;
}

export interface FormAnswersSweepDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  now?: (() => number) | undefined;
  /** The snapshot of a database; the stored one when absent. */
  viewFor?: ((connectionId: string) => Promise<SnapshotView | null>) | undefined;
}

/** Deletes the answers each forms add-on keeps no longer (see the header). Answers how many went, per add-on. */
export async function sweepFormAnswers(deps: FormAnswersSweepDeps): Promise<Record<string, number>> {
  const now = (deps.now ?? Date.now)();
  const stored = await storedFormsAddOns(deps.meta);
  const out: Record<string, number> = {};
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))].sort()) {
    let view: SnapshotView | null;
    try {
      view = deps.viewFor === undefined ? await loadSnapshotView(deps.meta, connectionId, { forOthers: true }) : await deps.viewFor(connectionId);
    } catch {
      view = null;
    }
    if (view === null) continue;
    let handle: { db: Kysely<SourceDatabase>; dialect: Dialect };
    try {
      handle = await deps.manager.data(connectionId);
    } catch {
      // A database that cannot be reached now is swept on a later day.
      continue;
    }
    for (const addOn of await formsAddOnsOn(deps.meta, connectionId, view, stored)) {
      const answers = addOn.answers;
      const submitted = answers?.columns.get('submitted_at');
      const key = answers?.primaryKey[0];
      if (answers === null || submitted === undefined || key === undefined) continue;
      const months = await answersMonths(handle.db, addOn);
      if (months === null) continue;
      const before = bindWriteValue(submitted, new Date(monthsBefore(now, months)).toISOString(), handle.dialect);
      let gone = 0;
      for (;;) {
        const due = (await handle.db
          .selectFrom(answers.id as never)
          .select(sql.ref(key).as('key') as never)
          .where(sql.ref('submitted_at'), '<', before as never)
          .limit(BATCH * 5)
          .execute()) as { key: unknown }[];
        if (due.length === 0) break;
        const deleted = await deleteFormAnswers({ db: handle.db, answers, files: addOn.files }, due.map((row) => row.key));
        gone += deleted;
        if (deleted === 0 || due.length < BATCH * 5) break;
      }
      if (gone > 0) out[addOn.key] = (out[addOn.key] ?? 0) + gone;
    }
  }
  return out;
}
