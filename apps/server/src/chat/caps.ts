// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CHAT'S CAPS: how much one visitor, one network address and the whole
 * install may write, so a script holding a chat open cannot flood the inbox
 * or switch the chat off.
 *
 *  - per conversation (its token): {@link CHAT_MESSAGES_PER_MINUTE} messages a
 *    minute and {@link CHAT_MESSAGES_PER_HOUR} an hour, and
 *    {@link CHAT_MESSAGES_PER_CONVERSATION} in all (counted from the
 *    conversation's own messages, so it holds for as long as it lives);
 *    {@link CHAT_DETAILS_PER_HOUR} changes of the details an hour;
 *  - per network address: {@link CHAT_STARTS_PER_ADDRESS_HOUR} new
 *    conversations an hour (a left question is one), an IPv6 address counted
 *    by its /64 (`rateAddress`), and also by its /56 at three times and its
 *    /48 at ten times that (a home or an office is often given a /56 or a
 *    /48, and one free tunnel hands out a whole /48);
 *  - per install: {@link CHAT_STARTS_PER_HOUR} new conversations an hour to
 *    one chat. Past it, the chat's BREAKER trips, as the payments' card-testing
 *    one does (`payments/card-testing.ts`): new conversations pause for
 *    {@link CHAT_PAUSE_MS}, the people the chat tells (else those who may
 *    change its settings) are told once, and a person may resume it sooner,
 *    which starts the hour's count again from nothing. A visitor already
 *    chatting goes on: the pause stops only new ones.
 *    Only a REAL conversation counts towards it: one that sent a second
 *    message or its details, or a question left outside hours (which carries
 *    an address). A bare start never does, so starts alone, however many,
 *    cannot switch a business's chat off ({@link ChatCaps.counted}).
 *  - the human check: past half the install's hourly limit of starts, a
 *    start's or a question's proof asks for more work, two bits more per
 *    quarter of the limit past half, at most six ({@link ChatCaps.difficulty}).
 *
 * Counted in the forms door's marks (`adminium_form_marks`, `forms/caps.ts`):
 * a mark is made first, then the window counted, so two writes at the same
 * moment cannot both slip under a cap; a refused write gives its marks back.
 * Every subject is a keyed hash or a hash of the add-on and the
 * conversation, never an address in clear, and an address's hash is never
 * kept with a conversation. The address's marks are read for an hour, kept
 * {@link CHAT_ADDRESS_KEEP_MS} at most, and swept: on the next start (at most
 * every few minutes) and by the hourly sweep.
 *
 * Kept in meta, so every process and every restart counts the same.
 */
import { createHash, createHmac } from 'node:crypto';

import { formMarksRepo, type MetaDb } from '@adminium/meta';

import { deriveKey } from '../config/secrets.js';
import { HOUR_MS } from '../public-api/anonymous-caps.js';
import { ipv6Network, rateAddress } from '../public-api/limiter.js';
import { PROOF_DIFFICULTY } from '../public-api/proof.js';

/** Messages one conversation may send in a minute, in an hour, and in all. */
export const CHAT_MESSAGES_PER_MINUTE = 20;
export const CHAT_MESSAGES_PER_HOUR = 200;
export const CHAT_MESSAGES_PER_CONVERSATION = 300;
/** New conversations one network address (an IPv4 address, an IPv6 /64) may start in an hour. */
export const CHAT_STARTS_PER_ADDRESS_HOUR = 10;
/** New conversations one IPv6 /56 may start in an hour: three times a /64's. */
export const CHAT_STARTS_PER_56_HOUR = 3 * CHAT_STARTS_PER_ADDRESS_HOUR;
/** New conversations one IPv6 /48 may start in an hour: ten times a /64's. */
export const CHAT_STARTS_PER_48_HOUR = 10 * CHAT_STARTS_PER_ADDRESS_HOUR;
/** Changes of the details (name, e-mail, language) one conversation may make in an hour. */
export const CHAT_DETAILS_PER_HOUR = 10;
/** New conversations one chat may take in an hour before its breaker pauses it. */
export const CHAT_STARTS_PER_HOUR = 500;
/** How long new conversations stay paused once the breaker trips. */
export const CHAT_PAUSE_MS = HOUR_MS;
/** How long an address's keyed hash is kept: the hour it is counted over, and a little more. */
export const CHAT_ADDRESS_KEEP_MS = 3 * HOUR_MS;
/** The most work the human check adds above its usual difficulty as the hour fills. */
export const CHAT_PROOF_EXTRA_MAX = 6;
/** How long a conversation's "counted" flag is kept: the marks' own keeping time (`FORMS_SWEEP` takes them after two days). */
const COUNTED_KEEP_MS = 48 * HOUR_MS;

const MINUTE_MS = 60_000;

/** Which cap a write met, as the window is told (`429 { cap, retryAfter }`). */
export type ChatCap = 'minute' | 'hour' | 'conversation' | 'new-conversations' | 'details';

/** The marks' purposes (at most 16 characters: the marks table's width). */
const PURPOSE = {
  message: 'chat-msg',
  details: 'chat-details',
  /** Every address mark (a /32, a /64, a /56, a /48): the purpose the address sweep takes. */
  start: 'chat-new',
  /** Every start to a chat, real or bare: what the human check's work follows. */
  begun: 'chat-begun',
  /** A real conversation: what the breaker counts. */
  install: 'chat-start',
  /** A conversation's "counted" flag: it is counted once. */
  counted: 'chat-counted',
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

/** The key the answerer hashes a visitor's address under: its own, so its notes and the caps' marks never share a value. */
export function chatAiAddressKey(secret: string): Buffer {
  return deriveKey(secret, 'adminium:chat-ai-address:v1', 'address');
}

/**
 * The address subjects a new conversation is counted under, each with its
 * hourly limit: the address (an IPv4 address, an IPv6 /64), and for IPv6
 * its /56 and its /48 too.
 */
function addressSubjects(key: Buffer, ip: string): { subject: string; limit: number }[] {
  const out = [{ subject: chatAddressSubject(key, ip), limit: CHAT_STARTS_PER_ADDRESS_HOUR }];
  for (const [bits, limit] of [
    [56, CHAT_STARTS_PER_56_HOUR],
    [48, CHAT_STARTS_PER_48_HOUR],
  ] as const) {
    const network = ipv6Network(ip, bits);
    if (network !== null) out.push({ subject: `chat-ip${String(bits)}:${createHmac('sha256', key).update(network).digest('hex')}`, limit });
  }
  return out;
}

/** A conversation's "counted" subject. */
function countedSubject(addOn: string, conversation: string): string {
  return `chat-cnt:${createHash('sha256').update(JSON.stringify([addOn, conversation])).digest('hex')}`;
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

  /** Since when an hour's count runs: the hour before `at`, or a person's resume within it (what was counted then is not counted again). */
  async function hourSince(chat: string, at: number): Promise<number> {
    const resumed = await newest(chat, PURPOSE.resume);
    return Math.max(at - HOUR_MS, resumed ?? 0);
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
     * chat's pause first, then the address's hour (its /64 or IPv4 address,
     * and an IPv6 address's /56 and /48 too). It is noted as begun, for the
     * human check's work; the breaker counts it only once it is real
     * ({@link counted}). `release` gives every mark back (the write did not
     * happen after all).
     */
    async chargeStart(addOn: string, ip: string, at: number): Promise<ChatCapCharge> {
      await pruneAddresses(at).catch(() => 0);
      const until = await pausedUntil(addOn, at);
      if (until !== null) return { ok: false, cap: 'paused', retryAfter: Math.max(1, Math.ceil((until - at) / 1000)) };
      const made: string[] = [];
      for (const { subject, limit } of addressSubjects(key, ip)) {
        made.push(await marks.mark({ subject, purpose: PURPOSE.start }, at));
        if ((await marks.sentSince(subject, at - HOUR_MS, PURPOSE.start)) > limit) {
          await marks.unmark(made);
          return { ok: false, cap: 'new-conversations', retryAfter: await waitOf(subject, PURPOSE.start, at - HOUR_MS, HOUR_MS, at) };
        }
      }
      made.push(await marks.mark({ subject: chatSubject(addOn), purpose: PURPOSE.begun }, at));
      return { ok: true, release: () => marks.unmark(made) };
    },

    /**
     * A conversation became real: it sent a second message or its details,
     * or it is a question left outside hours. Counted once (a flag per
     * conversation), towards the chat's hour; past {@link CHAT_STARTS_PER_HOUR}
     * the breaker trips. The write that made it real goes on either way: the
     * pause stops only new conversations. Answers whether it was counted now.
     */
    async counted(addOn: string, conversation: string, at: number): Promise<boolean> {
      if (!(await once(countedSubject(addOn, conversation), PURPOSE.counted, 1, COUNTED_KEEP_MS, at))) return false;
      const chat = chatSubject(addOn);
      await marks.mark({ subject: chat, purpose: PURPOSE.install }, at);
      if ((await marks.sentSince(chat, await hourSince(chat, at), PURPOSE.install)) > CHAT_STARTS_PER_HOUR && (await pausedUntil(addOn, at)) === null) {
        await marks.mark({ subject: chat, purpose: PURPOSE.pause }, at);
        // Told once a pause: a pause that trips again within the hour tells nobody twice.
        if (deps.paused !== undefined && (await once(`chat-paused:${chat.slice(8, 72)}`, PURPOSE.told, 1, CHAT_PAUSE_MS, at))) {
          await deps.paused(addOn, at + CHAT_PAUSE_MS, at).catch(() => undefined);
        }
      }
      return true;
    },

    /**
     * The human check's difficulty for a chat now: the usual one, and past
     * half the hour's limit of starts two bits more for each quarter of the
     * limit past half, at most {@link CHAT_PROOF_EXTRA_MAX} more.
     */
    async difficulty(addOn: string, at: number): Promise<number> {
      const chat = chatSubject(addOn);
      const begun = await marks.sentSince(chat, await hourSince(chat, at), PURPOSE.begun);
      const half = CHAT_STARTS_PER_HOUR / 2;
      const quarter = CHAT_STARTS_PER_HOUR / 4;
      const extra = begun <= half ? 0 : Math.min(CHAT_PROOF_EXTRA_MAX, 2 * Math.ceil((begun - half) / quarter));
      return PROOF_DIFFICULTY + extra;
    },

    /** One change of a conversation's details (name, e-mail, language): at most {@link CHAT_DETAILS_PER_HOUR} an hour. */
    async chargeDetails(addOn: string, conversation: string, at: number): Promise<ChatCapCharge> {
      const subject = conversationSubject(addOn, conversation);
      const mark = await marks.mark({ subject, purpose: PURPOSE.details }, at);
      if ((await marks.sentSince(subject, at - HOUR_MS, PURPOSE.details)) > CHAT_DETAILS_PER_HOUR) {
        await marks.unmark([mark]);
        return { ok: false, cap: 'details', retryAfter: await waitOf(subject, PURPOSE.details, at - HOUR_MS, HOUR_MS, at) };
      }
      return { ok: true, release: () => marks.unmark([mark]) };
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
