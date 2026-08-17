// SPDX-License-Identifier: AGPL-3.0-only
/**
 * passwordResetsRepo — adminium_password_resets (07-meta-store.md §3.6).
 * Carries both reset and invite-activation tokens; single-use.
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
  /** reset: +2 h; invite: +7 days — computed by the server (§3.6). */
  expiresAt: number;
}

export function passwordResetsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
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
      await db.insertInto('adminium_password_resets').values(row).execute();
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

    /** Retention §8 `password-resets` policy: used, or expired > 24 h ago. */
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
