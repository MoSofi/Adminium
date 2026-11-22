// SPDX-License-Identifier: AGPL-3.0-only
/**
 * passwordResetsRepo — adminium_password_resets. Carries both reset and
 * invite-activation tokens; single-use.
 */

import type { Selectable } from 'kysely';
import { z } from 'zod';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumPasswordResetsTable } from '../schema/tables.js';
import { DAY_MS } from './util.js';

export const resetKindSchema = z.enum(['reset', 'invite']);
export type ResetKind = z.infer<typeof resetKindSchema>;

export type PasswordReset = Selectable<AdminiumPasswordResetsTable>;

export interface CreatePasswordResetInput {
  userId: string;
  kind: ResetKind;
  tokenHash: string;
  /** reset: +2 h; invite: +7 days — computed by the server. */
  expiresAt: number;
}

export function passwordResetsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /**
     * Issue a link and retire the person's earlier unused ones, so a lost or
     * resent link stops working the moment a new one exists.
     *
     * An invite retires everything. A reset retires only earlier resets: the
     * forgot form is open to anyone who knows an address, and must not be a way
     * to kill somebody's invitation, which may be the only link they were given.
     */
    async create(input: CreatePasswordResetInput, at: number = Date.now()): Promise<PasswordReset> {
      const row: PasswordReset = {
        id: newId('rst'),
        userId: input.userId,
        kind: resetKindSchema.parse(input.kind),
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        createdAt: at,
      };
      await db.transaction().execute(async (trx) => {
        let earlier = trx
          .updateTable('adminium_password_resets')
          .set({ usedAt: at })
          .where('userId', '=', row.userId)
          .where('usedAt', 'is', null);
        if (row.kind === 'reset') earlier = earlier.where('kind', '=', 'reset');
        await earlier.execute();
        await trx.insertInto('adminium_password_resets').values(row).execute();
      });
      return row;
    },

    /** Unused and unexpired at `at`. */
    async findValidByTokenHash(tokenHash: string, at: number = Date.now()): Promise<PasswordReset | null> {
      const row = await db
        .selectFrom('adminium_password_resets')
        .selectAll()
        .where('tokenHash', '=', tokenHash)
        .where('usedAt', 'is', null)
        .where('expiresAt', '>', at)
        .executeTakeFirst();
      return row ?? null;
    },

    /** Single-use guard: only the first consume wins. */
    async consume(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_password_resets')
        .set({ usedAt: at })
        .where('id', '=', id)
        .where('usedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /**
     * Spend one link and retire the person's others; true when this call won.
     *
     * The others go FIRST, in separate statements. Two different live links
     * sent at once then cannot both win: whichever spends its own link second
     * finds it already retired by the other. At worst both lose and the person
     * asks again. One transaction would instead have each hold its own row
     * while waiting for the other's, which is a deadlock on Postgres and MySQL.
     */
    async redeem(id: string, userId: string, at: number = Date.now()): Promise<boolean> {
      await db
        .updateTable('adminium_password_resets')
        .set({ usedAt: at })
        .where('userId', '=', userId)
        .where('id', '!=', id)
        .where('usedAt', 'is', null)
        .execute();
      const res = await db
        .updateTable('adminium_password_resets')
        .set({ usedAt: at })
        .where('id', '=', id)
        .where('usedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Ends every unused link of these people: their address changed, or who invited them was stopped. */
    async retireFor(userIds: readonly string[], at: number = Date.now(), kind?: PasswordReset['kind']): Promise<void> {
      if (userIds.length === 0) return;
      let unused = db.updateTable('adminium_password_resets').set({ usedAt: at }).where('userId', 'in', [...userIds]).where('usedAt', 'is', null);
      if (kind !== undefined) unused = unused.where('kind', '=', kind);
      await unused.execute();
    },

    /** Retention `password-resets` policy: used, or expired > 24 h ago. */
    async gc(at: number = Date.now()): Promise<number> {
      const res = await db
        .deleteFrom('adminium_password_resets')
        .where((eb) => eb.or([eb('usedAt', 'is not', null), eb('expiresAt', '<', at - DAY_MS)]))
        .executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type PasswordResetsRepo = ReturnType<typeof passwordResetsRepo>;
