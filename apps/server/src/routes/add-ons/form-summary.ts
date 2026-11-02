// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /add-ons/:key/forms/:id/summary` — a form's results, counted over
 * every answer (`forms/summary.ts`), for a forms add-on's own pages: a
 * survey's results page reads totals, never the rows.
 *
 * Read under the add-on's read grant on its answers table: whoever may read
 * the answers may read their counts, and nobody else (403); a reader held to
 * some of the answers is refused too, as the counts are of every answer and
 * would tell them of the others. The form is read
 * as published (what strangers answered), else as its draft. A form that is
 * not there, or an add-on that declares no forms, answers 404. With an
 * invitations table, the reply says how many were invited and how many of
 * them answered.
 */
import { FORM_LANGUAGES, parseForm } from '@adminium/add-on-contracts/forms';
import type { MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';

import type { ConnectionManager } from '../../connections/manager.js';
import type { Row } from '../../crud/mask.js';
import { isRowLimited } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { ForbiddenError, NotFoundError } from '../../errors.js';
import { jsonOf } from '../../forms/catalog.js';
import { formsAddOnsOn } from '../../forms/installed.js';
import { invitationCounts, summariseAnswers } from '../../forms/summary.js';

export interface FormSummaryRouteDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
}

const counted = z.object({ answered: z.number() });
const questionSummary = z.union([
  counted.extend({ kind: z.enum(['one', 'several']), choices: z.record(z.string(), z.number()) }),
  counted.extend({ kind: z.literal('score'), counts: z.array(z.number()), promoters: z.number(), passives: z.number(), detractors: z.number(), recommendScore: z.number().nullable() }),
  counted.extend({ kind: z.literal('stars'), counts: z.array(z.number()), average: z.number().nullable() }),
  counted.extend({ kind: z.string() }),
]);

export const formSummaryReply = z.object({
  data: z.object({
    /** Every answer counted. */
    total: z.number(),
    /** Answers per language: every language the form lists, and any other an answer came in. */
    byLanguage: z.partialRecord(z.enum(FORM_LANGUAGES), z.number()),
    /** The survey's recommend question's score; null when it has none or nobody gave one. */
    recommendScore: z.number().nullable(),
    questions: z.record(z.string(), questionSummary),
    /** How many were invited, and how many of them answered; null when the add-on keeps no invitations. */
    invited: z.number().nullable(),
    answered: z.number().nullable(),
  }),
});

export function formSummaryRoutes(deps: FormSummaryRouteDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/add-ons/:key/forms/:id/summary',
      {
        preHandler: [app.requireAuth],
        schema: { params: z.object({ key: z.string().min(1).max(64), id: z.string().min(1).max(200) }), response: { 200: formSummaryReply } },
      },
      async (request) => {
        const { key, id } = request.params;
        const row = await deps.meta.db.selectFrom('adminium_manifests').select(['status', 'connectionId']).where('manifestKey', '=', key).where('kind', '=', 'add-on').executeTakeFirst();
        if (row === undefined || row.status !== 'installed' || row.connectionId === null) throw new NotFoundError('This add-on has no forms here.', { addOn: key });
        const connectionId = row.connectionId;
        const view = await loadSnapshotView(deps.meta, connectionId, { forOthers: true }).catch(() => null);
        const addOn = view === null ? undefined : (await formsAddOnsOn(deps.meta, connectionId, view)).find((one) => one.key === key);
        const answers = addOn?.answers ?? null;
        const forms = addOn?.forms ?? null;
        if (addOn === undefined || answers === null || forms === null) throw new NotFoundError('This add-on has no forms here.', { addOn: key });
        // Whoever may read the answers may read their counts; nobody else.
        if (!(await request.can(`table:${connectionId}:${answers.id}:read`))) throw new ForbiddenError('You may not read this form’s answers.', 'FORBIDDEN', { addOn: key });
        // Counted over every answer or not at all: a reader held to some answers would be told of the others.
        const set = await app.rbac.resolve(request);
        if (set.superAdmin !== true && view !== null) {
          const context = await rowLimitContextOf(deps.meta, set, connectionId, view.model);
          if (context !== null && isRowLimited(context, answers.id, 'read')) throw new ForbiddenError('You may read only some of this form’s answers, so their counts are not shown.', 'FORBIDDEN', { addOn: key, reason: 'row-limit' });
        }

        const { db } = await deps.manager.data(connectionId);
        const pk = forms.primaryKey[0];
        if (pk === undefined) throw new NotFoundError('This form is not there.', { addOn: key });
        const form = (await db
          .selectFrom(forms.id as never)
          .selectAll()
          .where(sql.ref(pk), '=', id as never)
          .executeTakeFirst()) as Row | undefined;
        if (form === undefined) throw new NotFoundError('This form is not there.', { addOn: key });
        const published = jsonOf(form['published']) as { definition?: unknown; settings?: unknown } | null | undefined;
        const parsed = published !== null && published !== undefined ? parseForm(published.definition, published.settings) : parseForm(jsonOf(form['definition']), jsonOf(form['settings']));
        if (!parsed.ok) throw new NotFoundError('This form cannot be read.', { addOn: key });

        const summary = await summariseAnswers(db, answers, parsed.form, form[pk]);
        const invited = addOn.invitations === null ? null : await invitationCounts(db, addOn.invitations, form[pk]);
        return { data: { ...summary, invited: invited?.invited ?? null, answered: invited?.answered ?? null } };
      },
    );
  };
}
