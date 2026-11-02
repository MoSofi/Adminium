// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a forms add-on's builder asks the engine about its forms, for staff.
 *
 *   GET /forms/mail   whether mail a stranger causes (a sign-up's
 *                     confirmation, staff notices by e-mail) can go now, and
 *                     why not: no public address set, or no mail server
 *
 * Read by anyone signed in: it says nothing but which of two settings is
 * missing, so the builder can say why no mail goes (the answer is kept).
 */
import type { MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { formsMailBlocked } from '../../forms/mail.js';

export interface FormsStaffDeps {
  meta: MetaDb;
  secret: string;
}

export const formsMailReply = z.object({
  data: z.object({
    /** Whether a confirmation and a staff e-mail go now. */
    sends: z.boolean(),
    /** Why not: no public address (`system.publicOrigin`), or no mail server; null when they go. */
    blocked: z.enum(['no-public-origin', 'no-mail-server']).nullable(),
  }),
});

export function formsStaffRoutes(deps: FormsStaffDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get('/forms/mail', { preHandler: [app.requireAuth], schema: { response: { 200: formsMailReply } } }, async () => {
      const blocked = await formsMailBlocked(deps.meta, deps.secret);
      return { data: { sends: blocked === null, blocked } };
    });
  };
}
