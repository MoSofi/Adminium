// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's preview on a server people reach.
 *
 * ─── Why a second address ───────────────────────────────────────────────────
 *
 * Under `adminium design` the Designer and the preview are two names of one
 * machine (`designer/design-mode.ts`): two sites, so code a model wrote, shown
 * in the preview, is never sent the person's session and cannot press the
 * Designer's buttons. A server people reach has one name, so it had no
 * preview: an app's screens framed there would run on the same site as the
 * signed-in person.
 *
 * `ADMINIUM_PREVIEW_ORIGIN` gives the instance its second name
 * (`https://shop.preview-example.com`). It is the operator's to set, and it
 * must be on a DIFFERENT SITE from the instance's own address: another
 * registrable domain, not a sibling under the same one. A sibling is the same
 * site to a browser, which sends `SameSite=Lax` cookies across it and lets it
 * write cookies over its parent's. Nothing here can check that (it takes the
 * public suffix list); the boot refuses only an address the instance already
 * answers on (`config/env.ts`).
 *
 * ─── What the preview's address does ────────────────────────────────────────
 *
 *  - the instance answers on it (`trial/operator-hosts.ts` lets it through);
 *  - everything that acts for the person is refused there, by the same list
 *    design mode keeps ({@link DESIGNER_ONLY}): the Designer's routes, every
 *    way to sign in, the models, users, roles, keys and settings;
 *  - the only user ever signed in there is the preview user
 *    ({@link PREVIEW_USER_EMAIL}), who holds the roles of the app being built
 *    and nothing else, through a one-use ticket (`designer/preview.ts`). A
 *    session of anyone else is not read on the preview's address, and the
 *    preview user's is read nowhere else (`plugins/auth.ts`,
 *    {@link sessionBelongsHere}). So a session cookie that reached the wrong
 *    address by any door signs nobody in;
 *  - framing, one way: the instance's own addresses may frame the preview,
 *    and nothing else may.
 *
 * An app's screens stay served at their own address on the instance's name,
 * as on any server: this adds a place to look at them, and takes none away.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Env } from '../config/env.js';
import { hostNameOf, type OperatorHosts } from '../trial/operator-hosts.js';
import { DESIGNER_ONLY, pathsOf } from './design-mode.js';
import { PREVIEW_USER_EMAIL } from './preview-user.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The preview's own address on a server people reach, or null when it has none (`designer/live-preview.ts`). */
    livePreview: LivePreview | null;
  }
}

export interface LivePreview {
  /** `ADMINIUM_PREVIEW_ORIGIN`. */
  origin: string;
  /** Its host name: lower case, no port. */
  host: string;
  /** The origins that may frame it: the instance's own addresses. */
  framers: readonly string[];
}

/** The preview's address, when the operator gave one and the instance's own addresses are known. */
export function livePreviewOf(env: Pick<Env, 'ADMINIUM_PREVIEW_ORIGIN'>, hosts: Pick<OperatorHosts, 'origins'> | null): LivePreview | null {
  const origin = env.ADMINIUM_PREVIEW_ORIGIN;
  if (origin === undefined || hosts === null) return null;
  return { origin, host: hostNameOf(new URL(origin).host), framers: hosts.origins };
}

/** Whether a request came in on the preview's address. The host is the proxy's `X-Forwarded-Host` where the proxy is trusted. */
export function onPreviewHost(preview: LivePreview | null, request: Pick<FastifyRequest, 'host'>): boolean {
  return preview !== null && hostNameOf(request.host) === preview.host;
}

/**
 * Whether a session is read on the address its request came in on: the
 * preview user's on the preview's address only, everyone else's everywhere
 * but there. With no preview address every session is read, as it always was.
 */
export function sessionBelongsHere(preview: LivePreview | null, request: Pick<FastifyRequest, 'host'>, user: { email: string }): boolean {
  if (preview === null) return true;
  return onPreviewHost(preview, request) === (user.email === PREVIEW_USER_EMAIL);
}

/** Registered before any plugin, so nothing behind it sees a request the preview's address may not make. */
export function registerLivePreview(app: FastifyInstance, preview: LivePreview): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!onPreviewHost(preview, request)) return undefined;
    if (pathsOf(request.url).some((path) => DESIGNER_ONLY.test(path))) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'The preview cannot reach the Designer.', details: { reason: 'PREVIEW_HOST' } } });
    }
    return undefined;
  });

  // Framing, one way: the instance's own addresses may frame the preview, the preview may be framed by them.
  app.addHook('onSend', async (request, reply, payload) => {
    const policy = reply.getHeader('content-security-policy');
    if (typeof policy !== 'string') return payload;
    if (onPreviewHost(preview, request)) {
      reply.header('content-security-policy', policy.replace(/frame-ancestors [^;]*/, () => `frame-ancestors 'self' ${preview.framers.join(' ')}`));
      reply.removeHeader('x-frame-options');
    } else if (!policy.includes('frame-src')) {
      reply.header('content-security-policy', `${policy};frame-src 'self' ${preview.origin}`);
    }
    return payload;
  });
}
