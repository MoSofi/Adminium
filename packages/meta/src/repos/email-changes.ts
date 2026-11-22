// SPDX-License-Identifier: AGPL-3.0-only
/**
 * emailChangesRepo — adminium_email_changes: a staff account's new sign-in
 * address until the link mailed to it is opened. One row per account; only the
 * link's hash is stored.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import type { AdminiumEmailChangesTable } from '../schema/tables.js';
import { DAY_MS, isDuplicateKeyError } from './util.js';

export type EmailChange = Selectable<AdminiumEmailChangesTable>;

/** How many links one account may have sent in {@link EMAIL_CHANGE_WINDOW_MS}: each goes to an address it may not own. */
export const EMAIL_CHANGE_MAX_SENDS = 5;
export const EMAIL_CHANGE_WINDOW_MS = 3_600_000;

export interface AskEmailChangeInput {
  userId: string;
  newEmail: string;
  tokenHash: string;
  expiresAt: number;
}

export function emailChangesRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /**
     * Replaces the account's waiting change with this one; the earlier link
     * stops working. Null, and nothing changed, when the account has used up
     * its sends for the hour.
     */
    async ask(input: AskEmailChangeInput, at: number = Date.now()): Promise<EmailChange | null> {
      const attempt = () =>
        db.transaction().execute(async (trx) => {
          const read = trx.selectFrom('adminium_email_changes').selectAll().where('userId', '=', input.userId);
          // SQLite has one writer and no `FOR UPDATE`.
          const held = await (meta.dialect === 'sqlite' ? read : read.forUpdate()).executeTakeFirst();
          const sameWindow = held !== undefined && at - held.windowAt < EMAIL_CHANGE_WINDOW_MS;
          if (sameWindow && held.sentCount >= EMAIL_CHANGE_MAX_SENDS) return null;
          const row: EmailChange = {
            userId: input.userId,
            newEmail: input.newEmail,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            sentCount: sameWindow ? held.sentCount + 1 : 1,
            windowAt: sameWindow ? held.windowAt : at,
            createdAt: at,
          };
          if (held === undefined) await trx.insertInto('adminium_email_changes').values(row).execute();
          else await trx.updateTable('adminium_email_changes').set(row).where('userId', '=', input.userId).execute();
          return row;
        });
      try {
        return await attempt();
      } catch (error) {
        // Two first asks at once: the other's row is there now, so this one replaces it.
        if (!isDuplicateKeyError(error)) throw error;
        return attempt();
      }
    },

    /** The waiting change this link's hash opens: unexpired at `at`. */
    async findValid(tokenHash: string, at: number = Date.now()): Promise<EmailChange | null> {
      const row = await db.selectFrom('adminium_email_changes').selectAll().where('tokenHash', '=', tokenHash).where('expiresAt', '>', at).executeTakeFirst();
      return row ?? null;
    },

    /** Lets go of this one link (it could not be mailed). A newer link is left alone. */
    async drop(userId: string, tokenHash: string): Promise<void> {
      await db.deleteFrom('adminium_email_changes').where('userId', '=', userId).where('tokenHash', '=', tokenHash).execute();
    },

    /** An account's address was set another way: what it was waiting for no longer applies. */
    async clear(userId: string): Promise<void> {
      await db.deleteFrom('adminium_email_changes').where('userId', '=', userId).execute();
    },

    /** Retention: expired more than a day ago, so an hour's send count has long passed too. */
    async gc(at: number = Date.now()): Promise<number> {
      const res = await db.deleteFrom('adminium_email_changes').where('expiresAt', '<', at - DAY_MS).executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type EmailChangesRepo = ReturnType<typeof emailChangesRepo>;
