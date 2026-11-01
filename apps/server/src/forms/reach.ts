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
