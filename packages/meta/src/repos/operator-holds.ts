// SPDX-License-Identifier: AGPL-3.0-only
/**
 * operatorHoldsRepo — adminium_operator_holds (0088): what the server's
 * operator holds back on this instance, by name, with the reason given.
 *
 * Written only by the operator endpoint. Nothing else reads or writes it but
 * the server's own gate, so no settings route, config import, export or
 * archive touches it.
 */
import type { MetaDb } from '../connect.js';
import { OPERATOR_HOLD_NAME_WIDTH, OPERATOR_HOLD_REASON_WIDTH } from '../migrations/0088_operator_holds.js';
import { readBool, writeBool } from './util.js';

export { OPERATOR_HOLD_NAME_WIDTH, OPERATOR_HOLD_REASON_WIDTH };

export interface OperatorHold {
  name: string;
  held: boolean;
  reason: string | null;
  changedAt: number;
}

export function operatorHoldsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** The hold named `name`, or null when the operator never set it. */
    async get(name: string): Promise<OperatorHold | null> {
      const row = await db.selectFrom('adminium_operator_holds').selectAll().where('name', '=', name).executeTakeFirst();
      if (row === undefined) return null;
      return { name: row.name, held: readBool(row.held), reason: row.reason ?? null, changedAt: Number(row.changedAt) };
    },

    /** Set the hold named `name`, on or off, with its reason. */
    async set(input: { name: string; held: boolean; reason: string | null }, at: number = Date.now()): Promise<OperatorHold> {
      if (input.name.length > OPERATOR_HOLD_NAME_WIDTH) throw new Error('An operator hold name is longer than its column.');
      if (input.reason !== null && input.reason.length > OPERATOR_HOLD_REASON_WIDTH) throw new Error('An operator hold reason is longer than its column.');
      const values = { held: writeBool(meta, input.held), reason: input.reason, changedAt: at };
      await db.transaction().execute(async (trx) => {
        const found = await trx.selectFrom('adminium_operator_holds').select('name').where('name', '=', input.name).executeTakeFirst();
        if (found === undefined) await trx.insertInto('adminium_operator_holds').values({ name: input.name, ...values }).execute();
        else await trx.updateTable('adminium_operator_holds').set(values).where('name', '=', input.name).execute();
      });
      return { name: input.name, held: input.held, reason: input.reason, changedAt: at };
    },
  };
}

export type OperatorHoldsRepo = ReturnType<typeof operatorHoldsRepo>;
