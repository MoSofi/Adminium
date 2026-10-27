// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Can a mail's reader reach the mail door?" — the ONE answer both sides use.
 *
 * A marketing mail's unsubscribe link, its RFC 8058 one-click and its click
 * links are written on this server's public address (`system.publicOrigin`)
 * and lead to the mail door (`/m/`). The rule this keeps: the door is never
 * shut while mail that links to it may go out. So the send side (refusing a
 * marketing send with `no-public-address`), the settings' sender check and the
 * door itself (opening its pages, taking a mail service's notice) all ask this
 * function, and cannot drift apart.
 *
 * It reads the same facts as the pay page (`payments/reachability.ts`): network
 * features on, not the desktop app, a public https address. It never asks
 * about the request in hand: the pay page's `proxy-hidden` (a proxy forwards
 * requests but `ADMINIUM_TRUST_PROXY` is off) matters there because a checkout
 * needs each customer's own network address. The door needs none: the signed
 * link is its gate, whoever's address the request seems to come from.
 */
import { settingsRepo, type MetaDb } from '@adminium/meta';

import { reachability, type Reachability } from '../payments/reachability.js';
import { normalizePublicOrigin } from '../security/public-origin.js';

/** Facts of this server the check reads. */
export interface MailDoorReachFacts {
  /** `ADMINIUM_NETWORK_FEATURES`. */
  networkFeatures: boolean;
  /** `ADMINIUM_RUNTIME === 'desktop'`. */
  desktop: boolean;
  /** `ADMINIUM_TRUST_PROXY`: carried for the shared check; the door's answer does not depend on it. */
  trustProxy: boolean;
}

/** This server's public address as stored, normalised; null when none is set or it is not an address. */
export async function storedPublicOrigin(meta: MetaDb): Promise<string | null> {
  const stored = await settingsRepo(meta).get('system.publicOrigin');
  return typeof stored === 'string' ? normalizePublicOrigin(stored) : null;
}

/** The answer for a public address already read: see the header. */
export function mailDoorReachOf(facts: MailDoorReachFacts, publicOrigin: string | null): Reachability {
  return reachability({ networkFeatures: facts.networkFeatures, desktop: facts.desktop, trustProxy: facts.trustProxy, publicOrigin, forwarded: false });
}

/** Whether the door is open now, with the public address the answer is about. */
export async function mailDoorReach(meta: MetaDb, facts: MailDoorReachFacts): Promise<{ origin: string | null; open: boolean }> {
  const origin = await storedPublicOrigin(meta);
  return { origin, open: mailDoorReachOf(facts, origin).state === 'reachable' };
}
