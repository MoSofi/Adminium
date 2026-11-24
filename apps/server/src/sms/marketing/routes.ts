// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Texts → Marketing: what the console's send dialog, its results and
 * a person's consent card read and do.
 *
 *   GET  /sms/marketing/setup                  can marketing go at all, and why not; the tables and templates to choose from
 *   POST /sms/marketing/preview                who a run would reach, who it would not and why, when, and the day's limit
 *   POST /sms/marketing/preview/people         "See who": the people of one group
 *   GET  /sms/marketing/runs                   runs, newest first
 *   POST /sms/marketing/runs                   make a run, now or at a time
 *   GET  /sms/marketing/runs/:id               one run and its numbers
 *   GET  /sms/marketing/runs/:id/people        its people, with how each text ended
 *   POST /sms/marketing/runs/:id/cancel        stop it
 *   GET  /sms/marketing/consent                one person's marketing yes, and whether it is confirmed
 *   POST /sms/marketing/consent                a named staff member records a person's marketing yes
 *   POST /sms/marketing/consent/confirm-request   mail them the confirmation (double opt-in)
 *   POST /sms/marketing/consent/confirm-in-person a named staff member records that they confirmed in person
 *
 * Mirrors e-mail campaigns: `system:settings:manage` on every route, and the
 * operator's `marketingCampaigns` switch on the send. Texts cost the business
 * money, so every change needs a signed-in person, never an API key. The
 * audience is read as that person, so a table, a row or a mobile column their
 * role hides is not theirs to text.
 *
 * No reply or audit row holds a number: a mask (`+49 ••• 34`) at most.
 * Refusals are stable codes the console words itself; each error's sentence
 * is English for the log and a caller with no console.
 */
import { CONSENT_HOWS, usersRepo, type ConsentPerson } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited, auditExempt } from '../../audit/coverage.js';
import type { StaffMember } from '../../consent/types.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { tagRoutes } from '../../security/route-audience.js';
import { refuseUnlessAllowed } from '../../trial/refuse.js';
import type { TrialPolicy } from '../../trial/policy.js';
import { MARKETING_HOURS } from '../send/window.js';
import type { TextConsentService } from '../consent/types.js';
import { DOUBLE_OPT_IN_COUNTRIES, NO_REPLY_COUNTRIES, NO_TEXT_CALLING_CODES } from '../consent/rules.js';
import { openTextAudience, rowNow, textAudienceTables, type TextAudienceDeps } from './audience.js';
import type { TextConfirm } from './confirm.js';
import { preflight, type PreflightDeps } from './preflight.js';
import { TextAudienceRefusedError, type TextRuns } from './runs.js';
import { TEXT_RECIPIENT_STATES, TEXT_RUN_REFUSALS, TEXT_RUN_STATES, type TextRunView } from './types.js';

export interface TextMarketingRoutesDeps extends PreflightDeps, TextAudienceDeps {
  runs: TextRuns;
  confirm: TextConfirm;
  consent: TextAudienceDeps['consent'] & Pick<TextConsentService, 'record'>;
  policy: Pick<TrialPolicy, 'allows'>;
  /** Templates a run may name: key, name and languages switched on. */
  templates: () => Promise<{ key: string; name: string; languages: string[] }[]>;
}

const id = z.string().min(1).max(64);
const audienceSchema = z.object({ connectionId: id, table: z.string().min(1).max(200), viewId: id.nullable().optional() }).strict();
const personSchema = z.object({ connectionId: id, table: z.string().min(1).max(200), key: z.string().min(1).max(200) }).strict();
const refusalSchema = z.object({ reason: z.enum(TEXT_RUN_REFUSALS), detail: z.string().nullable() }).strict();

const preflightView = z.object({
  ok: z.boolean(),
  refusals: z.array(refusalSchema),
  sender: z.object({ kind: z.enum(['number', 'name', 'pool']), value: z.string() }).nullable(),
  replies: z.object({ canReceiveStop: z.boolean(), state: z.string() }),
});

const setupReply = z.object({
  data: z.object({
    preflight: preflightView,
    hours: z.object({ from: z.string(), to: z.string(), days: z.literal('monday-to-saturday') }),
    daily: z.object({ limit: z.number(), used: z.number() }),
    /** Where marketing texts never go, and where a yes must be confirmed first. */
    countries: z.object({ noReplies: z.array(z.string()), blockedCallingCodes: z.array(z.string()), doubleOptIn: z.array(z.string()) }),
    tables: z.array(z.object({ connectionId: z.string(), table: z.string(), label: z.string(), appKey: z.string(), appName: z.string(), phones: z.enum(['readable', 'masked', 'hidden']) })),
    templates: z.array(z.object({ key: z.string(), name: z.string(), languages: z.array(z.string()) })),
  }),
});

const previewBody = z.object({ templateKey: z.string().min(1).max(80), audience: audienceSchema, scheduleAt: z.number().int().nonnegative().optional() }).strict();
const previewReply = z.object({
  data: z.object({
    preflight: preflightView,
    template: z.object({ refusals: z.array(refusalSchema), unfilled: z.array(z.string()), languages: z.array(z.string()) }),
    people: z.number(),
    canSend: z.number(),
    skipped: z.record(z.string(), z.number()),
    countries: z.array(z.object({ country: z.string(), people: z.number(), canSend: z.number(), opensAt: z.number().nullable(), noWindow: z.boolean() })),
    daily: z.object({ limit: z.number(), used: z.number(), left: z.number(), days: z.number() }),
  }),
});

const peopleBody = z.object({ audience: audienceSchema, reason: z.string().min(1).max(40), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) }).strict();
const peopleReply = z.object({
  data: z.object({
    people: z.array(z.object({ key: z.string(), name: z.string().nullable(), phone: z.string().nullable(), country: z.string().nullable(), reason: z.string().nullable() })),
    more: z.boolean(),
  }),
});

const totalsView = z.object({
  people: z.number(),
  queued: z.number(),
  sending: z.number(),
  sent: z.number(),
  delivered: z.number(),
  failed: z.number(),
  unknown: z.number(),
  skipped: z.record(z.string(), z.number()),
  cancelled: z.number(),
  optOuts: z.number(),
});

const runView = z.object({
  id: z.string(),
  name: z.string(),
  templateKey: z.string(),
  connectionId: z.string(),
  table: z.string(),
  viewId: z.string().nullable(),
  status: z.enum(TEXT_RUN_STATES),
  reason: z.string().nullable(),
  scheduledAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  waitingUntil: z.number().nullable(),
  createdBy: z.string(),
  createdByName: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  createdAt: z.number(),
  totals: totalsView,
});

const runReply = z.object({ data: runView });
const runsReply = z.object({ data: z.array(runView), next: z.string().nullable() });
const runsQuery = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) });
const createBody = z.object({ name: z.string().trim().min(1).max(120), templateKey: z.string().min(1).max(80), audience: audienceSchema, scheduleAt: z.number().int().nonnegative().optional() }).strict();
const runParams = z.object({ id });
const recipientsQuery = z.object({ state: z.enum(TEXT_RECIPIENT_STATES).optional(), reason: z.string().max(40).optional(), after: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const recipientsReply = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      phone: z.string().nullable(),
      country: z.string().nullable(),
      state: z.enum(TEXT_RECIPIENT_STATES),
      reason: z.string().nullable(),
      delivery: z.object({ id: z.string(), state: z.string(), reason: z.string().nullable(), providerStatus: z.string().nullable(), segments: z.number().nullable() }).nullable(),
    }),
  ),
  next: z.string().nullable(),
});

const standingReply = z.object({
  data: z.object({
    state: z.enum(['yes', 'no', 'not-asked', 'stopped', 'no-phone', 'no-row']),
    confirmed: z.boolean(),
    needsConfirm: z.boolean(),
    yes: z.object({ at: z.number(), source: z.string(), wording: z.string().nullable(), wordingVersion: z.string().nullable(), confirmedAt: z.number().nullable() }).nullable(),
    asked: z.object({ at: z.number(), state: z.string() }).nullable(),
    canEmail: z.boolean(),
    phone: z.string().nullable(),
    country: z.string().nullable(),
  }),
});
const recordBody = personSchema
  .extend({
    how: z.enum(CONSENT_HOWS),
    wording: z.object({ text: z.string().trim().min(1).max(2000), version: z.string().trim().min(1).max(40) }).strict(),
    note: z.string().max(500).optional(),
  })
  .strict();
const requestReply = z.object({
  data: z.object({ outcome: z.enum(['sent', 'held', 'not-needed', 'already-confirmed', 'no-consent', 'stopped', 'no-phone', 'no-row', 'no-email', 'no-public-origin', 'no-mail-server']) }),
});
const inPersonBody = personSchema.extend({ how: z.enum(['in-person', 'paper']) }).strict();
const inPersonReply = z.object({ data: z.object({ outcome: z.enum(['confirmed', 'already', 'not-needed', 'no-consent', 'stopped', 'no-phone', 'no-row', 'superseded']) }) });

/** The signed-in person; an API key is refused. */
function signedIn(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('Marketing texts are sent by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const userId = (request as unknown as { user?: { id?: string } }).user?.id;
  if (userId === undefined) throw new UnauthorizedError();
  return userId;
}

export function textMarketingRoutes(deps: TextMarketingRoutesDeps): FastifyPluginAsyncZod {
  const { runs, confirm } = deps;

  async function viewOf(run: Parameters<TextRuns['view']>[0]): Promise<z.infer<typeof runView>> {
    const view: TextRunView = await runs.view(run);
    return { ...view, createdByName: await runs.makerName(run.createdBy) };
  }

  async function staffOf(userId: string): Promise<StaffMember> {
    const user = await usersRepo(deps.meta).findById(userId);
    return { id: userId, label: user?.name ?? userId };
  }

  /** The person's row, reached as the signed-in person: they must read the table, the row and its mobile in clear. */
  async function reachPerson(userId: string, body: z.infer<typeof personSchema>): Promise<ConsentPerson> {
    const opened = await openTextAudience(deps, userId, { connectionId: body.connectionId, table: body.table });
    if ('refuse' in opened) throw new TextAudienceRefusedError(opened.refuse, opened.label);
    if ((await rowNow(opened.ok, body.key)) === undefined) throw new NotFoundError('That person is not there for you.', { key: body.key });
    return { connectionId: body.connectionId, table: opened.ok.wholeTable.id, key: body.key };
  }

  return async (app) => {
    tagRoutes(app, 'staff');
    const manage = app.rbac.require(PERMISSIONS.settingsManage);

    app.get('/sms/marketing/setup', { preHandler: manage, schema: { response: { 200: setupReply } } }, async (request) => {
      const userId = signedIn(request);
      const checked = await preflight(deps);
      const usage = await runs.usage();
      return {
        data: {
          preflight: checked,
          hours: { from: MARKETING_HOURS.from, to: MARKETING_HOURS.to, days: 'monday-to-saturday' as const },
          daily: usage,
          countries: { noReplies: [...NO_REPLY_COUNTRIES].sort(), blockedCallingCodes: [...NO_TEXT_CALLING_CODES].sort(), doubleOptIn: [...DOUBLE_OPT_IN_COUNTRIES].sort() },
          tables: await textAudienceTables(deps, userId),
          templates: await deps.templates(),
        },
      };
    });

    app.post(
      '/sms/marketing/preview',
      { preHandler: manage, config: { audit: auditExempt('a count of who a marketing text would reach: reads the table as the sender, writes nothing') }, schema: { body: previewBody, response: { 200: previewReply } } },
      async (request) => {
        const userId = signedIn(request);
        return { data: await runs.preview(userId, request.body) };
      },
    );

    app.post(
      '/sms/marketing/preview/people',
      { preHandler: manage, config: { audit: auditExempt('lists the people of one group of a marketing text, as the sender reads them: writes nothing') }, schema: { body: peopleBody, response: { 200: peopleReply } } },
      async (request) => {
        const userId = signedIn(request);
        const found = await runs.peopleFor(userId, request.body.audience, request.body.reason, { limit: request.body.limit, offset: request.body.offset });
        return { data: { people: found.people.map((one) => ({ key: one.key, name: one.name, phone: one.masked, country: one.country, reason: one.skip })), more: found.more } };
      },
    );

    app.get('/sms/marketing/runs', { preHandler: manage, schema: { querystring: runsQuery, response: { 200: runsReply } } }, async (request) => {
      signedIn(request);
      const page = await runs.list({ limit: request.query.limit, cursor: request.query.cursor });
      if (page === null) throw new ValidationFailedError('That page cursor is not one this list gave.', { field: 'cursor' });
      return { data: await Promise.all(page.runs.map(viewOf)), next: page.next };
    });

    app.post(
      '/sms/marketing/runs',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { body: createBody, response: { 202: runReply } } },
      async (request, reply) => {
        const userId = signedIn(request);
        refuseUnlessAllowed(deps.policy, 'smsProviders', 'The operator has switched text messages off for this installation.');
        refuseUnlessAllowed(deps.policy, 'marketingCampaigns', 'Marketing campaigns are switched off on this installation by its operator.');
        const run = await runs.create(userId, request.body);
        await app.rbac.audit(request, {
          category: 'settings',
          action: request.body.scheduleAt === undefined ? 'sms.marketing.send' : 'sms.marketing.schedule',
          changes: { after: { runId: run.id, templateKey: run.templateKey, connectionId: run.connectionId, table: run.table, viewId: run.viewId, scheduledAt: run.scheduledAt } },
        });
        return reply.status(202).send({ data: await viewOf(run) });
      },
    );

    app.get('/sms/marketing/runs/:id', { preHandler: manage, schema: { params: runParams, response: { 200: runReply } } }, async (request) => {
      signedIn(request);
      const run = await runs.byId(request.params.id);
      if (run === null) throw new NotFoundError('That marketing text run is not there.', { runId: request.params.id });
      return { data: await viewOf(run) };
    });

    app.get('/sms/marketing/runs/:id/people', { preHandler: manage, schema: { params: runParams, querystring: recipientsQuery, response: { 200: recipientsReply } } }, async (request) => {
      signedIn(request);
      const run = await runs.byId(request.params.id);
      if (run === null) throw new NotFoundError('That marketing text run is not there.', { runId: request.params.id });
      // The people are the table's: only someone who still reads its mobile numbers in clear sees who they are.
      const opened = await openTextAudience(deps, signedIn(request), { connectionId: run.connectionId, table: run.table });
      if ('refuse' in opened) throw new TextAudienceRefusedError(opened.refuse, opened.label);
      // Written down as the run's maker read the table: somebody held to some of its rows is not shown all of them.
      if (opened.ok.rowTest !== undefined) throw new ForbiddenError('You can read only some of these people, so the run\'s list is not shown to you.', 'FORBIDDEN', { reason: 'row-limited' });
      const found = await runs.recipients(run.id, request.query);
      return { data: found.people, next: found.next };
    });

    app.post(
      '/sms/marketing/runs/:id/cancel',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { params: runParams, response: { 200: runReply } } },
      async (request) => {
        const userId = signedIn(request);
        const run = await runs.cancel(request.params.id, userId);
        await app.rbac.audit(request, { category: 'settings', action: 'sms.marketing.cancel', changes: { after: { runId: run.id, status: run.status } } });
        return { data: await viewOf(run) };
      },
    );

    app.get('/sms/marketing/consent', { preHandler: manage, schema: { querystring: personSchema, response: { 200: standingReply } } }, async (request) => {
      const person = await reachPerson(signedIn(request), request.query);
      return { data: await confirm.standing(person) };
    });

    app.post(
      '/sms/marketing/consent',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { body: recordBody, response: { 200: standingReply } } },
      async (request) => {
        const userId = signedIn(request);
        const person = await reachPerson(userId, request.body);
        const facts = await confirm.factsOf(person);
        if (facts === null) throw new NotFoundError('That person is not there for you.', { key: request.body.key });
        const staff = await staffOf(userId);
        // A yes for one exact number, in the words the person was given, named to the staff member who took it.
        await deps.consent.record({
          phone: facts.phone,
          country: await deps.country(),
          person,
          purpose: 'text-marketing',
          state: 'yes',
          source: 'staff',
          detail: 'staff',
          how: request.body.how,
          note: request.body.note ?? null,
          staff,
          wording: request.body.wording,
        });
        await app.rbac.audit(request, { category: 'settings', action: 'sms.marketing.consent', changes: { after: { connectionId: person.connectionId, table: person.table, key: person.key, how: request.body.how, version: request.body.wording.version } } });
        // Where the country expects it, the mail that asks them to confirm goes at once.
        await confirm.request({ person, staff });
        return { data: await confirm.standing(person) };
      },
    );

    app.post(
      '/sms/marketing/consent/confirm-request',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { body: personSchema, response: { 200: requestReply } } },
      async (request) => {
        const userId = signedIn(request);
        const person = await reachPerson(userId, request.body);
        const outcome = await confirm.request({ person, staff: await staffOf(userId) });
        await app.rbac.audit(request, { category: 'settings', action: 'sms.marketing.confirm-requested', changes: { after: { connectionId: person.connectionId, table: person.table, key: person.key, outcome } } });
        return { data: { outcome } };
      },
    );

    app.post(
      '/sms/marketing/consent/confirm-in-person',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { body: inPersonBody, response: { 200: inPersonReply } } },
      async (request) => {
        const userId = signedIn(request);
        const person = await reachPerson(userId, request.body);
        const outcome = await confirm.confirmInPerson({ person, staff: await staffOf(userId), how: request.body.how });
        await app.rbac.audit(request, { category: 'settings', action: 'sms.marketing.confirmed-in-person', changes: { after: { connectionId: person.connectionId, table: person.table, key: person.key, how: request.body.how, outcome } } });
        return { data: { outcome } };
      },
    );
  };
}
