// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE MAIL DOOR — the pages and calls a marketing mail's links lead to, for
 * whoever holds the mail. Always registered, on every install and every host
 * (a customer domain included): an unsubscribe link must work whether or not
 * the public API is open (the public door is a separate setting).
 *
 *   GET  /m/u/<token>           the unsubscribe page: two buttons, never acts on its own
 *   POST /m/u/<token>           the page's form (`act=one|all`, optional `why`), and RFC
 *                               8058's one-click (`List-Unsubscribe=One-Click`, posted to the
 *                               same link the mail's header names): withdraws the purpose
 *   GET  /m/l/<token>           a counted click link: to the web address it signs, and nowhere else
 *   GET  /m/…                   anything else (`/m/c/` is kept for the sign-up confirm page):
 *                               "This page isn't available"
 *
 * ─── THE RULES IT KEEPS ────────────────────────────────────────────────────
 * - Every request asks first whether the outside can reach this server
 *   (`door.ts`), the very check a marketing send makes before it goes
 *   (`email/door-reach.ts`), so the door is open whenever mail linking to it
 *   may leave, a request through an untrusted proxy included. When it
 *   cannot, every page says "This page isn't available" and nothing is
 *   written.
 * - A GET never changes anything: link scanners open every link in a mail.
 * - A link that is not this install's, or was changed by one byte, shows
 *   "This link doesn't work" with the business's address; never an error.
 * - The pages run no script and carry a policy that allows none
 *   (`page.ts`); nothing is cached, and no referrer leaves.
 * - Form bodies are parsed in this plugin only: `application/x-www-form-urlencoded`
 *   (the page's forms, Gmail's one-click) and `multipart/form-data` (what
 *   RFC 8058 suggests a one-click send). The server takes neither anywhere
 *   else (it answers 415).
 * - No session is read: a staff member's cookie does not change what the
 *   page does (CSRF is moot without one; the token is the gate).
 */
import { createHash } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { AddressKeysLockedError } from '../../consent/index.js';
import { MAIL_DOOR_PREFIX } from '../../plugins/surfaces.js';
import type { UnsubscribeClaim } from '../../email/unsubscribe-token.js';
import { createMailDoor, type MailDoor, type MailDoorDeps, type UnsubscribeAction } from './door.js';
import { renderMailDoorPage, UNSUBSCRIBE_REASONS, type MailDoorView, type UnsubscribeReason } from './page.js';

export { createMailDoor, type MailDoor, type MailDoorDeps } from './door.js';


/** The largest form body taken: two short fields. */
const FORM_BODY_LIMIT = 4 * 1024;

/**
 * The token is the rest of the path. A wildcard, not a `:token` parameter:
 * Fastify refuses a parameter longer than 100 characters (414), and a token
 * carries a sealed address, often 250 or more.
 */
const tokenParams = z.object({ '*': z.string().max(4096) });

/** The token from the path; one with a slash (no token has one) reads as none. */
function tokenOf(params: { '*': string }): string {
  return params['*'].includes('/') ? '' : params['*'];
}

/** A form body, as the plugin's parser gives it. */
type FormBody = Record<string, string>;

function formOf(body: unknown): FormBody {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as FormBody) : {};
}

/**
 * Whether a one-click POST carries RFC 8058's `List-Unsubscribe=One-Click`:
 * a form field, or the same in a multipart or plain-text body.
 */
export function asksOneClick(body: unknown): boolean {
  if (typeof body === 'string') {
    if (/^\s*List-Unsubscribe=One-Click\s*$/.test(body)) return true;
    return /name="List-Unsubscribe"\r?\n(?:[^\r\n]+\r?\n)*\r?\nOne-Click\r?\n/.test(body);
  }
  return formOf(body)['List-Unsubscribe'] === 'One-Click';
}

export function mailDoorRoutes(deps: MailDoorDeps): FastifyPluginAsyncZod {
  return async (app) => {
    const door: MailDoor = createMailDoor(deps);

    // Form bodies, for this plugin's routes only: the page's own forms, and Gmail's one-click.
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: FORM_BODY_LIMIT }, (_request, body, done) => {
      const fields: FormBody = {};
      for (const [name, value] of new URLSearchParams(typeof body === 'string' ? body : body.toString('utf8'))) {
        if (!(name in fields)) fields[name] = value;
      }
      done(null, fields);
    });
    // RFC 8058's suggested encoding for the one-click POST, kept as text: only its one field is looked for.
    app.addContentTypeParser('multipart/form-data', { parseAs: 'string', bodyLimit: FORM_BODY_LIMIT }, (_request, body, done) => {
      done(null, body);
    });

    /** Draws a page in the reader's language and sends it, with its own policy, uncached. */
    async function send(request: FastifyRequest, reply: FastifyReply, view: MailDoorView, status: number, claim: UnsubscribeClaim | null): Promise<FastifyReply> {
      const locale = await door.language(request, claim);
      const { t, lang } = await door.translator(locale);
      const path = request.url.split('?')[0] ?? request.url;
      const { html, policy } = renderMailDoorPage({ view, business: await door.business(), lang, accent: await door.accent(), path, t });
      return reply
        .code(status)
        .header('content-type', 'text/html; charset=utf-8')
        .header('content-security-policy', policy)
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-robots-tag', 'noindex')
        .send(html);
    }

    /** "This page isn't available": the door is shut here, or there is nothing at this address. */
    const unavailable = (request: FastifyRequest, reply: FastifyReply, status = 404) => send(request, reply, { kind: 'unavailable' }, status, null);

    /**
     * Runs a page's work; a store whose keys cannot be read (the server's
     * secret was changed without carrying them over) answers "not available"
     * with a 503 rather than a guess.
     */
    async function guarded(request: FastifyRequest, reply: FastifyReply, work: () => Promise<FastifyReply>): Promise<FastifyReply> {
      try {
        return await work();
      } catch (error) {
        if (error instanceof AddressKeysLockedError) {
          request.log.error({ err: error }, 'mail door: the address keys cannot be read with this server’s secret');
          return unavailable(request, reply, 503);
        }
        throw error;
      }
    }

    /**
     * What the unsubscribe page and its posts are counted by
     * (`plugins/core.ts`): a link this install signed, by a digest of the link
     * itself, so whoever shares a network address with a flooder (everybody,
     * behind a proxy that is not trusted) keeps their own budget; anything
     * else by network address (null). Never the link in the counter's key,
     * which would carry the sealed address into memory under another name.
     */
    async function linkSubject(request: FastifyRequest): Promise<string | null> {
      const token = tokenOf(request.params as { '*': string });
      if (token === '' || (await door.readUnsubscribe(token)) === null) return null;
      return createHash('sha256').update(token).digest('base64url');
    }

    /** The page's own address, with its language kept, for the form to post to. */
    function actionOf(request: FastifyRequest, token: string): string {
      const lang = (request.query as { lang?: unknown } | undefined)?.lang;
      return `${MAIL_DOOR_PREFIX}/u/${token}${typeof lang === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(lang) ? `?lang=${lang}` : ''}`;
    }

    app.get(
      '/m/u/*',
      {
        config: { rateLimitBucket: 'mail-door-unsubscribe', rateLimitSubject: linkSubject },
        schema: { hide: true, params: tokenParams },
      },
      async (request, reply) =>
        guarded(request, reply, async () => {
          if (!(await door.reachable())) return unavailable(request, reply);
          const claim = await door.readUnsubscribe(tokenOf(request.params));
          if (claim === null) return send(request, reply, { kind: 'dead' }, 404, null);
          if (await door.settled(claim)) return send(request, reply, { kind: 'already' }, 200, claim);
          return send(request, reply, { kind: 'unsubscribe', address: claim.address, purpose: claim.purpose, action: actionOf(request, tokenOf(request.params)) }, 200, claim);
        }),
    );

    // The page's form (`act=one|all`, an optional `why`), and RFC 8058's one-click: a mail app posts
    // `List-Unsubscribe=One-Click` to the very link in the mail's `List-Unsubscribe` header, with no cookie.
    app.post(
      '/m/u/*',
      {
        config: {
          rateLimitBucket: 'mail-door-act',
          rateLimitSubject: linkSubject,
          csrf: 'exempt',
          audit: auditExempt('a stranger unsubscribing through a mail’s link or its one-click: the consent log row and the do-not-email entry are the record'),
        },
        schema: { hide: true, params: tokenParams },
      },
      async (request, reply) =>
        guarded(request, reply, async () => {
          if (!(await door.reachable())) return unavailable(request, reply);
          const claim = await door.readUnsubscribe(tokenOf(request.params));
          if (claim === null) return send(request, reply, { kind: 'dead' }, 404, null);
          if (asksOneClick(request.body)) {
            await door.unsubscribe(claim, 'one', 'one-click', null);
            return reply.code(200).header('cache-control', 'no-store').header('content-type', 'text/plain; charset=utf-8').send('Unsubscribed');
          }
          const form = formOf(request.body);
          const act = form['act'];
          // Neither button: nothing is done, and the page is shown again.
          if (act !== 'one' && act !== 'all') {
            return send(request, reply, { kind: 'unsubscribe', address: claim.address, purpose: claim.purpose, action: actionOf(request, tokenOf(request.params)) }, 400, claim);
          }
          const action: UnsubscribeAction = act;
          const why = (UNSUBSCRIBE_REASONS as readonly string[]).includes(form['why'] ?? '') ? (form['why'] as UnsubscribeReason) : null;
          const outcome = await door.unsubscribe(claim, action, 'link', why);
          return send(request, reply, 'already' in outcome ? { kind: 'already' } : { kind: 'done', which: outcome.done }, 200, claim);
        }),
    );

    // A counted click: only to the web address the link signs (never an open redirect).
    app.get(
      '/m/l/*',
      {
        config: { rateLimitBucket: 'mail-door-page' },
        schema: { hide: true, params: tokenParams },
      },
      async (request, reply) =>
        guarded(request, reply, async () => {
          if (!(await door.reachable())) return unavailable(request, reply);
          const claim = await door.readClick(tokenOf(request.params));
          if (claim === null) return unavailable(request, reply);
          // A HEAD (a link scanner checking the address) is told where it goes, and counts nothing.
          if (request.method === 'GET') await door.clicked(claim);
          return reply.code(302).header('location', claim.target).header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').send();
        }),
    );

    // Everything else under the door, the sign-up confirm page's `/m/c/` among it: not here (yet).
    app.get(
      '/m/*',
      {
        config: { rateLimitBucket: 'mail-door-page' },
        schema: { hide: true },
      },
      async (request, reply) => guarded(request, reply, async () => unavailable(request, reply)),
    );
  };
}
