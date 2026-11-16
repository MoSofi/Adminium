// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PAYING FROM AN APP'S OWN SCREENS: what the public API answers a customer.
 *
 * Two answers, both under the app's own publishable key:
 *
 *  - `available`: can this app take payments online right now? Only when
 *    someone who manages payments switched the app on, a payment service is
 *    live, customers can reach the pay address, and the operator has not
 *    switched payments off (a trial). Nothing more: no service, account or
 *    reason is told to the public. An app reads its screens exactly as before
 *    while it is not.
 *  - `start`: the pay link of one record the caller can already read (the
 *    route reads it first, through the same check as a public read of the
 *    record, so "not yours" and "not payable" look alike). The amount is never
 *    the caller's: the record is read again here. A public start has its own
 *    link, current beside the one the shop sent and never in its place
 *    (`card-testing.ts`): reused while it opens, made when there is none, and
 *    refused `not-now` once its declines locked it. While card testing has
 *    paused public starts, the app reads as not taking payments online.
 *  - `state`: how the newest online payment of one record the caller can
 *    already read stands, in one word, for the customer who comes back from
 *    the pay page: a checkout still open, the bank confirming, paid, didn't
 *    finish, or the time on the service's page ran out. Never an amount, a
 *    service, an id or anything of the customer: the record itself says what
 *    is paid and what is due.
 *
 * Only the app's own payables: a record of a table some other app or a person
 * made payable is not this key's to start a payment for.
 */
import { payableProfilesRepo, paymentAttemptsRepo, type AttemptState, type MetaDb, type RecordRef } from '@adminium/meta';

import type { CardTesting } from './card-testing.js';
import { createPublicLinkFor, type PayLinkForDeps } from './pay-link-for.js';
import { linkSealFromSecret, mintLink, payAddress, payReachable, payUrl as payUrlOf } from './links.js';
import { resolvePayable, type PayableSources } from './payables.js';

export interface PublicPayDeps extends PayLinkForDeps {
  /** False while the operator has switched payments off (a trial). */
  paymentsAllowed?: () => boolean;
  /** The card-testing breakers: public starts pause while it says so. */
  cardTesting?: Pick<CardTesting, 'pausedUntil'>;
}

/** A rehearsal's test link lasts an hour, as a staff test payment's does. */
const TEST_LINK_LIFETIME_MS = 60 * 60_000;

/** Why a payment could not be started, as the public is told it: never more than this. */
export type StartRefusal = 'off' | 'not-payable' | 'nothing-due' | 'not-now';

/**
 * How the newest online payment of a record stands, as its customer is told:
 * `none` (no payment was started online), `open` (a checkout is open at the
 * service, which has not said yet), `confirming` (the bank is confirming it:
 * some ways take days), `paid`, `failed` (it did not finish, or the customer
 * left it; nothing was taken) or `expired` (the time to pay on the service's
 * page ran out; nothing was taken).
 */
export const PUBLIC_PAY_STATES = ['none', 'open', 'confirming', 'paid', 'failed', 'expired'] as const;
export type PublicPayState = (typeof PUBLIC_PAY_STATES)[number];

/** An attempt's state in the customer's word. Money taken is paid, whether or not it is written into the record yet. */
const SAID: Readonly<Record<AttemptState, PublicPayState>> = {
  creating: 'open',
  open: 'open',
  processing: 'confirming',
  succeeded: 'paid',
  recording: 'paid',
  recorded: 'paid',
  record_refused: 'paid',
  failed: 'failed',
  cancelled: 'failed',
  abandoned: 'failed',
  expired: 'expired',
};

/** A record's payment state as the public reads it; `test` while it is a rehearsal's test payment. */
export interface PublicPayStateAnswer {
  state: PublicPayState;
  test?: true;
}

export interface PublicPay {
  available(connectionId: string, appKey: string): Promise<{ online: boolean }>;
  /**
   * Whether the app takes payments online for one of its tables right now:
   * `available`, narrowed to the app's own payable on that table. What an
   * entry open only while payments are on (or off) is opened by.
   */
  takesPaymentsFor(connectionId: string, appKey: string, table: string): Promise<boolean>;
  /** Whether the app has a payable on this table, switched on or not: what a rehearsal of it walks. */
  hasPayableOn(connectionId: string, appKey: string, table: string): Promise<boolean>;
  start(entity: RecordRef, appKey: string): Promise<{ ok: true; payUrl: string } | { ok: false; reason: StartRefusal }>;
  /**
   * How the newest online payment of the app's own payable record stands
   * (`none` for a record of any other table). Asked whether or not the app is
   * switched on now: a customer coming back is told the truth either way.
   */
  state(entity: RecordRef, appKey: string): Promise<PublicPayStateAnswer>;
  /** Whether the app has payables at all, switched on or not: what a rehearsal walks. */
  hasPayables(connectionId: string, appKey: string): Promise<boolean>;
  /**
   * A rehearsal's start: a test link on the address the rehearsing person
   * is on (`origin`), for the app's own payable, whether the app is switched on
   * or not. The caller has made sure the row is a sample row.
   */
  startTest(entity: RecordRef, appKey: string, origin: string, by: string): Promise<{ ok: true; payUrl: string } | { ok: false; reason: StartRefusal }>;
}

export function createPublicPay(deps: PublicPayDeps & { meta: MetaDb; sources: PayableSources }): PublicPay {
  const linkFor = createPublicLinkFor(deps);
  const seal = linkSealFromSecret(deps.secret);

  /** Live, reachable and allowed: what every app shares. */
  async function open(): Promise<boolean> {
    if (deps.paymentsAllowed !== undefined && !deps.paymentsAllowed()) return false;
    if (deps.cardTesting !== undefined && (await deps.cardTesting.pausedUntil()) !== null) return false;
    if (!(await deps.liveOn())) return false;
    const reach = await payReachable(deps.meta, { networkFeatures: deps.networkFeatures, desktop: deps.desktop, trustProxy: deps.trustProxy, forwarded: false });
    return reach.state === 'reachable' && (await payAddress(deps.meta)) !== null;
  }

  return {
    async available(connectionId, appKey) {
      const owned = (await payableProfilesRepo(deps.meta).list(connectionId)).filter((profile) => profile.ownerApp === appKey);
      const switchedOn = owned.some((profile) => profile.enabled && (profile.mapping !== null || profile.shape !== null));
      return { online: switchedOn && (await open()) };
    },

    async takesPaymentsFor(connectionId, appKey, table) {
      const profile = await payableProfilesRepo(deps.meta).byTable(connectionId, table);
      if (profile === null || profile.ownerApp !== appKey || (profile.mapping === null && profile.shape === null) || !profile.enabled) return false;
      return open();
    },

    async hasPayableOn(connectionId, appKey, table) {
      const profile = await payableProfilesRepo(deps.meta).byTable(connectionId, table);
      return profile !== null && profile.ownerApp === appKey && (profile.mapping !== null || profile.shape !== null);
    },

    async start(entity, appKey) {
      const keys = Object.keys(entity.pk);
      if (keys.length !== 1) return { ok: false, reason: 'not-payable' };
      const found = await deps.sources.table(entity.connectionId, entity.table);
      if (found === null) return { ok: false, reason: 'not-payable' };
      const profile = await payableProfilesRepo(deps.meta).byTable(entity.connectionId, found.table.id);
      // The app's own payable, switched on: anything else is not this key's to start.
      if (profile === null || profile.ownerApp !== appKey || (profile.mapping === null && profile.shape === null)) return { ok: false, reason: 'not-payable' };
      if (!profile.enabled || !(await open())) return { ok: false, reason: 'off' };
      const kind = profile.shape !== null ? 'shape' : 'profile';
      const payable = await resolvePayable(deps.sources, { kind, connectionId: entity.connectionId, tableName: found.table.id, rowKey: String(entity.pk[keys[0]!]) });
      if (payable === null) return { ok: false, reason: 'not-payable' };
      if (payable.refusal !== null) {
        const code = payable.refusal.code;
        return { ok: false, reason: code === 'NOTHING_DUE' ? 'nothing-due' : code === 'NOT_NOW' ? 'not-now' : 'not-payable' };
      }
      const payUrl = await linkFor(entity);
      if (payUrl === 'locked') return { ok: false, reason: 'not-now' };
      return payUrl === null ? { ok: false, reason: 'off' } : { ok: true, payUrl };
    },

    async state(entity, appKey) {
      const keys = Object.keys(entity.pk);
      if (keys.length !== 1) return { state: 'none' };
      const found = await deps.sources.table(entity.connectionId, entity.table);
      if (found === null) return { state: 'none' };
      const profile = await payableProfilesRepo(deps.meta).byTable(entity.connectionId, found.table.id);
      if (profile === null || profile.ownerApp !== appKey || (profile.mapping === null && profile.shape === null)) return { state: 'none' };
      const ref = { kind: profile.shape !== null ? ('shape' as const) : ('profile' as const), connectionId: entity.connectionId, tableName: found.table.id, rowKey: String(entity.pk[keys[0]!]) };
      const [newest] = await paymentAttemptsRepo(deps.meta).forPayable(ref, 1);
      if (newest === undefined) return { state: 'none' };
      return { state: SAID[newest.state], ...(newest.mode === 'test' ? { test: true as const } : {}) };
    },

    async hasPayables(connectionId, appKey) {
      return (await payableProfilesRepo(deps.meta).list(connectionId)).some((profile) => profile.ownerApp === appKey && (profile.mapping !== null || profile.shape !== null));
    },

    async startTest(entity, appKey, origin, by) {
      const keys = Object.keys(entity.pk);
      if (keys.length !== 1) return { ok: false, reason: 'not-payable' };
      const found = await deps.sources.table(entity.connectionId, entity.table);
      if (found === null) return { ok: false, reason: 'not-payable' };
      const profile = await payableProfilesRepo(deps.meta).byTable(entity.connectionId, found.table.id);
      if (profile === null || profile.ownerApp !== appKey || (profile.mapping === null && profile.shape === null)) return { ok: false, reason: 'not-payable' };
      const ref = { kind: profile.shape !== null ? ('shape' as const) : ('profile' as const), connectionId: entity.connectionId, tableName: found.table.id, rowKey: String(entity.pk[keys[0]!]) };
      // Read as every step of a test payment reads it: the app's switch is not asked (the shop is not live yet), everything else is.
      const payable = await resolvePayable(deps.sources, ref, { mode: 'test' });
      if (payable === null) return { ok: false, reason: 'not-payable' };
      if (payable.refusal !== null) {
        const code = payable.refusal.code;
        return { ok: false, reason: code === 'NOTHING_DUE' ? 'nothing-due' : code === 'NOT_NOW' ? 'not-now' : 'not-payable' };
      }
      // A public start's own link (beside the shop's, never in its place), in test mode.
      const minted = await mintLink(deps.meta, seal, { payable: ref, mode: 'test', createdBy: by, lifetimeMs: TEST_LINK_LIFETIME_MS, audience: 'public' }, (deps.now ?? Date.now)());
      return { ok: true, payUrl: payUrlOf(origin, minted.token) };
    },
  };
}
