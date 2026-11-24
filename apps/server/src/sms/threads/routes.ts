// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Texts → Conversations, and "Send a text" on a record's page.
 *
 *   GET  /texts/threads               the conversations this person may read
 *   GET  /texts/threads/:id           one, its messages and the app's texts
 *   POST /texts/threads/:id/replies   an answer, through the send path
 *   POST /texts/threads/:id/read      marks it read
 *   GET  /texts/replies               each app's replies switch (`sms.manage`)
 *   PUT  /texts/replies/:app          switches one app's replies on or off
 *   POST /texts/send                  a text to the number on a record
 *   GET  /texts/ready                 whether a text can go at all (a provider, a sender, not switched off)
 *   GET  /texts/consent               where the person on a record stands on the app's texts
 *   POST /texts/consent               a staff member records their yes or no to the app's service texts
 *
 * A RECORD is named by its database, its table (its id, its name, or for an
 * app's page sending `X-Adminium-Install`, the app's own name for one of its
 * tables), its row and the column holding the number. A record the person
 * cannot read answers as one that is not there.
 *
 * RECORDING an answer is a change of the person's row, as e-mail consent is
 * (`routes/consent`): the table's update grant with the row inside their
 * update reach, so a desk role may; or the right to text the app's people
 * (`texts:<app>:reply`, `texts.reply`). It never needs leave to change the
 * number. A yes keeps the words the person was given and their version, how
 * they gave it (in person, by phone, on paper, by e-mail) and the staff
 * member's name. Only service texts: a marketing yes is Studio → Texts'
 * (`/sms/marketing/consent`), which asks for its confirmation. A yes never
 * lifts the stop list: only the person's START does.
 *
 * Who may do what is `permission.ts`. A signed-in person only: an API key never
 * reads or answers a customer's text. Every read and every answer writes an
 * audit row, and none holds a word of a message or a whole number: a thread is
 * named by its id and its number by `+49 ••• 789`.
 *
 * The list is what a page reads again when it reconnects. A realtime notice on
 * `texts` (or `texts:<app>`) says only that a thread changed, so a notice
 * missed while the page was away costs nothing once it reads the list.
 *
 * A server with no public https address can send but never hear a reply: the
 * list says so in `replies`, and the conversations page shows it plainly.
 *
 * A NUMBER IN FULL only to whoever reads every conversation (Super Admin,
 * `texts.read`, `texts.reply`), or to someone who sees personal columns of the
 * record the thread is about (`read_pii` there). Anyone else gets the mask,
 * and `phoneHidden: 'masked-for-you'` says why: a role that may text a contact
 * without seeing the number must not read it back from the conversation.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { REACHABILITY_STATES } from '../../payments/reachability.js';
import { scrubUrlForLog } from '../../log-scrub.js';
import { permissionSetAllows, type PermissionSet } from '../../rbac/resolver.js';
import { tagRoutes } from '../../security/route-audience.js';
import type { SmsReplyReach } from '../inbound/channel.js';
import { maskPhone } from '../consent/redact.js';
import { textAppGrants, TEXTS_READ_PERMISSION, TEXTS_REPLY_PERMISSION } from './permission.js';
import { canReadPii } from '../../crud/mask.js';
import { mayReplyApp, readsAny, TEXT_BODY_MAX, TextCursorError, type TextItemView, type TextThreads, type TextThreadView, type TextViewer } from './service.js';
import { TEXT_THREAD_KINDS, type TextSendOutcome } from './types.js';
import { CONSENT_HOWS } from '@adminium/meta';
import type { TextConsentService } from '../consent/types.js';
import { TEXT_STANDING_STATES, TEXT_STOP_LIFTS, textStandingOf } from '../consent/standing-view.js';

/** The number on a record, as the person asking reaches the record. */
export interface RecordPhone {
  /** The table's id in the snapshot, whichever name the request gave it by. */
  tableId: string;
  /** The record's canonical key. */
  rowKey: string;
  /** The app whose table it is; null for a table no app declares. */
  app: string | null;
  /** The column is one that holds a phone number. */
  phoneColumn: boolean;
  value: unknown;
  /** The person may see the number on this table. */
  mayReadNumber: boolean;
  /** The person may change the row: the table's update grant, and the row inside their update reach. */
  mayChange: boolean;
}

export interface TextsRoutesDeps {
  threads: TextThreads;
  /** The grant the replies switches require: `PERMISSIONS.smsManage`. */
  manageGrant: string;
  /** Whether a reply can reach this server. Its address is never given out here. */
  replyReach: () => Promise<Pick<SmsReplyReach, 'state' | 'canReceiveStop'>>;
  /** The country a local number on a record is read in. */
  country: () => Promise<string | null>;
  /** Whether this person sees personal columns of a table (`canReadPii`). */
  mayReadPii?: ((request: FastifyRequest, connectionId: string, table: string) => Promise<boolean>) | undefined;
  /**
   * The record as this person reaches it for reading, under their row limits;
   * null when they may not read the table or the row. The table is named by
   * its id, its name, or (for an app's page) the app's own name for it.
   */
  recordPhone?: ((request: FastifyRequest, input: { connection: string; table: string; row: string; column: string }) => Promise<RecordPhone | null>) | undefined;
  /** The text consent log: without it, the consent routes are not served. */
  consent?: Pick<TextConsentService, 'standing' | 'stop' | 'record'> | undefined;
  /** Whether a text can go at all (`SmsWiring.ready`): false when absent. */
  ready?: (() => Promise<boolean>) | undefined;
}

/** What this person may do with conversations, from the grants they hold. */
export async function textViewerOf(request: FastifyRequest, resolve: (request: FastifyRequest) => Promise<PermissionSet>): Promise<TextViewer> {
  const set = await resolve(request);
  const everything = permissionSetAllows(set, TEXTS_REPLY_PERMISSION) ? 'reply' : permissionSetAllows(set, TEXTS_READ_PERMISSION) ? 'read' : null;
  return { everything, apps: textAppGrants(set.grants) };
}

const clientKey = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/, 'a key of 22 to 64 letters, digits, - or _');
const body = z.string().min(1).max(TEXT_BODY_MAX);
const cursor = z.string().max(512).optional();
const limit = z.coerce.number().int().min(1).max(100).optional();
const appKey = z.string().regex(/^[a-z0-9][a-z0-9_~-]{0,63}$/);

const person = z.object({ id: z.string(), label: z.string() });
const recordRef = z.object({ connectionId: z.string(), table: z.string(), key: z.string() });
const deliveryStatus = z.enum(['sending', 'sent', 'delivered', 'failed', 'unknown', 'skipped', 'not-sent']);

const threadDto = z
  .object({
    id: z.string(),
    app: z.string().nullable(),
    /** Null when this person may not see it in full: see `phoneHidden`. */
    phone: z.string().nullable(),
    masked: z.string().nullable(),
    /** `masked-for-you`: the number exists, and this person sees only its mask. */
    phoneHidden: z.enum(['masked-for-you']).nullable(),
    line: z.string().nullable(),
    record: recordRef.nullable(),
    lastAt: z.number(),
    lastDirection: z.enum(['in', 'out']),
    lastKind: z.enum(TEXT_THREAD_KINDS),
    preview: z.string().nullable(),
    unread: z.number(),
    readAt: z.number().nullable(),
    readBy: person.nullable(),
    stopped: z.boolean(),
    theyCanReply: z.boolean(),
  })
  .strict();

const itemDto = z
  .object({
    id: z.string(),
    source: z.enum(['message', 'app']),
    direction: z.enum(['in', 'out']),
    kind: z.enum([...TEXT_THREAD_KINDS, 'template']),
    body: z.string().nullable(),
    template: z.string().nullable(),
    at: z.number(),
    by: person.nullable(),
    delivery: z.object({ status: deliveryStatus, reason: z.string().nullable() }).nullable(),
    confirmed: z.boolean().nullable(),
    refused: z.string().nullable(),
  })
  .strict();

const outcomeDto = z
  .object({
    outcome: z.enum(['queued', 'held', 'refused']),
    deliveryId: z.string().nullable(),
    opensAt: z.number().nullable(),
    reason: z.string().nullable(),
  })
  .strict();

const listReply = z.object({
  data: z.object({
    threads: z.array(threadDto),
    next: z.string().nullable(),
    unread: z.number(),
    /** False: this server cannot hear a reply, so none will arrive here. */
    replies: z.object({ canArrive: z.boolean(), state: z.enum([...REACHABILITY_STATES, 'not-connected', 'key-unreadable', 'not-heard']) }),
  }),
});

const threadReply = z.object({
  data: z.object({
    thread: threadDto,
    items: z.array(itemDto),
    next: z.string().nullable(),
    answering: z.boolean(),
    canReply: z.object({ ok: z.boolean(), reason: z.enum(['not-allowed', 'stopped', 'not-connected', 'no-consent', 'cannot-receive-text', 'country-blocked']).nullable() }),
  }),
});

const sendReply = z.object({ data: z.object({ threadId: z.string().nullable(), item: itemDto.nullable(), result: outcomeDto }) });
const recordSendReply = z.object({ data: z.object({ threadId: z.string().nullable(), sentTo: z.string().nullable(), result: outcomeDto }) });

const switchDto = z.object({
  app: z.string(),
  name: z.string(),
  replies: z.enum(['on', 'off']),
  starts: z.enum(['on', 'off']),
  changedAt: z.number().nullable(),
  changedBy: person.nullable(),
});
const switchesReply = z.object({ data: z.object({ apps: z.array(switchDto), noApp: z.enum(['on', 'off']) }) });

function personOf(request: FastifyRequest): { id: string; label: string } {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('Customers’ texts are read and answered by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const user = (request as unknown as { user?: { id?: string; email?: string; name?: string | null } }).user;
  if (user?.id === undefined) throw new UnauthorizedError();
  return { id: user.id, label: user.name ?? user.email ?? '' };
}

const resultOf = (outcome: TextSendOutcome): z.infer<typeof outcomeDto> =>
  outcome.outcome === 'refused'
    ? { outcome: 'refused', deliveryId: null, opensAt: null, reason: outcome.reason }
    : { outcome: outcome.outcome, deliveryId: outcome.deliveryId, opensAt: outcome.outcome === 'held' ? outcome.opensAt : null, reason: null };

const itemOut = (view: TextItemView): z.infer<typeof itemDto> => ({ ...view });

export function textsRoutes(deps: TextsRoutesDeps): FastifyPluginAsyncZod {
  const { threads } = deps;

  return async (app) => {
    tagRoutes(app, 'staff');
    const manage = app.rbac.require(deps.manageGrant);

    const viewerOf = (request: FastifyRequest) => textViewerOf(request, (one) => app.rbac.resolve(one));
    const mayReadPii = deps.mayReadPii ?? canReadPii;

    /** The thread as this person may see it: the number in full, or its mask and why. */
    async function threadOut(request: FastifyRequest, viewer: TextViewer, view: TextThreadView): Promise<z.infer<typeof threadDto>> {
      if (view.phone === null || viewer.everything !== null) return { ...view, phoneHidden: null };
      if (view.record !== null && (await mayReadPii(request, view.record.connectionId, view.record.table))) return { ...view, phoneHidden: null };
      return { ...view, phone: null, phoneHidden: 'masked-for-you' };
    }

    /** Refused as `rbac.require` refuses: a 403 with its audit row. */
    async function refuse(request: FastifyRequest, permission: string): Promise<never> {
      await app.rbac.audit(request, { category: 'rbac', action: 'permission.denied', changes: { after: { permission, method: request.method, url: scrubUrlForLog(request.url) } } });
      throw new ForbiddenError('You do not have the required permission.', 'FORBIDDEN', { permission });
    }

    async function reader(request: FastifyRequest): Promise<TextViewer> {
      personOf(request);
      const viewer = await viewerOf(request);
      if (!readsAny(viewer)) await refuse(request, TEXTS_READ_PERMISSION);
      return viewer;
    }

    const cursorRefused = (error: unknown): never => {
      if (error instanceof TextCursorError) throw new ValidationFailedError(error.message, { field: 'cursor' });
      throw error;
    };

    app.get(
      '/texts/threads',
      {
        preHandler: app.requireAuth,
        schema: { querystring: z.object({ app: z.string().max(64).optional(), unread: z.enum(['true', 'false']).optional(), cursor, limit }).strict(), response: { 200: listReply } },
      },
      async (request) => {
        const viewer = await reader(request);
        const query = request.query;
        // `app=` alone asks for the threads no app owns.
        const listed = await threads.list(viewer, { app: query.app === undefined ? undefined : query.app === '' ? null : query.app, unreadOnly: query.unread === 'true', limit: query.limit ?? 50, cursor: query.cursor }).catch(cursorRefused);
        const reach = await deps.replyReach();
        // Which conversations were shown, by their ids: never a number or a word.
        await app.rbac.audit(request, { category: 'data', action: 'texts.threads.read', changes: { after: { threads: listed.threads.map((one) => one.id), app: query.app ?? null, unreadOnly: query.unread === 'true', page: query.cursor === undefined ? 'first' : 'later' } } });
        const shown = [];
        for (const one of listed.threads) shown.push(await threadOut(request, viewer, one));
        return { data: { threads: shown, next: listed.next, unread: listed.unread, replies: { canArrive: reach.canReceiveStop, state: reach.state } } };
      },
    );

    app.get(
      '/texts/threads/:id',
      { preHandler: app.requireAuth, schema: { params: z.object({ id: z.string().min(1).max(36) }), querystring: z.object({ cursor, limit }).strict(), response: { 200: threadReply } } },
      async (request) => {
        const viewer = await reader(request);
        const detail = await threads.thread(viewer, request.params.id, { limit: request.query.limit ?? 50, cursor: request.query.cursor }).catch(cursorRefused);
        if (detail === null) throw new NotFoundError('No such conversation.');
        await app.rbac.audit(request, { category: 'data', action: 'texts.thread.read', changes: { after: { thread: detail.thread.id, app: detail.thread.app, phone: detail.thread.masked, items: detail.items.length } } });
        return { data: { thread: await threadOut(request, viewer, detail.thread), items: detail.items.map(itemOut), next: detail.next, answering: detail.answering, canReply: detail.canReply } };
      },
    );

    app.post(
      '/texts/threads/:id/replies',
      {
        preHandler: app.requireAuth,
        config: { audit: audited('rbac') },
        schema: { params: z.object({ id: z.string().min(1).max(36) }), body: z.object({ body, clientKey }).strict(), response: { 200: sendReply } },
      },
      async (request) => {
        const by = personOf(request);
        const viewer = await reader(request);
        const sent = await threads.reply(viewer, request.params.id, { body: request.body.body, clientKey: request.body.clientKey, by });
        if (sent === null) throw new NotFoundError('No such conversation.');
        if (sent.outcome.outcome === 'refused' && sent.outcome.reason === 'not-allowed') await refuse(request, TEXTS_REPLY_PERMISSION);
        const result = resultOf(sent.outcome);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'texts.thread.replied',
          changes: { after: { thread: sent.thread.id, app: sent.thread.appKey === '' ? null : sent.thread.appKey, phone: sent.thread.phoneMasked, outcome: result.outcome, reason: result.reason, delivery: result.deliveryId } },
        });
        return { data: { threadId: sent.thread.id, item: sent.item === null ? null : itemOut(sent.item), result } };
      },
    );

    app.post(
      '/texts/threads/:id/read',
      { preHandler: app.requireAuth, config: { audit: audited('rbac') }, schema: { params: z.object({ id: z.string().min(1).max(36) }), response: { 204: z.null() } } },
      async (request, reply) => {
        const by = personOf(request);
        const viewer = await reader(request);
        const thread = await threads.markRead(viewer, request.params.id, by);
        if (thread === null) throw new NotFoundError('No such conversation.');
        await app.rbac.audit(request, { category: 'data', action: 'texts.thread.marked-read', changes: { after: { thread: thread.id, app: thread.appKey === '' ? null : thread.appKey } } });
        return reply.status(204).send(null);
      },
    );

    app.get('/texts/replies', { preHandler: manage, schema: { response: { 200: switchesReply } } }, async () => ({ data: await threads.switches() }));

    app.put(
      '/texts/replies/:app',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { params: z.object({ app: appKey }), body: z.object({ replies: z.enum(['on', 'off']) }).strict(), response: { 200: z.object({ data: switchDto }) } } },
      async (request) => {
        const by = personOf(request);
        const before = await threads.repliesOf(request.params.app);
        const view = await threads.setReplies(request.params.app, request.body.replies, by);
        if (view === null) throw new NotFoundError('No app with that key is installed.');
        await app.rbac.audit(request, { category: 'settings', action: 'texts.replies.switched', changes: { before: { app: view.app, replies: before }, after: { app: view.app, replies: view.replies } } });
        return { data: view };
      },
    );


    const recordQuery = z
      .object({
        connection: z.string().min(1).max(36),
        table: z.string().min(1).max(255),
        row: z.string().min(1).max(191),
        /** The column holding the number: one that holds a phone. */
        column: z.string().min(1).max(128),
      })
      .strict();
    const answerDto = z.object({ at: z.number(), source: z.string(), how: z.string().nullable(), by: person.nullable(), wordingVersion: z.string().nullable() });
    const purposeDto = z.object({ state: z.enum(TEXT_STANDING_STATES), answer: answerDto.nullable() });
    const standingReply = z.object({
      data: z.object({
        connection: z.string(),
        table: z.string(),
        row: z.string(),
        app: z.string().nullable(),
        /** Whether a text can go at all: false while no provider and sender are set, or the operator switched texts off. */
        ready: z.boolean(),
        masked: z.string().nullable(),
        service: purposeDto,
        marketing: purposeDto,
        stopped: z.object({ since: z.number(), reason: z.string(), liftBy: z.enum(TEXT_STOP_LIFTS) }).nullable(),
      }),
    });
    const answerBody = recordQuery
      .extend({
        state: z.enum(['yes', 'no']),
        how: z.enum(CONSENT_HOWS),
        /** The words the person was given, and their version: required for a yes. */
        wording: z.object({ text: z.string().trim().min(1).max(2000), version: z.string().trim().min(1).max(40) }).strict().optional(),
        note: z.string().max(500).optional(),
      })
      .strict()
      .refine((body) => body.state === 'no' || body.wording !== undefined, { message: 'A yes keeps the words the person was given, and their version.', path: ['wording'] });

    /** The record and the person on it, as this person reaches it: refused as missing otherwise. */
    async function consentRecord(request: FastifyRequest, input: z.infer<typeof recordQuery>) {
      const missing = () => new NotFoundError('No such record.');
      if (deps.recordPhone === undefined || deps.consent === undefined) throw missing();
      const record = await deps.recordPhone(request, input);
      if (record === null) throw missing();
      if (!record.phoneColumn) throw new ValidationFailedError('That column does not hold a phone number.', { field: 'column', reason: 'not-a-phone-column' });
      return { record, person: { connectionId: input.connection, table: record.tableId, key: record.rowKey } };
    }

    async function standingOut(input: z.infer<typeof recordQuery>, found: Awaited<ReturnType<typeof consentRecord>>): Promise<z.infer<typeof standingReply>['data']> {
      const view = await textStandingOf(deps.consent!, { phone: found.record.value, country: await deps.country(), person: found.person, app: found.record.app });
      return { connection: input.connection, table: found.record.tableId, row: found.record.rowKey, app: found.record.app, ready: (await deps.ready?.()) ?? false, ...view };
    }

    app.get('/texts/ready', { preHandler: app.requireAuth, schema: { response: { 200: z.object({ data: z.object({ ready: z.boolean() }) }) } } }, async () => ({ data: { ready: (await deps.ready?.()) ?? false } }));

    app.get('/texts/consent', { preHandler: app.requireAuth, config: { audit: audited('rbac') }, schema: { querystring: recordQuery, response: { 200: standingReply } } }, async (request) => {
      personOf(request);
      const found = await consentRecord(request, request.query);
      const data = await standingOut(request.query, found);
      // Whose standing was read, by its keys: never the number, never a word of an answer.
      await app.rbac.audit(request, { category: 'data', action: 'texts.consent.read', changes: { after: { connection: data.connection, table: data.table, row: data.row, app: data.app } } });
      return { data };
    });

    app.post('/texts/consent', { preHandler: app.requireAuth, config: { audit: audited('rbac') }, schema: { body: answerBody, response: { 200: standingReply } } }, async (request) => {
      const by = personOf(request);
      const body = request.body;
      const input = { connection: body.connection, table: body.table, row: body.row, column: body.column };
      const found = await consentRecord(request, input);
      // A change of the person's row, or the right to text the app's people.
      if (!found.record.mayChange && !mayReplyApp(await viewerOf(request), found.record.app ?? '')) await refuse(request, `table:${body.connection}:${found.record.tableId}:update`);
      try {
        await deps.consent!.record({
          phone: found.record.value,
          country: await deps.country(),
          person: found.person,
          purpose: 'text-service',
          state: body.state,
          source: 'staff',
          detail: 'staff',
          how: body.how,
          note: body.note ?? null,
          staff: by,
          wording: body.wording ?? null,
        });
      } catch (error) {
        if (error instanceof ValidationFailedError) throw new ValidationFailedError('The number on this record is not one a text can reach.', { field: 'column', reason: 'unreadable-phone' });
        throw error;
      }
      const data = await standingOut(input, found);
      await app.rbac.audit(request, {
        category: 'data',
        action: 'texts.consent.recorded',
        changes: { after: { connection: data.connection, table: data.table, row: data.row, app: data.app, purpose: 'text-service', state: body.state, how: body.how, version: body.wording?.version ?? null, phone: data.masked } },
      });
      return { data };
    });

    app.post(
      '/texts/send',
      {
        preHandler: app.requireAuth,
        config: { audit: audited('rbac') },
        schema: {
          body: z
            .object({
              connection: z.string().min(1).max(36),
              table: z.string().min(1).max(255),
              row: z.string().min(1).max(191),
              /** The column holding the number: one that holds a phone. */
              column: z.string().min(1).max(128),
              body,
              clientKey,
            })
            .strict(),
          response: { 200: recordSendReply },
        },
      },
      async (request) => {
        const by = personOf(request);
        const input = request.body;
        const missing = () => new NotFoundError('No such record.');
        if (deps.recordPhone === undefined) throw missing();
        // A record this person cannot read answers as one that is not there.
        const record = await deps.recordPhone(request, { connection: input.connection, table: input.table, row: input.row, column: input.column });
        if (record === null) throw missing();
        if (!record.phoneColumn) throw new ValidationFailedError('That column does not hold a phone number.', { field: 'column', reason: 'not-a-phone-column' });
        const viewer = await viewerOf(request);
        if (!mayReplyApp(viewer, record.app ?? '')) await refuse(request, TEXTS_REPLY_PERMISSION);
        const sent = await threads.sendToRecord({ body: input.body, clientKey: input.clientKey, by, app: record.app, phone: record.value, country: await deps.country(), record: { connectionId: input.connection, table: record.tableId, key: record.rowKey } });
        const result = resultOf(sent.outcome);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'texts.record.texted',
          changes: { after: { connection: input.connection, table: record.tableId, row: record.rowKey, app: record.app, thread: sent.threadId, phone: sent.masked ?? maskPhone(null), outcome: result.outcome, reason: result.reason, delivery: result.deliveryId } },
        });
        return { data: { threadId: sent.threadId, sentTo: record.mayReadNumber ? sent.masked : null, result } };
      },
    );
  };
}
