// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CHAT'S CAPS: how much one visitor, one network address and the whole
 * install may write, so a script holding a chat open cannot flood the inbox.
 *
 *  - per conversation (its token): {@link CHAT_MESSAGES_PER_MINUTE} messages a
 *    minute and {@link CHAT_MESSAGES_PER_HOUR} an hour, and
 *    {@link CHAT_MESSAGES_PER_CONVERSATION} in all (counted from the
 *    conversation's own messages, so it holds for as long as it lives);
 *  - per network address: {@link CHAT_STARTS_PER_ADDRESS_HOUR} new
 *    conversations an hour (a left question is one), an IPv6 address counted
 *    by its /64 (`rateAddress`);
 *  - per install: {@link CHAT_STARTS_PER_HOUR} new conversations an hour to
 *    one chat. Past it, the chat's BREAKER trips, as the payments' card-testing
 *    one does (`payments/card-testing.ts`): new conversations pause for
 *    {@link CHAT_PAUSE_MS}, the people the chat tells (else those who may
 *    change its settings) are told once, and a person may resume it sooner.
 *    A visitor already chatting goes on: the pause stops only new ones.
 *
 * Counted in the forms door's marks (`adminium_form_marks`, `forms/caps.ts`):
 * a mark is made first, then the window counted, so two writes at the same
 * moment cannot both slip under a cap; a refused write gives its marks back.
 * Every subject is a keyed hash or a hash of the add-on and the
 * conversation, never an address in clear. The address's marks live
 * {@link CHAT_ADDRESS_KEEP_MS} and go, and the hash is never kept with a
 * conversation.
 *
 * Kept in meta, so every process and every restart counts the same.
 */
import { createHash, createHmac } from 'node:crypto';

import { formMarksRepo, type MetaDb } from '@adminium/meta';

import { deriveKey } from '../config/secrets.js';
import { HOUR_MS } from '../public-api/anonymous-caps.js';
import { rateAddress } from '../public-api/limiter.js';

/** Messages one conversation may send in a minute, in an hour, and in all. */
export const CHAT_MESSAGES_PER_MINUTE = 20;
export const CHAT_MESSAGES_PER_HOUR = 200;
export const CHAT_MESSAGES_PER_CONVERSATION = 300;
/** New conversations one network address may start in an hour. */
export const CHAT_STARTS_PER_ADDRESS_HOUR = 10;
/** New conversations one chat may take in an hour before its breaker pauses it. */
export const CHAT_STARTS_PER_HOUR = 500;
/** How long new conversations stay paused once the breaker trips. */
export const CHAT_PAUSE_MS = HOUR_MS;
/** How long an address's keyed hash is kept: the hour it is counted over, and a little more. */
export const CHAT_ADDRESS_KEEP_MS = 3 * HOUR_MS;

const MINUTE_MS = 60_000;

/** Which cap a write met, as the window is told (`429 { cap, retryAfter }`). */
export type ChatCap = 'minute' | 'hour' | 'conversation' | 'new-conversations';

/** The marks' purposes (at most 16 characters: the marks table's width). */
const PURPOSE = {
  message: 'chat-msg',
  start: 'chat-new',
  install: 'chat-start',
  pause: 'chat-pause',
  resume: 'chat-resume',
  told: 'chat-told',
} as const;

/** A charge refused: which cap, and in how many seconds it opens again (null: never, in this conversation). */
export type ChatCapRefusal = { ok: false; cap: ChatCap; retryAfter: number | null } | { ok: false; cap: 'paused'; retryAfter: number };
export type ChatCapCharge = { ok: true; release: () => Promise<void> } | ChatCapRefusal;

/** The key the caps hash addresses under: their own, from the server's secret. */
export function chatCapKey(secret: string): Buffer {
  return deriveKey(secret, 'adminium:chat-caps:v1', 'caps');
}

/** One conversation's subject. */
export function conversationSubject(addOn: string, conversation: string): string {
  return `chat-conv:${createHash('sha256').update(JSON.stringify([addOn, conversation])).digest('hex')}`;
}

/** One network address's subject, under the caps' key. */
export function chatAddressSubject(key: Buffer, ip: string): string {
  return `chat-ip:${createHmac('sha256', key).update(rateAddress(ip)).digest('hex')}`;
}

/** One chat's subject, for the install's count and its breaker. */
export function chatSubject(addOn: string): string {
  return `chat-on:${createHash('sha256').update(addOn).digest('hex')}`;
}

export interface ChatCapsDeps {
  meta: MetaDb;
  secret: string;
  /** Tells the people the chat tells that its breaker paused it: called at most once a pause. */
  paused?: (addOn: string, until: number, at: number) => Promise<void>;
}

export function createChatCaps(deps: ChatCapsDeps) {
  const { meta } = deps;
  const marks = formMarksRepo(meta);
  const key = chatCapKey(deps.secret);
  let prunedAt = 0;

  /** Seconds until the oldest mark of a window leaves it. */
  async function waitOf(subject: string, purpose: string, since: number, window: number, at: number): Promise<number> {
    const oldest = await marks.oldestSince(subject, since, purpose);
    return Math.max(1, Math.ceil(((oldest ?? at) + window - at) / 1000));
  }

  /** The newest mark of a subject's purpose, or null. */
  async function newest(subject: string, purpose: string): Promise<number | null> {
    const row = await meta.db
      .selectFrom('adminium_form_marks')
      .select((eb) => eb.fn.max('createdAt').as('at'))
      .where('subject', '=', subject)
      .where('purpose', '=', purpose)
      .executeTakeFirst();
    return row?.at === null || row?.at === undefined ? null : Number(row.at);
  }

  /** Until when a chat's new conversations are paused, or null. */
  async function pausedUntil(addOn: string, at: number): Promise<number | null> {
    const subject = chatSubject(addOn);
    const pause = await newest(subject, PURPOSE.pause);
    if (pause === null || pause + CHAT_PAUSE_MS <= at) return null;
    const resumed = await newest(subject, PURPOSE.resume);
    return resumed !== null && resumed >= pause ? null : pause + CHAT_PAUSE_MS;
  }

  /** An address's marks older than its keeping time go (at most once every few minutes). */
  async function pruneAddresses(at: number, force = false): Promise<number> {
    if (!force && at - prunedAt < 5 * MINUTE_MS) return 0;
    prunedAt = at;
    const gone = await meta.db.deleteFrom('adminium_form_marks').where('purpose', '=', PURPOSE.start).where('createdAt', '<', at - CHAT_ADDRESS_KEEP_MS).executeTakeFirst();
    return Number(gone.numDeletedRows ?? 0);
  }

  /** Whether a mark of `purpose` for `subject` may be made now, at most `limit` in `window`: made when it may. */
  async function once(subject: string, purpose: string, limit: number, window: number, at: number): Promise<boolean> {
    const id = await marks.mark({ subject, purpose }, at);
    if ((await marks.sentSince(subject, at - window, purpose)) > limit) {
      await marks.unmark([id]);
      return false;
    }
    return true;
  }

  return {
    pausedUntil,

    /**
     * A new conversation (a start, or a question left outside hours): the
     * chat's pause first, then the address's hour, then the chat's hour,
     * which trips the breaker. `release` gives both marks back (the write
     * did not happen after all).
     */
    async chargeStart(addOn: string, ip: string, at: number): Promise<ChatCapCharge> {
      await pruneAddresses(at).catch(() => 0);
      const until = await pausedUntil(addOn, at);
      if (until !== null) return { ok: false, cap: 'paused', retryAfter: Math.max(1, Math.ceil((until - at) / 1000)) };
      const address = chatAddressSubject(key, ip);
      const mine = await marks.mark({ subject: address, purpose: PURPOSE.start }, at);
      if ((await marks.sentSince(address, at - HOUR_MS, PURPOSE.start)) > CHAT_STARTS_PER_ADDRESS_HOUR) {
        await marks.unmark([mine]);
        return { ok: false, cap: 'new-conversations', retryAfter: await waitOf(address, PURPOSE.start, at - HOUR_MS, HOUR_MS, at) };
      }
      const chat = chatSubject(addOn);
      const ours = await marks.mark({ subject: chat, purpose: PURPOSE.install }, at);
      // Counted since the hour began, or since a person resumed the chat within it: what was counted then is not counted again.
      const resumed = await newest(chat, PURPOSE.resume);
      const since = Math.max(at - HOUR_MS, resumed ?? 0);
      if ((await marks.sentSince(chat, since, PURPOSE.install)) > CHAT_STARTS_PER_HOUR) {
        await marks.unmark([mine, ours]);
        await marks.mark({ subject: chat, purpose: PURPOSE.pause }, at);
        // Told once a pause: a pause that trips again within the hour tells nobody twice.
        if (deps.paused !== undefined && (await once(`chat-paused:${chat.slice(8, 72)}`, PURPOSE.told, 1, CHAT_PAUSE_MS, at))) {
          await deps.paused(addOn, at + CHAT_PAUSE_MS, at).catch(() => undefined);
        }
        return { ok: false, cap: 'paused', retryAfter: Math.ceil(CHAT_PAUSE_MS / 1000) };
      }
      return { ok: true, release: () => marks.unmark([mine, ours]) };
    },

    /**
     * One message from a visitor: the conversation's minute, its hour, and
     * how many it has sent in all (`sent`, its visitor messages so far).
     */
    async chargeMessage(addOn: string, conversation: string, sent: number, at: number): Promise<ChatCapCharge> {
      if (sent >= CHAT_MESSAGES_PER_CONVERSATION) return { ok: false, cap: 'conversation', retryAfter: null };
      const subject = conversationSubject(addOn, conversation);
      const mark = await marks.mark({ subject, purpose: PURPOSE.message }, at);
      for (const [cap, window, limit] of [
        ['minute', MINUTE_MS, CHAT_MESSAGES_PER_MINUTE],
        ['hour', HOUR_MS, CHAT_MESSAGES_PER_HOUR],
      ] as const) {
        if ((await marks.sentSince(subject, at - window, PURPOSE.message)) > limit) {
          await marks.unmark([mark]);
          return { ok: false, cap, retryAfter: await waitOf(subject, PURPOSE.message, at - window, window, at) };
        }
      }
      return { ok: true, release: () => marks.unmark([mark]) };
    },

    /** A person who may change the chat's settings resumes new conversations before the pause is over. False when it was not paused. */
    async resume(addOn: string, at: number): Promise<boolean> {
      if ((await pausedUntil(addOn, at)) === null) return false;
      await marks.mark({ subject: chatSubject(addOn), purpose: PURPOSE.resume }, at);
      return true;
    },

    once,

    /** How many marks of `purpose` for `subject` were made in the `window` before `at`: what {@link once} has counted. */
    used: (subject: string, purpose: string, window: number, at: number): Promise<number> => marks.sentSince(subject, at - window, purpose),

    /** Takes back every mark of `purpose` for `subject`: what {@link once} counted starts again from nothing. */
    async clearOnce(subject: string, purpose: string): Promise<void> {
      await meta.db.deleteFrom('adminium_form_marks').where('subject', '=', subject).where('purpose', '=', purpose).execute();
    },

    /** The sweep of the addresses' hashes past their keeping time. Answers how many went. */
    prune: (at: number) => pruneAddresses(at, true),
  };
}

export type ChatCaps = ReturnType<typeof createChatCaps>;
