// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Can visitors reach your public pages?" — the ONE answer the forms door
 * and the Privacy page's reach card both read.
 *
 * The pay page's own check (`payments/reachability.ts`), about this server's
 * public address (`system.publicOrigin`), with `proxy-hidden` read from the
 * request in hand: behind a proxy that is not trusted every stranger would
 * look like the proxy, and a form's limits count strangers by address. The
 * door serves nothing while the answer is not `reachable`; the card says
 * which state it is in and what fixes it. Asking both through here keeps the
 * card from saying "reachable" while the door refuses.
 *
 * The card asks with the staff member's own request, and that request can
 * only speak for itself: staff who reach the server directly look exactly
 * like a server with no proxy, while strangers may come through one the
 * server does not trust and be refused (`proxy-hidden`). {@link proxyUncheckedOf}
 * says when the card cannot tell, so it words that doubt under "reachable".
 */
import type { MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import { storedPublicOrigin } from '../email/door-reach.js';
import { reachability, type Reachability } from '../payments/reachability.js';

/** Facts of this server the check reads. */
export interface FormsReachFacts {
  /** `ADMINIUM_NETWORK_FEATURES`. */
  networkFeatures: boolean;
  /** `ADMINIUM_RUNTIME === 'desktop'`. */
  desktop: boolean;
  /** `ADMINIUM_TRUST_PROXY`. */
  trustProxy: boolean;
}

/** Whether the request came through a proxy: it carries a header one adds. */
export function forwardedOf(request: Pick<FastifyRequest, 'headers'>): boolean {
  return request.headers['x-forwarded-for'] !== undefined || request.headers['forwarded'] !== undefined;
}

/** The answer for this request, with the public address it is about. */
export async function formsReach(meta: MetaDb, facts: FormsReachFacts, request: Pick<FastifyRequest, 'headers'>): Promise<Reachability> {
  const publicOrigin = await storedPublicOrigin(meta);
  return reachability({ networkFeatures: facts.networkFeatures, desktop: facts.desktop, trustProxy: facts.trustProxy, forwarded: forwardedOf(request), publicOrigin });
}

/**
 * Whether this request cannot say how strangers come in: the server trusts no
 * proxy (`ADMINIUM_TRUST_PROXY` off) and the request came with no header a
 * proxy adds. Strangers coming through a proxy would then be refused while
 * this request is answered "reachable". False behind a trusted proxy, and
 * when the request itself came through one (the answer is then `proxy-hidden`).
 */
export function proxyUncheckedOf(facts: Pick<FormsReachFacts, 'trustProxy'>, request: Pick<FastifyRequest, 'headers'>): boolean {
  return !facts.trustProxy && !forwardedOf(request);
}
