// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CARD TESTING, when the public starts payments (E3).
 *
 * An app's own checkout lets a stranger make something payable and start a
 * payment for it, so a card tester no longer needs a link the shop sent. On
 * top of plan 70's per-link defence (a pay proof per checkout, 20 checkouts a
 * link, 60 an address, and five declines lock a link and end its pages):
 *
 *  - A PUBLIC START HAS ITS OWN LINK (`audience: public`), current beside the
 *    link the shop sent, never in its place. A tester's declines lock only
 *    theirs; the shop's link keeps working.
 *  - TWO BUDGETS. Checkouts through public links and through the shop's own
 *    links are counted apart, so a run of public checkouts never uses up what
 *    staff links may start.
 *  - THE ADDRESS. A public checkout keeps a keyed hash of the address it
 *    started from (an IPv6 address by its /64, which one subscriber holds), so
 *    declines are counted per address: one that declined too often gets no
 *    new public checkout. The hash is never the address, and it is forgotten
 *    once the window is over.
 *  - STARTS ARE COUNTED TOO: each payment started from an app's screens (the
 *    start call, or a create that answers a pay link) by its address and for
 *    the install, so a tester is held before any checkout is made.
 *  - THE INSTALL'S BREAKER. Declines from many addresses within the window
 *    (one tester behind many addresses) pause every public start for an hour:
 *    the apps read "not taking payments online", the shop's own links keep
 *    working, and the payment managers are told once.
 *
 * Counted over this hour and the one before (`readRecent`), so a run that
 * starts late in an hour cannot spend a whole new hour a minute later. All in
 * meta, so every process and every restart counts the same.
 */
import { createHmac, hkdfSync } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

import { paymentCountersRepo, paymentSettingsRepo, type PaymentAttempt } from '@adminium/meta';
import { z } from 'zod';

import { tellPaymentManagers, type NoticeDeps } from './notices.js';

/** Checkouts every public link together may start in an hour. */
export const PUBLIC_CHECKOUTS_PER_HOUR = 600;
/** Payments one address may start from apps' screens in an hour (a start, or a create that answers a pay link). */
export const ADDRESS_STARTS_PER_HOUR = 30;
/** Payments every address together may start from apps' screens in an hour. */
export const PUBLIC_STARTS_PER_HOUR = 600;
/** Declines one address may have on public checkouts, over this hour and the one before, before it gets no new one. */
export const ADDRESS_DECLINES_TO_BLOCK = 5;
/** Addresses with a decline, over this hour and the one before, that pause every public start. */
export const DECLINING_ADDRESSES_TO_PAUSE = 10;
/** How long public starts stay paused. */
export const PUBLIC_PAUSE_MS = 60 * 60_000;
/** How long a public checkout keeps its hashed start address: the two windows, and a little more. */
export const START_ADDRESS_KEEP_MS = 3 * 60 * 60_000;

/** The settings document holding the pause. */
export const PUBLIC_PAUSE_DOC = 'public-starts-pause';
const pauseSchema = z.object({ until: z.number(), since: z.number(), addresses: z.number() }).strict();
/** A resume: the addresses already counted then are not counted again for a new pause. */
export const PUBLIC_RESUMED_DOC = 'public-starts-resumed';
const resumedSchema = z.object({ at: z.number(), counted: z.number() }).strict();

const ADDRESSES_BUCKET = 'decline-addresses';
const addressBucket = (hash: string): string => `decline-address:${hash}`;

/**
 * The part of an address that names one subscriber: an IPv4 address whole,
 * an IPv6 address by its first 64 bits (an IPv4 address written as IPv6 is
 * IPv4). Null for anything that is not an address.
 */
export function addressPrefix(ip: string): string | null {
  const bare = ip.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  if (mapped !== null && isIPv4(mapped[1]!)) return mapped[1]!;
  if (isIPv4(bare)) return bare;
  if (!isIPv6(bare)) return null;
  const [head, tail = ''] = bare.toLowerCase().split('::') as [string, string?];
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  // An embedded IPv4 tail is two groups; only the first four groups are kept, so its value does not matter.
  const groups = [...left, ...Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => '0'), ...right];
  return `${groups.slice(0, 4).map((group) => String(parseInt(group, 16) || 0)).join(':')}::/64`;
}

/** The key the start addresses are hashed with, from the server's secret (never the secret itself). */
function addressKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'adminium', 'payments:start-address', 32));
}

/** A keyed hash of a request's address: the same address always hashes the same, and cannot be read back. Null with no address. */
export function startAddressOf(secret: string, ip: string | undefined): string | null {
  const prefix = ip === undefined ? null : addressPrefix(ip);
  if (prefix === null) return null;
  return createHmac('sha256', addressKey(secret)).update(prefix, 'utf8').digest('base64url');
}

export interface CardTestingDeps extends NoticeDeps {
  secret: string;
}

export interface CardTesting {
  /** Until when public starts are paused, or null. */
  pausedUntil(): Promise<number | null>;
  /** Whether this hashed address declined too often to start another public checkout. */
  addressBlocked(startAddress: string): Promise<boolean>;
  /** Counts one public start from this hashed address (null: none known); false when it is one too many, or the address is held. */
  countStart(startAddress: string | null): Promise<boolean>;
  /** A public checkout was declined (`count` new declines): counted by its address, and the install's breaker may trip. */
  noteDecline(attempt: PaymentAttempt, count: number): Promise<void>;
  /** Someone who manages payments resumes public starts before the hour is over. */
  resume(): Promise<boolean>;
}

export function createCardTesting(deps: CardTestingDeps): CardTesting {
  const now = deps.now ?? Date.now;
  const counters = paymentCountersRepo(deps.meta);
  const docs = paymentSettingsRepo(deps.meta);

  async function pausedUntil(): Promise<number | null> {
    const pause = await docs.get(PUBLIC_PAUSE_DOC, pauseSchema).catch(() => null);
    return pause !== null && pause.until > now() ? pause.until : null;
  }

  return {
    pausedUntil,

    async addressBlocked(startAddress) {
      return (await counters.readRecent(addressBucket(startAddress), now())) >= ADDRESS_DECLINES_TO_BLOCK;
    },

    async countStart(startAddress) {
      const at = now();
      if (startAddress !== null) {
        if ((await counters.readRecent(addressBucket(startAddress), at)) >= ADDRESS_DECLINES_TO_BLOCK) return false;
        if ((await counters.hit(`start-address:${startAddress}`, at)) > ADDRESS_STARTS_PER_HOUR) return false;
      }
      return (await counters.hit('start-install', at)) <= PUBLIC_STARTS_PER_HOUR;
    },

    async noteDecline(attempt, count) {
      const hash = attempt.startAddress;
      if (hash === null || count <= 0) return;
      const at = now();
      let mine = 0;
      for (let one = 0; one < count; one += 1) mine = await counters.hit(addressBucket(hash), at);
      // This address's first decline in this hour: one more address declining.
      if (mine === count) await counters.hit(ADDRESSES_BUCKET, at);
      // A person resumed within the window: only the addresses declining since then count.
      const resumed = await docs.get(PUBLIC_RESUMED_DOC, resumedSchema).catch(() => null);
      const before = resumed !== null && resumed.at > at - 2 * PUBLIC_PAUSE_MS ? resumed.counted : 0;
      const addresses = Math.max(0, (await counters.readRecent(ADDRESSES_BUCKET, at)) - before);
      if (addresses < DECLINING_ADDRESSES_TO_PAUSE || (await pausedUntil()) !== null) return;
      const until = at + PUBLIC_PAUSE_MS;
      await docs.set(PUBLIC_PAUSE_DOC, pauseSchema, { until, since: at, addresses }, at);
      await tellPaymentManagers(deps, {
        kind: 'payments.card-testing',
        about: `card-testing:${String(Math.floor(at / PUBLIC_PAUSE_MS))}`,
        urgent: true,
        actionUrl: '/studio/payments',
        words: () => ({
          title: { key: 'cardTesting.title', fallback: 'Payments from your apps are paused' },
          body: {
            key: 'cardTesting.body',
            fallback:
              "Cards were declined from {count} different addresses within an hour, which looks like someone testing stolen cards. Payments started from your apps' own screens are paused for an hour; pay links you send keep working. You can resume them in Payments.",
          },
          values: { count: String(addresses) },
        }),
      }).catch(() => 0);
    },

    async resume() {
      if ((await pausedUntil()) === null) return false;
      const at = now();
      await docs.set(PUBLIC_RESUMED_DOC, resumedSchema, { at, counted: await counters.readRecent(ADDRESSES_BUCKET, at) }, at);
      await docs.remove(PUBLIC_PAUSE_DOC);
      return true;
    },
  };
}
