// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calendar sync's doors.
 *
 * ─── WHERE A SERVICE CALLS (`/calendars/hook/:provider/:channel`) ───────────
 * No session. The channel id is in the address and minted here; what proves a
 * call is the secret it presents, compared by the sync. A handshake is answered
 * as plain text, and only while that channel is being made.
 *
 * ─── THE DESK (`/calendar-sync/…`) ──────────────────────────────────────────
 * One rule, as the person's own role reaches the row:
 *
 *   read a person's calendar state and busy blocks   read on their row
 *   change their calendars, "Sync now"               update on their row
 *   read the clashes                                 read on the booking
 *   "Keep it"                                        update on the booking
 *
 * A row out of reach answers as one that is not there. An API key acts for
 * nobody here. A busy block is a time and nothing else.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { auditRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { auditExempt, audited } from '../../audit/coverage.js';
import type { CalendarSync } from '../../calendar-sync/service.js';
import type { ConnectedAccounts } from '../../connected-accounts/service.js';
import { canReadPii } from '../../crud/mask.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { normaliseAddress } from '../../public-api/claim-code.js';
import { tagRoutes } from '../../security/route-audience.js';

/** A service's notice is a few kilobytes; a Microsoft batch a little more. */
export const CALENDAR_HOOK_BODY_LIMIT = 256 * 1024;

const hookParams = z.object({ provider: z.string().max(80), channel: z.string().max(36) });

export function calendarHookRoutes(deps: { sync: CalendarSync }): FastifyPluginAsync {
  return async (app) => {
    tagRoutes(app, 'staff');
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: CALENDAR_HOOK_BODY_LIMIT }, (_request, body, done) => {
      done(null, body);
    });
    app.post<{ Params: { provider: string; channel: string } }>(
      '/calendars/hook/:provider/:channel',
      {
        config: {
          rateLimitBucket: 'calendar-hook',
          csrf: 'exempt',
          audit: auditExempt('a calendar service calling back; a genuine notice only asks for a read, and a refused one is not worth a row each'),
        },
        schema: { hide: true, params: hookParams },
      },
      async (request, reply) => {
        const { provider, channel } = request.params;
        if (!/^[a-z][a-z0-9-]{1,79}$/.test(provider)) return reply.status(404).send();
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
        const query: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(request.query as Record<string, unknown>)) if (typeof value === 'string') query[name] = value;
        const answer = await deps.sync.receiveHook({ provider, channelId: channel, delivery: { headers, query, rawBody: typeof request.body === 'string' ? request.body : '' } });
        if (answer.text !== undefined) {
          // A stranger's text comes back here: never as anything a browser would run.
          return reply.status(200).header('content-type', 'text/plain; charset=utf-8').header('x-content-type-options', 'nosniff').send(answer.text);
        }
        return reply.status(answer.status).send();
      },
    );
  };
}

const rowRef = z.object({
  connection: z.string().min(1).max(36),
  table: z.string().min(1).max(128),
  row: z.string().min(1).max(191),
});
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const calendarEntry = z.object({ id: z.string(), name: z.string(), primary: z.boolean(), writable: z.boolean() });
const stateReply = z.object({
  calendar: z
    .object({
      accountId: z.string(),
      state: z.enum(['connecting', 'connected', 'partial', 'reconnect', 'disconnecting']),
      address: z.string().nullable(),
      demo: z.boolean(),
      lastSyncedAt: z.number().nullable(),
      busyAsOf: z.number().nullable(),
      busyDropped: z.boolean(),
      paused: z.string().nullable(),
      readCalendars: z.array(z.string()).nullable(),
      countAllDay: z.boolean(),
      detail: z.enum(['first-name+initial', 'none']),
      calendarId: z.string().nullable(),
      traits: z.object({ listsCalendars: z.boolean(), allDayKnown: z.boolean(), busyPush: z.boolean() }).nullable(),
      calendars: z.array(calendarEntry).nullable(),
      push: z.object({ channels: z.number(), lastNoticeAt: z.number().nullable() }),
    })
    .nullable(),
});

const choicesBody = rowRef
  .extend({
    readCalendars: z.array(z.string().min(1).max(512)).min(1).max(50).nullable().optional(),
    countAllDay: z.boolean().optional(),
    detail: z.enum(['first-name+initial', 'none']).optional(),
    resume: z.literal(true).optional(),
  })
  .strict();

/** A demo calendar for a person's row, with its busy times: what a walk or a contract connects where no outside account exists. */
const demoBody = rowRef
  .extend({ busy: z.array(z.object({ start: z.string().datetime(), end: z.string().datetime() })).max(100).optional() })
  .strict();

const clashReply = z.object({
  clashes: z.array(z.object({ row: z.string(), resource: z.string(), overlapStart: z.number(), overlapEnd: z.number(), kept: z.boolean() })),
});

const keepBody = rowRef.extend({ overlapStart: z.number().int(), overlapEnd: z.number().int() }).strict();

export interface CalendarDeskDeps {
  meta: MetaDb;
  sync: CalendarSync;
  accounts: ConnectedAccounts;
  /** The row as this person reaches it, under their row limits, with its canonical key; null when they do not. */
  reachedRow(request: FastifyRequest, connectionId: string, table: string, row: string, action: 'read' | 'update'): Promise<{ rowKey: string } | null>;
  /** The table's personal columns, shown only to whoever may read them. */
  maskedColumns(connectionId: string, table: string): Promise<ReadonlySet<string>>;
  /** The columns that name a staff member as this row's own person (`table.belongs`). */
  ownColumns(connectionId: string, table: string): Promise<readonly string[]>;
}

function personId(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('A calendar is handled by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const id = request.user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

export function calendarDeskRoutes(deps: CalendarDeskDeps): FastifyPluginAsyncZod {
  const { sync, accounts } = deps;
  const audit = auditRepo(deps.meta);

  async function reachRow(request: FastifyRequest, input: z.infer<typeof rowRef>, action: 'read' | 'update'): Promise<string> {
    const missing = () => new NotFoundError('No such record.');
    if (!(await request.can(`table:${input.connection}:${input.table}:read`))) throw missing();
    if (action === 'update' && !(await request.can(`table:${input.connection}:${input.table}:update`))) throw new ForbiddenError('You may not change this record.', 'TABLE_FORBIDDEN');
    const reached = await deps.reachedRow(request, input.connection, input.table, input.row, action);
    if (reached === null) throw missing();
    return reached.rowKey;
  }

  /** A person's row, on a table whose rows may connect. */
  async function person(request: FastifyRequest, input: z.infer<typeof rowRef>, action: 'read' | 'update') {
    if ((await accounts.tableOf(input.connection, input.table)) === null) throw new NotFoundError('No such record.');
    const rowKey = await reachRow(request, input, action);
    return { connectionId: input.connection, tableName: input.table, rowKey };
  }

  const record = (request: FastifyRequest, action: string, after: Record<string, unknown>) =>
    audit.append({ actorKind: 'user', actorId: request.user?.id ?? null, actorLabel: request.user?.email ?? 'unknown', category: 'add-on', action, changes: { after } });

  /** Whether this reader may see who a row's calendar belongs to: personal data, or their own row. */
  async function seesPersonal(request: FastifyRequest, target: { connectionId: string; tableName: string; rowKey: string }): Promise<boolean> {
    if (await canReadPii(request, target.connectionId, target.tableName)) return true;
    const table = await accounts.tableOf(target.connectionId, target.tableName);
    if (table === null) return false;
    const column = table.rule.address;
    if (column !== undefined && !(await deps.maskedColumns(target.connectionId, target.tableName)).has(column)) return true;
    const row = await accounts.readRow(target);
    if (row === undefined) return false;
    const me = request.user?.id;
    if (me !== undefined && (await deps.ownColumns(target.connectionId, target.tableName)).some((name) => row[name] === me)) return true;
    const own = accounts.personOf(row, table.rule).address;
    const mine = request.user?.email;
    return typeof own === 'string' && typeof mine === 'string' && normaliseAddress(own) === normaliseAddress(mine);
  }

  return async (app) => {
    app.get('/calendar-sync/row', { preHandler: app.requireAuth, schema: { querystring: rowRef, response: { 200: stateReply } } }, async (request) => {
      personId(request);
      const target = await person(request, request.query, 'read');
      return { calendar: await sync.stateOfRow(target, { personal: await seesPersonal(request, target) }) };
    });

    app.get(
      '/calendar-sync/busy',
      { preHandler: app.requireAuth, schema: { querystring: rowRef.extend({ from: day, to: day }), response: { 200: z.object({ busy: z.array(z.object({ start: z.number(), end: z.number() })) }) } } },
      async (request) => {
        personId(request);
        const { from, to } = request.query;
        if (to < from || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 92 * 86_400_000) throw new ValidationFailedError('A range of at most 92 days.', {});
        const target = await person(request, request.query, 'read');
        return { busy: (await sync.busyOfRow(target, from, to)) ?? [] };
      },
    );

    app.post(
      '/calendar-sync/row/choices',
      { preHandler: app.requireAuth, config: { audit: audited('rbac') }, schema: { body: choicesBody, response: { 200: z.object({ ok: z.literal(true) }) } } },
      async (request) => {
        personId(request);
        const input = request.body;
        const target = await person(request, input, 'update');
        const account = (await accounts.repo.forTarget(target))[0];
        if (account === undefined) throw new NotFoundError('This row has no connected calendar.');
        const chosen = await sync.setChoices(account.id, {
          ...(input.readCalendars === undefined ? {} : { readCalendars: input.readCalendars }),
          ...(input.countAllDay === undefined ? {} : { countAllDay: input.countAllDay }),
          ...(input.detail === undefined ? {} : { detail: input.detail }),
          ...(input.resume === undefined ? {} : { resume: input.resume }),
        });
        if (chosen === 'unknown-calendar') throw new ValidationFailedError('That is not one of this account\'s calendars.', { reason: 'UNKNOWN_CALENDAR' });
        await record(request, 'calendar-sync.choices', { table: target.tableName, row: target.rowKey });
        return { ok: true as const };
      },
    );

    app.post(
      '/calendar-sync/row/sync-now',
      { preHandler: app.requireAuth, config: { audit: audited('rbac') }, schema: { body: rowRef, response: { 200: z.object({ ok: z.literal(true) }) } } },
      async (request) => {
        personId(request);
        const target = await person(request, request.body, 'update');
        const account = (await accounts.repo.forTarget(target))[0];
        if (account === undefined) throw new NotFoundError('This row has no connected calendar.');
        await sync.syncNow(account.id);
        return { ok: true as const };
      },
    );

    /*
     * THE BUILT-IN DEMO CALENDAR, only on a server that says it is a developer's or a test's (`demoCalendarFor`).
     * Anywhere else this route does not exist. The same rule as a real connect: update on the person's row.
     */
    const demo = sync.demo;
    if (demo !== null) {
      app.post(
        '/calendar-sync/row/demo',
        { preHandler: app.requireAuth, config: { audit: audited('rbac') }, schema: { hide: true, body: demoBody, response: { 200: z.object({ ok: z.literal(true) }) } } },
        async (request) => {
          personId(request);
          const { busy, ...ref } = request.body;
          const target = await person(request, ref, 'update');
          const account = await sync.attachDemo(target);
          if (account === null) throw new NotFoundError('This row cannot connect a calendar.');
          if (busy !== undefined) demo.setBusy(account.subject, 'primary', busy.map((one) => ({ allDay: false as const, start: one.start, end: one.end, kind: 'busy' as const })));
          await sync.readAccount(account.id);
          await record(request, 'calendar-sync.demo-attached', { table: target.tableName, row: target.rowKey });
          return { ok: true as const };
        },
      );
    }

    app.get(
      '/calendar-sync/clashes',
      { preHandler: app.requireAuth, schema: { querystring: rowRef.omit({ row: true }), response: { 200: clashReply } } },
      async (request) => {
        personId(request);
        const { connection, table } = request.query;
        if (!(await request.can(`table:${connection}:${table}:read`))) throw new NotFoundError('No such table.');
        const found = await sync.clashes(connection, table);
        if (found === null) throw new NotFoundError('No such table.');
        const out = [];
        // Each one as this person reaches the booking: a specialist sees only their own.
        for (const clash of found) {
          if ((await deps.reachedRow(request, connection, table, clash.rowKey, 'read')) === null) continue;
          out.push({ row: clash.rowKey, resource: clash.resource, overlapStart: clash.overlapStart, overlapEnd: clash.overlapEnd, kept: clash.kept });
        }
        return { clashes: out };
      },
    );

    app.post(
      '/calendar-sync/clashes/keep',
      { preHandler: app.requireAuth, config: { audit: audited('rbac') }, schema: { body: keepBody, response: { 200: z.object({ ok: z.literal(true) }) } } },
      async (request) => {
        const by = personId(request);
        const input = request.body;
        const rowKey = await reachRow(request, input, 'update');
        if (!(await sync.keepClash(input.connection, input.table, { rowKey, overlapStart: input.overlapStart, overlapEnd: input.overlapEnd, by }))) {
          throw new NotFoundError('That clash is no longer there.');
        }
        await record(request, 'calendar-sync.clash-kept', { table: input.table, row: rowKey });
        return { ok: true as const };
      },
    );
  };
}
