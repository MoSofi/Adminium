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
 *  - plain text: a name holds letters, spaces and ordinary punctuation (a
 *    diner's own script's too: `，。` or `،`), at most 80 characters, and
 *    never a link; a column the app marks for it (a note to the kitchen)
 *    may also hold a few digits and run longer.
 *
 * Counted where every instance reads them — markers in the public challenges
 * table, by an HMAC of the value, so the table is never a list of numbers —
 * and CHARGED FIRST: the marker is written, then counted with it, so many
 * requests at once cannot all be counted before any is written. A create
 * that then fails for another reason (the slot was taken) takes its markers
 * back; a refusal by the cap takes them back too.
 */
import { createHmac, hkdfSync } from 'node:crypto';

import { PLAIN_TEXT_DIGITS_MOST, PLAIN_TEXT_LONGEST, PLAIN_TEXT_MAX } from '@adminium/manifest';
import type { PublicChallengesRepo } from '@adminium/meta';
import { z } from 'zod';

import { DAY_MS } from './claim-code.js';
import { linkFreeText, NAME_RULE, plainText, stricterRule, type PlainTextRule } from './plain-text.js';
import { rateAddress } from './limiter.js';

export const HOUR_MS = 60 * 60_000;

/** The markers' purpose: what the cap counts. */
export const ANONYMOUS_PURPOSE = 'anonymous-create';

// The judge itself lives in `plain-text.ts`, where a column's own rule reads it too.
export { linkFreeText, NAME_RULE, plainText, stricterRule, type PlainTextRule };

/** The longest a plain-text value may be, unless its column says longer. */
export { PLAIN_TEXT_MAX };

/**
 * A column held to plain text: its name, or its name with what else it may
 * hold — at most `digits` digits in all ("2 without onions", "table 12", never
 * a phone number) and up to `max` characters.
 */
export type PlainTextColumn = string | { column: string; digits?: number | undefined; max?: number | undefined };

/** A list of plain-text columns, as an entry, an endpoint or a scope declares it (`column` spelled as each does). */
export const plainTextListSchema = (column: z.ZodType<string>) =>
  z
    .array(
      z.union([
        column,
        z
          .object({
            column,
            digits: z.number().int().min(1).max(PLAIN_TEXT_DIGITS_MOST).optional(),
            max: z.number().int().min(1).max(PLAIN_TEXT_LONGEST).optional(),
          })
          .strict(),
      ]),
    )
    .min(1)
    .max(8);

export const plainColumn = (entry: PlainTextColumn): string => (typeof entry === 'string' ? entry : entry.column);

export const plainRule = (entry: PlainTextColumn): PlainTextRule =>
  typeof entry === 'string' ? NAME_RULE : { digits: entry.digits ?? 0, max: entry.max ?? PLAIN_TEXT_MAX };

/** The column names of a plain-text list. */
export const plainColumns = (list: readonly PlainTextColumn[] | undefined): string[] => (list ?? []).map(plainColumn);

/** A plain-text list copied, so a definition never shares its entries. */
export const copyPlainText = (list: readonly PlainTextColumn[]): PlainTextColumn[] => list.map((entry) => (typeof entry === 'string' ? entry : { ...entry }));

/** Whether a save lets a column hold more than it did: dropped, or more digits or characters allowed. */
export function plainTextLoosened(before: readonly PlainTextColumn[] | undefined, after: readonly PlainTextColumn[] | undefined): boolean {
  const now = new Map<string, PlainTextRule>();
  for (const entry of after ?? []) {
    const was = now.get(plainColumn(entry));
    now.set(plainColumn(entry), was === undefined ? plainRule(entry) : stricterRule(was, plainRule(entry)));
  }
  return (before ?? []).some((entry) => {
    const was = plainRule(entry);
    const rule = now.get(plainColumn(entry));
    return rule === undefined || rule.digits > was.digits || rule.max > was.max;
  });
}

/** What a public caller is told when a plain-text column is refused: the rule, never which part of it. */
export const PLAIN_TEXT_REFUSED = 'That can hold letters, spaces and ordinary punctuation only, and no web or email address.';

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
  plainText?: PlainTextColumn[] | undefined;
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

/**
 * The first column whose value is not plain text, or null: judged as a child
 * row's note is, so a name like "refund-desk.com Smith" is refused before the
 * venue's own email could print it.
 */
export function notPlain(caps: AnonymousCaps, values: Record<string, unknown>): string | null {
  const entry = (caps.plainText ?? []).find((e) => !linkFreeText(values[plainColumn(e)], plainRule(e)));
  return entry === undefined ? null : plainColumn(entry);
}

export type CapCharge =
  | {
      ok: true;
      /** Every marker taken back: a create refused for the guest's own value. */
      release: () => Promise<void>;
      /** Every marker but the entry's own hour per visitor: a create the whole write reached, then refused (a full slot). */
      releaseAllButVisitor?: () => Promise<void>;
    }
  | { ok: false };

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
  const charges: { subject: string; limit: number; since: number; visitor?: true }[] = [];
  // One visitor first, then everyone through the key: a visitor over their own hour never counts as the key's.
  if (input.ip !== undefined) {
    if (caps.perIpHour !== undefined && caps.perIpHour < ANONYMOUS_PER_IP_HOUR) {
      charges.push({ subject: entryIpSubject(input.key, input.keyId, input.ref, input.ip), limit: caps.perIpHour, since: input.now - HOUR_MS, visitor: true });
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
  const visitorIds = new Set<string>();
  const release = async () => {
    if (ids.length > 0) await repo.unmark(ids);
  };
  const releaseAllButVisitor = async () => {
    const back = ids.filter((id) => !visitorIds.has(id));
    if (back.length > 0) await repo.unmark(back);
  };
  for (const charge of charges) {
    const id = await repo.mark({ keyId: input.keyId, ref: input.ref, sessionId: null, subject: charge.subject, purpose: ANONYMOUS_PURPOSE }, input.now);
    ids.push(id);
    if (charge.visitor === true) visitorIds.add(id);
  }
  for (const charge of charges) {
    if ((await repo.sentSince(charge.subject, charge.since, ANONYMOUS_PURPOSE)) > charge.limit) {
      await release();
      return { ok: false };
    }
  }
  return { ok: true, release, releaseAllButVisitor };
}
