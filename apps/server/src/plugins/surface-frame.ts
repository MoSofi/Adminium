// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S CUSTOMER SCREEN IN A FRAME ON THE OWNER'S WEBSITE.
 *
 * What this decides, and what it cannot. It is read once, when the frame's
 * document loads, so it says which ADDRESSES a listed website may load. An app
 * changes screens in the browser with no new request: holding the frame to the
 * screens it may show is the app's, through `@adminium/public-client/frame`.
 *
 * A page is framed by a listed website only when ALL of these hold:
 *
 *  - it is a customer side's page, asked with exactly one `frame=1`;
 *  - the path after the mount (`/apps/<key>/customer/…`,
 *    `/apps/<key>/<slug>/customer/…`, or `/…` on a mapped host) is one the
 *    install's manifest declares, compared whole and raw: a declared path has
 *    no escapes, so `/b%6Fok` matches nothing;
 *  - "Your websites" lists at least one website.
 *
 * Anything else keeps the global `frame-ancestors 'self'` and
 * `X-Frame-Options: SAMEORIGIN`, so the browser refuses the frame and the
 * loader's plain link stays. `'self'` stays in the framed answer too: the
 * snippet maker frames the real screen as its preview.
 *
 * Every `frame=1` answer of a customer side is `no-store` (the list changes,
 * and a kept copy would carry the old one) and `noindex` (it is a second
 * address for the same page), whether or not it may be framed.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { HostedSurface } from '../cli/surfaces-root.js';

/** Whether this address asks for the framed answer: `frame=1`, once. */
export function asksForFrame(url: string): boolean {
  const at = url.indexOf('?');
  if (at === -1) return false;
  const values = new URLSearchParams(url.slice(at + 1)).getAll('frame');
  return values.length === 1 && values[0] === '1';
}

/** The path after the side's mount, in the three shapes it is served under; null for a path of no mount of this side. */
export function pathAfterMount(path: string, surface: Pick<HostedSurface, 'appKey' | 'side' | 'prefix'>): string | null {
  if (path === surface.prefix) return '/';
  if (path.startsWith(`${surface.prefix}/`)) return path.slice(surface.prefix.length);
  if (!path.startsWith('/apps/')) return path;
  const copy = new RegExp(`^/apps/${surface.appKey.replace(/[^a-z0-9-]/gi, '')}/[^/]+/${surface.side}(/.*)?$`).exec(path);
  if (copy === null) return null;
  return copy[1] === undefined || copy[1] === '' ? '/' : copy[1];
}

export interface SurfaceFramingDeps {
  /** The paths this mount's install declares (`frontends[].embed`), or null when it declares none. */
  declaredPaths: (request: FastifyRequest, surface: HostedSurface) => Promise<readonly string[] | null>;
  /** "Your websites". */
  websites: () => Promise<readonly string[]>;
}

export interface SurfaceFraming {
  /** Read what this page's answer must carry, before it is sent. */
  mark: (request: FastifyRequest, reply: FastifyReply, surface: HostedSurface) => Promise<void>;
  /** The last word on a marked answer's headers, for an `onSend` hook. */
  onSend: (request: FastifyRequest, reply: FastifyReply, payload: unknown) => Promise<unknown>;
}

export function createSurfaceFraming(deps: SurfaceFramingDeps): SurfaceFraming {
  /** The answers asked with `frame=1`, and the websites each may be framed by (none: as any other page). */
  const marked = new WeakMap<FastifyReply, readonly string[]>();
  return {
    async mark(request, reply, surface) {
      if (surface.side !== 'customer' || !asksForFrame(request.url)) return;
      marked.set(reply, []);
      const rest = pathAfterMount(request.url.split('?')[0] ?? '', surface);
      if (rest === null) return;
      // A failed read frames nothing: the page is still served, under the global policy.
      const declared = await deps.declaredPaths(request, surface).catch(() => null);
      if (declared === null || !declared.includes(rest)) return;
      marked.set(reply, await deps.websites().catch(() => []));
    },
    async onSend(_request, reply, payload) {
      const framers = marked.get(reply);
      if (framers === undefined) return payload;
      void reply.header('cache-control', 'no-store');
      reply.removeHeader('etag');
      reply.removeHeader('last-modified');
      if (reply.getHeader('x-robots-tag') === undefined) void reply.header('x-robots-tag', 'noindex');
      const policy = reply.getHeader('content-security-policy');
      if (framers.length > 0 && typeof policy === 'string') {
        void reply.header('content-security-policy', policy.replace(/frame-ancestors [^;]*/, () => `frame-ancestors 'self' ${framers.join(' ')}`));
        reply.removeHeader('x-frame-options');
      }
      return payload;
    },
  };
}
