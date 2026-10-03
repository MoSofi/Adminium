// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The preview's own sign-in.
 *
 * The staff side and the dashboard need a signed-in session to show
 * anything, and the preview runs on its own name (`localhost:<port>`), where
 * the owner's session is not sent. It is given a session of its own — and a
 * LOW one: a user that holds only the roles of the app being built, so code
 * the model wrote, running in the preview, can do what the app's own staff
 * could do and nothing more.
 *
 * The Designer asks for a one-use ticket (on its own name, signed in); the
 * preview frame opens `/designer-preview/enter?ticket=…` on the preview's
 * name; the ticket is spent, the session set, and the frame sent on. The
 * cookie is made for a frame on another site (SameSite=None, Partitioned).
 */
import { randomBytes } from 'node:crypto';

import { rolesRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createSession, sessionCookieNameOf } from '../auth/sessions.js';
import { hostRole } from './design-mode.js';

/** Who the preview signs in as. `.localhost` is a name nobody can own. */
export const PREVIEW_USER_EMAIL = 'preview@adminium.localhost';
/** How long a ticket waits to be spent. */
export const PREVIEW_TICKET_MS = 60_000;
/** A preview session lasts as long as the owner's. */
const PREVIEW_SESSION_MS = 12 * 60 * 60 * 1000;

export interface PreviewTickets {
  /** A ticket for one app's preview, spent on first use. */
  issue(appKey: string): string;
}

/** The preview user, made once, holding exactly the app's roles. */
export async function previewUser(meta: MetaDb, appKey: string): Promise<User> {
  const users = usersRepo(meta);
  const roles = rolesRepo(meta);
  const user = (await users.findByEmail(PREVIEW_USER_EMAIL)) ?? (await users.create({ email: PREVIEW_USER_EMAIL, name: 'Preview', passwordHash: null, status: 'active' }));
  const wanted = (await roles.list()).filter((role) => role.appKey === appKey);
  const held = await roles.rolesForUser(user.id);
  for (const role of held) if (!wanted.some((other) => other.id === role.id)) await roles.removeFromUser(user.id, role.id);
  for (const role of wanted) if (!held.some((other) => other.id === role.id)) await roles.assignToUser(user.id, role.id);
  return user;
}

const enterQuery = z.object({ ticket: z.string().regex(/^[0-9a-f]{48}$/), to: z.string().max(500) });

/** Where a preview may be sent: a path of this server, under the app's own address or the dashboard's. */
export function safeTarget(to: string, appKey: string): string | null {
  if (!to.startsWith('/') || to.startsWith('//') || to.includes('\\') || to.includes('..') || /[\r\n]/.test(to)) return null;
  if (to.startsWith('/api/') || to.startsWith('/designer-preview/')) return null;
  if (to.startsWith('/apps/') && !to.startsWith(`/apps/${appKey}/`)) return null;
  return to;
}

export function registerPreview(app: FastifyInstance, deps: { meta: MetaDb; port: number }): PreviewTickets {
  const tickets = new Map<string, { appKey: string; expires: number }>();

  app.get('/designer-preview/enter', { config: { rateLimitBucket: 'designer' } }, async (request, reply) => {
    if (hostRole(request.headers.host, deps.port) !== 'preview') {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    }
    const parsed = enterQuery.safeParse(request.query);
    const held = parsed.success ? tickets.get(parsed.data.ticket) : undefined;
    if (!parsed.success || held === undefined) return reply.code(401).type('text/plain; charset=utf-8').send('This preview link has been used. Open the preview again from the Designer.');
    tickets.delete(parsed.data.ticket);
    if (held.expires < Date.now()) return reply.code(401).type('text/plain; charset=utf-8').send('This preview link is too old. Open the preview again from the Designer.');
    const target = safeTarget(parsed.data.to, held.appKey);
    if (target === null) return reply.code(400).type('text/plain; charset=utf-8').send('That is not a page of this app.');

    const user = await previewUser(deps.meta, held.appKey);
    const now = Date.now();
    const minted = await createSession(deps.meta, user.id, { ip: request.ip, userAgent: 'preview' }, now, { absoluteDeadline: now + PREVIEW_SESSION_MS });
    // The preview is framed by the Designer, another site: a Lax cookie would never be sent inside the frame.
    // `None` needs `Secure`, which browsers allow on `localhost` over plain http; `Partitioned` keeps it to frames
    // under this Designer, and lets it work where third-party cookies are otherwise blocked.
    void reply.setCookie(sessionCookieNameOf(request), minted.token, {
      path: '/',
      httpOnly: true,
      signed: true,
      sameSite: 'none',
      secure: true,
      partitioned: true,
      maxAge: Math.floor(PREVIEW_SESSION_MS / 1000),
    });
    return reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').redirect(target, 303);
  });

  return {
    issue(appKey) {
      const now = Date.now();
      for (const [ticket, held] of tickets) if (held.expires < now) tickets.delete(ticket);
      const ticket = randomBytes(24).toString('hex');
      tickets.set(ticket, { appKey, expires: now + PREVIEW_TICKET_MS });
      return ticket;
    },
  };
}
