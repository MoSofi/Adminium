// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A campaign's audience when it is the people of a table (`email/audience-
 * table.ts`): what the send dialog reads and the two things it changes.
 *
 *   GET  /email-audience/tables              the tables the sender may pick (comp E1.2)
 *   GET  /email-audience/views               "Only these": a table's saved views
 *   GET  /email-audience/review              the first send's review (comp E1.7)
 *   POST /email-audience/review/answer       "Confirm" or "Leave out", one person
 *   PUT  /email-audience/existing-customers  the owner's switch and their tick (comp E1.18)
 *
 * The breakdown (comp E1.4) is the campaign's own audience preview
 * (`POST /email-templates/:id/audience/preview`), which answers it for a
 * table audience through {@link tableAudiencePreview}.
 *
 * ─── Who may ───────────────────────────────────────────────────────────────
 * Each rides the campaigns' grant (`settings.manage`) and is judged as the
 * sender reaches the table: its read grant, the addresses in clear, their
 * row limits (`openPeopleTable`). A table they may not read is never listed;
 * one whose addresses they see masked is listed, and refused by name when
 * they pick it. "Confirm" and "Leave out" write a person's consent, so they
 * are judged as "Record consent" is: the table's update grant and the row
 * inside the update reach, a signed-in person's, never an API key's. The
 * switch is the owner's claim about how addresses were taken; it is set by
 * a signed-in person, with the tick, and audited.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { EmailTemplate, MetaDb } from '@adminium/meta';

import { audited, auditExempt } from '../../audit/coverage.js';
import type { ConsentEvent, ConsentService, StaffMember } from '../../consent/index.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { campaignUnfilled } from '../../email/audience.js';
import {
  AudienceRefusedError,
  answerReview,
  audienceBreakdown,
  audienceTables,
  audienceVariableNames,
  audienceViews,
  existingCustomersView,
  openPeopleTable,
  openTableAudience,
  reviewList,
  type AudienceDeps,
  type AudienceBreakdown,
  type PeopleTableAccess,
  type TableAudience,
} from '../../email/audience-table.js';
import { setExistingCustomers } from '../../email/existing-customers.js';
import { ForbiddenError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { estimateMinutes } from '../../jobs/email-campaign-run.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { permissionSetAllows } from '../../rbac/resolver.js';

export interface EmailAudienceRoutesDeps {
  manager: Pick<ConnectionManager, 'data'>;
  consent: ConsentService;
  /** The table's declared consent column following the log (`people/consent-writes.ts` `mirrorEvent`). */
  mirror: (event: ConsentEvent) => Promise<number>;
}

const tableRef = z.object({ connectionId: z.string().min(1).max(64), table: z.string().min(1).max(200) });

const existingCustomersShape = z.object({
  /** The app declares the opt-out mark and who counts as a customer: only then may the switch be on. */
  offered: z.boolean(),
  on: z.boolean(),
  at: z.number().nullable(),
  by: z.object({ id: z.string(), name: z.string() }).nullable(),
});

const tablesReply = z.object({
  tables: z.array(
    z.object({
      connectionId: z.string(),
      table: z.string(),
      label: z.string(),
      appKey: z.string(),
      appName: z.string(),
      kind: z.enum(['people', 'companies']),
      consentPurpose: z.enum(['newsletter', 'surveys']).nullable(),
      addresses: z.enum(['readable', 'masked', 'hidden']),
      existingCustomers: existingCustomersShape,
    }),
  ),
});

const viewsReply = z.object({
  views: z.array(z.object({ id: z.string(), name: z.string(), shared: z.boolean(), refused: z.enum(['view-search', 'view-hidden-column']).nullable() })),
});

const reviewQuery = tableRef.extend({ limit: z.coerce.number().int().min(1).max(500).default(200) });
const reviewReply = z.object({
  /** The purpose the table's consent column stands for; null when it has none (nobody to review). */
  purpose: z.enum(['newsletter', 'surveys']).nullable(),
  /** How many are waiting, of whom the first `limit` are listed. */
  total: z.number().int(),
  people: z.array(z.object({ key: z.string(), name: z.string(), address: z.string(), tickedBy: z.string().nullable(), tickedAt: z.number().nullable() })),
});

const answerBody = tableRef.extend({ key: z.string().min(1).max(200), answer: z.enum(['confirm', 'leave-out']) });
const answerReply = z.object({ event: z.object({ id: z.string(), state: z.enum(['yes', 'no']), at: z.number() }) });

const switchBody = tableRef.extend({ on: z.boolean(), optOutOffered: z.boolean() });
const switchReply = z.object({ existingCustomers: existingCustomersShape });

/** The signed-in person: the campaign routes' grant, and never an API key for what writes a person's consent. */
function signedIn(request: FastifyRequest): StaffMember {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('This is done by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const user = (request as unknown as { user?: { id?: string; name?: string | null; email?: string | null } }).user;
  if (user?.id === undefined) throw new UnauthorizedError();
  return { id: user.id, label: user.name?.trim() || user.email || 'someone' };
}

async function requireCampaigns(request: FastifyRequest): Promise<void> {
  if (await request.can(PERMISSIONS.settingsManage)) return;
  throw new ForbiddenError('You do not have permission to send campaigns.', 'FORBIDDEN', { permission: PERMISSIONS.settingsManage });
}

/** The table as the person reaches it, or the refusal by name. */
async function reached(deps: AudienceDeps, userId: string, ref: { connectionId: string; table: string }): Promise<PeopleTableAccess> {
  const opened = await openPeopleTable(deps, userId, ref.connectionId, ref.table);
  if (!('ok' in opened)) throw new AudienceRefusedError(opened.refuse, opened.label);
  return opened.ok;
}

/**
 * A table audience's preview, the same arithmetic the run does: its counts
 * each way, the placeholders it fills, and those nobody's send would. The
 * sender is refused by name as the send would refuse them.
 */
export async function tableAudiencePreview(
  deps: AudienceDeps,
  userId: string | null,
  audience: TableAudience,
  variants: readonly Pick<EmailTemplate, 'subject' | 'preheader' | 'blocks' | 'footer'>[],
  ratePerHour: number | null,
): Promise<{ total: number; skipped: number; unfilled: string[]; estimateMinutes: number | null; breakdown: AudienceBreakdown; variables: string[] }> {
  const opened = await openTableAudience(deps, userId, audience);
  if (!('ok' in opened)) throw new AudienceRefusedError(opened.refuse, opened.label);
  const breakdown = await audienceBreakdown(deps, opened.ok);
  const variables = audienceVariableNames(opened.ok);
  return {
    total: breakdown.rows - breakdown.noAddress,
    skipped: breakdown.rows - breakdown.noAddress - breakdown.recipients,
    unfilled: campaignUnfilled(variants, variables),
    estimateMinutes: estimateMinutes(breakdown.recipients, ratePerHour),
    breakdown,
    variables,
  };
}

/** The audience routes, on the e-mail documents' plugin (`index.ts`). */
export async function registerEmailAudienceRoutes(app: FastifyInstance, meta: MetaDb, deps: EmailAudienceRoutesDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const audience: AudienceDeps = { meta, manager: deps.manager, consent: deps.consent };

  typed.get(
    '/email-audience/tables',
    {
      config: { audit: auditExempt('the tables a campaign may go to — reads the people declarations and the sender\'s grants, writes nothing') },
      schema: { response: { 200: tablesReply } },
    },
    async (request) => {
      const { id } = signedIn(request);
      await requireCampaigns(request);
      return { tables: await audienceTables(audience, id) };
    },
  );

  typed.get(
    '/email-audience/views',
    {
      config: { audit: auditExempt('the saved views of a table — reads them, writes nothing') },
      schema: { querystring: tableRef, response: { 200: viewsReply } },
    },
    async (request) => {
      const { id } = signedIn(request);
      await requireCampaigns(request);
      return { views: await audienceViews(audience, await reached(audience, id, request.query)) };
    },
  );

  typed.get(
    '/email-audience/review',
    {
      config: { audit: auditExempt('the first send\'s review — reads the table and the consent log, writes nothing') },
      schema: { querystring: reviewQuery, response: { 200: reviewReply } },
    },
    async (request) => {
      const { id } = signedIn(request);
      await requireCampaigns(request);
      return await reviewList(audience, await reached(audience, id, request.query), request.query.limit);
    },
  );

  typed.post(
    '/email-audience/review/answer',
    {
      config: { audit: audited('rbac') },
      schema: { body: answerBody, response: { 200: answerReply } },
    },
    async (request) => {
      const staff = signedIn(request);
      await requireCampaigns(request);
      const access = await reached(audience, staff.id, request.body);
      // A person's consent is written as "Record consent" writes it: by whoever may change their row.
      if (!permissionSetAllows(access.set, `table:${access.declared.connectionId}:${access.wholeTable.id}:update`)) {
        throw new ForbiddenError(`You may not change ${access.label}, so you can't answer for its people.`, 'TABLE_FORBIDDEN');
      }
      const event = await answerReview({ ...audience, mirror: deps.mirror }, access, { key: request.body.key, answer: request.body.answer, staff });
      await app.rbac.audit(request, {
        category: 'data',
        action: request.body.answer === 'confirm' ? 'consent.review-confirm' : 'consent.review-leave-out',
        connectionId: access.declared.connectionId,
        entity: { connectionId: access.declared.connectionId, table: access.wholeTable.id, pk: {}, label: request.body.key },
        changes: { after: { event: event.id, purpose: event.purpose, state: event.state } },
      });
      return { event: { id: event.id, state: event.state as 'yes' | 'no', at: event.at } };
    },
  );

  typed.put(
    '/email-audience/existing-customers',
    {
      config: { audit: audited('rbac') },
      schema: { body: switchBody, response: { 200: switchReply } },
    },
    async (request) => {
      const { id } = signedIn(request);
      await requireCampaigns(request);
      const access = await reached(audience, id, request.body);
      const { on, optOutOffered } = request.body;
      if (on && !access.offered) throw new AudienceRefusedError('existing-customers-off', access.label);
      if (on && !optOutOffered) {
        throw new ValidationFailedError('Tick "I offered a way to say no when we took their address" to switch existing customers on.', { field: 'optOutOffered' });
      }
      const switched = await setExistingCustomers(meta, { connectionId: access.declared.connectionId, table: access.wholeTable.id, on, optOutOffered, by: id }, app.rbac.now());
      await app.rbac.audit(request, {
        category: 'settings',
        action: 'email-audience.existing-customers',
        connectionId: access.declared.connectionId,
        changes: { before: { on: access.switched?.on === true }, after: { table: access.wholeTable.id, on: switched.on, optOutOffered } },
      });
      return { existingCustomers: await existingCustomersView(meta, { offered: access.offered, switched }) };
    },
  );
}
