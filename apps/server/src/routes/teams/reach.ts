// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two questions the people screens ask of the rows themselves:
 *
 * - `POST /roles/rows/preview` — "Dana would see 6 of 14": how many rows of a
 *   table one person reaches under one limit, before the limit is saved. The
 *   limit is the one in the request (the editor's draft), judged as if it were
 *   the only thing that person holds on the table.
 * - `GET /users/:id/rows` and `POST /users/:id/rows/hand-over` — the rows that
 *   name a person, and giving them to somebody else before that person is
 *   removed.
 *
 * Both read source tables, so they are rows of the leak matrix: the first
 * counts through the same test every read carries, as the person asked about
 * and never as the asker; the second is the people-manager's, and never
 * touches a private table.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { rowReachSchema, teamsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { rowLimitFor } from '../../crud/row-limit.js';
import { handRowsOver, rowsNaming } from '../../crud/rows-naming.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

const previewBody = z.object({
  connectionId: z.string().min(1),
  table: z.string().min(1).max(300),
  userId: z.string().min(1),
  action: z.enum(['read', 'update', 'delete']).default('read'),
  reach: rowReachSchema,
});
const previewReply = z.object({ reached: z.number(), total: z.number(), capped: z.boolean() });

const namedRows = z.object({
  named: z.array(z.object({ connectionId: z.string(), connectionName: z.string(), tableId: z.string(), tableLabel: z.string(), column: z.string(), rows: z.number(), private: z.boolean() })),
  unreadable: z.array(z.object({ connectionId: z.string(), connectionName: z.string() })),
  total: z.number(),
});
const handOverBody = z.object({ to: z.string().min(1) });
const userIdParams = z.object({ id: z.string() });

export function rowReachRoutes(deps: { meta: MetaDb; manager: ConnectionManager }): FastifyPluginAsyncZod {
  const { meta, manager } = deps;
  return async (app) => {
    const users = usersRepo(meta);

    app.post('/roles/rows/preview', { preHandler: app.rbac.require(PERMISSIONS.rolesManage), schema: { body: previewBody, response: { 200: previewReply } } }, async (request) => {
      const { connectionId, table: tableId, userId, action, reach } = request.body;
      if ((await users.findById(userId)) === null) throw new NotFoundError('User not found.', { userId });
      const view = await loadSnapshotView(meta, connectionId);
      const table = view.model.tables.find((candidate) => candidate.id === tableId);
      if (table === undefined) throw new NotFoundError('Table not found.', { table: tableId });
      // A private table's rows are its people's alone: no figure of it is worked out for anybody else.
      if (table.private === true) throw new ValidationFailedError('A private table is read by its own people only.', { fields: { table: { code: 'private' } } });
      if (table.belongs === undefined && reach.reach !== 'all') throw new ValidationFailedError('This table does not say whose its rows are.', { fields: { table: { code: 'no-belongs' } } });
      const led = reach.reach === 'team' ? await teamsRepo(meta).leadReach(userId) : { ids: [], capped: false };
      // The person, holding this one limit on this one table and nothing else.
      const set = {
        superAdmin: false,
        rowLimits: { [action]: [{ limited: [{ grant: `table:${connectionId}:${tableId}:${action}`, reach }], unlimited: new Set<string>() }] },
        reach: { userId, ledIds: led.ids },
      };
      const ctx = await rowLimitContextOf(meta, set, connectionId, view.model);
      const test = ctx === null ? null : rowLimitFor(ctx, tableId, action);
      const db = (await manager.data(connectionId)).db as unknown as Kysely<SourceDatabase>;
      const count = async (limited: boolean): Promise<number> => {
        let query = db.selectFrom(tableId as never).select(sql<number>`count(*)`.as('n'));
        if (limited && test !== null) query = query.where(test(db as never, table.name));
        return Number(((await query.executeTakeFirst()) as { n?: unknown } | undefined)?.n ?? 0);
      };
      const total = await count(false);
      return { reached: test === null ? total : await count(true), total, capped: led.capped };
    });

    const guarded = { preHandler: app.rbac.require(PERMISSIONS.usersManage) };

    app.get('/users/:id/rows', { ...guarded, schema: { params: userIdParams, response: { 200: namedRows } } }, async (request) => {
      if ((await users.findById(request.params.id)) === null) throw new NotFoundError('User not found.', { userId: request.params.id });
      return rowsNaming(meta, manager, request.params.id);
    });

    app.post('/users/:id/rows/hand-over', { ...guarded, schema: { params: userIdParams, body: handOverBody, response: { 200: namedRows } } }, async (request) => {
      const from = await users.findById(request.params.id);
      if (from === null) throw new NotFoundError('User not found.', { userId: request.params.id });
      const to = await users.findById(request.body.to);
      if (to === null) throw new NotFoundError('User not found.', { userId: request.body.to });
      if (to.id === from.id) throw new ValidationFailedError('Hand the rows to somebody else.', { fields: { to: { code: 'same-person' } } });
      // Somebody who can be given a row: here, or the sample's. Not a person who is suspended or has not arrived.
      if (to.status !== 'active' && to.status !== 'sample') throw new ConflictError('That person cannot be given rows now.', 'CONFLICT', { reason: 'NOT_ACTIVE' });
      const moved = await handRowsOver(meta, manager, from.id, to.id);
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'user.rows.hand-over',
        changes: { before: { userId: from.id }, after: { to: to.id, rows: moved.total, tables: moved.named.filter((one) => !one.private).map((one) => ({ connectionId: one.connectionId, table: one.tableId, column: one.column, rows: one.rows })) } },
      });
      return moved;
    });
  };
}
