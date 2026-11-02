// SPDX-License-Identifier: AGPL-3.0-only
/**
 * formMarksRepo — adminium_form_marks (0073): what a stranger's answer to a
 * form is counted by.
 *
 * Shaped like the public door's markers (`publicChallengesRepo.mark`,
 * `sentSince`, `unmark`), so the public door's anonymous caps
 * (`chargeAnonymous` on the server) count a form's answers with no key
 * behind them. A subject is a keyed hash or an id, made by the caller.
 */
import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { FORM_MARK_PURPOSE_WIDTH, FORM_MARK_SUBJECT_WIDTH } from '../migrations/0073_form_marks.js';
import { affected } from './util.js';

export { FORM_MARK_PURPOSE_WIDTH, FORM_MARK_SUBJECT_WIDTH };

export function formMarksRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** One more of `subject`'s `purpose`, at `at`. Answers the row's id, to take back. */
    async mark(input: { subject: string; purpose: string }, at: number = Date.now()): Promise<string> {
      if (input.subject.length > FORM_MARK_SUBJECT_WIDTH || input.purpose.length > FORM_MARK_PURPOSE_WIDTH) throw new Error('A form mark is longer than its column.');
      const id = newId('fmk');
      await db.insertInto('adminium_form_marks').values({ id, subject: input.subject, purpose: input.purpose, createdAt: at }).execute();
      return id;
    },

    /** Take marks back: what they counted did not happen after all. */
    async unmark(ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return;
      await db.deleteFrom('adminium_form_marks').where('id', 'in', [...ids]).execute();
    },

    /** How many of `subject`'s marks (of `purpose`, or any) were made since `since`. */
    async sentSince(subject: string, since: number, purpose?: string): Promise<number> {
      let query = db
        .selectFrom('adminium_form_marks')
        .select((eb) => eb.fn.countAll<number | string | bigint>().as('n'))
        .where('subject', '=', subject)
        .where('createdAt', '>=', since);
      if (purpose !== undefined) query = query.where('purpose', '=', purpose);
      const row = await query.executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /** The oldest of `subject`'s marks of `purpose` since `since`: when its window opens again. Null for none. */
    async oldestSince(subject: string, since: number, purpose: string): Promise<number | null> {
      const row = await db
        .selectFrom('adminium_form_marks')
        .select((eb) => eb.fn.min('createdAt').as('at'))
        .where('subject', '=', subject)
        .where('purpose', '=', purpose)
        .where('createdAt', '>=', since)
        .executeTakeFirst();
      return row?.at === null || row?.at === undefined ? null : Number(row.at);
    },

    /** Every mark made before `before`: the sweep. Answers how many went. */
    async prune(before: number): Promise<number> {
      return affected((await db.deleteFrom('adminium_form_marks').where('createdAt', '<', before).executeTakeFirst()).numDeletedRows);
    },
  };
}

export type FormMarksRepo = ReturnType<typeof formMarksRepo>;
