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
import { permissionsRepo, rolesRepo, rowLimitSchema, rowReachesSchema, rowReachList, teamsRepo, usersRepo, type MetaDb, type TableActions } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { rowLimitFor } from '../../crud/row-limit.js';
import { rowsNaming } from '../../crud/rows-naming.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { handOverRows } from '../../rbac/hand-over.js';
import { listingsOfTable, rowReachIssue } from '../../rbac/row-limit-check.js';
import { PERMISSIONS, grantMatches, grantsFromMatrixRows, isGranted } from '../../rbac/permissions.js';
import { SUPER_ADMIN_SLUG } from '../../rbac/resolver.js';
import { rowReachOfRow } from '../../rbac/row-limits.js';

const previewBody = z.object({
  connectionId: z.string().min(1),
  table: z.string().min(1).max(300),
  userId: z.string().min(1),
  action: z.enum(['read', 'update', 'delete']).default('read'),
  /** One reach, or several of which any one is enough (an app's account manager: every won deal, or an open one he is on). */
  reach: rowReachesSchema,
  /** The role being edited: the person's OTHER roles are then asked whether one of them reaches every row anyway. */
  roleId: z.string().min(1).optional(),
});
const previewReply = z.object({
  reached: z.number(),
  total: z.number(),
  capped: z.boolean(),
  /** Other roles this person holds that give the action on the table with no limit: with one of them, the limit does not hold for this person. */
  liftedBy: z.array(z.string()),
});

/** How a table says whose a row is, for a screen to say in words. */
const wayDto = z.union([
  z.object({ kind: z.literal('person'), column: z.string(), label: z.string() }),
  z.object({
    kind: z.literal('listing'),
    table: z.string(),
    label: z.string(),
    dated: z.boolean(),
    /** The listing counts only while this column of it holds one of `in`, or is empty (`isNull`) or not. */
    when: z.object({ column: z.string(), label: z.string(), in: z.array(z.string()).optional(), isNull: z.boolean().optional() }).optional(),
  }),
  z.object({ kind: z.literal('parent'), column: z.string(), table: z.string(), label: z.string() }),
]);
const roleRowsReply = z.object({
  roleId: z.string(),
  locked: z.boolean(),
  tables: z.array(
    z.object({
      /** The table's place in the matrix: the key `PUT /roles/:id/permissions` takes a row limit by. */
      ref: z.string(),
      connectionId: z.string(),
      connectionName: z.string(),
      tableId: z.string(),
      label: z.string(),
      /** Read by its own people only, whatever a role says: nothing to choose. */
      private: z.boolean(),
      ways: z.array(wayDto),
      /** Every listing the table's rows are read through, its own or a parent's: what a reach's `notThrough` may name, in words. */
      listings: z.array(z.object({ table: z.string(), label: z.string() })),
      /** Whether the role holds the action on this table at all. */
      granted: z.object({ read: z.boolean(), update: z.boolean(), delete: z.boolean() }),
      /** Whether one of the role's own grants names this table (a limit is stored on such a grant). */
      own: z.boolean(),
      limit: rowLimitSchema.nullable(),
    }),
  ),
});
const roleIdParams = z.object({ id: z.string() });

const namedRows = z.object({
  /** The rows that are the person's, by table and column: never a private table's. */
  named: z.array(z.object({ connectionId: z.string(), connectionName: z.string(), tableId: z.string(), tableLabel: z.string(), column: z.string(), rows: z.number() })),
  /** Whether rows of a private table name the person: said, never counted. */
  private: z.boolean(),
  unreadable: z.array(z.object({ connectionId: z.string(), connectionName: z.string() })),
  /** After a hand-over: connections whose rows could be counted and not moved. */
  failed: z.array(z.object({ connectionId: z.string(), connectionName: z.string() })).optional(),
  total: z.number(),
});
const handOverBody = z.object({ to: z.string().min(1) });
const userIdParams = z.object({ id: z.string() });

export function rowReachRoutes(deps: { meta: MetaDb; manager: ConnectionManager }): FastifyPluginAsyncZod {
  const { meta, manager } = deps;
  return async (app) => {
    const users = usersRepo(meta);

    app.post('/roles/rows/preview', { preHandler: app.rbac.require(PERMISSIONS.rolesManage), schema: { body: previewBody, response: { 200: previewReply } } }, async (request, reply) => {
      const { connectionId, table: tableId, userId, action, reach } = request.body;
      if ((await users.findById(userId)) === null) throw new NotFoundError('User not found.', { userId });
      const view = await loadSnapshotView(meta, connectionId);
      const table = view.model.tables.find((candidate) => candidate.id === tableId);
      if (table === undefined) throw new NotFoundError('Table not found.', { table: tableId });
      // A count of a table's rows is a reading of them: only for somebody who reads the table themselves. Who edits roles
      // and reads nothing here is told no figure of it.
      await (app.rbac.require(`table:${connectionId}:${tableId}:read`) as unknown as (req: typeof request, rep: typeof reply) => Promise<void>)(request, reply);
      // A private table's rows are its people's alone, and "only while" names a column everybody who reads the table sees:
      // under a hidden one, the count would tell its values.
      const reaches = rowReachList(reach);
      for (const one of reaches) {
        const wrong = rowReachIssue(view.model, tableId, one);
        if (wrong !== null) throw new ValidationFailedError(wrong.message, { fields: { table: { code: wrong.code, ...(wrong.column === undefined ? {} : { column: wrong.column }) } } });
      }
      const led = reaches.some((one) => one.reach === 'team') ? await teamsRepo(meta).leadReach(userId) : { ids: [], capped: false };
      // The person, holding this one limit (one reach, or several of which any one is enough) on this one table and nothing else.
      const set = {
        superAdmin: false,
        rowLimits: { [action]: [{ limited: reaches.map((one) => ({ grant: `table:${connectionId}:${tableId}:${action}`, reach: one })), unlimited: new Set<string>() }] },
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
      // The person's other roles, each asked alone: one that gives the action here with no limit lifts this one's.
      const liftedBy: string[] = [];
      for (const role of await rolesRepo(meta).rolesForUser(userId)) {
        if (role.id === request.body.roleId) continue;
        if (role.slug === SUPER_ADMIN_SLUG) {
          liftedBy.push(role.name);
          continue;
        }
        // Within one role a limit on the table stands over that role's own wider grant; only a role with no limit here lifts.
        const permission = `table:${connectionId}:${tableId}:${action}`;
        let gives = false;
        let limited = false;
        for (const row of await permissionsRepo(meta).listForRole(role.id)) {
          if (!grantsFromMatrixRows([row]).some((grant) => grantMatches(grant, permission))) continue;
          gives = true;
          if (rowReachOfRow(row, action) !== null) limited = true;
        }
        if (gives && !limited) liftedBy.push(role.name);
      }
      return { reached: test === null ? total : await count(true), total, capped: led.capped, liftedBy };
    });

    app.get('/roles/:id/rows', { preHandler: app.rbac.require(PERMISSIONS.rolesManage), schema: { params: roleIdParams, response: { 200: roleRowsReply } } }, async (request) => {
      const role = await rolesRepo(meta).findById(request.params.id);
      if (role === null) throw new NotFoundError('Role not found.', { roleId: request.params.id });
      const rows = await permissionsRepo(meta).listForRole(role.id);
      const held = new Set(grantsFromMatrixRows(rows));
      const tables = [];
      for (const connection of await meta.db.selectFrom('adminium_connections').select(['id', 'name']).orderBy('createdAt', 'asc').execute()) {
        const view = await loadSnapshotView(meta, connection.id).catch(() => null);
        if (view === null) continue;
        const labelOf = (id: string): string => {
          const found = view.model.tables.find((candidate) => candidate.id === id);
          return found?.label ?? found?.name ?? id;
        };
        for (const table of view.model.tables) {
          if (table.belongs === undefined && table.private !== true) continue;
          const ref = `${connection.id}/${table.id}`;
          const granted = (action: string): boolean => isGranted(held, `table:${connection.id}:${table.id}:${action}`);
          if (!granted('read') && !granted('update') && !granted('delete')) continue;
          const ways = (table.belongs ?? []).flatMap((way): z.infer<typeof wayDto>[] => {
            if ('through' in way) {
              const when = way.through.while;
              const list = view.model.tables.find((candidate) => candidate.id === way.through.table);
              const columnLabel = (name: string): string => list?.columns.find((candidate) => candidate.name === name)?.label ?? name;
              return [
                {
                  kind: 'listing' as const,
                  table: way.through.table,
                  label: labelOf(way.through.table),
                  dated: way.through.from !== undefined || way.through.to !== undefined,
                  ...(when === undefined ? {} : { when: { column: when.column, label: columnLabel(when.column), ...('in' in when ? { in: when.in.map(String) } : { isNull: when.isNull }) } }),
                },
              ];
            }
            if ('via' in way) {
              const relation = view.model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === way.via);
              return relation === undefined ? [] : [{ kind: 'parent' as const, column: way.via, table: relation.to.tableId, label: labelOf(relation.to.tableId) }];
            }
            const column = table.columns.find((candidate) => candidate.name === way.column);
            return [{ kind: 'person' as const, column: way.column, label: column?.label ?? way.column }];
          });
          const stored = rows.find((row) => row.resourceKind === 'table' && row.resourceRef === ref);
          tables.push({
            ref,
            connectionId: connection.id,
            connectionName: connection.name,
            tableId: table.id,
            label: table.label ?? table.name,
            private: table.private === true,
            ways,
            listings: [...listingsOfTable(view.model, table.id)].map((listing) => ({ table: listing, label: labelOf(listing) })),
            granted: { read: granted('read'), update: granted('update'), delete: granted('delete') },
            own: stored !== undefined,
            limit: stored === undefined ? null : ((stored.actions as TableActions).rowLimit ?? null),
          });
        }
      }
      return { roleId: role.id, locked: role.slug === SUPER_ADMIN_SLUG, tables };
    });

    const guarded = { preHandler: app.rbac.require(PERMISSIONS.usersManage) };

    app.get('/users/:id/rows', { ...guarded, schema: { params: userIdParams, response: { 200: namedRows } } }, async (request) => {
      if ((await users.findById(request.params.id)) === null) throw new NotFoundError('User not found.', { userId: request.params.id });
      return rowsNaming(meta, manager, request.params.id);
    });

    app.post('/users/:id/rows/hand-over', { ...guarded, schema: { params: userIdParams, body: handOverBody, response: { 200: namedRows } } }, async (request) => {
      const from = await users.findById(request.params.id);
      if (from === null) throw new NotFoundError('User not found.', { userId: request.params.id });
      // A Super Admin's account is a Super Admin's to act on, here as on every other route about a person.
      const roles = rolesRepo(meta);
      if ((await roles.rolesForUser(from.id)).some((role) => role.slug === SUPER_ADMIN_SLUG)) {
        const actorId = request.apiKeyPrincipal === null ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null) : null;
        if (actorId === null || !(await roles.rolesForUser(actorId)).some((role) => role.slug === SUPER_ADMIN_SLUG)) throw new ForbiddenError('Only a Super Admin can change a Super Admin account.');
      }
      // While a person is here their rows are theirs: a row changes hands through its own table, judged and recorded row by row.
      if (from.status !== 'suspended') {
        throw new ConflictError('Rows are handed on when a person is suspended or removed. Suspend them first, or hand the rows on as you remove them.', 'CONFLICT', { reason: 'STILL_HERE' });
      }
      return handOverRows({ meta, manager }, { from, toId: request.body.to, audit: (entry) => app.rbac.audit(request, { category: 'rbac', ...entry }) });
    });
  };
}
