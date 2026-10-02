// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/auth/design-session` — the link `adminium design` opens signs
 * its owner in, once.
 *
 * Copied from the desktop shell's boot token, and stricter in one way that
 * matters: it signs in ONE user, the owner `design` itself made with no
 * password (`designer.localOwnerId`). A project whose owner has a password —
 * or a meta store shared with anything else — gets no link at all, and the
 * person signs in as they always do. A token never makes a password-less
 * session for an account that has a password.
 *
 * The gates, each enough on its own to refuse:
 *
 *   1. EXISTENCE  registered only when the server runs `adminium design`
 *   2. NAME       the request's Host is the Designer's own name (127.0.0.1:<port>)
 *   3. PEER       the socket is loopback
 *   4. TOKEN      this run's token, compared in constant time and spent on first use
 *   5. OWNER      the local owner exists and still has no password
 *
 * It is origin-checked, not token-checked for CSRF: the page that exchanges
 * the link has no session yet, and a stale cookie from another project on
 * this machine must not turn the exchange into a 403.
 */
import { settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditAuth } from '../../auth/audit.js';
import { createBootTokenGuard, isLoopbackPeer } from '../../auth/desktop-session.js';
import { createSession, setSessionCookie } from '../../auth/sessions.js';
import { hostRole } from '../../designer/design-mode.js';
import { AppError } from '../../errors.js';
import { toUserView } from './handlers.js';
import { RATE_LIMIT_BUCKETS } from './index.js';
import { authLoginReply } from './schema.js';

export interface DesignSessionRoutesDeps {
  meta: MetaDb;
  /** This run's token. Never written anywhere. */
  token: string;
  port: number;
}

/** A design session lasts a working day. */
export const DESIGN_SESSION_MS = 12 * 60 * 60 * 1000;

export const designSessionBody = z.object({ designToken: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 hex characters') });

const spent = (): AppError => new AppError(401, 'INVALID_CREDENTIALS', 'This link has been used.', { reason: 'DESIGN_LINK_USED' });

export function designSessionRoutes(deps: DesignSessionRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  return async (app) => {
    const guard = createBootTokenGuard(deps.token);

    app.post(
      '/auth/design-session',
      {
        preHandler: [app.requireMeta],
        config: { rateLimitBucket: RATE_LIMIT_BUCKETS.login, csrf: 'origin' },
        schema: { body: designSessionBody, response: { 200: authLoginReply } },
      },
      async (request, reply) => {
        if (hostRole(request.headers.host, deps.port) !== 'designer' || !isLoopbackPeer(request.raw.socket)) {
          await auditAuth(meta, request, { action: 'design_session_rejected', actorId: null, actorLabel: 'design-link' });
          throw new AppError(403, 'FORBIDDEN', 'The Designer is signed into from its own address on this machine only.');
        }
        // Spent before anything else is looked at: a failure after this costs a restart, never a second try.
        if (guard.claim(request.body.designToken) !== 'ok') {
          await auditAuth(meta, request, { action: 'design_session_failed', actorId: null, actorLabel: 'design-link' });
          throw spent();
        }
        const ownerId = await settingsRepo(meta).get('designer.localOwnerId');
        const owner = ownerId === null ? null : await usersRepo(meta).findById(ownerId);
        if (owner === null || owner.passwordHash !== null || owner.status !== 'active') {
          throw new AppError(409, 'CONFLICT', 'This project’s owner signs in with their password.', { reason: 'OWNER_HAS_PASSWORD' });
        }

        const now = Date.now();
        const userAgent = request.headers['user-agent'];
        const minted = await createSession(
          meta,
          owner.id,
          { ip: request.ip, userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null },
          now,
          { absoluteDeadline: now + DESIGN_SESSION_MS },
        );
        await usersRepo(meta).recordLogin(owner.id, now);
        setSessionCookie(reply, minted, request);
        await auditAuth(meta, request, { action: 'login', actorId: owner.id, actorLabel: owner.name, changes: { after: { method: 'design-link' } } });
        const fresh = (await usersRepo(meta).findById(owner.id)) ?? owner;
        return { data: { user: toUserView(fresh) } };
      },
    );
  };
}
