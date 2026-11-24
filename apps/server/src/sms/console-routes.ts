// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Texts: what the console reads and changes beside the provider card.
 *
 *   GET    /sms/sending-limits          the daily limit, the service hours and today's count
 *   PUT    /sms/sending-limits          change the limit and the hours
 *   GET    /sms/deliveries              Activity: one row per text, newest first, with no number and no words
 *   POST   /sms/deliveries/:id/settle   a person checked an `unknown` at the provider
 *   GET    /sms/inbound/failed          replies and reports that could not be acted on (`sms.manage`)
 *   POST   /sms/inbound/failed/:id/retry, /retry-all, /:id/dismiss
 *   GET    /sms/stop-list               the do-not-text list (`sms.manage`)
 *   POST   /sms/stop-list/lookup        whether one number is on it
 *   POST   /sms/stop-list               record a stop request a person made to the business
 *   DELETE /sms/stop-list/:id           take a number off (Super Admin only)
 *   POST   /sms/stop-list/:id/lift-erased   an erased person's entry, with a fresh named yes (Super Admin only)
 *   GET    /sms/text-templates          the installed text templates, every language
 *   PUT    /sms/text-templates/:key/:locale     change one language's words
 *   DELETE /sms/text-templates/:key/:locale     empty one language, so it falls back to US English
 *
 * WHO. `sms.manage` opens all of it. `privacy.people`, which an app's role may
 * carry so a desk can answer a customer, opens a look-up of one number on the
 * do-not-text list, recording a request on it, and Activity for the apps its
 * roles give it (as the privacy routes narrow the same grant): a desk is who
 * hears "stop texting me" from a sender name, and who is asked "did my text
 * go?". It never pages through the whole list, which holds every app's
 * customers, and may not settle an unknown or take a number off the list.
 *
 * WHAT NEVER LEAVES. A delivery row holds no number and no words, so none is
 * sent. The stop list shows the number, because staff must be able to find it,
 * to `sms.manage` whole and to a desk one typed number at a time. Every read and
 * every change is made by a signed-in person, never an API key, and audited: a
 * number only by its mask, a page by its count and filter.
 */
import { TEXT_TEMPLATE_BODY_MAX, checkTextTemplate } from '@adminium/manifest';
import { CONSENT_HOWS, settingsRepo, textTemplatesRepo, type MetaDb } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { hashOf } from '../apps/manifest-text-templates.js';
import { auditExempt, audited } from '../audit/coverage.js';
import type { StaffMember } from '../consent/types.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../errors.js';
import type { InboundCore, InboundFailedView } from '../inbound/index.js';
import { parsePhone } from '../phone/index.js';
import { privacyScopeOf, type PrivacyScope } from '../privacy/scope.js';
import { tagRoutes } from '../security/route-audience.js';
import { maskPhone } from './consent/redact.js';
import { SMS_INBOUND_CHANNEL } from './inbound/index.js';
import { TEXT_PURPOSES, TEXT_STOP_REASONS, type TextConsentService, type TextStopView } from './consent/types.js';
import { dayKey, MAX_TEXT_DAILY_LIMIT, readTextPolicy, warningAt } from './send/policy.js';
import type { TextSendPath } from './send/path.js';
import type { TextSendStore } from './send/store.js';
import { TEXT_DELIVERY_STATES, type TextDelivery } from './send/types.js';
import type { SmsService } from './service.js';

export interface SmsConsoleRoutesDeps {
  meta: MetaDb;
  service: Pick<SmsService, 'view'>;
  consent: Pick<TextConsentService, 'stop'>;
  deliveries: Pick<TextSendStore, 'list' | 'byId' | 'usedOn'>;
  /** The send path, once joined; settling an unknown tells its source row through it. */
  texts: () => Pick<TextSendPath, 'resolveUnknown'> | null;
  /** `PERMISSIONS.smsManage`. */
  manageGrant: string;
  /** `PERMISSIONS.privacyPeople`. */
  peopleGrant: string;
  /** The inbound core's failed list, for the events of the text channel. */
  inbound?: Pick<InboundCore, 'failed'> | undefined;
  /** The apps a desk's `privacy.people` reaches (`privacyScopeOf`); null apps reach every one. */
  privacyScope?: ((userId: string) => Promise<PrivacyScope | null>) | undefined;
  now?: (() => number) | undefined;
}

const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const hoursSchema = z.object({ from: z.string().regex(CLOCK), to: z.string().regex(CLOCK) }).strict();

const limitsBody = z
  .object({ dailyLimit: z.number().int().min(1).max(MAX_TEXT_DAILY_LIMIT), serviceHours: hoursSchema })
  .strict()
  .refine((value) => value.serviceHours.from !== value.serviceHours.to, { message: 'The hours start and end at the same time.', path: ['serviceHours'] });

const limitsReply = z.object({
  data: z.object({
    dailyLimit: z.number().int(),
    serviceHours: hoursSchema,
    /** Today's count, on the server's one day zone. */
    usedToday: z.number().int(),
    /** The count at which the warning shows. */
    warnAt: z.number().int(),
    day: z.string(),
    dayZone: z.string(),
  }),
});

const deliveryView = z
  .object({
    id: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    /** `+49 ••• 789`: never the number. */
    phoneMasked: z.string().nullable(),
    textClass: z.enum(['service', 'marketing']),
    state: z.enum(TEXT_DELIVERY_STATES),
    reason: z.string().nullable(),
    provider: z.enum(['twilio', 'telnyx']).nullable(),
    providerStatus: z.string().nullable(),
    providerErrorCode: z.string().nullable(),
    segments: z.number().nullable(),
    price: z.object({ amount: z.string(), currency: z.string() }).nullable(),
    estimatedSegments: z.number(),
    encoding: z.enum(['gsm-7', 'ucs-2']),
    attempts: z.number(),
    /** When the first try that may have gone was handed over. */
    mayHaveGoneAt: z.number().nullable(),
    /** The app and table the text was about; never the row's key. */
    source: z.object({ app: z.string(), table: z.string() }).nullable(),
  })
  .strict();

const deliveriesQuery = z.object({
  /** `createdAt:id` of the last row of the page before. */
  before: z.string().max(120).optional(),
  state: z.enum(TEXT_DELIVERY_STATES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const deliveriesReply = z.object({ data: z.array(deliveryView), next: z.string().nullable() });
const settleBody = z.object({ answer: z.enum(['went', 'not-sent']) }).strict();

const stopView = z
  .object({
    id: z.string(),
    /** Null once the person was erased: the entry keeps a hash alone. */
    phone: z.string().nullable(),
    masked: z.string().nullable(),
    reason: z.enum(TEXT_STOP_REASONS),
    origin: z.string().nullable(),
    addedAt: z.number(),
    addedBy: z.string().nullable(),
    erasedAt: z.number().nullable(),
  })
  .strict();

const stopQuery = z.object({ cursor: z.string().max(400).optional(), reason: z.enum(TEXT_STOP_REASONS).optional() });
const stopListReply = z.object({ data: z.array(stopView), next: z.string().nullable() });
/** How the person asked the business. Kept as the entry's origin. */
const STOP_ASKED = ['phone', 'email', 'in-person'] as const;
const stopBody = z.object({ phone: z.string().min(1).max(64), asked: z.enum(STOP_ASKED) }).strict();
const stopAddReply = z.object({ data: stopView, added: z.boolean() });
const lookupBody = z.object({ phone: z.string().min(1).max(64) }).strict();
/** The number typed again, and the fresh yes the person gave, in the words they were shown. */
const liftBody = z
  .object({
    phone: z.string().min(1).max(64),
    purpose: z.enum(TEXT_PURPOSES),
    wording: z.object({ text: z.string().min(1).max(2000), version: z.string().min(1).max(40) }).strict(),
    how: z.enum(CONSENT_HOWS),
  })
  .strict();
const lookupReply = z.object({ data: stopView.nullable() });

const failedView = z
  .object({
    id: z.string(),
    /** `reply`, `delivery` or `opt-out`. Never a word of what was sent. */
    kind: z.string(),
    reason: z.string().nullable(),
    /** Who it is from: `+49 ••• 789`, never the number. */
    masked: z.string().nullable(),
    receivedAt: z.number(),
    attempts: z.number(),
    retryable: z.boolean(),
    /** It may be a request to stop: texts to its sender wait until it is retried or closed, or until `holdsUntil`. */
    holds: z.boolean(),
    holdsUntil: z.number().nullable(),
  })
  .strict();
const failedQuery = z.object({ cursor: z.string().max(400).optional() });
const failedReply = z.object({ data: z.array(failedView), next: z.string().nullable(), summary: z.object({ failed: z.number(), holding: z.number(), more: z.boolean() }) });
const failedParams = z.object({ id: z.string().min(1).max(64) });
const failedOf = (event: InboundFailedView): z.infer<typeof failedView> => ({
  id: event.id,
  kind: event.kind,
  reason: event.reason,
  masked: event.masked,
  receivedAt: event.receivedAt,
  attempts: event.attempts,
  retryable: event.retryable,
  holds: event.holds,
  holdsUntil: event.holdsUntil,
});
/** How many failed events the count reads, at most. */
const FAILED_COUNT_MAX = 200;

const templateLanguage = z.object({ locale: z.string(), body: z.string(), enabled: z.boolean(), edited: z.boolean(), updatedAt: z.number() }).strict();
const templateView = z.object({ key: z.string(), name: z.string(), app: z.string().nullable(), languages: z.array(templateLanguage) }).strict();
const templatesReply = z.object({ data: z.array(templateView), connected: z.boolean() });
const templateParams = z.object({ key: z.string().min(1).max(120), locale: z.string().regex(/^[a-z]{2,3}_[A-Z]{2}$/) });
const templateBody = z.object({ body: z.string().max(TEXT_TEMPLATE_BODY_MAX) }).strict();
const templateReply = z.object({ data: templateView });

/** The language every template has, and the one an empty language falls back to. */
const FALLBACK_LOCALE = 'en_US';

function personOf(request: FastifyRequest): StaffMember {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('Texts are changed by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const user = (request as unknown as { user?: { id?: string; name?: string | null; email?: string | null } }).user;
  if (user?.id === undefined) throw new UnauthorizedError();
  return { id: user.id, label: user.name?.trim() || user.email || 'someone' };
}

function deliveryOf(row: TextDelivery): z.infer<typeof deliveryView> {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    phoneMasked: row.phoneMasked,
    textClass: row.textClass,
    state: row.state,
    reason: row.reason,
    provider: row.provider,
    providerStatus: row.providerStatus,
    providerErrorCode: row.providerErrorCode,
    segments: row.segments,
    price: row.price,
    estimatedSegments: row.estimatedSegments,
    encoding: row.encoding,
    attempts: row.attempts,
    mayHaveGoneAt: row.mayHaveGoneAt,
    source: row.reportTarget === null ? null : { app: row.reportTarget.app, table: row.reportTarget.table },
  };
}

function readBefore(raw: string | undefined): { at: number; id: string } | null {
  if (raw === undefined || raw === '') return null;
  const at = raw.indexOf(':');
  const when = Number(raw.slice(0, at));
  if (at < 1 || !Number.isSafeInteger(when)) throw new ValidationFailedError('That page cursor is not one this list gave.', { field: 'before' });
  return { at: when, id: raw.slice(at + 1) };
}

const stopOf = (entry: TextStopView): z.infer<typeof stopView> => ({
  id: entry.id,
  phone: entry.phone,
  masked: entry.masked,
  reason: entry.reason,
  origin: entry.origin,
  addedAt: entry.addedAt,
  addedBy: entry.addedBy?.label ?? null,
  erasedAt: entry.erasedAt,
});

export function smsConsoleRoutes(deps: SmsConsoleRoutesDeps): FastifyPluginAsyncZod {
  const now = deps.now ?? Date.now;
  const scopeOf = deps.privacyScope ?? ((userId: string) => privacyScopeOf(deps.meta, userId));
  const settings = settingsRepo(deps.meta);
  const templates = textTemplatesRepo(deps.meta);

  async function storedPolicy(): Promise<unknown> {
    try {
      return await settings.get('sms.sendPolicy');
    } catch {
      // A value this version cannot read: the defaults, never "no limit".
      return null;
    }
  }

  async function limitsView() {
    const policy = readTextPolicy(await storedPolicy());
    const day = dayKey(now(), policy.dayZone);
    return { dailyLimit: policy.dailyLimit, serviceHours: policy.serviceHours, usedToday: await deps.deliveries.usedOn(day), warnAt: warningAt(policy.dailyLimit), day, dayZone: policy.dayZone };
  }

  async function templateOf(key: string): Promise<z.infer<typeof templateView> | null> {
    const rows = await templates.listByKey(key);
    if (rows.length === 0) return null;
    const english = rows.find((row) => row.locale === FALLBACK_LOCALE) ?? rows[0]!;
    return {
      key,
      name: english.name,
      app: english.managedBy,
      // `edited`: no longer what the app shipped, so an update of the app keeps these words.
      languages: rows.map((row) => ({ locale: row.locale, body: row.body, enabled: row.enabled, edited: row.managedBy !== null && row.contentHash !== hashOf(row), updatedAt: row.updatedAt })),
    };
  }

  return async (app) => {
    tagRoutes(app, 'staff');
    const manage = app.rbac.require(deps.manageGrant);
    /** `sms.manage`, or the desk's `privacy.people`. */
    async function desk(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      if (typeof request.can === 'function' && (await request.can(deps.peopleGrant))) return;
      await manage(request, reply);
    }

    // ── the daily limit and the service hours ───────────────────────────────
    app.get('/sms/sending-limits', { preHandler: manage, schema: { response: { 200: limitsReply } } }, async () => ({ data: await limitsView() }));

    app.put(
      '/sms/sending-limits',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { body: limitsBody, response: { 200: limitsReply } } },
      async (request) => {
        const person = personOf(request);
        const before = readTextPolicy(await storedPolicy());
        await settings.set('sms.sendPolicy', { dailyLimit: request.body.dailyLimit, serviceHours: request.body.serviceHours }, { updatedBy: person.id, at: now() });
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'sms.limits.saved',
          changes: { before: { dailyLimit: before.dailyLimit, serviceHours: before.serviceHours }, after: request.body },
        });
        return { data: await limitsView() };
      },
    );

    // ── Activity ────────────────────────────────────────────────────────────
    app.get(
      '/sms/deliveries',
      { preHandler: desk, config: { audit: audited('rbac') }, schema: { querystring: deliveriesQuery, response: { 200: deliveriesReply } } },
      async (request) => {
        const person = personOf(request);
        // A desk reads the apps its roles give it, as the privacy routes narrow the same grant. `sms.manage` reads all.
        let apps: readonly string[] | null = null;
        if (!(await request.can(deps.manageGrant))) {
          const scope = await scopeOf(person.id);
          if (scope === null) throw new ForbiddenError('You do not have the required permission.', 'FORBIDDEN', { permission: deps.peopleGrant });
          apps = scope.apps === null ? null : [...scope.apps].sort();
        }
        const limit = request.query.limit ?? 50;
        const rows = await deps.deliveries.list({
          limit: limit + 1,
          before: readBefore(request.query.before),
          ...(request.query.state === undefined ? {} : { states: [request.query.state] }),
          ...(apps === null ? {} : { apps }),
        });
        const shown = rows.slice(0, limit);
        const last = shown.at(-1);
        await app.rbac.audit(request, { category: 'data', action: 'sms.deliveries.read', changes: { after: { rows: shown.length, state: request.query.state ?? null, apps, page: request.query.before === undefined ? 'first' : 'later' } } });
        return { data: shown.map(deliveryOf), next: rows.length > limit && last !== undefined ? `${last.createdAt}:${last.id}` : null };
      },
    );

    app.post(
      '/sms/deliveries/:id/settle',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { params: z.object({ id: z.string().min(1).max(64) }), body: settleBody, response: { 200: z.object({ data: deliveryView }) } } },
      async (request) => {
        personOf(request);
        const path = deps.texts();
        if (path === null) throw new ConflictError('Texts are not ready on this server yet. Try again in a moment.');
        const before = await deps.deliveries.byId(request.params.id);
        if (before === null) throw new NotFoundError('No such text.');
        if (before.state !== 'unknown') throw new ConflictError('This text is no longer waiting for a check.', 'CONFLICT', { reason: 'not-unknown', state: before.state });
        const row = await path.resolveUnknown(before.id, request.body.answer === 'went' ? 'checked-went' : 'checked-not-sent');
        if (row === null) throw new ConflictError('This text is no longer waiting for a check.', 'CONFLICT', { reason: 'not-unknown' });
        await app.rbac.audit(request, {
          category: 'settings',
          action: request.body.answer === 'went' ? 'sms.delivery.checked-went' : 'sms.delivery.checked-not-sent',
          changes: { after: { id: row.id, to: row.phoneMasked, provider: row.provider } },
        });
        return { data: deliveryOf(row) };
      },
    );

    // ── replies and reports that could not be acted on ─────────────────────
    function failedList(): Pick<InboundCore, 'failed'>['failed'] {
      if (deps.inbound === undefined) throw new ConflictError('Texts are not ready on this server yet. Try again in a moment.');
      return deps.inbound.failed;
    }

    app.get(
      '/sms/inbound/failed',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { querystring: failedQuery, response: { 200: failedReply } } },
      async (request) => {
        personOf(request);
        const failed = failedList();
        const page = await failed.list({ channel: SMS_INBOUND_CHANNEL, limit: 50, cursor: request.query.cursor ?? null });
        const summary = await failed.count({ channel: SMS_INBOUND_CHANNEL, limit: FAILED_COUNT_MAX });
        await app.rbac.audit(request, { category: 'data', action: 'sms.inbound.failed.read', changes: { after: { events: page.events.map((one) => one.id) } } });
        return { data: page.events.map(failedOf), next: page.next, summary };
      },
    );

    app.post(
      '/sms/inbound/failed/:id/retry',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { params: failedParams, response: { 200: z.object({ data: z.object({ retried: z.boolean() }) }) } } },
      async (request) => {
        personOf(request);
        const failed = failedList();
        const before = await failed.get(request.params.id);
        if (before === null || before.channel !== SMS_INBOUND_CHANNEL) throw new NotFoundError('No such failed event.');
        if (!before.retryable) throw new ConflictError('Its content is gone, so it cannot be tried again. Close it instead.', 'CONFLICT', { reason: 'body-gone' });
        const retried = await failed.retry(before.id);
        if (retried) await app.rbac.audit(request, { category: 'settings', action: 'sms.inbound.retried', changes: { after: { id: before.id, kind: before.kind, from: before.masked } } });
        return { data: { retried } };
      },
    );

    app.post(
      '/sms/inbound/failed/retry-all',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { response: { 200: z.object({ data: z.object({ retried: z.number(), more: z.boolean() }) }) } } },
      async (request) => {
        personOf(request);
        const result = await failedList().retryAll({ channel: SMS_INBOUND_CHANNEL, limit: FAILED_COUNT_MAX });
        await app.rbac.audit(request, { category: 'settings', action: 'sms.inbound.retried-all', changes: { after: result } });
        return { data: result };
      },
    );

    app.post(
      '/sms/inbound/failed/:id/dismiss',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { params: failedParams, response: { 204: z.null() } } },
      async (request, reply) => {
        personOf(request);
        const failed = failedList();
        const before = await failed.get(request.params.id);
        if (before === null || before.channel !== SMS_INBOUND_CHANNEL) throw new NotFoundError('No such failed event.');
        // Closing a possible STOP lets texts go to that person again: the audit row says so.
        if (await failed.dismiss(before.id)) await app.rbac.audit(request, { category: 'settings', action: 'sms.inbound.dismissed', changes: { before: { id: before.id, kind: before.kind, from: before.masked, held: before.holds } } });
        return reply.status(204).send(null);
      },
    );

    // ── the do-not-text list ────────────────────────────────────────────────
    app.get(
      '/sms/stop-list',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { querystring: stopQuery, response: { 200: stopListReply } } },
      async (request) => {
        personOf(request);
        const page = await deps.consent.stop.list({ limit: 100, cursor: request.query.cursor ?? null, ...(request.query.reason === undefined ? {} : { reason: request.query.reason }) });
        // Which page and how many, never a number.
        await app.rbac.audit(request, { category: 'data', action: 'sms.stop-list.read', changes: { after: { entries: page.entries.length, reason: request.query.reason ?? null, page: request.query.cursor === undefined ? 'first' : 'later' } } });
        return { data: page.entries.map(stopOf), next: page.next };
      },
    );

    app.post(
      '/sms/stop-list/lookup',
      { preHandler: desk, config: { audit: audited('rbac') }, schema: { body: lookupBody, response: { 200: lookupReply } } },
      async (request) => {
        personOf(request);
        const country = (await deps.service.view())?.defaultCountry ?? null;
        const entry = await deps.consent.stop.entryFor(request.body.phone, country);
        const typed = parsePhone(request.body.phone, country);
        await app.rbac.audit(request, { category: 'data', action: 'sms.stop.looked-up', changes: { after: { to: maskPhone(typed.ok ? typed.e164 : request.body.phone), found: entry !== null } } });
        return { data: entry === null ? null : stopOf(entry) };
      },
    );

    app.post(
      '/sms/stop-list',
      { preHandler: desk, config: { audit: audited('rbac') }, schema: { body: stopBody, response: { 200: stopAddReply } } },
      async (request) => {
        const staff = personOf(request);
        const country = (await deps.service.view())?.defaultCountry ?? null;
        const { entry, added } = await deps.consent.stop.add({ phone: request.body.phone, country, reason: 'staff', origin: request.body.asked, staff });
        if (added) await app.rbac.audit(request, { category: 'settings', action: 'sms.stop.recorded', changes: { after: { to: maskPhone(entry.phone), asked: request.body.asked } } });
        return { data: stopOf(entry), added };
      },
    );

    app.delete(
      '/sms/stop-list/:id',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { params: z.object({ id: z.string().min(1).max(64) }), response: { 204: z.null() } } },
      async (request, reply) => {
        personOf(request);
        // Taking a number off means texts may reach someone who said stop: only the Super Admin, and only after a new yes.
        if (!(await app.rbac.resolve(request)).superAdmin) throw new ForbiddenError('Only a Super Admin can take a number off the do-not-text list.', 'FORBIDDEN', { reason: 'super-admin' });
        const outcome = await deps.consent.stop.remove(request.params.id);
        if (outcome === 'missing') throw new NotFoundError('That number is not on the list.');
        if (outcome === 'erased') throw new ConflictError('An erased person stays on the list, so they are never texted again.', 'CONFLICT', { reason: 'erased' });
        await app.rbac.audit(request, { category: 'settings', action: 'sms.stop.removed', changes: { before: { id: request.params.id } } });
        return reply.status(204).send(null);
      },
    );

    app.post(
      '/sms/stop-list/:id/lift-erased',
      {
        preHandler: manage,
        config: { audit: audited('rbac') },
        schema: { params: z.object({ id: z.string().min(1).max(64) }), body: liftBody, response: { 204: z.null() } },
      },
      async (request, reply) => {
        const staff = personOf(request);
        // An erased person's entry: only the Super Admin, and only with a fresh yes they gave a named person, in its words.
        if (!(await app.rbac.resolve(request)).superAdmin) throw new ForbiddenError('Only a Super Admin can take an erased person’s number off the do-not-text list.', 'FORBIDDEN', { reason: 'super-admin' });
        const country = (await deps.service.view())?.defaultCountry ?? null;
        const outcome = await deps.consent.stop.liftErased({ id: request.params.id, phone: request.body.phone, country, purpose: request.body.purpose, wording: request.body.wording, how: request.body.how, staff });
        if (outcome === 'missing') throw new NotFoundError('That number is not on the list.');
        if (outcome === 'not-erased') throw new ConflictError('This entry still has its number: take it off with Remove.', 'CONFLICT', { reason: 'not-erased' });
        if (outcome === 'other-number') throw new ConflictError('That is not the number this entry was kept for.', 'CONFLICT', { reason: 'other-number' });
        const typed = parsePhone(request.body.phone, country);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'sms.stop.erased-lifted',
          changes: { before: { id: request.params.id }, after: { to: maskPhone(typed.ok ? typed.e164 : null), purpose: request.body.purpose, how: request.body.how, wordingVersion: request.body.wording.version } },
        });
        return reply.status(204).send(null);
      },
    );

    // ── text templates ──────────────────────────────────────────────────────
    app.get('/sms/text-templates', { preHandler: manage, config: { audit: auditExempt('read-only text templates') }, schema: { response: { 200: templatesReply } } }, async () => {
      const keys = [...new Set((await deps.meta.db.selectFrom('adminium_text_templates').select('key').orderBy('key').execute()).map((row) => row.key))];
      const out = [];
      for (const key of keys) {
        const one = await templateOf(key);
        if (one !== null) out.push(one);
      }
      const view = await deps.service.view();
      return { data: out, connected: view !== null && view.keyReadable };
    });

    app.put(
      '/sms/text-templates/:key/:locale',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { params: templateParams, body: templateBody, response: { 200: templateReply } } },
      async (request) => {
        const person = personOf(request);
        const { key, locale } = request.params;
        const existing = await templates.listByKey(key);
        if (existing.length === 0) throw new NotFoundError('No such text template.');
        const checked = checkTextTemplate(request.body.body);
        if (!checked.ok) throw new ValidationFailedError('This text cannot be saved.', { reason: checked.reason, ...(checked.names === undefined ? {} : { names: checked.names }) });
        const english = existing.find((row) => row.locale === FALLBACK_LOCALE) ?? existing[0]!;
        const own = existing.find((row) => row.locale === locale);
        await templates.upsert(key, locale, { name: own?.name ?? english.name, body: request.body.body, enabled: own?.enabled ?? true, updatedBy: person.id }, now());
        await app.rbac.audit(request, { category: 'settings', action: 'sms.template.saved', changes: { after: { key, locale } } });
        return { data: (await templateOf(key))! };
      },
    );

    app.delete(
      '/sms/text-templates/:key/:locale',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { params: templateParams, response: { 200: templateReply } } },
      async (request) => {
        personOf(request);
        const { key, locale } = request.params;
        if (locale === FALLBACK_LOCALE) throw new ValidationFailedError('US English is what every other language falls back to, so it cannot be emptied.', { reason: 'fallback' });
        if (!(await templates.remove(key, locale))) throw new NotFoundError('That language of this template is already empty.');
        await app.rbac.audit(request, { category: 'settings', action: 'sms.template.emptied', changes: { before: { key, locale } } });
        return { data: (await templateOf(key)) ?? { key, name: key, app: null, languages: [] } };
      },
    );
  };
}
