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
 * The request hook is also where every public page is hidden at once, while
 * the server's operator holds them back (`operator/holds.ts`): every request
 * for a public door ({@link isPublicDoor}) answers 404 with the bare
 * "unavailable" page, on every host, the user's own domains included. Which
 * door is public is not a list kept here: each route carries its audience
 * from registration (`security/route-audience.ts`), an untagged one counting
 * as public; the doors served by hooks rather than routes (an app's customer
 * side, a host mapped to one or to the add-on pages) are known by their
 * address.
 */
import { Readable } from 'node:stream';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { LocaleId } from '@adminium/i18n';
import { createServerI18n } from '@adminium/i18n/server';
import { settingsRepo, type MetaDb } from '@adminium/meta';

import { AppError, errorEnvelope } from '../errors.js';
import { bcp47 } from '../i18n/bcp47.js';
import { loadOverrideMap, recipientLocale } from '../i18n/server-i18n.js';
import type { OperatorHolds } from '../operator/holds.js';
import { DEFAULT_WORKSPACE_NAME, negotiateLocale, parseInstancePath, parseSurfacePath, PAY_PREFIX, PAYMENT_WEBHOOK_PREFIX } from '../plugins/surfaces.js';
import { audienceOf } from '../security/route-audience.js';
import { normalizeHost } from '../security/csrf.js';
import { domainMappingFor, pagesMappingFor } from '../surfaces/settings.js';
import { renderHiddenPage } from '../surfaces/unavailable-page.js';
import { ANY_HOST_PATHS } from './operator-hosts.js';
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

/**
 * Whether a request is for a door a stranger opens: what hiding the public
 * pages closes. The health checks never are; a host mapped to an app's
 * customer side or to the add-on pages always is; so is an app's customer
 * side under `/apps/`; otherwise the route's own tag decides, an untagged
 * route counting as public. A path no route answers is left to the
 * not-found handler: its only public answers are the customer sides above.
 */
export async function isPublicDoor(app: FastifyInstance, request: FastifyRequest): Promise<boolean> {
  const path = pathOf(request.url);
  if (ANY_HOST_PATHS.has(path)) return false;
  const settings = app.hasDecorator('surfaceSettings') && app.surfaceSettings !== null ? await app.surfaceSettings.read() : null;
  if (settings !== null) {
    if (pagesMappingFor(settings, request.host, normalizeHost) !== null) return true;
    const mapped = domainMappingFor(settings, request.host, normalizeHost);
    if (mapped !== null && mapped.side !== 'staff') return true;
    const host = request.host === undefined ? '' : normalizeHost(request.host);
    if (Object.keys(settings.retired ?? {}).some((retired) => normalizeHost(retired) === host)) return true;
  }
  if ((parseSurfacePath(path) ?? parseInstancePath(path))?.side === 'customer') return true;
  if (request.is404) return false;
  return audienceOf(request.routeOptions.config) !== 'staff';
}

/** What a hidden public page answers: the bare page to a browser, the 404 envelope to anything else. */
async function sendHiddenPage(meta: MetaDb | null, holds: OperatorHolds, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  void reply.code(404).header('cache-control', 'no-store').header('x-robots-tag', NOINDEX);
  const path = pathOf(request.url);
  const page = (request.method === 'GET' || request.method === 'HEAD') && !path.startsWith('/api/') && wantsPage(request);
  if (!page || meta === null) return reply.send(errorEnvelope('NOT_FOUND', 'Nothing is served at this address.', request.id));
  const locale = (negotiateLocale(request.headers['accept-language']) ?? ((await recipientLocale(meta, null)) as LocaleId));
  const i18n = await createServerI18n({ locale, overrides: await loadOverrideMap(meta, locale) });
  const workspace = await settingsRepo(meta).get('branding.appName');
  const logo = await holds.logo().catch(() => null);
  const html = renderHiddenPage({
    venueName: typeof workspace === 'string' && workspace.trim() !== '' && workspace !== DEFAULT_WORKSPACE_NAME ? workspace : null,
    logo: logo === null ? null : `data:${logo.mime};base64,${logo.bytes.toString('base64')}`,
    lang: bcp47(locale),
    t: (key, fallback, args) => i18n.t(key, { defaultValue: fallback, ...args }),
  });
  return reply.type('text/html; charset=utf-8').send(request.method === 'HEAD' ? '' : html);
}

/** A browser opening a page, as opposed to a script, a stylesheet or a `fetch`. */
function wantsPage(request: FastifyRequest): boolean {
  const mode = request.headers['sec-fetch-mode'];
  if (typeof mode === 'string') return mode === 'navigate';
  const accept = request.headers.accept;
  return typeof accept === 'string' && accept.includes('text/html');
}

/** What hiding the public pages needs: the operator's holds, and the meta store the page's words come from. */
export interface PublicPagesHide {
  holds: OperatorHolds;
  meta: MetaDb | null;
}

export function registerPublicPages(app: FastifyInstance, policy: Pick<TrialPolicy, 'allows'>, hide?: PublicPagesHide): void {
  const indexing = policy.allows('searchIndexing').allowed;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Hidden by the server's operator: every public door, on every host.
    if (hide !== undefined && hide.holds.publicPages().hidden && (await isPublicDoor(app, request))) {
      return sendHiddenPage(hide.meta, hide.holds, request, reply);
    }
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
