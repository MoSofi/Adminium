// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The limits on a create nobody signed in for — a first visit booked by a
 * stranger, which is also a way to fill a diary and to have the venue email
 * whatever a stranger typed.
 *
 *  - per value: at most `n` a day for one phone number or one address,
 *    whichever key or page it came through — one mailbox however it is
 *    spelled (`ana+1@…` is `ana@…`; dots never matter to Gmail);
 *  - per key: at most `n` an hour through one browser key, from everyone;
 *  - per visitor: at most {@link ANONYMOUS_PER_IP_HOUR} an hour from one
 *    address (an IPv6 subscriber's whole /64), so one visitor cannot spend
 *    the key's hour for everyone;
 *  - plain text: a name holds letters, spaces and ordinary punctuation, at
 *    most 80 characters, and never a link.
 *
 * Counted where every instance reads them — markers in the public challenges
 * table, by an HMAC of the value, so the table is never a list of numbers —
 * and CHARGED FIRST: the marker is written, then counted with it, so many
 * requests at once cannot all be counted before any is written. A create
 * that then fails for another reason (the slot was taken) takes its markers
 * back; a refusal by the cap takes them back too.
 */
import { createHmac, hkdfSync } from 'node:crypto';

import type { PublicChallengesRepo } from '@adminium/meta';

import { DAY_MS } from './claim-code.js';
import { rateAddress } from './limiter.js';

export const HOUR_MS = 60 * 60_000;

/** The markers' purpose: what the cap counts. */
export const ANONYMOUS_PURPOSE = 'anonymous-create';

/** The longest a plain-text value may be. */
export const PLAIN_TEXT_MAX = 80;

/** Creates nobody signed in for, an hour, from one visitor's address, through one key. */
export const ANONYMOUS_PER_IP_HOUR = 60;

export interface AnonymousCaps {
  /** At most `n` a day per value of any of these columns. */
  perValue?: { columns: string[]; n: number } | undefined;
  /** At most this many an hour through the key. */
  perKeyHour?: number | undefined;
  /** At most this many an hour from one visitor through this entry (never above {@link ANONYMOUS_PER_IP_HOUR}). */
  perIpHour?: number | undefined;
  /** Columns that hold plain text only. */
  plainText?: string[] | undefined;
}

/** The key a capped value is hashed under: its own derivation from the secret. */
export function capKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'adminium-public-cap-v1', 'anonymous', 32));
}

/** Gmail's own domains: its mailboxes read the same with or without dots in the name. */
const GMAIL: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);

/**
 * One mailbox, for counting only: the name's `+tag` dropped (any domain), and
 * for Gmail its dots too. Never used to find or link a person — folding a
 * custom domain there could hand one person's rows to another — but counting
 * too many as one mailbox harms nobody.
 */
export function mailboxOf(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return address;
  let name = address.slice(0, at);
  // `gmail.com.` is `gmail.com`: a name ending in a dot is the same name.
  let domain = address.slice(at + 1).replace(/\.+$/, '');
  const plus = name.indexOf('+');
  if (plus > 0) name = name.slice(0, plus);
  if (GMAIL.has(domain)) {
    name = name.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${name}@${domain}`;
}

/**
 * One person's value, however they spelled it: an address in lower case, as
 * its mailbox (`mailboxOf`); a phone number as its last nine digits (so
 * `+44 7700 900123` and `07700 900123` are one number); anything else
 * trimmed and lower case.
 */
export function capValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().toLowerCase();
  if (text === '') return null;
  if (text.includes('@')) return mailboxOf(text);
  const digits = text.replace(/\D/g, '');
  return digits.length >= 7 && /^[\d\s()+.-]+$/.test(text) ? digits.slice(-9) : text;
}

/** Where a value is counted: the row it would describe, never the key it came through. */
export function valueSubject(key: Buffer, connectionId: string, table: string, column: string, value: string): string {
  return `anon:${createHmac('sha256', key).update(JSON.stringify([connectionId, table, column, value])).digest('hex')}`;
}

export function keySubject(keyId: string): string {
  return `anon-key:${keyId}`;
}

/** Where one visitor's creates through a key are counted: never the address itself, a keyed hash of it. */
export function ipSubject(key: Buffer, keyId: string, ip: string): string {
  return `anon-ip:${createHmac('sha256', key).update(JSON.stringify([keyId, rateAddress(ip)])).digest('hex')}`;
}

/** Where one visitor's creates through one entry of a key are counted, for the entry's own lower cap. */
export function entryIpSubject(key: Buffer, keyId: string, ref: string, ip: string): string {
  return `anon-ip:${createHmac('sha256', key).update(JSON.stringify([keyId, ref, rateAddress(ip)])).digest('hex')}`;
}

const PLAIN = /^[\p{L}\p{M} .,'’()&-]*$/u;

/**
 * Whether a value is plain text: letters, spaces, ordinary punctuation, at
 * most 80 characters, and no link. A create nobody signed in for is held to
 * exactly this (`anonymous.plainText`), as it always has been.
 */
export function plainText(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  return value.length <= PLAIN_TEXT_MAX && PLAIN.test(value) && !lower.includes('://') && !lower.includes('www.');
}

/**
 * The endings a web address a stranger could be sent to ends in: the common
 * generic ones and the country ones a link is usually made with. Never a
 * short word a name is made of ("Mary.Ann", "J.R.R.", "Jo").
 */
const KNOWN_TLDS: ReadonlySet<string> = new Set([
  // generic
  'com', 'net', 'org', 'info', 'biz', 'edu', 'gov', 'mil', 'int', 'io', 'co', 'ai', 'app', 'dev', 'xyz', 'online', 'site',
  'top', 'shop', 'store', 'club', 'live', 'me', 'tv', 'cc', 'ly', 'gg', 'sh', 'fm', 'ws', 'link', 'click', 'help', 'support',
  'page', 'pro', 'name', 'mobi', 'tech', 'website', 'space', 'world', 'today', 'news', 'blog', 'cloud', 'email', 'host', 'lol',
  'vip', 'win', 'bid', 'loan', 'work', 'review', 'download', 'racing', 'date', 'trade', 'science', 'party', 'stream', 'fun',
  'icu', 'buzz', 'cam', 'rest', 'bar', 'cyou', 'monster', 'sbs', 'cfd', 'ink', 'wiki', 'social', 'events', 'tickets',
  'finance', 'money', 'bank', 'pay', 'gift', 'gifts', 'deals', 'sale', 'promo', 'claims', 'refund',
  // countries a link is usually made with
  'uk', 'de', 'fr', 'nl', 'eu', 'us', 'ca', 'au', 'in', 'br', 'jp', 'cn', 'ru', 'it', 'es', 'pl', 'ch', 'se', 'dk', 'fi',
  'at', 'cz', 'pt', 'ie', 'nz', 'za', 'mx', 'tr', 'ua', 'kr', 'hk', 'sg', 'tw', 'vn', 'ng', 'ke', 'gr', 'ro', 'hu', 'su',
  'рф', 'срб', 'укр', 'бел', 'қаз',
]);

/** A name with dots between its parts (`evil.com`, `claim.refund.net`, `J.R.R`); the last part is read as an ending. */
const DOTTED = /[\p{L}\p{M}-]+(?:\.[\p{L}\p{M}-]+)+/gu;

/**
 * Plain text that names no place to go (`limits.plainText`, a child row's
 * `plainText`): {@link plainText}, and no `@` handle, no path and no web
 * address ending in a known ending ("Claim your refund at evil.com",
 * "evil.co.uk/x", "@handle") — while "Mary.Ann", "J.R.R. Tolkien" and
 * "St. John" are names, and pass.
 */
export function linkFreeText(value: unknown): boolean {
  if (!plainText(value)) return false;
  if (typeof value !== 'string') return true;
  if (value.includes('@') || value.includes('/')) return false;
  for (const [dotted] of value.matchAll(DOTTED)) {
    const ending = dotted.slice(dotted.lastIndexOf('.') + 1).toLowerCase();
    if (KNOWN_TLDS.has(ending)) return false;
  }
  return true;
}

/** The first column whose value is not plain text, or null. */
export function notPlain(caps: AnonymousCaps, values: Record<string, unknown>): string | null {
  return (caps.plainText ?? []).find((column) => !plainText(values[column])) ?? null;
}

export type CapCharge = { ok: true; release: () => Promise<void> } | { ok: false };

/**
 * Charge a session-less create against its caps: every marker written, then
 * each counted. Refused (and taken back) when any count is over; otherwise the
 * caller holds `release`, for a create that then fails.
 */
export async function chargeAnonymous(
  repo: Pick<PublicChallengesRepo, 'mark' | 'sentSince' | 'unmark'>,
  input: { caps: AnonymousCaps; key: Buffer; keyId: string; connectionId: string; table: string; ref: string; values: Record<string, unknown>; now: number; ip?: string | undefined },
): Promise<CapCharge> {
  const { caps } = input;
  const charges: { subject: string; limit: number; since: number }[] = [];
  // One visitor first, then everyone through the key: a visitor over their own hour never counts as the key's.
  if (input.ip !== undefined) {
    if (caps.perIpHour !== undefined && caps.perIpHour < ANONYMOUS_PER_IP_HOUR) {
      charges.push({ subject: entryIpSubject(input.key, input.keyId, input.ref, input.ip), limit: caps.perIpHour, since: input.now - HOUR_MS });
    }
    charges.push({ subject: ipSubject(input.key, input.keyId, input.ip), limit: ANONYMOUS_PER_IP_HOUR, since: input.now - HOUR_MS });
  }
  if (caps.perKeyHour !== undefined) charges.push({ subject: keySubject(input.keyId), limit: caps.perKeyHour, since: input.now - HOUR_MS });
  const perValue = caps.perValue;
  if (perValue !== undefined) {
    for (const column of perValue.columns) {
      const value = capValue(input.values[column]);
      if (value !== null) charges.push({ subject: valueSubject(input.key, input.connectionId, input.table, column, value), limit: perValue.n, since: input.now - DAY_MS });
    }
  }
  const ids: string[] = [];
  const release = async () => {
    if (ids.length > 0) await repo.unmark(ids);
  };
  for (const charge of charges) {
    ids.push(await repo.mark({ keyId: input.keyId, ref: input.ref, sessionId: null, subject: charge.subject, purpose: ANONYMOUS_PURPOSE }, input.now));
  }
  for (const charge of charges) {
    if ((await repo.sentSince(charge.subject, charge.since, ANONYMOUS_PURPOSE)) > charge.limit) {
      await release();
      return { ok: false };
    }
  }
  return { ok: true, release };
}
