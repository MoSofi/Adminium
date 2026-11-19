// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE VISITOR BANNER'S ANSWERS — "Yes" and "Cookie choice" on a stranger's
 * own page (`views/visitor.ts`).
 *
 *   POST   /x/consent/visit    "Yes": a signed cookie carrying the yes (its visitor row comes with the first counted view)
 *   DELETE /x/consent/visit    withdraw ("Cookie choice", then "No"): the row and its visits go, the cookie is cleared
 *
 * "No" is never sent here: it is kept in the visitor's browser alone.
 *
 * ─── THE RULES IT KEEPS ────────────────────────────────────────────────────
 * - Same origin only: a browser's own page on this host asks (its `Origin`
 *   is this host, and `Sec-Fetch-Site`, where sent, says `same-origin`);
 *   another site's page, a form post from elsewhere, a known bot or script
 *   (`views/bots.ts`) or a prefetch is refused, and nothing is set. This is
 *   policy, not a boundary: a script can say what a browser says.
 * - So a "yes" writes nothing durable: it is a signed cookie alone
 *   (`views/visitor.ts`), and the visitor's row is written only with the
 *   first counted view of the install's own page that carries it, within an
 *   hour, capped per network address a day. A script that says yes a
 *   million times leaves a million cookies with itself and nothing here.
 * - Counted by network: the bucket by the IPv4 address or the IPv6 /64
 *   ({@link CONSENT_PER_ADDRESS_MINUTE}), and in this process by the /56 at
 *   three times and the /48 at ten times that, as the chat's caps count.
 * - A "yes" is taken only at "Per visitor" (the level read again within the
 *   last few seconds), only while the outside can reach the server (the
 *   forms door's own answer), only on the install's own addresses (its
 *   public address, a mapped pages host). Anything else is answered 404
 *   `not-asked`, and nothing is set.
 * - A stranger's door: a signed-in person's session is not read here
 *   (`../x-door/stranger.ts`), and the staff CSRF token is not asked for (the
 *   origin check above is this route's own), so "Yes" works for the owner
 *   trying their own page on the staff host.
 * - The cookie is never set in a frame on another site: it is `SameSite=Lax`,
 *   which a browser neither sends nor sets in a frame on another site, and
 *   the banner is drawn only on the install's own pages.
 * - A withdrawal works at every level: a visitor may always take a "yes"
 *   back, and the cookie goes whatever the server still holds.
 * - What a kept "yes" holds: the keyed hash of the cookie's value, the host,
 *   the moment and the banner's wording version. Never the address, the
 *   browser or the value itself.
 */
import { visitorsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { formsReach, type FormsReachFacts } from '../../forms/reach.js';
import { ipv6Network, rateAddress } from '../../public-api/limiter.js';
import { hostOf, normalizeHost } from '../../security/csrf.js';
import { tagRoutes } from '../../security/route-audience.js';
import { isKnownBot, isPrefetch } from '../../views/bots.js';
import type { TrackingLevel } from '../../views/counter.js';
import { bannerLocaleOf, bannerWords, clearVisitorCookie, newVisitor, ownPagesHost, pendingYes, setVisitorCookie, visitorProofOf, visitorSince } from '../../views/visitor.js';
import { xDoorHeaders } from '../x-door/headers.js';
import { strangerDoor } from '../x-door/stranger.js';

export interface XConsentDeps extends FormsReachFacts {
  meta: MetaDb;
  /** The visitor key (`views/visitor.ts` `visitorKey`). */
  key: Buffer;
  /** The level, read again at most a few seconds ago (`ViewCounter.levelNow`). */
  levelNow: () => Promise<TrackingLevel>;
  now?: () => number;
}

/** "Yes" and "Cookie choice" one network address (an IPv4 address, an IPv6 /64) may send in a minute: the bucket's. */
export const CONSENT_PER_ADDRESS_MINUTE = 30;
/** ...one IPv6 /56: three times that. */
export const CONSENT_PER_56_MINUTE = 3 * CONSENT_PER_ADDRESS_MINUTE;
/** ...one IPv6 /48: ten times that. */
export const CONSENT_PER_48_MINUTE = 10 * CONSENT_PER_ADDRESS_MINUTE;
/** The most networks the wider caps hold in a minute: past it the minute starts over. */
const NETWORKS_MAX = 50_000;

const yesBody = z.object({ language: z.string().max(20).optional() }).strict();

/**
 * Whether a request is a browser's own page on this host asking. The host is
 * compared alone, as the staff origin check compares it (`security/csrf.ts`):
 * behind a proxy that ends TLS and is not trusted (no `ADMINIUM_TRUST_PROXY`),
 * the request reads as `http` while the visitor's page is `https`. Where the
 * browser sends `Sec-Fetch-Site`, it still tells a page on another scheme,
 * port or site apart.
 */
export function sameOriginOf(request: Pick<FastifyRequest, 'headers' | 'host'>): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string') return false;
  const originHost = hostOf(origin);
  if (originHost === null || originHost !== normalizeHost(request.host)) return false;
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return false;
  // A known bot or script, or a prefetch, never answers the banner.
  return !isKnownBot(request.headers['user-agent']) && !isPrefetch(request.headers);
}

/** The /56 and /48 caps of one process: a minute from each network's first answer. */
function widerCaps(now: () => number): (ip: string) => boolean {
  const seen = new Map<string, { since: number; count: number }>();
  return (ip) => {
    const at = now();
    if (seen.size > NETWORKS_MAX) {
      for (const [network, one] of seen) if (at - one.since >= 60_000) seen.delete(network);
      if (seen.size > NETWORKS_MAX) seen.clear();
    }
    const nets: { network: string; max: number; held: { since: number; count: number } }[] = [];
    for (const [bits, max] of [[56, CONSENT_PER_56_MINUTE], [48, CONSENT_PER_48_MINUTE]] as const) {
      const network = ipv6Network(ip, bits);
      if (network === null) continue;
      const kept = seen.get(network);
      nets.push({ network, max, held: kept === undefined || at - kept.since >= 60_000 ? { since: at, count: 0 } : kept });
    }
    if (nets.some((one) => one.held.count >= one.max)) return false;
    for (const one of nets) seen.set(one.network, { since: one.held.since, count: one.held.count + 1 });
    return true;
  };
}

export function xConsentRoutes(deps: XConsentDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  const visitors = visitorsRepo(meta);
  const wider = widerCaps(now);
  const config = {
    rateLimitBucket: 'x-consent' as const,
    // Counted by network: an IPv6 address rotated within its /64 is one counter.
    rateLimitSubject: async (request: FastifyRequest) => `net:${rateAddress(request.ip)}`,
    // The origin check is this route's own; a signed-in person's session is not read here.
    csrf: 'origin' as const,
    audit: auditExempt('a stranger answering the visitor banner: the visitor row is the record; a stranger is not an actor the audit log names'),
  };

  return async (app) => {
    tagRoutes(app, 'public');
    strangerDoor(app);
    // Never framed, never cached, no referrer: the `/x/` doors' own last word.
    xDoorHeaders(app, { framed: () => false, websites: async () => [], previewing: () => false });

    app.post('/x/consent/visit', { config, schema: { hide: true, body: yesBody } }, async (request, reply) => {
      if (!sameOriginOf(request)) return reply.status(403).send({ state: 'refused' });
      if (!wider(request.ip)) return reply.status(429).send({ state: 'too-many' });
      if ((await deps.levelNow()) !== 'visitor' || (await formsReach(meta, deps, request)).state !== 'reachable' || !(await ownPagesHost(meta, request))) {
        return reply.status(404).send({ state: 'not-asked' });
      }
      // A browser that said yes already keeps its visitor (kept, or still waiting for its first view).
      const already = visitorProofOf(deps.key, request);
      if (already !== null) {
        if ((await visitors.find(already.id)) !== null) return { state: 'yes' };
        const since = await visitorSince(meta);
        if (since !== null && already.saidYesAt >= since && pendingYes(already, now())) return { state: 'yes' };
      }
      const banner = await bannerWords(meta, bannerLocaleOf(request.body.language));
      // Nothing is written here: the cookie carries the "yes" until a counted view makes its row.
      const made = newVisitor(deps.key, { at: now(), wordingVersion: banner.version });
      setVisitorCookie(request, reply, made.value);
      return { state: 'yes' };
    });

    app.delete('/x/consent/visit', { config, schema: { hide: true } }, async (request, reply) => {
      if (!sameOriginOf(request)) return reply.status(403).send({ state: 'refused' });
      const proof = visitorProofOf(deps.key, request);
      if (proof !== null) await visitors.forget(proof.id);
      clearVisitorCookie(request, reply);
      return { state: 'withdrawn' };
    });
  };
}
