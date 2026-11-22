// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/shipping/webhook/:installId?token=…` — where a carrier calls
 * back about a parcel.
 *
 * Its own encapsulated plugin, as payments' is, with the body kept as text and
 * limited in size. No session is read, so CSRF is not in play. The token in
 * the address is the gate, and `token` is a query parameter the log scrubber
 * already removes. Nothing is audited per delivery: the event row is the
 * record. What it does is `shipping/tracking.ts`.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { tagRoutes } from '../../security/route-audience.js';
import { receiveTrackingWebhook, type TrackingWebhookDeps } from '../../shipping/tracking.js';

/** The largest delivery accepted. A tracking event with its full history is a few kilobytes. */
export const SHIPPING_WEBHOOK_BODY_LIMIT = 256 * 1024;

const params = z.object({ installId: z.string().max(64) });
const query = z.object({ token: z.string().max(128).optional() });

export function shippingWebhookRoutes(deps: TrackingWebhookDeps): FastifyPluginAsync {
  return async (app) => {
    // A carrier calling back: the instance's own business with a service it signed up with.
    tagRoutes(app, 'staff');
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: SHIPPING_WEBHOOK_BODY_LIMIT }, (_request, body, done) => {
      done(null, body);
    });

    app.post<{ Params: { installId: string }; Querystring: { token?: string } }>(
      '/shipping/webhook/:installId',
      {
        config: {
          rateLimitBucket: 'shipping-webhook',
          csrf: 'exempt',
          audit: auditExempt('a carrier calling back; the stored event is the record, and a wrong token is counted, not audited one row each'),
        },
        // Typed for the boot check, kept out of the public spec: only a carrier calls it.
        schema: { hide: true, params, querystring: query },
      },
      async (request, reply) => {
        const outcome = await receiveTrackingWebhook(deps, {
          installId: request.params.installId,
          token: request.query.token ?? '',
          rawBody: typeof request.body === 'string' ? request.body : '',
        });
        return reply.status(outcome.status).send({ received: outcome.status === 200 });
      },
    );
  };
}
