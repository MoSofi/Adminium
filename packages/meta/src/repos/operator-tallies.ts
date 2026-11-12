// SPDX-License-Identifier: AGPL-3.0-only
/**
 * operatorTalliesRepo — adminium_operator_tallies (0089): what the server
 * counts for its operator on this instance, by name: a whole number and when
 * it last changed.
 *
 * Written only by the server itself (the AI client's count, the Designer's
 * start prompt). No settings route, config import, export or archive touches
 * it, so a super admin cannot set a count back.
 */
import type { MetaDb } from '../connect.js';
import { OPERATOR_TALLY_NAME_WIDTH } from '../migrations/0089_operator_tallies.js';
import { isDuplicateKeyError } from './util.js';

export { OPERATOR_TALLY_NAME_WIDTH };

export interface OperatorTally {
  name: string;
  amount: number;
  changedAt: number;
}

export function operatorTalliesRepo(meta: MetaDb) {
  const { db } = meta;
  const checkName = (name: string): void => {
    if (name.length === 0 || name.length > OPERATOR_TALLY_NAME_WIDTH) throw new Error('An operator tally name is empty or longer than its column.');
  };
  const insert = async (name: string, amount: number, at: number): Promise<boolean> => {
    try {
      await db.insertInto('adminium_operator_tallies').values({ name, amount, changedAt: at }).execute();
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  };
  return {
    /** The tally named `name`, or null when nothing was ever counted under it. */
    async get(name: string): Promise<OperatorTally | null> {
      const row = await db.selectFrom('adminium_operator_tallies').selectAll().where('name', '=', name).executeTakeFirst();
      return row === undefined ? null : { name: row.name, amount: Number(row.amount), changedAt: Number(row.changedAt) };
    },

    /** Make the row with 0 when there is none, so the tally reads 0 and not "never counted". */
    async open(name: string, at: number = Date.now()): Promise<void> {
      checkName(name);
      await insert(name, 0, at);
    },

    /** Add `amount` (a whole number, 0 or more) to the tally, in one statement: two adds at once both count. */
    async add(name: string, amount: number, at: number = Date.now()): Promise<void> {
      checkName(name);
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('An operator tally grows by a whole number, 0 or more.');
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const updated = await db
          .updateTable('adminium_operator_tallies')
          .set((eb) => ({ amount: eb('amount', '+', amount), changedAt: at }))
          .where('name', '=', name)
          .executeTakeFirst();
        if (Number(updated.numUpdatedRows) > 0) return;
        if (await insert(name, amount, at)) return;
      }
      throw new Error(`The operator tally "${name}" could not be counted.`);
    },

    /**
     * Take the tally once: true for the one caller that makes its row, false
     * for every caller after it, whenever they ask.
     */
    async claim(name: string, at: number = Date.now()): Promise<boolean> {
      checkName(name);
      return insert(name, 1, at);
    },

    /** Take a claim back, when what it was taken for could not be done. */
    async release(name: string): Promise<void> {
      await db.deleteFrom('adminium_operator_tallies').where('name', '=', name).execute();
    },
  };
}

export type OperatorTalliesRepo = ReturnType<typeof operatorTalliesRepo>;
