// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local-bridge resource: `GET /api/v1/bridge/hello`, `POST /api/v1/bridge/handoff`,
 * `GET /api/v1/bridge/seed/:ticket`.
 *
 * Lets adminium.dev finish what it starts. The site's connect card asks for a
 * connection string it fundamentally cannot use — a page has no raw TCP — so
 * without this the only honest answer was "copy this command instead". With it,
 * the site hands the string to an Adminium already running on the same machine
 * and the real Studio wizard takes over. The string goes browser → loopback; it
 * never touches adminium.dev's server (a static site with no backend at all).
 *
 * ── OFF UNLESS ASKED FOR ────────────────────────────────────────────────────
 * `compose` registers this plugin only when `ADMINIUM_BRIDGE_ORIGINS` is set —
 * `adminium --bridge` sets it, nothing else does. An instance nobody opted in
 * for has no bridge routes at all, not merely a bridge that refuses.
 *
 * ── THE THREE GATES ─────────────────────────────────────────────────────────
 *  1. ORIGIN. Cross-origin access is granted to the configured exact origins
 *     only, and the JSON content type forces a preflight — so a page that is
 *     not on the list cannot even deliver the request, let alone read a reply.
 *     Chrome additionally preflights every public→private-network request; the
 *     `Access-Control-Allow-Private-Network` answer below is what satisfies it.
 *  2. PAIRING CODE. The instance prints a one-time code at boot and
 *     `/handoff` requires it. This is the user's consent: the allow-list says
 *     *which* site may ask, the code says *this* person is at both keyboards.
 *  3. SESSION. `/seed/:ticket` — the only route that gives the DSN BACK — is
 *     same-origin, cookie-authenticated and `connections:manage`-gated. A
 *     guessed ticket is worthless without an admin session.
 *
 * ── WHY CORS IS HAND-ROLLED HERE ────────────────────────────────────────────
 * `plugins/core.ts` registers `@fastify/cors` globally with `credentials: true`
 * for split deployments. That is exactly the wrong policy for this resource:
 * credentialed cross-origin requests to a cookie-authenticated admin panel are
 * a CSRF primitive. The headers below deliberately OMIT
 * `Access-Control-Allow-Credentials`, so a browser will strip cookies from any
 * cross-origin call it makes here — which is why gate 3 can rely on the session
 * cookie meaning "same-origin, from the dashboard". `@fastify/cors` also has no
 * concept of the Private Network Access header, which this needs.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../../errors.js';
import type { BridgeStore } from '../../bridge/store.js';
import { pairingCodeMatches } from '../../bridge/store.js';
import { APP_VERSION } from '../../version.js';
import { CONNECTIONS_MANAGE } from '../connections/index.js';
import {
  bridgeHandoffBody,
  bridgeHandoffReply,
  bridgeHelloReply,
  bridgeSeedParams,
  bridgeSeedReply,
  type BridgeHandoffReply,
  type BridgeHelloReply,
  type BridgeSeedReply,
} from './schema.js';

export interface BridgeRoutesDeps {
  /** Exact origins allowed to reach the cross-origin half. Never empty. */
  origins: readonly string[];
  /** Printed by the CLI at boot; required by `/handoff`. */
  pairingCode: string;
  store: BridgeStore;
  version?: string | undefined;
}

/** Where the Studio wizard lives, for the redirect the site performs next. */
export const CONNECT_PATH = '/studio/connect';

export function bridgeRoutes(deps: BridgeRoutesDeps): FastifyPluginAsyncZod {
  const { origins, pairingCode, store } = deps;
  const version = deps.version ?? APP_VERSION;
  const allowed = new Set(origins);

  /**
   * Echo the caller's origin when it is allow-listed. Echoing (rather than
   * listing) is required: `Access-Control-Allow-Origin` takes one value, and
   * `Vary: Origin` keeps a shared cache from serving one origin's answer to
   * another.
   */
  const applyCors = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const origin = request.headers.origin;
    reply.header('Vary', 'Origin');
    if (typeof origin !== 'string' || !allowed.has(origin)) return false;
    reply.header('Access-Control-Allow-Origin', origin);
    return true;
  };

  /**
   * The preflight answer for both cross-origin routes. A disallowed origin gets
   * a 403 with no allow headers, which is what makes the browser refuse to send
   * the real request at all.
   */
  const preflight = async (request: FastifyRequest, reply: FastifyReply): Promise<null> => {
    if (!applyCors(request, reply)) return reply.code(403).send();
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'content-type');
    reply.header('Access-Control-Max-Age', '600');
    // Chrome's Private Network Access: a page on a public origin reaching a
    // private/loopback address is preflighted even for simple requests, and the
    // request is only allowed if we opt in explicitly. Answered only when asked,
    // so the header never appears on ordinary same-origin traffic.
    if (request.headers['access-control-request-private-network'] === 'true') {
      reply.header('Access-Control-Allow-Private-Network', 'true');
    }
    return reply.code(204).send();
  };

  return async (app) => {
    app.options('/bridge/hello', { schema: { hide: true } }, preflight);
    app.options('/bridge/handoff', { schema: { hide: true } }, preflight);

    // ── 1. discovery ─────────────────────────────────────────────────────────
    // Deliberately thin. It answers "is an Adminium listening here, and does it
    // speak bridge" and nothing else — no instance id, no connection list, no
    // pairing code. The version is already public on this path because the site
    // needs to know whether this build supports the hand-off shape.
    app.get(
      '/bridge/hello',
      { schema: { response: { 200: bridgeHelloReply } } },
      async (request, reply): Promise<BridgeHelloReply> => {
        if (!applyCors(request, reply)) {
          throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed to pair.');
        }
        return { data: { product: 'adminium', version, connectPath: CONNECT_PATH } };
      },
    );

    // ── 2. hand-off ──────────────────────────────────────────────────────────
    app.post(
      '/bridge/handoff',
      {
        schema: {
          body: bridgeHandoffBody,
          response: { 200: bridgeHandoffReply },
        },
        config: { rateLimitBucket: 'auth-login' },
      },
      async (request, reply): Promise<BridgeHandoffReply> => {
        if (!applyCors(request, reply)) {
          throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed to pair.');
        }
        const { code, dsn, engine } = request.body;
        if (!pairingCodeMatches(code, pairingCode)) {
          // One message for a wrong code, whatever was wrong about it.
          throw new AppError(403, 'PAIRING_FAILED', 'That pairing code does not match.');
        }
        const ticket = store.put({ dsn, engine: engine ?? null });
        return { data: { ticket, connectPath: CONNECT_PATH } };
      },
    );

    // ── 3. redemption ────────────────────────────────────────────────────────
    // No `applyCors`: same-origin only, so the session cookie the RBAC guard
    // reads can only have come from the dashboard itself.
    app.get(
      '/bridge/seed/:ticket',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: { params: bridgeSeedParams, response: { 200: bridgeSeedReply } },
      },
      async (request): Promise<BridgeSeedReply> => {
        const seed = store.take(request.params.ticket);
        if (seed === null) {
          throw new AppError(
            404,
            'BRIDGE_SEED_NOT_FOUND',
            'That hand-off has already been used or has expired.',
          );
        }
        return { data: { dsn: seed.dsn, engine: seed.engine } };
      },
    );
  };
}
