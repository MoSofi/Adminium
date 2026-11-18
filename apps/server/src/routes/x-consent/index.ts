// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE VISITOR BANNER'S ANSWERS — "Yes" and "Cookie choice" on a stranger's
 * own page (`views/visitor.ts`).
 *
 *   POST   /x/consent/visit    "Yes": a random id, its cookie, and a visitor row with the proof
 *   DELETE /x/consent/visit    withdraw ("Cookie choice", then "No"): the row and its visits go, the cookie is cleared
 *
 * "No" is never sent here: it is kept in the visitor's browser alone.
 *
 * ─── THE RULES IT KEEPS ────────────────────────────────────────────────────
 * - Same origin only: a browser's own page on this host asks (its `Origin`
 *   is this host, and `Sec-Fetch-Site`, where sent, says `same-origin`);
 *   another site's page, a form post from elsewhere, or a script with no
 *   browser's marks is refused, and nothing is written. No human check: a
 *   "yes" spends nothing of the business's, and each costs a request in
 *   this route's own small bucket.
 * - A "yes" is taken only at "Per visitor", only while the outside can reach
 *   the server (the forms door's own answer), only on the install's own
 *   addresses (its public address, a mapped pages host). Anything else is
 *   answered 404 `not-asked`, and nothing is written or set.
 * - The cookie is never set in a frame on another site: it is `SameSite=Lax`,
 *   which a browser neither sends nor sets in a frame on another site, and
 *   the banner is drawn only on the install's own pages.
 * - A withdrawal works at every level: a visitor may always take a "yes"
 *   back, and the cookie goes whatever the server still holds.
 * - What the "yes" keeps: the keyed hash of the cookie's value, the host,
 *   the moment and the banner's wording version. Never the address, the
 *   browser or the value itself.
 */
import { visitorsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { formsReach, type FormsReachFacts } from '../../forms/reach.js';
import { tagRoutes } from '../../security/route-audience.js';
import type { TrackingLevel } from '../../views/counter.js';
import { bannerLocaleOf, bannerWords, clearVisitorCookie, newVisitor, ownPagesHost, setVisitorCookie, visitorIdOf } from '../../views/visitor.js';
import { xDoorHeaders } from '../x-door/headers.js';

export interface XConsentDeps extends FormsReachFacts {
  meta: MetaDb;
  /** The visitor key (`views/visitor.ts` `visitorKey`). */
  key: Buffer;
  /** The level as the counter holds it. */
  level: () => TrackingLevel;
  now?: () => number;
}

const yesBody = z.object({ language: z.string().max(20).optional() }).strict();

/** Whether a request is a browser's own page on this host asking. */
export function sameOriginOf(request: Pick<FastifyRequest, 'headers' | 'protocol' | 'host'>): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin !== `${request.protocol}://${request.host}`) return false;
  const site = request.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin';
}

export function xConsentRoutes(deps: XConsentDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  const visitors = visitorsRepo(meta);
  const config = {
    rateLimitBucket: 'x-consent' as const,
    audit: auditExempt('a stranger answering the visitor banner: the visitor row is the record; a stranger is not an actor the audit log names'),
  };

  return async (app) => {
    tagRoutes(app, 'public');
    // Never framed, never cached, no referrer: the `/x/` doors' own last word.
    xDoorHeaders(app, { framed: () => false, websites: async () => [], previewing: () => false });

    app.post('/x/consent/visit', { config, schema: { hide: true, body: yesBody } }, async (request, reply) => {
      if (!sameOriginOf(request)) return reply.status(403).send({ state: 'refused' });
      if (deps.level() !== 'visitor' || (await formsReach(meta, deps, request)).state !== 'reachable' || !(await ownPagesHost(meta, request))) {
        return reply.status(404).send({ state: 'not-asked' });
      }
      // A browser that said yes already keeps its visitor.
      const already = visitorIdOf(deps.key, request);
      if (already !== null && (await visitors.find(already)) !== null) return { state: 'yes' };
      const banner = await bannerWords(meta, bannerLocaleOf(request.body.language));
      const made = newVisitor(deps.key);
      await visitors.create({ id: made.id, host: request.host.toLowerCase().slice(0, 253), saidYesAt: now(), wordingVersion: banner.version });
      setVisitorCookie(request, reply, made.value);
      return { state: 'yes' };
    });

    app.delete('/x/consent/visit', { config, schema: { hide: true } }, async (request, reply) => {
      if (!sameOriginOf(request)) return reply.status(403).send({ state: 'refused' });
      const id = visitorIdOf(deps.key, request);
      if (id !== null) await visitors.forget(id);
      clearVisitorCookie(request, reply);
      return { state: 'withdrawn' };
    });
  };
}
