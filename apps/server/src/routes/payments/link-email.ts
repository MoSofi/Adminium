// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/payments/links/:id/email` — the Payment panel's "Email pay
 * link": the record's current pay link, sent to the customer address the
 * record holds, in the shop's name.
 *
 * Who may: whoever may make that link (the same check, handed in by the
 * links routes). Only a live link that still works is sent; a test link opens
 * for staff only, so a customer could never use one. A payable is emailed at
 * most a few times an hour, counted in meta so every process counts the same.
 * The answer says the email is on its way, never that it arrived: it goes
 * through the outbox, which may still fail.
 */
import { paymentCountersRepo, paymentLinksRepo, type MetaDb, type PayableRef } from '@adminium/meta';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import type { EmailLogger } from '../../email/send.js';
import { ForbiddenError, NotFoundError, RateLimitedError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { sendPayLinkEmail } from '../../payments/emails.js';
import { linkOpens, linkSealFromSecret, payAddress, payUrl } from '../../payments/links.js';
import type { PayableSources } from '../../payments/payables.js';

export interface PaymentLinkEmailDeps {
  meta: MetaDb;
  sources: PayableSources;
  secret: string;
  /** The links routes' own check: may this person make (and so send) this payable's link? Throws when not. */
  assertMayLink: (request: FastifyRequest, payable: PayableRef) => Promise<void>;
  logger?: EmailLogger;
}

/** Pay-link emails one payable may get in an hour. */
export const LINK_EMAILS_PER_HOUR = 5;

const idParams = z.object({ id: z.string().min(1).max(64) });
const reply = z.object({ data: z.object({ queued: z.literal(true), to: z.string() }) });

function requirePerson(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError('Pay links are emailed by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  }
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

/** A short, fixed-width name for a payable in a counter's bucket. */
function payableBucket(payable: PayableRef): string {
  return createHash('sha256').update(JSON.stringify([payable.kind, payable.connectionId, payable.tableName, payable.rowKey])).digest('hex').slice(0, 24);
}

export function paymentLinkEmailRoutes(deps: PaymentLinkEmailDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const seal = linkSealFromSecret(deps.secret);
  const links = paymentLinksRepo(meta);
  const counters = paymentCountersRepo(meta);

  return async (app) => {
    app.post(
      '/payments/links/:id/email',
      { config: { audit: audited('rbac') }, schema: { params: idParams, response: { 200: reply } } },
      async (request) => {
        requirePerson(request);
        const link = await links.byId(request.params.id);
        if (link === null) throw new NotFoundError('No such pay link.');
        await deps.assertMayLink(request, link.payable);
        if (!linkOpens(link, app.rbac.now())) throw new ValidationFailedError('This pay link no longer works. Make a new one first.', { reason: 'link-gone' });
        if (link.mode !== 'live') throw new ValidationFailedError('A test link opens only for staff, so it is not emailed to the customer.', { reason: 'test-link' });
        const address = await payAddress(meta);
        if (address === null) throw new ValidationFailedError('Customers cannot reach the pay address, so no pay link can be sent.', { reason: 'no-pay-address' });

        if ((await counters.hit(`link-email:${payableBucket(link.payable)}`, app.rbac.now())) > LINK_EMAILS_PER_HOUR) {
          throw new RateLimitedError('This pay link was emailed several times in the last hour. Try again later.');
        }

        const outcome = await sendPayLinkEmail(
          { meta, sources: deps.sources, secret: deps.secret, ...(deps.logger === undefined ? {} : { logger: deps.logger }), now: () => app.rbac.now() },
          { link, url: payUrl(address, seal.unseal(link.tokenSealed)) },
        );
        if (!outcome.sent) {
          const words: Record<typeof outcome.reason, string> = {
            'no-customer-email': 'This record has no customer email address to send the link to.',
            'not-payable': 'Nothing can be paid on this record right now.',
            'email-off': 'Email is not set up on this server, so the link cannot be sent.',
            'template-off': 'The pay link email is switched off in Email templates.',
          };
          throw new ValidationFailedError(words[outcome.reason], { reason: outcome.reason });
        }
        await app.rbac.audit(request, {
          category: 'payments',
          action: 'payments.link.emailed',
          changes: { after: { linkId: link.id, kind: link.payable.kind, connectionId: link.payable.connectionId, tableName: link.payable.tableName, rowKey: link.payable.rowKey, jobId: outcome.jobId } },
        });
        return { data: { queued: true as const, to: outcome.to } };
      },
    );
  };
}
