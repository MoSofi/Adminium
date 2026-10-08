// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /add-ons/:key/kit` — what an add-on's own page may read and write.
 *
 * A page built on the data kit names its add-on's tables by the short names
 * of its manifest and nothing else: no connection, no real table name. This
 * one read tells the kit's hooks where those tables are, what the signed-in
 * reader may do to each, which columns their role does not read, which moves
 * of a row's state they may make and which of its actions they are offered,
 * and which tables of the owner's database hand rows to the add-on.
 *
 * It grants nothing. Every answer here is asked again by the data routes on
 * the read or the write itself; the page only stops offering what would be
 * refused.
 */
import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import { appTablesRepo, userPrefsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { hostTablesOf } from '../../add-ons/host-tables.js';
import { addOnPagePermission } from '../../add-ons/page-gate.js';
import { storedTableRef } from '../../apps/table-ref.js';
import { readViewFor } from '../../crud/read-view.js';
import { NotFoundError } from '../../errors.js';
import { factsViewFor } from '../pages/column-facts.js';
import { movesFor, rolesOf, stateActionFacts } from '../pages/state-actions.js';

export interface AddOnKitDeps {
  meta: MetaDb;
}

const SCHEMA_REMAP = 'system:schema:remap';

const kitTable = z.object({
  /** The table's id, as the data routes take it. */
  id: z.string(),
  can: z.object({ read: z.boolean(), create: z.boolean(), update: z.boolean(), delete: z.boolean() }),
  /** The columns the reader's role does not read: never shown, never asked for. */
  unreadable: z.array(z.string()),
  states: z
    .object({
      column: z.string(),
      /** The moves this reader may make, by the state they leave; never one only a posting makes. */
      moves: z.record(z.string(), z.array(z.string())),
      /** The table's actions this reader is offered: never a target, never what one writes. */
      actions: z.array(z.object({ id: z.string(), kind: z.enum(['move', 'set', 'link', 'child']), from: z.array(z.string()) })).optional(),
    })
    .optional(),
});

export const addOnKitReply = z.object({
  connectionId: z.string(),
  /** The add-on's own tables, by the short names of its manifest; one not made yet is left out. */
  tables: z.record(z.string(), kitTable),
  /** The tables of the owner's database that hand rows to the add-on. Read only. */
  hosts: z.array(z.object({ tableRef: z.string(), id: z.string(), label: z.string(), via: z.enum(['posting', 'adjust']) })),
  /** What the reader holds of the permissions a page asks about by name. */
  has: z.record(z.string(), z.boolean()),
  /** The currency of the database its tables are in (ISO 4217), or null when the owner set none: what a page writes money in. */
  currency: z.string().nullable(),
});

export function addOnKitRoutes(deps: AddOnKitDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/add-ons/:key/kit',
      { preHandler: [app.requireAuth], schema: { params: z.object({ key: z.string().min(1).max(64) }), response: { 200: addOnKitReply } } },
      async (request) => {
        const { key } = request.params;
        const row = await deps.meta.db.selectFrom('adminium_manifests').select(['manifest', 'status', 'connectionId']).where('manifestKey', '=', key).where('kind', '=', 'add-on').executeTakeFirst();
        const parsed = row === undefined ? null : addOnManifestSchema.safeParse(typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest);
        // Not there, switched off, being changed, or with no tables of its own on any database: one answer.
        if (row === undefined || parsed?.success !== true || row.status !== 'installed' || row.connectionId === null) {
          throw new NotFoundError('This add-on has no pages to serve here.', { addOn: key });
        }
        const manifest = parsed.data as unknown as AddOnManifest;
        const connectionId = row.connectionId;
        const reader = request.user === null || request.user === undefined ? undefined : (await userPrefsRepo(deps.meta).resolve(request.user.id)).locale;
        const view = await factsViewFor(deps.meta, connectionId, reader);
        if (view === null) throw new NotFoundError('This add-on has no pages to serve here.', { addOn: key });
        const readView = await readViewFor(request, view);
        const permissions = await request.server.rbac.resolve(request);
        const roles = await rolesOf(deps.meta, permissions);
        const records = await appTablesRepo(deps.meta).forConnection(connectionId);
        const index = { records, tables: view.model.tables.map((table) => ({ id: table.id, name: table.name })) };
        const can = (permission: string): Promise<boolean> => request.can(permission);

        const tables: z.infer<typeof addOnKitReply>['tables'] = {};
        for (const record of records) {
          if (record.appKey !== key || (record.state !== 'created' && record.state !== 'adopted')) continue;
          const model = view.model.tables.find((table) => table.name === record.tableName);
          if (model === undefined) continue;
          let table;
          try {
            table = view.table(model.id);
          } catch {
            // A table that is there and not served: as one not made yet.
            continue;
          }
          const grant = (action: string): Promise<boolean> => can(`table:${connectionId}:${table.id}:${action}`);
          const states = table.table?.states;
          const actions = states === undefined ? undefined : await stateActionFacts(deps.meta, { can, permissions, locale: reader, log: request.log }, view, table.id);
          tables[record.ref] = {
            id: table.id,
            can: { read: await grant('read'), create: await grant('create'), update: await grant('update'), delete: await grant('delete') },
            unreadable: [...readView.table(table.id).columns.values()].filter((column) => column.unreadable === true).map((column) => column.name),
            ...(states === undefined
              ? {}
              : {
                  states: {
                    column: states.column,
                    moves: movesFor(states.moves, roles),
                    ...(actions === undefined ? {} : { actions: actions.map((action) => ({ id: action.id, kind: action.kind, from: action.from })) }),
                  },
                }),
          };
        }

        // A table of the add-on's own that posts into its ledger is its table, listed above — not a host.
        const own = new Set(Object.values(tables).map((table) => table.id));
        const hosts = hostTablesOf(view, key, manifest).filter((host) => !own.has(host.id)).map((host) => {
          const table = view.table(host.id);
          return { tableRef: storedTableRef(index, host.id), id: host.id, label: table.table?.label ?? table.name, via: host.via };
        });

        const has: Record<string, boolean> = { [SCHEMA_REMAP]: await can(SCHEMA_REMAP) };
        for (const page of manifest.addOn.pages ?? []) has[addOnPagePermission(page.ref)] = await can(addOnPagePermission(page.ref));
        const connection = await deps.meta.db.selectFrom('adminium_connections').select('currency').where('id', '=', connectionId).executeTakeFirst();
        return { connectionId, tables, hosts, has, currency: connection?.currency ?? null };
      },
    );
  };
}
