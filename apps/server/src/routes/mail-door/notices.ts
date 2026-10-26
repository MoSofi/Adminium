// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/email/notices/:service/:token` — where a mail service tells
 * this server, after the fact, that a mail bounced, was marked as spam, or
 * that its reader unsubscribed through the service's own link.
 *
 * Its own encapsulated plugin, because the body is needed as the exact bytes
 * that arrived, whatever their type: SendGrid signs them, and Amazon SNS
 * posts JSON as `text/plain`. No session is read, so CSRF is not in play.
 *
 * What it does, in order:
 *   1. the door must be open (`door.ts`: the public address reachable),
 *      else 503 and nothing read, so the service keeps the notice and
 *      tries again later;
 *   2. the endpoint for `<service>/<token>` (`configFor`), and the service's
 *      own reader proves the call (`email/notices/`): a forged call is
 *      answered as the reader says (`noticeAnswer`) and writes nothing;
 *   3. each permanent event goes on the do-not-email list, with its reason:
 *      a hard bounce `bounce`, a spam report `spam`, the service's own
 *      unsubscribe `relay-unsubscribe`. A soft bounce writes nothing;
 *   4. the endpoint counts the notice (`noticed`), and Amazon SNS's answered
 *      handshake marks it confirmed (`confirmed`).
 * A write that fails answers 503 and forgets the call in the replay guard,
 * so the service's retry is taken rather than refused as a replay.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { looksLikeAddress, type ConsentService, type StopReason } from '../../consent/index.js';
import { createNoticeEndpoints } from '../../email/notices/endpoints.js';
import { createNoticeReader, createReplayGuard, noticeAnswer, type NoticeEvent, type NoticeService, type ReplayGuard, type SnsFetch } from '../../email/notices/index.js';
import { createMailDoor, type MailDoorDeps } from './door.js';

/** The largest notice taken: SendGrid batches many events in one post. */
export const NOTICE_BODY_LIMIT = 1024 * 1024;

/** How each service is named where an entry says where it came from. */
const SERVICE_NAMES: Readonly<Record<NoticeService, string>> = {
  ses: 'Amazon SES',
  postmark: 'Postmark',
  mailgun: 'Mailgun',
  brevo: 'Brevo',
  sendgrid: 'SendGrid',
  other: 'Another service',
};

const noticeParams = z.object({ service: z.string().max(40), token: z.string().max(200) });

export interface MailNoticeDeps extends MailDoorDeps {
  consent: ConsentService;
  /** Test seam: the GET to Amazon SNS (its certificate, its handshake). */
  snsFetch?: SnsFetch | undefined;
}

/** The stop-list reason for an event the service says is for good. */
function reasonOf(event: NoticeEvent): StopReason {
  return event.kind === 'complaint' ? 'spam' : event.kind === 'unsubscribe' ? 'relay-unsubscribe' : 'bounce';
}

/**
 * The replay guard, with the calls each request claimed kept beside it: when
 * that request's writes fail, it lets go of them again. A reader claims in
 * the request's own async context, so the keys land in that request's list.
 */
function trackedReplays(): { guard: ReplayGuard; scope: AsyncLocalStorage<string[]> } {
  const inner = createReplayGuard();
  const scope = new AsyncLocalStorage<string[]>();
  return {
    scope,
    guard: {
      claim(key, until) {
        const taken = inner.claim(key, until);
        if (taken) scope.getStore()?.push(key);
        return taken;
      },
      release(key) {
        inner.release(key);
      },
    },
  };
}

export async function writeNoticeEvents(consent: ConsentService, service: NoticeService, events: readonly NoticeEvent[], now: number): Promise<number> {
  let written = 0;
  for (const event of events) {
    // A soft bounce stays off the list; so does an address too long for it to keep.
    if (!event.permanent || !looksLikeAddress(event.address)) continue;
    const { added } = await consent.stop.add({ address: event.address, reason: reasonOf(event), origin: SERVICE_NAMES[service], at: event.at ?? now });
    if (added) written += 1;
  }
  return written;
}

export function mailNoticeRoutes(deps: MailNoticeDeps): FastifyPluginAsyncZod {
  return async (app) => {
    const meta: MetaDb = deps.meta;
    const now = deps.now ?? Date.now;
    const door = createMailDoor(deps);
    const endpoints = createNoticeEndpoints({ meta, secret: deps.secret, now });
    const replays = trackedReplays();
    const reader = createNoticeReader({ now, replays: replays.guard, ...(deps.snsFetch === undefined ? {} : { snsFetch: deps.snsFetch }) });

    // Every content type, kept as the exact bytes: SendGrid's signature is over them.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: NOTICE_BODY_LIMIT }, (_request, body, done) => {
      done(null, body);
    });

    app.post(
      '/email/notices/:service/:token',
      {
        config: {
          rateLimitBucket: 'mail-notice',
          csrf: 'exempt',
          audit: auditExempt('a mail service calling back: each address it reports is a do-not-email entry, which is the record, and a refused call writes nothing'),
        },
        // Typed for the boot check, kept out of the public spec: only a mail service calls it.
        schema: { hide: true, params: noticeParams },
      },
      async (request, reply) => {
        void reply.header('cache-control', 'no-store');
        if (!(await door.reachable(request))) return reply.code(503).send({ received: false });
        const { service, token } = request.params;
        const endpoint = await endpoints.configFor(service, token);
        if (endpoint === null) return reply.code(401).send({ received: false });
        const claimed: string[] = [];
        const verdict = await replays.scope.run(claimed, () =>
          reader.read({ body: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0), headers: request.headers, pathToken: token }, endpoint),
        );
        if (!verdict.genuine) return reply.code(noticeAnswer(verdict)).send({ received: false });
        try {
          await writeNoticeEvents(deps.consent, endpoint.service, verdict.events, now());
          if (verdict.reply?.kind === 'subscription-confirmed') await endpoints.confirmed(endpoint.id);
          await endpoints.noticed(endpoint.id);
        } catch (error) {
          // Not taken after all: the service's retry must not be refused as a replay.
          for (const key of claimed) replays.guard.release(key);
          request.log.error({ err: error, service: endpoint.service }, 'mail notice: the events could not be written');
          return reply.code(503).send({ received: false });
        }
        return reply.code(200).send({ received: true });
      },
    );
  };
}
