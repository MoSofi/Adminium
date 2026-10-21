// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/payments/webhook/:provider/:mode` — where a payment service
 * calls back.
 *
 * Its own encapsulated plugin, because it needs the body as the exact bytes
 * that arrived: a signature is checked over them, and a parser that read the
 * JSON and wrote it out again would break every signature. No session is
 * read, so CSRF is not in play; nothing is audited per delivery (the events
 * table is the record). What it does is `payments/webhook.ts`.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { receiveWebhook, type WebhookDeps } from '../../payments/webhook.js';

/** The largest delivery accepted. Stripe's and PayPal's events are a few kilobytes. */
export const WEBHOOK_BODY_LIMIT = 256 * 1024;

const webhookParams = z.object({ provider: z.string().max(80), mode: z.string().max(8) });

export function paymentWebhookRoutes(deps: WebhookDeps): FastifyPluginAsync {
  return async (app) => {
    // Every content type, kept as text: the signature is over these bytes.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: WEBHOOK_BODY_LIMIT }, (_request, body, done) => {
      done(null, body);
    });

    app.post<{ Params: { provider: string; mode: string } }>(
      '/payments/webhook/:provider/:mode',
      {
        config: {
          rateLimitBucket: 'payment-webhook',
          csrf: 'exempt',
          audit: auditExempt('a payment service calling back; the stored event is the record, and a bad signature is counted, not audited one row each'),
        },
        // Typed for the boot check, kept out of the public spec: only a payment service calls it.
        schema: { hide: true, params: webhookParams },
      },
      async (request, reply) => {
        const { provider, mode } = request.params;
        if (!/^[a-z][a-z0-9-]{1,79}$/.test(provider)) return reply.status(404).send({ received: false });
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
        const outcome = await receiveWebhook(deps, { provider, mode, rawBody: typeof request.body === 'string' ? request.body : '', headers });
        if (outcome.status === 200) return reply.status(200).send({ received: true });
        return reply.status(outcome.status).send({ received: false });
      },
    );
  };
}
