// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE HEADERS OF EVERY `/x/` DOOR — what a stranger's page, its API and its
 * files answer with, whichever plugin serves them.
 *
 * A Fastify hook belongs to the plugin that adds it, so a door registered as
 * its own plugin would otherwise answer with none of these. Each door calls
 * {@link xDoorHeaders} once, inside its own plugin, and gets the same last
 * word on its headers:
 *
 * - the page's own content policy ({@link xContentPolicy}): scripts, styles
 *   and fonts from `/x/assets/` on this host only, calls to this host only;
 * - `frame-ancestors`: the listed websites ("Your websites") for an answer the
 *   door says is drawn for a website's frame, this host alone for a staff
 *   preview, and nobody for everything else;
 * - no referrer, no type sniffing, `noindex` (a stronger header the server
 *   already set, as a trial's, is kept);
 * - the dashboard's own `X-Frame-Options` taken off: the policy says who may
 *   frame, and that header would refuse every website;
 * - nothing cached, save the bundle's hashed files and the loader.
 *
 * Which pages a website may frame is a list of path patterns
 * ({@link framedPageOf}): each door passes its own, so a new door's page is
 * framed only when it is listed, and only with `?frame=1`.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { X_PREFIX } from '../../plugins/surfaces.js';

/**
 * The policy every answer of a door carries, for the origin it was asked
 * on. `framers` are the origins that may frame this answer: none, unless it
 * is a page drawn for a frame and the owner listed websites.
 */
export function xContentPolicy(origin: string, framers: readonly string[] = []): string {
  const assets = `${origin}${X_PREFIX}/assets/`;
  return [
    "default-src 'none'",
    `script-src ${assets}`,
    `style-src ${assets}`,
    `font-src ${assets}`,
    "img-src 'self' data:",
    "connect-src 'self'",
    framers.length === 0 ? "frame-ancestors 'none'" : `frame-ancestors ${framers.join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** What a door tells the shared hook about each of its answers. */
export interface XDoorHeaderOptions {
  /** Whether this answer is a page a listed website may frame. */
  framed: (request: FastifyRequest) => boolean;
  /** The listed websites' origins, read only for a framed answer. */
  websites: () => Promise<readonly string[]>;
  /** Whether this answer is a staff preview: framed by this host alone, whatever else holds. */
  previewing: (request: FastifyRequest) => boolean;
}

/**
 * A `framed` test for the pages a website may frame: a path that matches one
 * of `pages` whole, asked with `frame=1`. Anything else, an API call under
 * the same prefix included, is framed by nobody.
 */
export function framedPageOf(pages: readonly RegExp[]): (request: FastifyRequest) => boolean {
  return (request) => {
    const [path = '', query = ''] = request.url.split('?');
    return pages.some((page) => page.test(path)) && new URLSearchParams(query).get('frame') === '1';
  };
}

function originOf(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

/**
 * Add the door headers' hook to `app`, the door's own plugin instance: it
 * covers every answer that plugin gives, its errors and 404s included.
 */
export function xDoorHeaders(app: FastifyInstance, options: XDoorHeaderOptions): void {
  app.addHook('onSend', async (request, reply, payload) => {
    // A preview is framed by the builder on this host, and by nobody else.
    const framers = options.previewing(request) ? ["'self'"] : options.framed(request) ? await options.websites() : [];
    void reply.header('content-security-policy', xContentPolicy(originOf(request), framers));
    void reply.header('referrer-policy', 'no-referrer');
    void reply.header('x-content-type-options', 'nosniff');
    // Kept when the server already said more (trial mode's `noindex, nofollow`, `trial/public-pages.ts`).
    if (reply.getHeader('x-robots-tag') === undefined) void reply.header('x-robots-tag', 'noindex');
    // The policy's frame-ancestors decides who may frame a page; the dashboard's own header would refuse every website.
    reply.removeHeader('x-frame-options');
    if (!request.url.startsWith(`${X_PREFIX}/assets/`) && !request.url.startsWith(`${X_PREFIX}/embed.js`)) void reply.header('cache-control', 'no-store');
    return payload;
  });
}
