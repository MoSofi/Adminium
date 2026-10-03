// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rules a server keeps while it runs `adminium design`.
 *
 * ─── One machine, two names ─────────────────────────────────────────────────
 *
 * The server listens on this machine only, and answers to exactly three
 * names: `127.0.0.1:<port>`, `localhost:<port>` and `[::1]:<port>`. Any other
 * `Host` is refused before a route is reached. That is what stops a web page
 * from reaching it through DNS rebinding: a page on `evil.example` whose
 * name now points at 127.0.0.1 still sends `Host: evil.example`.
 *
 * The two names do different jobs:
 *
 *   127.0.0.1   the Designer: its pages, its routes, the models, the sign-in
 *   localhost   the preview of what the Designer built
 *
 * They are different origins AND different sites, so a session cookie set on
 * one is never sent to the other, and a script on one calling the other is a
 * cross-site request the CSRF check refuses. Code the model wrote runs on
 * `localhost` — and from there it cannot press the Designer's buttons,
 * answer its own cards, or add a model.
 *
 * The Designer frames the preview: its pages may frame `localhost`, and the
 * preview's pages may be framed by `127.0.0.1`. Nothing else is loosened.
 *
 * ─── A cookie per port ──────────────────────────────────────────────────────
 *
 * Browsers ignore the port when they send cookies, so two projects running
 * `design` on the same machine would read each other's session. In design
 * mode the session cookie is named for the port.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface DesignModeOptions {
  port: number;
}

/** The three names a design-mode server answers to. */
export function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${String(port)}`, `localhost:${String(port)}`, `[::1]:${String(port)}`]);
}

/** Which job a request's name does. */
export function hostRole(host: string | undefined, port: number): 'designer' | 'preview' | 'refused' {
  const name = (host ?? '').toLowerCase();
  if (!allowedHosts(port).has(name)) return 'refused';
  return name.startsWith('localhost:') ? 'preview' : 'designer';
}

/** What the preview's name may never reach: everything that acts for the person. */
const DESIGNER_ONLY = /^\/api\/v1\/(designer|auth\/design-session|auth\/login|auth\/2fa|auth\/password|auth\/desktop-session|llm|setup|users|roles|permissions|api-keys|settings)(\/|$|\?)/i;

/**
 * An app's own screens: code a model wrote. On the Designer's name they would
 * run beside the owner's session, with everything the owner may do; they are
 * served on the preview's name only, where the session is the preview user's.
 */
const APP_SCREENS = /^\/apps\/[^/]+\/(staff|customer)(\/|$|\?)/i;

/** The path as the router will read it: decoded once, so `%64esigner` is `designer`. */
function pathsOf(url: string): string[] {
  const raw = url.split('?')[0] ?? url;
  try {
    const decoded = decodeURIComponent(raw);
    return decoded === raw ? [raw] : [raw, decoded];
  } catch {
    return [raw];
  }
}

export function designSessionCookie(port: number): string {
  return `adminium_session_${String(port)}`;
}

export function registerDesignMode(app: FastifyInstance, opts: DesignModeOptions): void {
  const designerOrigin = `http://127.0.0.1:${String(opts.port)}`;
  const previewOrigin = `http://localhost:${String(opts.port)}`;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const role = hostRole(request.headers.host, opts.port);
    if (role === 'refused') {
      // 421: this server does not answer to that name. No body worth reading for a page that should not be here.
      return reply.code(421).header('content-type', 'text/plain; charset=utf-8').header('cache-control', 'no-store').send('This Adminium answers on this machine only.');
    }
    const paths = pathsOf(request.url);
    if (role === 'preview' && paths.some((path) => DESIGNER_ONLY.test(path))) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'The preview cannot reach the Designer.', details: { reason: 'PREVIEW_HOST' } } });
    }
    if (role === 'designer' && paths.some((path) => APP_SCREENS.test(path))) {
      return reply
        .code(403)
        .header('content-type', 'text/plain; charset=utf-8')
        .header('cache-control', 'no-store')
        .send('While the Designer runs, an app’s own screens open in the Designer’s preview, not here.');
    }
    return undefined;
  });

  // Framing, one way: the Designer may frame the preview, the preview may be framed by the Designer.
  app.addHook('onSend', async (request, reply, payload) => {
    const policy = reply.getHeader('content-security-policy');
    if (typeof policy !== 'string') return payload;
    const role = hostRole(request.headers.host, opts.port);
    if (role === 'designer') {
      reply.header('content-security-policy', policy.includes('frame-src') ? policy : `${policy};frame-src 'self' ${previewOrigin}`);
    } else if (role === 'preview') {
      reply.header('content-security-policy', policy.replace(/frame-ancestors [^;]*/, `frame-ancestors 'self' ${designerOrigin}`));
      reply.removeHeader('x-frame-options');
    }
    return payload;
  });
}
