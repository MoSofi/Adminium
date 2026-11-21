// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record's live pay link, for a printed document (an invoice's "Or pay
 * online" line and its code to scan).
 *
 * Only when the record can be paid online right now: it is payable with
 * something due, live payments are on, and customers can reach the pay
 * address. The record's current live link is used when it still opens; a new
 * one is made only when there is none, so drawing a document never retires a
 * link a customer was already sent. Anything else is no link, and the slot
 * stays empty: a document never prints a link that would not open.
 */
import { paymentCountersRepo, paymentLinksRepo, payableProfilesRepo, type MetaDb, type PayableRef, type RecordRef } from '@adminium/meta';

import { LINK_FAILURES_TO_LOCK, linkFailBucket } from './checkout.js';
import { linkOpens, linkSealFromSecret, mintLink, payAddress, payReachable, payUrl } from './links.js';
import { resolvePayable, type PayableSources } from './payables.js';

export interface PayLinkForDeps {
  meta: MetaDb;
  sources: PayableSources;
  secret: string;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  /** Whether live payments are on for any service. */
  liveOn: () => Promise<boolean>;
  now?: () => number;
}

/** A public start's own link lasts a day: a customer pays at checkout, or starts again. */
export const PUBLIC_LINK_LIFETIME_MS = 24 * 3_600_000;

/** A record's live pay link, and the moment it stops opening (ms since the epoch). */
export interface PayLinkWithExpiry {
  url: string;
  expiresAt: number;
}

export function createPayLinkFor(deps: PayLinkForDeps): (entity: RecordRef) => Promise<string | null> {
  const linkFor = createPayLinkWithExpiryFor(deps);
  return async (entity) => (await linkFor(entity))?.url ?? null;
}

/**
 * The same link, with the moment it stops opening: what a printed document
 * says under it ("Works until …"). The link is the record's current one, so
 * its expiry is that link's own, never a fresh 30 days from the print.
 */
export function createPayLinkWithExpiryFor(deps: PayLinkForDeps): (entity: RecordRef) => Promise<PayLinkWithExpiry | null> {
  const linkFor = createLinkFor(deps);
  return async (entity) => {
    const made = await linkFor(entity, 'staff');
    return made === null || made === 'locked' ? null : made;
  };
}

/**
 * A public start's link: the record's own public link (current beside the
 * one the shop sent, never in its place) while it opens, else a new one. A
 * public link locked by its declines is not replaced: `locked`, so a card
 * tester cannot buy a fresh five declines by starting again.
 */
export function createPublicLinkFor(deps: PayLinkForDeps): (entity: RecordRef, beside?: boolean) => Promise<string | 'locked' | null> {
  const linkFor = createLinkFor(deps);
  return async (entity, beside = false) => {
    const made = await linkFor(entity, 'public', beside);
    return made === null || made === 'locked' ? made : made.url;
  };
}

function createLinkFor(deps: PayLinkForDeps): (entity: RecordRef, audience: 'staff' | 'public', beside?: boolean) => Promise<PayLinkWithExpiry | 'locked' | null> {
  const seal = linkSealFromSecret(deps.secret);
  return async (entity, audience, beside = false) => {
    const at = (deps.now ?? Date.now)();
    const keys = Object.keys(entity.pk);
    if (keys.length !== 1) return null;
    const found = await deps.sources.table(entity.connectionId, entity.table);
    if (found === null) return null;
    const tableName = found.table.id;
    let kind: PayableRef['kind'] | null = null;
    if ((await deps.sources.shapeOf(entity.connectionId, tableName)) !== null) kind = 'shape';
    else {
      const profile = await payableProfilesRepo(deps.meta).byTable(entity.connectionId, tableName);
      if (profile !== null && profile.enabled && profile.mapping !== null) kind = 'profile';
    }
    if (kind === null) return null;
    const ref: PayableRef = { kind, connectionId: entity.connectionId, tableName, rowKey: String(entity.pk[keys[0]!]) };
    const payable = await resolvePayable(deps.sources, ref);
    if (payable === null || payable.refusal !== null) return null;
    if (!(await deps.liveOn())) return null;
    const reach = await payReachable(deps.meta, { networkFeatures: deps.networkFeatures, desktop: deps.desktop, trustProxy: deps.trustProxy, forwarded: false });
    const address = await payAddress(deps.meta);
    if (reach.state !== 'reachable' || address === null) return null;
    const current = await paymentLinksRepo(deps.meta).currentFor(ref, audience);
    if (current !== null && current.mode === 'live' && linkOpens(current, at)) {
      if (audience === 'public' && (await paymentCountersRepo(deps.meta).read(linkFailBucket(current.id), at)) >= LINK_FAILURES_TO_LOCK) return 'locked';
      // The same link, opened this time from a frame or not: its ending follows the last start.
      if (audience === 'public' && (current.beside === true) !== beside) await paymentLinksRepo(deps.meta).setBeside(current.id, beside);
      return { url: payUrl(address, seal.unseal(current.tokenSealed)), expiresAt: current.expiresAt };
    }
    const minted = await mintLink(deps.meta, seal, { payable: ref, mode: 'live', createdBy: null, ...(audience === 'public' ? { audience, beside, lifetimeMs: PUBLIC_LINK_LIFETIME_MS } : {}) }, at);
    return { url: payUrl(address, minted.token), expiresAt: minted.link.expiresAt };
  };
}
