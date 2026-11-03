// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a forms add-on's builder asks the engine about its forms, for staff.
 *
 *   GET /forms/mail     whether mail a stranger causes (a sign-up's
 *                       confirmation, staff notices by e-mail) can go now, and
 *                       why not: no public address set, or no mail server
 *   GET /forms/status   everything the builder's blocked cards and its Share
 *                       tab say: the mail answer above, whether strangers can
 *                       reach the pages, whether the privacy notice is set,
 *                       the public address, the listed websites, and the
 *                       roles a form may tell
 *
 * `/forms/mail` is read by anyone signed in: it says nothing but which of two
 * settings is missing, so the builder can say why no mail goes (the answer is
 * kept).
 *
 * `/forms/status` is read by a signed-in person (never an API key) who may
 * read the forms of an installed forms add-on: the people the builder is for,
 * a marketer among them, who hold neither the privacy action nor the roles
 * action. Every value is one any visitor of a form already meets (the
 * address, the websites a form shows on, whether it can be reached at all) or
 * a setting's name (a role's): no address of a person, no member of a role,
 * nobody who added a website. Everyone else is refused (403).
 */
import { rolesRepo, roleNameFor, userPrefsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { storedPublicOrigin } from '../../email/door-reach.js';
import { ForbiddenError } from '../../errors.js';
import { formsAddOnsOn, storedFormsAddOns } from '../../forms/installed.js';
import { formsMailBlocked } from '../../forms/mail.js';
import { formsReach, type FormsReachFacts } from '../../forms/reach.js';
import { REACHABILITY_STATES } from '../../payments/reachability.js';
import { readWebsites } from '../../forms/websites.js';
import { sameLanguage } from '../../i18n/bcp47.js';
import { privacyNoticeReady } from '../../privacy/business.js';

export interface FormsStaffDeps {
  meta: MetaDb;
  secret: string;
  /** The facts the reach answer reads (the forms door's own); absent, the status read is not served. */
  reach?: FormsReachFacts | undefined;
}

const mailAnswer = z.object({
  /** Whether a confirmation and a staff e-mail go now. */
  sends: z.boolean(),
  /** Why not: no public address (`system.publicOrigin`), or no mail server; null when they go. */
  blocked: z.enum(['no-public-origin', 'no-mail-server']).nullable(),
});

export const formsMailReply = z.object({ data: mailAnswer });

export const formsStatusReply = z.object({
  data: z.object({
    mail: mailAnswer,
    /** "Can visitors reach your public pages?": the forms door's own answer for this request, as `/privacy/reach` gives it. */
    reach: z.object({ state: z.enum(REACHABILITY_STATES) }),
    /** Whether the privacy notice is set (the business's name and the notice's address): a form is not served until it is. */
    notice: z.boolean(),
    /** This server's public address (`system.publicOrigin`): a form's link is `<publicOrigin>/x/forms/<slug>`; null while unset. */
    publicOrigin: z.string().nullable(),
    /** The websites a form may be shown on in a frame ("Your websites"), as origins. */
    websites: z.array(z.string()),
    /** Every role, by its name in the reader's language: whom a form may tell. No member of any. */
    roles: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});

export function formsStaffRoutes(deps: FormsStaffDeps): FastifyPluginAsyncZod {
  const { meta } = deps;

  /** Whether this person may read the forms of an installed forms add-on, on any database. */
  async function readsSomeForms(can: (permission: string) => Promise<boolean>): Promise<boolean> {
    const stored = (await storedFormsAddOns(meta)).filter((addOn) => addOn.status === 'installed');
    for (const connectionId of new Set(stored.map((addOn) => addOn.connectionId))) {
      const view = await loadSnapshotView(meta, connectionId, { forOthers: true }).catch(() => null);
      if (view === null) continue;
      for (const addOn of await formsAddOnsOn(meta, connectionId, view, stored)) {
        if (addOn.forms !== null && (await can(`table:${connectionId}:${addOn.forms.id}:read`))) return true;
      }
    }
    return false;
  }

  return async (app) => {
    app.get('/forms/mail', { preHandler: [app.requireAuth], schema: { response: { 200: formsMailReply } } }, async () => {
      const blocked = await formsMailBlocked(deps.meta, deps.secret);
      return { data: { sends: blocked === null, blocked } };
    });

    const reach = deps.reach;
    if (reach === undefined) return;

    app.get(
      '/forms/status',
      {
        preHandler: [app.requireAuth],
        schema: {
          tags: ['forms'],
          summary: 'What a forms builder shows about its forms',
          description:
            'Whether mail a stranger causes goes, whether strangers can reach the pages, whether the privacy notice is set, the public address, the listed websites, and the roles a form may tell. For a signed-in person who may read the forms of an installed forms add-on.',
          response: { 200: formsStatusReply },
        },
      },
      async (request) => {
        // A signed-in person only (the session is what `requireAuth` asks for), and one the add-on lets read its forms.
        if (!(await readsSomeForms((permission) => request.can(permission)))) {
          throw new ForbiddenError('Only someone who may read a forms add-on’s forms reads its status.', 'FORBIDDEN', { reason: 'forms-read' });
        }
        const [blocked, answer, notice, publicOrigin, websites, roles] = await Promise.all([
          formsMailBlocked(meta, deps.secret),
          formsReach(meta, reach, request),
          privacyNoticeReady(meta),
          storedPublicOrigin(meta),
          readWebsites(meta),
          rolesRepo(meta).list(),
        ]);
        const locale = request.user === null ? undefined : (await userPrefsRepo(meta).resolve(request.user.id)).locale;
        return {
          data: {
            mail: { sends: blocked === null, blocked },
            reach: { state: answer.state },
            notice,
            publicOrigin,
            websites: websites.map((website) => website.origin),
            roles: roles.map((role) => ({ id: role.id, name: locale === undefined ? role.name : roleNameFor(role, (names) => sameLanguage(names, locale)) })),
          },
        };
      },
    );
  };
}
