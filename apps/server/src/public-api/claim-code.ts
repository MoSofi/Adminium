// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The emailed code that raises a found session to `verified`, and the pieces
 * around it: the code itself, its keyed hash, the person it is counted
 * against, and the address as a page may show it.
 *
 * ── WHAT A CODE PROVES ─────────────────────────────────────────────────────
 * A claim by details (a mobile and a date of birth) finds a person; knowing
 * those details is not the same as being them. A six-digit code sent to the
 * address on their row proves the mailbox, and only then does a session read
 * what the person marked sensitive.
 *
 * ── WHY IT IS HARD TO GUESS ────────────────────────────────────────────────
 * A code is never stored, only an HMAC of it under a key derived from the
 * server's secret and compared in constant time, so a copy of the table does
 * not give codes up. Each code takes five tries, CHARGED BEFORE the compare,
 * so requests in flight together cannot each try one. A person is capped
 * across every session and every key — counted by their row in the source
 * database, not by who asked: three codes in fifteen minutes and ten a day,
 * and ten wrong codes in a day lock the verified level until the desk clears
 * it. At those limits a guesser has about one chance in a hundred thousand a
 * day per person, and every try emails them.
 */
import { createHash, createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';

/** Digits in a code, and how long one lasts. */
export const CODE_DIGITS = 6;
export const CODE_TTL_MS = 10 * 60_000;
/** Tries per code; codes per session; the pause between two codes. */
export const CODE_TRIES = 5;
export const CODES_PER_SESSION = 5;
export const CODE_RESEND_MS = 30_000;
/** A session whose code died of wrong tries waits this long before another. */
export const CODE_LOCK_MS = 15 * 60_000;
/** Per person: codes in fifteen minutes, codes a day, wrong codes a day. */
export const PERSON_CODES_15M = 3;
export const PERSON_CODES_DAY = 10;
export const PERSON_FAILURES_DAY = 10;
/** A session is verified for this long; an address change needs a code confirmed this recently. */
export const VERIFIED_TTL_MS = 30 * 60_000;
export const STEP_UP_MS = 10 * 60_000;
/** One address change per person a day. */
export const EMAIL_CHANGES_DAY = 1;

export const DAY_MS = 24 * 60 * 60_000;

/** A fresh code, zero-padded. */
export function newCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

/** The key codes are hashed under: its own derivation, so no other use of the secret shares it. */
export function codeKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'adminium-public-code-v1', 'code', 32));
}

/** The key an address is hashed under, for the challenge row (which is otherwise an address list). */
export function addressKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'adminium-public-code-v1', 'address', 32));
}

/**
 * A code's hash, bound to the one challenge it was sent for — its session,
 * purpose and moment — so a hash copied onto another row matches nothing.
 */
export function hashCode(key: Buffer, binding: string, code: string): string {
  return createHmac('sha256', key).update(`${binding}.${code.trim()}`).digest('hex');
}

/** What a code is bound to. */
export function codeBinding(challenge: { sessionId: string | null; purpose: string; createdAt: number }): string {
  return `${challenge.sessionId ?? ''}.${challenge.purpose}.${String(challenge.createdAt)}`;
}

/** Whether a typed code is the one hashed, in constant time. */
export function codeMatches(key: Buffer, binding: string, typed: string, stored: string): boolean {
  const a = Buffer.from(hashCode(key, binding, typed), 'hex');
  const b = Buffer.from(stored, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hashAddress(key: Buffer, address: string): string {
  return createHmac('sha256', key).update(address.trim().toLowerCase()).digest('hex');
}

/**
 * The person a code is counted against: the claimed ROW — connection, table,
 * column, value — whichever key or endpoint the session came through, so
 * every way in shares one count and the desk clears one lock.
 */
export function subjectOf(connectionId: string, table: string, column: string, value: unknown): string {
  return `row:${createHash('sha256').update(JSON.stringify([connectionId, table, column, String(value)])).digest('hex')}`;
}

/**
 * The address as a page may show it: its first letter, and the domain's —
 * the whole domain only for the big mail providers, whose name tells nobody
 * where a person works.
 */
const PROVIDERS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.fr',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  't-online.de',
  'orange.fr',
  'free.fr',
  'laposte.net',
  'seznam.cz',
  'qq.com',
  '163.com',
  '126.com',
  'yandex.ru',
]);

export function maskAddress(address: string): string {
  const [local = '', domain = ''] = address.trim().toLowerCase().split('@');
  const head = `${local.slice(0, 1)}•••`;
  if (PROVIDERS.has(domain)) return `${head}@${domain}`;
  const dot = domain.lastIndexOf('.');
  const tld = dot === -1 ? '' : domain.slice(dot);
  return `${head}@${domain.slice(0, 1)}•••${tld}`;
}

/** A plausible address to send a code to: one @, a dotted domain, no spaces, not too long. */
export function plausibleAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** What typing a code came to. */
export type CodeTry = { outcome: 'right' } | { outcome: 'wrong'; triesLeft: number } | { outcome: 'expired' };

/**
 * One typed code against an open challenge, as read by the request. The try
 * is charged FIRST — an update that succeeds only while tries are left — and
 * only a charged try is compared, so any number of requests holding the same
 * open code still get five compares between them. The fifth wrong try kills
 * the code; a right one uses it, once.
 */
export async function tryCode(
  challenges: {
    charge(id: string, max: number): Promise<number | null>;
    consume(id: string, at?: number): Promise<boolean>;
  },
  open: { id: string; sessionId: string | null; purpose: string; createdAt: number; codeHash: string },
  typed: string,
  key: Buffer,
  now: number,
): Promise<CodeTry> {
  const tries = await challenges.charge(open.id, CODE_TRIES);
  if (tries === null) return { outcome: 'expired' };
  if (!codeMatches(key, codeBinding(open), typed, open.codeHash)) {
    if (tries >= CODE_TRIES) await challenges.consume(open.id, now);
    return { outcome: 'wrong', triesLeft: Math.max(CODE_TRIES - tries, 0) };
  }
  return (await challenges.consume(open.id, now)) ? { outcome: 'right' } : { outcome: 'expired' };
}
