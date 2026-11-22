// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DOOR OF AN ADD-ON'S OWN SMALL PAGE (`addOn.framedPage`).
 *
 * `GET /x/add-on-frame/<add-on>` answers the page and `…/frame.js` its one
 * script, for an add-on Adminium vouches for, attached to an installed app and
 * not switched off there. Nothing else is told: every other case is the one 404.
 *
 * The page has a policy of its own (`framedPagePolicy`) that sandboxes it
 * however it is opened, names the outside hosts the add-on declared, and lets
 * only this host and the listed websites frame it. Its address carries no
 * token. A sandboxed page has no origin, so a browser sends no referrer from
 * it, whatever the header below says. The app's pages keep their own policy,
 * unchanged.
 */
import { framedPageHtml, framedPagePolicy, framedPageSchema, type FramedPage } from '@adminium/add-on-contracts';
import type { MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { appsSwitchedOn } from '../../add-ons/page-gate.js';
import { installsOf } from '../../installs/resolve.js';
import { tagRoutes } from '../../security/route-audience.js';
import { strangerDoor } from '../x-door/stranger.js';

const params = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }).strict();

export interface AddOnFrameDeps {
  meta: MetaDb;
  store: { readVerifiedFile(key: string, version: string, path: string): Promise<{ bytes: Buffer }> };
  /** Whether Adminium vouches for this package's bytes, as for every door a stranger uses (`forms/vouched.ts`). */
  vouched: (pkg: { key: string; version: string }) => Promise<boolean>;
  /** The business's listed websites: an app's page framed on one of them frames this page in turn. */
  websites: () => Promise<readonly string[]>;
}

export function addOnFrameRoutes(deps: AddOnFrameDeps) {
  /** The add-on's page and installed version, while it is attached to an installed app and on there. */
  async function liveFrame(key: string): Promise<{ page: FramedPage; version: string } | null> {
    const copies = (await installsOf(deps.meta).listByKey(key)).filter((copy) => copy.row.kind === 'add-on' && copy.row.status === 'installed');
    if (copies.length === 0) return null;
    const appsOn = await appsSwitchedOn(deps.meta);
    const live = copies.find((copy) => copy.attachments.some((attachment) => attachment.disabledAt === null && appsOn.has(attachment.attachedTo)));
    if (live === undefined || !(await deps.vouched({ key, version: live.row.version }))) return null;
    const parsed = framedPageSchema.safeParse((live.document as { addOn?: { framedPage?: unknown } } | null)?.addOn?.framedPage);
    return parsed.success ? { page: parsed.data, version: live.row.version } : null;
  }

  const gone = (reply: FastifyReply) => reply.status(404).type('text/plain; charset=utf-8').send('Not found');
  const originOf = (request: FastifyRequest) => `${request.protocol}://${request.host}`;

  return async (app: FastifyInstance) => {
    tagRoutes(app, 'public');
    // A stranger's door: a signed-in person's session or key is let go here.
    strangerDoor(app);
    const config = { rateLimitBucket: 'public' as const };

    app.get('/x/add-on-frame/:key', { config, schema: { hide: true, params } }, async (request, reply) => {
      const { key } = request.params as z.infer<typeof params>;
      const live = await liveFrame(key);
      if (live === null) return gone(reply);
      const origin = originOf(request);
      return reply
        .header('content-security-policy', framedPagePolicy(origin, key, live.page, await deps.websites()))
        .header('referrer-policy', 'strict-origin-when-cross-origin')
        .header('x-content-type-options', 'nosniff')
        .header('x-robots-tag', 'noindex')
        .header('cross-origin-resource-policy', 'cross-origin')
        .header('cache-control', 'no-store')
        .removeHeader('x-frame-options')
        .type('text/html; charset=utf-8')
        .send(framedPageHtml(key, live.page));
    });

    app.get('/x/add-on-frame/:key/frame.js', { config, schema: { hide: true, params } }, async (request, reply) => {
      const { key } = request.params as z.infer<typeof params>;
      const live = await liveFrame(key);
      if (live === null) return gone(reply);
      let bytes: Buffer;
      try {
        // Checked on read: a package changed on disk since it was installed is not served.
        ({ bytes } = await deps.store.readVerifiedFile(key, live.version, live.page.script));
      } catch {
        return gone(reply);
      }
      return reply
        .header('x-content-type-options', 'nosniff')
        // Fetched by a page with no origin, so it must be open to a cross-origin read.
        .header('cross-origin-resource-policy', 'cross-origin')
        .header('cache-control', 'no-cache')
        .type('text/javascript; charset=utf-8')
        .send(bytes);
    });
  };
}
