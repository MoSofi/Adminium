// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STRANGER'S DOOR NEVER ACTS AS A SIGNED-IN PERSON.
 *
 * On the install's own page the browser sends this host's cookies with the
 * door's reads and answers ("Per visitor" needs its own cookie there), so a
 * member of staff signed in on the same host arrives with their session. The
 * door is a stranger's: whatever cookie or key arrives, every request runs
 * as nobody. The session and any key are let go before the route runs, so:
 *
 * - a write a door makes (a form's answer, a chat's message) is judged as a
 *   stranger's: a right the person holds (taking a refund, writing a table a
 *   stranger cannot) is never used by a page they are trying out;
 * - the staff CSRF check sees no session, so the door's own checks (its
 *   origin check, its human check) are the only ones;
 * - `request.can` answers as for a stranger.
 *
 * The one exception is a preview: a `GET` that asks `?preview=1` keeps the
 * session, because only a signed-in person who may read the add-on's table
 * is shown a draft (each door checks that itself), and a preview writes
 * nothing.
 *
 * Added inside each door's own plugin (a Fastify hook belongs to the plugin
 * that adds it), after the auth plugin's hooks have run.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** Whether a request is a staff preview's read: the only one that keeps the session. */
export function asksPreviewRead(request: Pick<FastifyRequest, 'method' | 'query'>): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  return (request.query as { preview?: unknown } | undefined)?.preview === '1';
}

/** Lets go of the signed-in person and any key on every request of this plugin, a preview's read aside. */
export function strangerDoor(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    if (asksPreviewRead(request)) return;
    request.user = null;
    request.session = null;
    request.apiKey = null;
    request.apiKeyPrincipal = null;
    request.rbacResolution = null;
  });
}
