// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/inbound/<channel>/:source/:token`: where a provider hands this
 * server something a customer sent, or a report about something it sent.
 *
 * Its own encapsulated plugin, because a signature is over the exact bytes that
 * arrived. No session is read, so CSRF is not in play. One route per channel,
 * so each channel has its own body limit.
 *
 * The order, which is the whole point of this file:
 *   1. the door must be open (the public address reachable), else 503 and
 *      nothing read, so the provider keeps the event;
 *   2. the source must exist (404) and be able to check a proof now (503);
 *   3. the path token, in constant time (401);
 *   4. the channel's proof over the exact bytes: a forged call writes nothing;
 *   5. store once. If it cannot be stored safely the answer is 503, never a
 *      200 that drops it;
 *   6. only then answer. All parsing and acting happens in the queued job.
 *
 * The address a signature is checked against is built from the STORED public
 * address, because a proxy changes what the request says about itself.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { auditExempt } from '../audit/coverage.js';
import { deriveKey } from '../config/secrets.js';
import { tagRoutes } from '../security/route-audience.js';
import type { InboundCore } from './core.js';
import { INBOUND_SOURCE_MAX, type InboundChannel } from './types.js';

/** Where the routes are mounted, and so what a provider is given. */
export const INBOUND_API_PREFIX = '/api/v1';
export const INBOUND_PATH = '/inbound';

const TOKEN_SALT = 'adminium:inbound-door:v1';
const params = z.object({ source: z.string().max(INBOUND_SOURCE_MAX), token: z.string().max(200) });

/**
 * The path token of one source at one account. Derived rather than stored:
 * a change of account changes the address, so the old one stops working, and
 * nothing needs a table. A changed server secret changes it too, which is when
 * the provider key has to be pasted again anyway.
 */
export function inboundToken(secret: string, channel: string, source: string, account: string): string {
  return createHmac('sha256', deriveKey(secret, TOKEN_SALT)).update(`${channel}\n${source}\n${account}`).digest('base64url');
}

/** The full address a provider is given, on the stored public address. It holds the token: show it only to whoever manages the channel. */
export function inboundAddress(origin: string, channel: string, source: string, token: string): string {
  return `${origin}${INBOUND_API_PREFIX}${INBOUND_PATH}/${channel}/${source}/${token}`;
}

function sameToken(given: string, expected: string): boolean {
  const a = createHmac('sha256', TOKEN_SALT).update(given).digest();
  const b = createHmac('sha256', TOKEN_SALT).update(expected).digest();
  return timingSafeEqual(a, b);
}

export interface InboundRoutesDeps {
  core: InboundCore;
  channels: readonly InboundChannel[];
  /** `ADMINIUM_SECRET`. */
  secret: string;
  now?: (() => number) | undefined;
}

export function inboundRoutes(deps: InboundRoutesDeps): FastifyPluginAsync {
  return async (app) => {
    // A provider calling back: the instance's own business with a service it signed up with, kept while public pages are hidden.
    tagRoutes(app, 'staff');
    const now = deps.now ?? Date.now;

    // Every content type, kept as the exact bytes. The limit is each route's own.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    for (const channel of deps.channels) {
      app.post<{ Params: { source: string; token: string } }>(
        `${INBOUND_PATH}/${channel.channel}/:source/:token`,
        {
          bodyLimit: channel.bodyLimit,
          config: {
            rateLimitBucket: 'inbound-door',
            csrf: 'exempt',
            audit: auditExempt('a provider calling back: the stored event is the record, and a refused call writes nothing'),
          },
          // Typed for the boot check, kept out of the public spec: only a provider calls it.
          schema: { hide: true, params },
        },
        async (request, reply) => {
          void reply.header('cache-control', 'no-store');
          const refuse = (code: number) => reply.code(code).send({ received: false });
          const { source, token } = request.params;
          try {
            const reach = await channel.reach();
            if (!reach.open || reach.origin === null) return await refuse(503);

            const account = await channel.account(source);
            if (account.state === 'unknown') return await refuse(404);
            if (account.state === 'unavailable') return await refuse(503);
            if (!sameToken(token, inboundToken(deps.secret, channel.channel, source, account.account))) return await refuse(401);

            const proof = await channel.prove({
              source,
              account: account.account,
              body: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
              headers: request.headers,
              publicUrl: inboundAddress(reach.origin, channel.channel, source, token),
              now: now(),
            });
            if (!proof.genuine) return await refuse(proof.answer);

            await deps.core.accept({ channel: channel.channel, account: account.account, source, events: proof.events });
            if (proof.reply !== undefined) return await reply.code(200).type(proof.reply.contentType).send(proof.reply.body);
            return await reply.code(200).send({ received: true });
          } catch {
            // Nothing from the failure is logged: it could quote what was being stored.
            request.log.error({ channel: channel.channel, source }, 'inbound: the event could not be stored');
            return refuse(503);
          }
        },
      );
    }
  };
}
