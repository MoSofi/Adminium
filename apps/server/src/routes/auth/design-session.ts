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
 * `POST /api/v1/auth/design-link` is how that owner, already signed in, asks
 * for one more link: for the system's browser, when the desktop app's window
 * has spent the run's own token. Under gates 1 to 3 and 5, and only for the
 * local owner's own session. What it mints is taken by the door above, once,
 * within a minute (`designer/design-links.ts`).
 *
 * The door is origin-checked, not token-checked for CSRF: the page that exchanges
 * the link has no session yet, and a stale cookie from another project on
 * this machine must not turn the exchange into a 403.
 */
import { settingsRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditAuth } from '../../auth/audit.js';
import { createBootTokenGuard, isLoopbackPeer } from '../../auth/desktop-session.js';
import { ownerOnThisComputer } from '../../auth/local-owner.js';
import { createSession, setSessionCookie } from '../../auth/sessions.js';
import { createDesignLinks, type DesignLinks } from '../../designer/design-links.js';
import { hostRole } from '../../designer/design-mode.js';
import { AppError } from '../../errors.js';
import { toUserView } from './handlers.js';
import { RATE_LIMIT_BUCKETS } from './index.js';
import { authLoginReply } from './schema.js';

export interface DesignSessionRoutesDeps {
  meta: MetaDb;
  /** This run's token. Never written anywhere. */
  token: string;
  now?: () => number;
  port: number;
  /** The links the owner asked for after the run's own was spent; its own when omitted. */
  links?: DesignLinks;
  /**
   * The server was started by a host on the person's own computer (the desktop
   * app): gate 5 takes the owner this project was made for whether or not they
   * have a password. Every other gate stands.
   */
  thisComputer?: boolean;
}

/** A design session lasts a working day. */
export const DESIGN_SESSION_MS = 12 * 60 * 60 * 1000;

export const designSessionBody = z.object({ designToken: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 hex characters') });

/** How long the link `design` prints can be opened. */
export const DESIGN_LINK_MS = 15 * 60_000;

/** Where a link asked for lands: a page of this server, by its path. Never another origin (`//host`, a scheme). */
export const designLinkBody = z.strictObject({ to: z.string().max(400).regex(/^\/(?!\/)[^\\#\s]*$/, 'must be a path of this server') });
export const designLinkReply = z.object({ data: z.object({ url: z.string() }) });

const spent = (): AppError => new AppError(401, 'INVALID_CREDENTIALS', 'This link has been used.', { reason: 'DESIGN_LINK_USED' });

export function designSessionRoutes(deps: DesignSessionRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  return async (app) => {
    const guard = createBootTokenGuard(deps.token);
    const links = deps.links ?? createDesignLinks(deps.now === undefined ? {} : { now: deps.now });
    // A link nobody opened does not stay good for as long as the server runs: the command's arguments are readable by other users of the machine.
    const goodUntil = (deps.now ?? Date.now)() + DESIGN_LINK_MS;
    /** The one account a link signs in: the owner `design` made; on the person's own computer, also once they have a password. */
    const signedInOwner = async (): Promise<User | null> => {
      if (deps.thisComputer === true) return ownerOnThisComputer(meta);
      const ownerId = await settingsRepo(meta).get('designer.localOwnerId');
      return ownerId === null ? null : await usersRepo(meta).findById(ownerId);
    };

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
        // A link the owner asked for a moment ago has its own minute and its own single use.
        const asked = links.claim(request.body.designToken);
        if (!asked && (deps.now ?? Date.now)() > goodUntil) {
          await auditAuth(meta, request, { action: 'design_session_failed', actorId: null, actorLabel: 'design-link' });
          throw new AppError(401, 'INVALID_CREDENTIALS', 'This link is too old. Run `adminium design` again for a new one.', { reason: 'DESIGN_LINK_OLD' });
        }
        // Spent before anything else is looked at: a failure after this costs a restart, never a second try.
        if (!asked && guard.claim(request.body.designToken) !== 'ok') {
          await auditAuth(meta, request, { action: 'design_session_failed', actorId: null, actorLabel: 'design-link' });
          throw spent();
        }
        const owner = await signedInOwner();
        if (owner === null || (owner.passwordHash !== null && deps.thisComputer !== true) || owner.status !== 'active') {
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

    app.post(
      '/auth/design-link',
      {
        preHandler: [app.requireMeta, app.requireAuth],
        schema: { body: designLinkBody, response: { 200: designLinkReply } },
      },
      async (request) => {
        if (hostRole(request.headers.host, deps.port) !== 'designer' || !isLoopbackPeer(request.raw.socket)) {
          throw new AppError(403, 'FORBIDDEN', 'The Designer is signed into from its own address on this machine only.');
        }
        // Only the owner the link would sign in may ask for it, and only while the link is how that owner signs in.
        const owner = await signedInOwner();
        if (owner === null || request.user === null || request.user.id !== owner.id) {
          throw new AppError(403, 'FORBIDDEN', 'Only this project’s local owner can ask for a sign-in link.');
        }
        if ((owner.passwordHash !== null && deps.thisComputer !== true) || owner.status !== 'active') {
          throw new AppError(409, 'CONFLICT', 'This project’s owner signs in with their password.', { reason: 'OWNER_HAS_PASSWORD' });
        }
        await auditAuth(meta, request, { action: 'design_link_issued', actorId: owner.id, actorLabel: owner.name });
        // After `#`, as the first link is: no request carries it and no log holds it.
        return { data: { url: `http://127.0.0.1:${String(deps.port)}${request.body.to}#designToken=${links.issue()}` } };
      },
    );
  };
}
