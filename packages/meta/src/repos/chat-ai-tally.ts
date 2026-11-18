// SPDX-License-Identifier: AGPL-3.0-only
/**
 * chatAiTallyRepo — adminium_chat_ai_days (0094) and adminium_chat_ai_addresses
 * (0095): what a website chat's automatic answerer spent on a UTC day, and
 * what it did for each network address (a keyed hash) in the last three hours.
 *
 * Written only by the server's answerer. No settings route, config import,
 * export or archive touches them, so nobody sets a day's spend back.
 *
 * Every change that a limit guards is ONE statement, so two calls at once
 * cannot both pass the limit: a reservation adds to what is held only where
 * what was spent and what is held still leave room for it. An address's
 * notes are counted the way the forms door's marks are: a note made first,
 * then the window counted, so two calls at once cannot both slip under a cap.
 *
 * An address note holds no conversation: only whether its call was the
 * first of a new conversation, and its tokens. It is read for
 * {@link CHAT_AI_ADDRESS_KEEP_MS} and no longer; each new note first deletes
 * every note older than that, and the server sweeps them hourly too.
 */
import type { MetaDb } from '../connect.js';
import { CHAT_AI_ADDRESS_WIDTH, CHAT_AI_ADD_ON_WIDTH, CHAT_AI_DAY_WIDTH, CHAT_AI_INSTALL_WIDTH } from '../migrations/0094_chat_ai_tally.js';
import { newId } from '../ids.js';
import { affected, isDuplicateKeyError } from './util.js';

export { CHAT_AI_ADDRESS_WIDTH, CHAT_AI_ADD_ON_WIDTH, CHAT_AI_DAY_WIDTH, CHAT_AI_INSTALL_WIDTH };

/** How long an address note is read, and kept: three hours. */
export const CHAT_AI_ADDRESS_KEEP_MS = 3 * 60 * 60_000;

/** One chat install: what an address's notes are counted within. */
export interface ChatAiChatKey {
  installId: string;
  addOn: string;
}

/** What an address did on one chat in the last three hours. */
export interface ChatAiAddressUse {
  /** New conversations it had automatic answers asked for. */
  conversations: number;
  /** Tokens its calls held or spent. */
  tokens: number;
}

/** One chat's day: the install, the add-on, and the UTC day as `YYYY-MM-DD`. */
export interface ChatAiDayKey {
  installId: string;
  addOn: string;
  day: string;
}

/** What one chat's day spent and what its running calls hold. */
export interface ChatAiDay {
  spent: number;
  reserved: number;
  changedAt: number;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC day a moment falls on, as the tally keys it. */
export function chatAiDayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

const whole = (n: number, what: string): void => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`A chat tally's ${what} is a whole number, 0 or more.`);
};

function checkKey(key: ChatAiDayKey): void {
  if (key.installId.length === 0 || key.installId.length > CHAT_AI_INSTALL_WIDTH) throw new Error('A chat tally install id is empty or longer than its column.');
  if (key.addOn.length === 0 || key.addOn.length > CHAT_AI_ADD_ON_WIDTH) throw new Error('A chat tally add-on key is empty or longer than its column.');
  if (key.day.length !== CHAT_AI_DAY_WIDTH || !DAY_RE.test(key.day)) throw new Error('A chat tally day is written YYYY-MM-DD.');
}

function checkChat(key: ChatAiChatKey): void {
  if (key.installId.length === 0 || key.installId.length > CHAT_AI_INSTALL_WIDTH) throw new Error('A chat tally install id is empty or longer than its column.');
  if (key.addOn.length === 0 || key.addOn.length > CHAT_AI_ADD_ON_WIDTH) throw new Error('A chat tally add-on key is empty or longer than its column.');
}

function checkAddress(hash: string): void {
  if (hash.length === 0 || hash.length > CHAT_AI_ADDRESS_WIDTH) throw new Error('A chat tally address hash is empty or longer than its column.');
}

export function chatAiTallyRepo(meta: MetaDb) {
  const { db } = meta;
  const days = 'adminium_chat_ai_days' as const;
  const addresses = 'adminium_chat_ai_addresses' as const;

  const insertDay = async (key: ChatAiDayKey, spent: number, reserved: number, at: number): Promise<boolean> => {
    try {
      await db.insertInto(days).values({ installId: key.installId, addOn: key.addOn, day: key.day, tokensSpent: spent, tokensReserved: reserved, changedAt: at }).execute();
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  };

  return {
    /** One chat's day, or null when nothing was reserved or spent on it. */
    async day(key: ChatAiDayKey): Promise<ChatAiDay | null> {
      checkKey(key);
      const row = await db
        .selectFrom(days)
        .select(['tokensSpent', 'tokensReserved', 'changedAt'])
        .where('installId', '=', key.installId)
        .where('addOn', '=', key.addOn)
        .where('day', '=', key.day)
        .executeTakeFirst();
      return row === undefined ? null : { spent: Number(row.tokensSpent), reserved: Number(row.tokensReserved), changedAt: Number(row.changedAt) };
    },

    /**
     * Hold `tokens` of the day's `limit`, in one statement: held only when
     * what was spent, what is held and these tokens fit under the limit.
     * Answers whether they were held. A day with no row starts with this
     * reservation (made at most once: two first calls at once meet the key).
     */
    async reserve(key: ChatAiDayKey, tokens: number, limit: number, at: number): Promise<boolean> {
      checkKey(key);
      whole(tokens, 'reservation');
      whole(limit, 'limit');
      if (tokens > limit) return false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const updated = await db
          .updateTable(days)
          .set((eb) => ({ tokensReserved: eb('tokensReserved', '+', tokens), changedAt: at }))
          .where('installId', '=', key.installId)
          .where('addOn', '=', key.addOn)
          .where('day', '=', key.day)
          .where((eb) => eb(eb('tokensSpent', '+', eb.ref('tokensReserved')), '<=', limit - tokens))
          .executeTakeFirst();
        if (affected(updated.numUpdatedRows) > 0) return true;
        const there = await db.selectFrom(days).select('day').where('installId', '=', key.installId).where('addOn', '=', key.addOn).where('day', '=', key.day).executeTakeFirst();
        if (there !== undefined) return false;
        if (await insertDay(key, 0, tokens, at)) return true;
      }
      return false;
    },

    /**
     * A call ended: count what it `spent` and let go of the `held` tokens it
     * reserved, in one statement.
     */
    async settle(key: ChatAiDayKey, held: number, spent: number, at: number): Promise<void> {
      checkKey(key);
      whole(held, 'reservation');
      whole(spent, 'spend');
      const updated = await db
        .updateTable(days)
        .set((eb) => ({ tokensSpent: eb('tokensSpent', '+', spent), tokensReserved: eb('tokensReserved', '-', held), changedAt: at }))
        .where('installId', '=', key.installId)
        .where('addOn', '=', key.addOn)
        .where('day', '=', key.day)
        .where('tokensReserved', '>=', held)
        .executeTakeFirst();
      if (affected(updated.numUpdatedRows) > 0) return;
      // Less held than this call reserved (nothing a running call does): what others hold stays, the spend is counted.
      const counted = await db
        .updateTable(days)
        .set((eb) => ({ tokensSpent: eb('tokensSpent', '+', spent), changedAt: at }))
        .where('installId', '=', key.installId)
        .where('addOn', '=', key.addOn)
        .where('day', '=', key.day)
        .executeTakeFirst();
      if (affected(counted.numUpdatedRows) > 0) return;
      // A day with no row: made with the spend, or, made by another call just now, counted on it.
      if (!(await insertDay(key, spent, 0, at))) {
        await db
          .updateTable(days)
          .set((eb) => ({ tokensSpent: eb('tokensSpent', '+', spent), changedAt: at }))
          .where('installId', '=', key.installId)
          .where('addOn', '=', key.addOn)
          .where('day', '=', key.day)
          .execute();
      }
    },

    /**
     * Note one model call for `addressHash` on a chat: whether it is the
     * first of a new conversation, and the tokens it holds. Every note older
     * than {@link CHAT_AI_ADDRESS_KEEP_MS} goes first. Answers the note's id,
     * to settle or take back.
     */
    async markAddress(key: ChatAiChatKey, addressHash: string, note: { first: boolean; tokens: number }, at: number): Promise<string> {
      checkChat(key);
      checkAddress(addressHash);
      whole(note.tokens, 'reservation');
      await db.deleteFrom(addresses).where('createdAt', '<', at - CHAT_AI_ADDRESS_KEEP_MS).execute();
      const id = newId('cai');
      await db.insertInto(addresses).values({ id, installId: key.installId, addOn: key.addOn, addressHash, first: note.first ? 1 : 0, tokens: note.tokens, createdAt: at }).execute();
      return id;
    },

    /** A call ended: its note counts what it spent, in place of what it held. */
    async settleAddress(id: string, spent: number): Promise<void> {
      whole(spent, 'spend');
      await db.updateTable(addresses).set({ tokens: spent }).where('id', '=', id).execute();
    },

    /** Take a note back: the call it was made for was never made. */
    async unmarkAddress(id: string): Promise<void> {
      await db.deleteFrom(addresses).where('id', '=', id).execute();
    },

    /** What `addressHash` did on a chat in the three hours before `at`: never a note older. */
    async addressUse(key: ChatAiChatKey, addressHash: string, at: number): Promise<ChatAiAddressUse> {
      checkChat(key);
      const row = await db
        .selectFrom(addresses)
        .select((eb) => [eb.fn.sum<number | string | bigint | null>('first').as('firsts'), eb.fn.sum<number | string | bigint | null>('tokens').as('tokens')])
        .where('addressHash', '=', addressHash)
        .where('installId', '=', key.installId)
        .where('addOn', '=', key.addOn)
        .where('createdAt', '>', at - CHAT_AI_ADDRESS_KEEP_MS)
        .executeTakeFirst();
      return { conversations: Number(row?.firsts ?? 0), tokens: Number(row?.tokens ?? 0) };
    },

    /** The sweep: every address note made before `before` (epoch ms). Answers how many went. */
    async pruneAddresses(before: number): Promise<number> {
      const deleted = await db.deleteFrom(addresses).where('createdAt', '<', before).executeTakeFirst();
      return affected(deleted.numDeletedRows);
    },
  };
}

export type ChatAiTallyRepo = ReturnType<typeof chatAiTallyRepo>;
