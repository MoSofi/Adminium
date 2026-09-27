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

const PLAIN = /^[\p{L}\p{M} .,'’()&-]*$/u;
/** A domain written out: a word, a dot, and a name of two letters or more after it (`evil.com`, `claim.refund.net`, `пример.рф`). */
const DOMAIN = /[\p{L}\p{N}-]+\.\p{L}{2,}/u;

/**
 * Whether a value is plain text: letters, spaces, ordinary punctuation — no
 * link, no address and no domain a stranger could be sent to ("claim your
 * refund at evil.com"). A dot is fine after a word and a space ("St. John",
 * "J. R. Smith"); a dot between two words is a domain, and refused.
 */
export function plainText(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  return value.length <= PLAIN_TEXT_MAX && PLAIN.test(value) && !lower.includes('://') && !lower.includes('www.') && !lower.includes('@') && !DOMAIN.test(value);
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
  if (caps.perKeyHour !== undefined) charges.push({ subject: keySubject(input.keyId), limit: caps.perKeyHour, since: input.now - HOUR_MS });
  if (input.ip !== undefined) charges.push({ subject: ipSubject(input.key, input.keyId, input.ip), limit: ANONYMOUS_PER_IP_HOUR, since: input.now - HOUR_MS });
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
