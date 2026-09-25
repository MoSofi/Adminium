// SPDX-License-Identifier: AGPL-3.0-only
/**
 * publicChallengesRepo / publicProofsRepo — emailed codes and used human
 * checks (migrations `0014_public_surface`, `0042_clinic_platform`).
 *
 * A code is stored as a hash only, with its attempts on the row, so the bound
 * on guesses survives a restart (the rate limiter is an in-process map). The
 * caps that protect a PERSON rather than a session — codes sent to one
 * patient in a window, wrong codes in a day — are counted here across every
 * session, by the claimed row's `subject`.
 *
 * Comparing a code is the caller's: it reads the hash and compares in
 * constant time. Nothing here matches on a code in SQL.
 */
import type { Selectable } from 'kysely';
import { sql } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumPublicChallengesTable, AdminiumPublicProofsTable } from '../schema/tables.js';

export type PublicChallenge = Selectable<AdminiumPublicChallengesTable>;
export type PublicProof = Selectable<AdminiumPublicProofsTable>;

export interface CreatePublicChallengeInput {
  keyId: string;
  /** The endpoint (claim) the code was asked for. */
  ref: string;
  /** Hash of the address it went to — a challenge table is otherwise an address list. */
  destinationHash: string;
  /** Keyed hash of the code. */
  codeHash: string;
  expiresAt: number;
  sessionId: string | null;
  /** `verify` | `email-change` | `link` (a sign-in link and its code) | `link-mail` (an app email's link). */
  purpose: string;
  /** The new address of an `email-change`, encrypted. */
  newDestinationEnc?: string | null;
  /** The claimed row the code was sent for. */
  subject: string | null;
  /** A sign-in link's token, as its SHA-256; absent for a code alone. */
  tokenHash?: string | null;
}

export function publicChallengesRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<PublicChallenge | null> {
    const row = await db.selectFrom('adminium_public_challenges').selectAll().where('id', '=', id).executeTakeFirst();
    return row ?? null;
  }

  return {
    findById,

    /** The challenge a sign-in link's token belongs to, by the token's SHA-256; used or not. */
    async findByTokenHash(tokenHash: string): Promise<PublicChallenge | null> {
      const row = await db.selectFrom('adminium_public_challenges').selectAll().where('tokenHash', '=', tokenHash).executeTakeFirst();
      return row ?? null;
    },

    /**
     * A new code for a session and purpose. Every code still open for that
     * pair is closed first, in the same transaction: a new code kills the
     * previous one, so only the newest email works.
     */
    async create(input: CreatePublicChallengeInput, at: number = Date.now()): Promise<PublicChallenge> {
      const row: PublicChallenge = {
        id: newId('pch'),
        keyId: input.keyId,
        ref: input.ref,
        destinationHash: input.destinationHash,
        codeHash: input.codeHash,
        attempts: 0,
        consumedAt: null,
        expiresAt: input.expiresAt,
        createdAt: at,
        sessionId: input.sessionId,
        purpose: input.purpose,
        newDestinationEnc: input.newDestinationEnc ?? null,
        subject: input.subject,
        clearedAt: null,
        tokenHash: input.tokenHash ?? null,
      };
      await db.transaction().execute(async (trx) => {
        if (input.sessionId !== null) {
          await trx
            .updateTable('adminium_public_challenges')
            .set({ consumedAt: at })
            .where('sessionId', '=', input.sessionId)
            .where('purpose', '=', input.purpose)
            .where('consumedAt', 'is', null)
            .execute();
        }
        await trx.insertInto('adminium_public_challenges').values(row).execute();
      });
      return row;
    },

    /**
     * The sign-in links still open for one address on one key, newest first:
     * not used, not expired, not taken back. A link is never closed by the
     * next one sent — up to three live together, each on its own.
     */
    async openLinks(subject: string, keyId: string, at: number = Date.now()): Promise<PublicChallenge[]> {
      return db
        .selectFrom('adminium_public_challenges')
        .selectAll()
        .where('subject', '=', subject)
        .where('keyId', '=', keyId)
        .where('purpose', '=', 'link')
        .where('consumedAt', 'is', null)
        .where('expiresAt', '>', at)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .execute();
    },

    /** How many sign-in links are live for one address, on any key. */
    async liveLinks(subject: string, at: number = Date.now()): Promise<number> {
      const row = await db
        .selectFrom('adminium_public_challenges')
        .select((eb) => eb.fn.countAll<number | string | bigint>().as('n'))
        .where('subject', '=', subject)
        .where('purpose', '=', 'link')
        .where('consumedAt', 'is', null)
        .where('expiresAt', '>', at)
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /**
     * Take back every open sign-in link to one address on these keys (its
     * owner's address changed) — asked for (`link`) or carried by the app's
     * own email (`link-mail`).
     */
    async revokeLinks(subject: string, keyIds: readonly string[], at: number = Date.now()): Promise<number> {
      if (keyIds.length === 0) return 0;
      const res = await db
        .updateTable('adminium_public_challenges')
        .set({ consumedAt: at })
        .where('subject', '=', subject)
        .where('purpose', 'in', ['link', 'link-mail'])
        .where('keyId', 'in', [...keyIds])
        .where('consumedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
    },

    /** The session's open code for a purpose: not used, not expired. */
    async findOpen(sessionId: string, purpose: string, at: number = Date.now()): Promise<PublicChallenge | null> {
      const row = await db
        .selectFrom('adminium_public_challenges')
        .selectAll()
        .where('sessionId', '=', sessionId)
        .where('purpose', '=', purpose)
        .where('consumedAt', 'is', null)
        .where('expiresAt', '>', at)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      return row ?? null;
    },

    /** The newest code a session was sent for a purpose, used or not — for "send it again in 30 s". */
    async newestFor(sessionId: string, purpose: string): Promise<PublicChallenge | null> {
      const row = await db
        .selectFrom('adminium_public_challenges')
        .selectAll()
        .where('sessionId', '=', sessionId)
        .where('purpose', '=', purpose)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      return row ?? null;
    },

    /** How many codes one session has been sent. */
    async countForSession(sessionId: string): Promise<number> {
      const row = await db
        .selectFrom('adminium_public_challenges')
        .select((eb) => eb.fn.countAll<number | string | bigint>().as('n'))
        .where('sessionId', '=', sessionId)
        // Codes only: a success marker (a code confirmed) is not a code sent.
        .where('codeHash', '!=', '')
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /**
     * One wrong guess, counted atomically on the row, and the count after it.
     * Returns null for a code already used or gone: a wrong guess against a
     * dead code changes nothing.
     */
    async recordFailure(id: string): Promise<number | null> {
      const res = await db
        .updateTable('adminium_public_challenges')
        .set({ attempts: sql<number>`attempts + 1` })
        .where('id', '=', id)
        .where('consumedAt', 'is', null)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1) return null;
      return (await findById(id))?.attempts ?? null;
    },

    /**
     * Charge one try BEFORE the code is compared, and only while tries are
     * left: the new count, or null when the code is used, gone or out of
     * tries. Comparing first would let many requests in flight at once each
     * be compared before any of them was counted.
     */
    async charge(id: string, max: number): Promise<number | null> {
      const res = await db
        .updateTable('adminium_public_challenges')
        .set({ attempts: sql<number>`attempts + 1` })
        .where('id', '=', id)
        .where('consumedAt', 'is', null)
        .where('attempts', '<', max)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1) return null;
      return (await findById(id))?.attempts ?? null;
    },

    /**
     * Something that happened, recorded where the caps read it: a code
     * confirmed (`verified`), an address changed (`email-changed`). A used
     * row with no code — a marker, never a code anyone can type.
     */
    async mark(input: { keyId: string; ref: string; sessionId: string | null; subject: string; purpose: string }, at: number = Date.now()): Promise<string> {
      const id = newId('pch');
      await db
        .insertInto('adminium_public_challenges')
        .values({
          id,
          keyId: input.keyId,
          ref: input.ref,
          destinationHash: '',
          codeHash: '',
          attempts: 0,
          consumedAt: at,
          expiresAt: at,
          createdAt: at,
          sessionId: input.sessionId,
          purpose: input.purpose,
          newDestinationEnc: null,
          subject: input.subject,
          clearedAt: null,
        })
        .execute();
      return id;
    },

    /** Take markers back: what they counted did not happen after all. */
    async unmark(ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return;
      await db.deleteFrom('adminium_public_challenges').where('id', 'in', [...ids]).where('codeHash', '=', '').execute();
    },

    /** Whether a session has a marker of this purpose since a moment (a code confirmed a moment ago). */
    async markedSince(sessionId: string, purpose: string, since: number): Promise<boolean> {
      const row = await db
        .selectFrom('adminium_public_challenges')
        .select('id')
        .where('sessionId', '=', sessionId)
        .where('purpose', '=', purpose)
        .where('createdAt', '>=', since)
        .executeTakeFirst();
      return row !== undefined;
    },

    /** Use a code, once: false when it was already used (a second request lost the race). */
    async consume(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_public_challenges')
        .set({ consumedAt: at })
        .where('id', '=', id)
        .where('consumedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Codes sent for one person since a moment, across every session (the per-person cap). */
    async sentSince(subject: string, since: number, purpose?: string): Promise<number> {
      let query = db
        .selectFrom('adminium_public_challenges')
        .select((eb) => eb.fn.countAll<number | string | bigint>().as('n'))
        .where('subject', '=', subject)
        .where('createdAt', '>=', since);
      if (purpose !== undefined) query = query.where('purpose', '=', purpose);
      const row = await query.executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /** Wrong codes typed for one person since a moment, not counting what the desk cleared. */
    async failuresSince(subject: string, since: number): Promise<number> {
      const row = await db
        .selectFrom('adminium_public_challenges')
        .select((eb) => eb.fn.sum<number | string | bigint | null>('attempts').as('n'))
        .where('subject', '=', subject)
        .where('createdAt', '>=', since)
        .where('clearedAt', 'is', null)
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /** The desk lifts a person's lock: their wrong codes so far stop counting. */
    async clearSubject(subject: string, at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_public_challenges')
        .set({ clearedAt: at })
        .where('subject', '=', subject)
        .where('clearedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
    },

    /** Housekeeping: rows older than the longest window any cap reads. */
    async purgeBefore(before: number): Promise<number> {
      const res = await db.deleteFrom('adminium_public_challenges').where('createdAt', '<', before).executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export function publicProofsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /**
     * Spend a proof. True the first time; false when any server already spent
     * it — the id is the primary key, so the insert is the check, and a replay
     * on another instance is refused the same way.
     */
    async spend(
      input: { id: string; keyId: string; purpose: string; expiresAt: number },
      at: number = Date.now(),
    ): Promise<boolean> {
      try {
        await db.insertInto('adminium_public_proofs').values({ ...input, createdAt: at }).execute();
        return true;
      } catch (error) {
        const found = await db
          .selectFrom('adminium_public_proofs')
          .select('id')
          .where('id', '=', input.id)
          .executeTakeFirst();
        if (found !== undefined) return false;
        throw error;
      }
    },

    /** Housekeeping: a proof past its expiry could not be used again anyway. */
    async purgeExpired(at: number = Date.now()): Promise<number> {
      const res = await db.deleteFrom('adminium_public_proofs').where('expiresAt', '<=', at).executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type PublicChallengesRepo = ReturnType<typeof publicChallengesRepo>;
export type PublicProofsRepo = ReturnType<typeof publicProofsRepo>;
