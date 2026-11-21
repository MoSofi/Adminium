// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CONNECT DOOR — where a person connects their own outside account, signed
 * in or not (`connected-accounts/service.ts`).
 *
 *   GET  /api/v1/add-ons/:key/oauth/callback  where a provider sends the browser back
 *   GET  /x/connect                           the page a connect link opens (`#<token>`)
 *   GET  /x/connect/back                      the page that finishes a sign-in
 *   POST /x/connect/api/open                  what a link is for. Spends nothing
 *   POST /x/connect/api/start                 starts a sign-in, binding it to this browser
 *   POST /x/connect/api/complete              finishes it: the only writer
 *
 * ─── THE CALLBACK DOES NO WORK ──────────────────────────────────────────────
 * Each business types its address into Google's and Microsoft's consoles, so
 * it is one fixed path that never moves. Its GET changes nothing. It answers
 * 303 to the door page with what the provider sent moved into the fragment,
 * so the code leaves the address bar, the history and any later log, and the
 * page POSTs it.
 *
 * ─── THE COOKIE ─────────────────────────────────────────────────────────────
 * `start` sets a `__Host-` cookie (HttpOnly, Secure, SameSite=Lax) with a
 * random nonce, and the flow keeps its hash. `complete` refuses without it, so
 * an authorize address sent to someone else connects nothing in their browser.
 *
 * Tagged `staff`: connecting a colleague's calendar is the instance's own
 * business, and it keeps working while public pages are hidden. Every request
 * still runs as nobody (`../x-door/stranger.ts`).
 */
import type { MetaDb } from '@adminium/meta';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { ConnectRefusedError, type ConnectedAccounts } from '../../connected-accounts/service.js';
import { forwardedOf } from '../../forms/reach.js';
import { tagRoutes } from '../../security/route-audience.js';
import { framedPageOf, xDoorHeaders } from '../x-door/headers.js';
import { xPages, type XPageWords } from '../x-door/page.js';
import { strangerDoor } from '../x-door/stranger.js';

/** The cookie that ties a sign-in to the browser that started it. */
export const CONNECT_COOKIE = '__Host-adminium-connect';
const COOKIE_SECONDS = 10 * 60;

const PAGE_WORDS: XPageWords = {
  live: { key: 'x:connect.noScript', fallback: 'Connecting an account needs JavaScript.' },
  closed: { key: 'x:connect.unavailable', fallback: 'This link doesn’t work any more. Ask for a new one.' },
  unavailable: { key: 'x:connect.unavailable', fallback: 'This link doesn’t work any more. Ask for a new one.' },
};

const token = z.string().min(32).max(128);
const openBody = z.object({ token }).strict();
const startBody = z.object({ token, provider: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) }).strict();
const completeBody = z
  .object({
    state: z.string().min(16).max(512),
    code: z.string().min(1).max(4096).optional(),
    error: z.string().min(1).max(64).optional(),
  })
  .strict();

const callbackParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) });
/** What is carried on from the provider. Anything else it sends stays behind. */
const callbackQuery = z.object({ code: z.string().max(4096).optional(), state: z.string().max(512).optional(), error: z.string().max(64).optional() }).passthrough();

function cookieOf(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === CONNECT_COOKIE) return part.slice(at + 1).trim() || null;
  }
  return null;
}

/** A browser's own page calls these. A call from another site is refused before it reads anything. */
function sameSite(request: FastifyRequest): boolean {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.host;
  } catch {
    return false;
  }
}

const unavailable = (reply: FastifyReply) => reply.status(404).send({ error: 'unavailable' });

export interface ConnectDoorDeps {
  meta: MetaDb;
  accounts: ConnectedAccounts;
}

/** The fixed address a provider sends the browser back to. Registered under `/api/v1`. */
export function connectCallbackRoutes(): FastifyPluginAsyncZod {
  return async (app) => {
    tagRoutes(app, 'staff');
    // As nobody: a screens-only person coming back signed in is not refused here, and their session is never read.
    strangerDoor(app);
    app.get(
      '/add-ons/:key/oauth/callback',
      {
        config: { rateLimitBucket: 'connect-door', audit: auditExempt('changes nothing: it hands the provider\'s answer to the door page, whose POST is the write') },
        // Kept out of the public spec: only a provider's redirect lands here.
        schema: { hide: true, params: callbackParams, querystring: callbackQuery },
      },
      async (request, reply) => {
        const carried = new URLSearchParams();
        const { code, state, error } = request.query;
        if (state !== undefined) carried.set('state', state);
        if (code !== undefined) carried.set('code', code);
        if (error !== undefined) carried.set('error', error);
        void reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
        return reply.redirect(`/x/connect/back#${carried.toString()}`, 303);
      },
    );
  };
}

export function connectDoorRoutes(deps: ConnectDoorDeps): FastifyPluginAsync {
  const { meta, accounts } = deps;

  const open = async (request: FastifyRequest): Promise<boolean> => (await accounts.reachNow(forwardedOf(request))) !== 'cannot-connect';

  const door: FastifyPluginAsyncZod = async (app) => {
    tagRoutes(app, 'staff');
    strangerDoor(app);
    xDoorHeaders(app, { framed: framedPageOf([]), websites: () => Promise.resolve([]), previewing: () => false });
    const { page } = xPages(app, meta, PAGE_WORDS);
    const audit = auditExempt('a stranger\'s door: a connection made is recorded by the engine\'s own notice to the managers');

    for (const path of ['/x/connect', '/x/connect/back']) {
      app.get(path, { config: { rateLimitBucket: 'connect-door', audit }, schema: { hide: true } }, async (request, reply) => page(request, reply, (await open(request)) ? 'live' : 'unavailable'));
    }

    app.post('/x/connect/api/open', { config: { rateLimitBucket: 'connect-door', csrf: 'exempt', audit }, schema: { hide: true, body: openBody } }, async (request, reply) => {
      if (!sameSite(request) || !(await open(request))) return unavailable(reply);
      const opened = await accounts.open(request.body.token);
      if (opened === null) return unavailable(reply);
      return { business: opened.business, person: opened.person, purpose: opened.link.purpose, providers: opened.providers };
    });

    app.post('/x/connect/api/start', { config: { rateLimitBucket: 'connect-door', csrf: 'exempt', audit }, schema: { hide: true, body: startBody } }, async (request, reply) => {
      if (!sameSite(request) || !(await open(request))) return unavailable(reply);
      let started;
      try {
        started = await accounts.start({ token: request.body.token, provider: request.body.provider, forwarded: forwardedOf(request) });
      } catch (error) {
        if (error instanceof ConnectRefusedError) return reply.status(409).send({ error: error.code });
        throw error;
      }
      if (started === null) return unavailable(reply);
      void reply.header('set-cookie', `${CONNECT_COOKIE}=${started.nonce}; Path=/; Max-Age=${String(COOKIE_SECONDS)}; HttpOnly; Secure; SameSite=Lax`);
      return { authorizeUrl: started.authorizeUrl };
    });

    app.post('/x/connect/api/complete', { config: { rateLimitBucket: 'connect-door', csrf: 'exempt', audit }, schema: { hide: true, body: completeBody } }, async (request, reply) => {
      if (!sameSite(request) || !(await open(request))) return unavailable(reply);
      const { state, code, error } = request.body;
      const answer = await accounts.complete({ state, code: code ?? null, error: error ?? null, nonce: cookieOf(request) });
      void reply.header('set-cookie', `${CONNECT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
      return answer;
    });
  };
  return door as unknown as FastifyPluginAsync;
}
