/**
 * sessionsRepo — adminium_sessions (07-meta-store.md §3.5).
 * Cookie tokens are opaque; only their SHA-256 hex is stored (hashing in server).
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumSessionsTable } from '../schema/tables.js';
import { DAY_MS } from './util.js';

/** `last_seen_at` updates are throttled to at most one per this interval (§3.5). */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

export type Session = Selectable<AdminiumSessionsTable>;

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: number;
  ip?: string | null;
  userAgent?: string | null;
}

export function sessionsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: CreateSessionInput, at: number = Date.now()): Promise<Session> {
      const row: Session = {
        id: newId('sess'),
        tokenHash: input.tokenHash,
        userId: input.userId,
        createdAt: at,
        expiresAt: input.expiresAt,
        lastSeenAt: at,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        revokedAt: null,
      };
      await db.insertInto('adminium_sessions').values(row).execute();
      return row;
    },

    /** A session is valid when un-revoked and unexpired at `at`. */
    async findValidByTokenHash(tokenHash: string, at: number = Date.now()): Promise<Session | null> {
      const row = await db
        .selectFrom('adminium_sessions')
        .selectAll()
        .where('tokenHash', '=', tokenHash)
        .where('revokedAt', 'is', null)
        .where('expiresAt', '>', at)
        .executeTakeFirst();
      return row ?? null;
    },

    /**
     * Throttled `last_seen_at` bump: writes only when the previous value is at
     * least {@link SESSION_TOUCH_INTERVAL_MS} old. Returns true when written.
     */
    async touch(sessionId: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_sessions')
        .set({ lastSeenAt: at })
        .where('id', '=', sessionId)
        .where('lastSeenAt', '<=', at - SESSION_TOUCH_INTERVAL_MS)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    async revoke(sessionId: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_sessions')
        .set({ revokedAt: at })
        .where('id', '=', sessionId)
        .where('revokedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    async revokeAllForUser(userId: string, at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_sessions')
        .set({ revokedAt: at })
        .where('userId', '=', userId)
        .where('revokedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
    },

    /** Retention §8 `sessions` policy: expired, or revoked > 24 h ago. */
    async gc(at: number = Date.now()): Promise<number> {
      const res = await db
        .deleteFrom('adminium_sessions')
        .where((eb) => eb.or([eb('expiresAt', '<', at), eb('revokedAt', '<', at - DAY_MS)]))
        .executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type SessionsRepo = ReturnType<typeof sessionsRepo>;
