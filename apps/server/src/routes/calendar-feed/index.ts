// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S PRIVATE CALENDAR FEED: the feed itself, for a calendar service,
 * and the two staff calls about its link.
 *
 *   GET|HEAD /x/cal/<token>.ics        the feed: the token is the only gate
 *   GET  /api/v1/calendar-feed         whether I may renew this person's link, and the link if it is my own
 *   POST /api/v1/calendar-feed/renew   a new link: the old one stops now
 *
 * Who: anyone who may change the person's row, under their own row limits. That
 * is the person themselves, and an owner, who may renew anyone's. Only the
 * person whose address is on the row is ever SHOWN the link: an owner ends a
 * link that got out without being handed someone's diary, and the front desk,
 * which only reads the team, gets neither. A renew is an audit entry.
 */
import { createHash } from 'node:crypto';

import { appTablesRepo, calendarFeedsRepo, realTableOf, settingsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt, audited } from '../../audit/coverage.js';
import { CALENDAR_FEED_PREFIX, feedTargetOf, feedUrl, makeFeedToken, readFeedToken, renderFeed, type FeedDeps } from '../../calendar/feed.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { fetchByPk, parseRecordId } from '../../crud/records.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { fetchVisible } from '../../crud/row-limit.js';
import { storedPublicOrigin } from '../../email/door-reach.js';
import { mailLinkKeys } from '../../email/link-keys.js';
import { ForbiddenError, NotFoundError } from '../../errors.js';
import { rowKeyOf } from '../../payments/payables.js';
import { normaliseAddress } from '../../public-api/claim-code.js';
import { addressDigest } from '../../reviews/link.js';
import { tagRoutes } from '../../security/route-audience.js';

const tokenParams = z.object({ '*': z.string().max(2048) });

const tokenOf = (params: { '*': string }): string => (params['*'].endsWith('.ics') && !params['*'].includes('/') ? params['*'].slice(0, -4) : '');

/** The feed itself: answered on every host, to whoever holds the link. */
export function calendarFeedDoor(deps: FeedDeps): FastifyPluginAsyncZod {
  return async (app) => {
    tagRoutes(app, 'public');
    /**
     * A genuine link is counted by the feed it opens, not by its text: each ask
     * for the link seals a new one, so a count per text would be a count per ask.
     * Anything else by network address.
     */
    const subject = async (request: FastifyRequest): Promise<string | null> => {
      const token = tokenOf(request.params as { '*': string });
      const install = await settingsRepo(deps.meta).get('system.instanceId');
      if (token === '' || typeof install !== 'string') return null;
      const claim = readFeedToken(await mailLinkKeys(deps.meta, deps.secret).feedAll(), install, token);
      if (claim === null) return null;
      return createHash('sha256').update(JSON.stringify([claim.connection, claim.app, claim.table, claim.row, claim.nonce])).digest('base64url');
    };
    const none = (reply: FastifyReply) => reply.code(404).header('cache-control', 'no-store').header('x-robots-tag', 'noindex').header('referrer-policy', 'no-referrer').type('text/plain; charset=utf-8').send('Not found');
    app.route({
      method: ['GET', 'HEAD'],
      url: `${CALENDAR_FEED_PREFIX}*`,
      exposeHeadRoute: false,
      config: { rateLimitBucket: 'calendar-feed', rateLimitSubject: subject, audit: auditExempt('a calendar service reading a person’s private feed: it changes nothing') },
      schema: { hide: true, params: tokenParams },
      handler: async (request, reply) => {
        const token = tokenOf(request.params);
        const feed = token === '' ? null : await renderFeed(deps, token);
        if (feed === null) return none(reply);
        reply
          .header('cache-control', 'private, no-store')
          .header('etag', feed.etag)
          .header('x-robots-tag', 'noindex')
          .header('referrer-policy', 'no-referrer')
          .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
          .header('x-frame-options', 'DENY');
        if (request.headers['if-none-match'] === feed.etag) return reply.code(304).send();
        return reply.type('text/calendar; charset=utf-8').send(request.method === 'HEAD' ? '' : feed.body);
      },
    });
  };
}

const feedQuery = z.object({ connection: z.string().min(1).max(64), table: z.string().min(1).max(200), row: z.string().min(1).max(200) }).strict();
const feedReply = z.object({ data: z.object({ link: z.string().nullable(), own: z.boolean() }) });

/** The app whose table it is, as this database has it. */
async function appOfTable(meta: MetaDb, view: SnapshotView, tableId: string): Promise<string | null> {
  const records = await appTablesRepo(meta).forConnection(view.connectionId);
  const own = records.find((record) => {
    const real = realTableOf(record);
    try {
      return view.table(real).id === tableId;
    } catch {
      return view.linkTable(real)?.id === tableId;
    }
  });
  return own?.appKey ?? null;
}

/** The two staff calls. */
export function calendarFeedRoutes(deps: FeedDeps): FastifyPluginAsyncZod {
  return async (app) => {
    /** The person's row, as this reader may change it; a row they may not change is a row that is not there. */
    async function personFor(request: FastifyRequest, query: z.infer<typeof feedQuery>) {
      const missing = () => new NotFoundError('There is no calendar feed here.');
      const view = await deps.viewFor(query.connection);
      if (view === null) throw missing();
      const target = feedTargetOf(view, query.table);
      if (target === null) throw missing();
      const appKey = await appOfTable(deps.meta, view, target.table.id);
      if (appKey === null) throw missing();
      if (!(await request.can(`table:${query.connection}:${target.resource.id}:update`))) throw new ForbiddenError('You may not manage this calendar link.');
      let pk: Row;
      try {
        pk = parseRecordId(target.resource, query.row);
      } catch {
        throw missing();
      }
      const { db } = await deps.manager.data(query.connection);
      const rows = await rowLimitContextOf(deps.meta, await app.rbac.resolve(request), query.connection, view.model);
      const person = rows === null ? await fetchByPk(db, target.resource, pk) : await fetchVisible(rows, db, target.resource, pk, 'update');
      if (person === undefined) throw missing();
      const address = person[target.rule.calendar.feed.own];
      const mine = (request.user as { email?: unknown } | null)?.email;
      const own = typeof address === 'string' && address.trim() !== '' && typeof mine === 'string' && normaliseAddress(address) === normaliseAddress(mine);
      return { target, appKey, rowKey: rowKeyOf(target.resource, person), own, address: typeof address === 'string' ? addressDigest(address) : '' };
    }

    /** The link, for its own person only, on this server's public address. */
    async function linkFor(input: { appKey: string; connection: string; table: string; rowKey: string; address: string; nonce: string | null; user: unknown }): Promise<string | null> {
      const origin = await storedPublicOrigin(deps.meta);
      const install = await settingsRepo(deps.meta).get('system.instanceId');
      if (origin === null || input.nonce === null || typeof input.user !== 'string' || typeof install !== 'string' || install === '') return null;
      const token = makeFeedToken(await mailLinkKeys(deps.meta, deps.secret).feed(), { install, app: input.appKey, connection: input.connection, table: input.table, row: input.rowKey, address: input.address, nonce: input.nonce, user: input.user });
      return feedUrl(origin, token);
    }

    app.get('/calendar-feed', { preHandler: app.requireAuth, schema: { querystring: feedQuery, response: { 200: feedReply } } }, async (request) => {
      const { target, appKey, rowKey, own, address } = await personFor(request, request.query);
      if (!own) return { data: { link: null, own: false } };
      const nonce = await calendarFeedsRepo(deps.meta).ensure({ connectionId: request.query.connection, appKey, tableName: target.table.id, rowKey }, Date.now());
      return { data: { link: await linkFor({ appKey, connection: request.query.connection, table: target.table.id, rowKey, address, nonce, user: (request.user as { id?: unknown } | null)?.id }), own: true } };
    });

    app.post(
      '/calendar-feed/renew',
      { preHandler: app.requireAuth, config: { audit: audited('rbac') }, schema: { body: feedQuery, response: { 200: feedReply } } },
      async (request) => {
        const { target, appKey, rowKey, own, address } = await personFor(request, request.body);
        const by = (request.user as { id?: unknown } | null)?.id;
        const nonce = await calendarFeedsRepo(deps.meta).renew({ connectionId: request.body.connection, appKey, tableName: target.table.id, rowKey }, typeof by === 'string' ? by : null, Date.now());
        await app.rbac.audit(request, { category: 'settings', action: 'calendar-feed.renew', changes: { after: { table: target.table.id, row: rowKey } } });
        return { data: { link: own ? await linkFor({ appKey, connection: request.body.connection, table: target.table.id, rowKey, address, nonce, user: by }) : null, own } };
      },
    );
  };
}
