// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What trial mode does to the pages strangers reach: public, but hidden from
 * search engines, and without the pay pages.
 *
 * One `onRequest` hook and one `onSend` hook, registered before every plugin
 * and route, so they reach every door the server has (customer sides, forms
 * and their loader, the mail door, the public API and its docs, guest and
 * survey links, the add-on pages' hosts) without a list that a new door could
 * be missing from:
 *
 *  - while search indexing is off (trial mode), EVERY response carries
 *    `X-Robots-Tag: noindex, nofollow`, every HTML page the robots meta tag in
 *    its head, and `/robots.txt` disallows everything, on every host, over any
 *    robots.txt an app's side ships. Staff pages carry it too: no page of a
 *    trial belongs in a search index. The hosted profile and an ordinary server
 *    leave all three alone;
 *  - pay pages (`/pay…`) and inbound payment webhooks are refused (403, with
 *    the policy's reason) where the policy switches them off: a trial has no
 *    payment provider to pay through or to call back.
 *
 * The request hook is where a later switch over every public page belongs
 * too (the operator hiding them): one more question asked in the same place.
 */
import { Readable } from 'node:stream';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../errors.js';
import { PAY_PREFIX, PAYMENT_WEBHOOK_PREFIX } from '../plugins/surfaces.js';
import type { PolicyQuestion, TrialPolicy } from './policy.js';

/** Said on every response, and in the meta tag, while indexing is off. */
export const NOINDEX = 'noindex, nofollow';

export const ROBOTS_META = `<meta name="robots" content="${NOINDEX}">`;

/** The robots.txt of a server no search engine may index. */
export const ROBOTS_DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

/** An existing robots meta tag, whatever its attribute order and quoting. */
const ROBOTS_TAG = /<meta\b[^>]*\bname\s*=\s*["']?robots["']?[^>]*>/gi;

/**
 * `html` with the robots meta tag first in its head: an existing one replaced,
 * else after `<head …>`, else after `<html …>`, else at the very start.
 */
export function withRobotsMeta(html: string): string {
  const cleaned = html.replace(ROBOTS_TAG, '');
  for (const opening of [/<head\b[^>]*>/i, /<html\b[^>]*>/i]) {
    const found = opening.exec(cleaned);
    if (found !== null) {
      const at = found.index + found[0].length;
      return `${cleaned.slice(0, at)}${ROBOTS_META}${cleaned.slice(at)}`;
    }
  }
  return `${ROBOTS_META}${cleaned}`;
}

async function textOf(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

/** The path the router will read, without the query. */
function pathOf(url: string): string {
  return url.split('?')[0] ?? url;
}

/** The policy question that switches off the door this path is, if any. */
function closedBy(path: string): PolicyQuestion | null {
  if (path === PAY_PREFIX || path.startsWith(`${PAY_PREFIX}/`)) return 'payPages';
  if (path.startsWith(PAYMENT_WEBHOOK_PREFIX)) return 'paymentWebhooks';
  return null;
}

export function registerPublicPages(app: FastifyInstance, policy: Pick<TrialPolicy, 'allows'>): void {
  const indexing = policy.allows('searchIndexing').allowed;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = pathOf(request.url);
    const question = closedBy(path);
    if (question !== null) {
      const answer = policy.allows(question);
      if (!answer.allowed) {
        throw new AppError(403, 'FORBIDDEN', question === 'payPages' ? 'Pay pages are off on this server.' : 'Payment services cannot call this server.', { reason: answer.reason });
      }
    }
    if (!indexing && path === '/robots.txt' && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.code(200).type('text/plain; charset=utf-8').header('cache-control', 'no-store').send(request.method === 'HEAD' ? '' : ROBOTS_DISALLOW_ALL);
    }
    return undefined;
  });

  if (indexing) return;

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-robots-tag', NOINDEX);
    const type = reply.getHeader('content-type');
    if (request.method === 'HEAD' || typeof type !== 'string' || !type.toLowerCase().startsWith('text/html')) return payload;
    // A compressed body cannot be edited as text; the header above still says it.
    if (reply.getHeader('content-encoding') !== undefined) return payload;
    let html: string;
    if (typeof payload === 'string') html = payload;
    else if (Buffer.isBuffer(payload)) html = payload.toString('utf8');
    else if (payload instanceof Readable) html = await textOf(payload);
    else return payload;
    // The length a file was sent with is no longer the body's: measured again from the text.
    reply.removeHeader('content-length');
    return withRobotsMeta(html);
  });
}
