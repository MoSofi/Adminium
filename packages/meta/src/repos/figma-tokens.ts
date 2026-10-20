// SPDX-License-Identifier: AGPL-3.0-only
/**
 * figmaTokensRepo — a person's own Figma token on `adminium_users` (wave 0061).
 *
 * Kept apart from `usersRepo` on purpose: a `User` never carries the token, so it is never on a
 * request's user, in a users route or in a log of one. The token is stored as the server encrypted
 * it; this file never sees it in the clear.
 *
 * The pause after Figma said a seat's reads are used up belongs to the Figma account, not to the
 * person: Figma counts a personal token's reads per Figma user. So it is kept on every row whose
 * token is that Figma user's, and read from the latest of them.
 */
import type { MetaDb } from '../connect.js';
import { readBool, writeBool } from './util.js';

export interface FigmaTokenRow {
  /** The token in the server's envelope; null when the person has not connected Figma. */
  encrypted: string | null;
  handle: string | null;
  figmaUserId: string | null;
}

export interface FigmaPause {
  /** Epoch ms. */
  until: number;
  /** Whether Figma said when; when it did not, reads stop until the person's own import succeeds. */
  dated: boolean;
}

export function figmaTokensRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** The person's stored token, or null when there is no such person. */
    async read(userId: string): Promise<FigmaTokenRow | null> {
      const row = await db
        .selectFrom('adminium_users')
        .select(['figmaTokenEncrypted', 'figmaHandle', 'figmaUserId'])
        .where('id', '=', userId)
        .executeTakeFirst();
      return row === undefined ? null : { encrypted: row.figmaTokenEncrypted, handle: row.figmaHandle, figmaUserId: row.figmaUserId };
    },

    /** Keep a token for the person. False when there is no such person. */
    async save(userId: string, input: { encrypted: string; handle: string; figmaUserId: string }): Promise<boolean> {
      const done = await db
        .updateTable('adminium_users')
        .set({ figmaTokenEncrypted: input.encrypted, figmaHandle: input.handle.slice(0, 120), figmaUserId: input.figmaUserId.slice(0, 200) })
        .where('id', '=', userId)
        .executeTakeFirst();
      return Number(done.numUpdatedRows) > 0;
    },

    /**
     * Take the person's token off the server. The Figma account it named stays on the row, with any
     * pause: the pause is a fact about that account, and holds if the person connects it again.
     */
    async clear(userId: string): Promise<boolean> {
      const done = await db
        .updateTable('adminium_users')
        .set({ figmaTokenEncrypted: null, figmaHandle: null })
        .where('id', '=', userId)
        .where('figmaTokenEncrypted', 'is not', null)
        .executeTakeFirst();
      return Number(done.numUpdatedRows) > 0;
    },

    /** The pause on a Figma account, or null when its reads are not paused. */
    async pausedFor(figmaUserId: string): Promise<FigmaPause | null> {
      const row = await db
        .selectFrom('adminium_users')
        .select(['figmaPausedUntil', 'figmaPauseDated'])
        .where('figmaUserId', '=', figmaUserId)
        .where('figmaPausedUntil', 'is not', null)
        .orderBy('figmaPausedUntil', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row === undefined || row.figmaPausedUntil === null ? null : { until: Number(row.figmaPausedUntil), dated: readBool(row.figmaPauseDated) };
    },

    /**
     * Pause a Figma account's reads. Kept on every row holding that account's token, and on the row of
     * the person whose read was refused when it names no account yet (the project's own token, used by
     * its owner, is on no row).
     */
    async pause(figmaUserId: string, pause: FigmaPause, viaUserId: string | null): Promise<void> {
      const set = { figmaPausedUntil: pause.until, figmaPauseDated: writeBool(meta, pause.dated) };
      await db.updateTable('adminium_users').set(set).where('figmaUserId', '=', figmaUserId).execute();
      if (viaUserId !== null) {
        await db
          .updateTable('adminium_users')
          .set({ ...set, figmaUserId })
          .where('id', '=', viaUserId)
          .where('figmaUserId', 'is', null)
          .execute();
      }
    },

    /** Lift a Figma account's pause (its owner's own import succeeded). */
    async unpause(figmaUserId: string): Promise<void> {
      await db.updateTable('adminium_users').set({ figmaPausedUntil: null, figmaPauseDated: writeBool(meta, false) }).where('figmaUserId', '=', figmaUserId).execute();
    },
  };
}
