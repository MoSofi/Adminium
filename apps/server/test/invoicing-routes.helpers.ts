// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard's data routes over an invoicing app installed by the real
 * installer (`installInvoicing`): a second Adminium, with the full data API,
 * RBAC and undo store, pointed at the same database, carrying the same
 * stored rules. So a test can save an invoice with its lines as the
 * dashboard's form does, and ask for an undo.
 */
import { overridesRepo } from '@adminium/meta';

import { createWriteService, type RecordHooks, type WriteServiceOptions } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { type Dialect, type InvoicingHarness } from './invoicing-install.helpers.js';
import { asUser, buildDataTestApp, createConnectionViaApi, introspectViaApi, type DataTestContext } from './connections-helpers.js';

type Reply = Awaited<ReturnType<DataTestContext['app']['inject']>>;

export interface DataRoutes {
  t: DataTestContext;
  connectionId: string;
  /** A table's id, as the data routes take it. */
  table: (ref: string) => string;
  /** The id of the one-to-many relation from a child table to its parent. */
  relation: (childRef: string) => string;
  post: (ref: string, body: unknown) => Promise<Reply>;
  patch: (ref: string, id: unknown, body: unknown) => Promise<Reply>;
  undo: (token: string) => Promise<Reply>;
  close: () => Promise<void>;
}

export async function dataRoutesOver(
  h: InvoicingHarness,
  dialect: Dialect,
  currency: string | null = 'EUR',
  /** The hooks every write through the routes runs, as a project's would. */
  hooks?: RecordHooks,
): Promise<DataRoutes> {
  const dsns = await h.manager.connections.getDsns(h.connectionId);
  // The service reads its stores when a write needs them: they are the test app's own, filled in once it exists.
  const options: WriteServiceOptions = hooks === undefined ? {} : { hooks: () => hooks };
  const t = await buildDataTestApp(hooks === undefined ? {} : { writes: createWriteService(options) });
  Object.assign(options, writeStores(t.meta));
  const connectionId = await createConnectionViaApi(t, dsns!.dataDsn!, 'Studio', dialect);
  await introspectViaApi(t, connectionId);
  await t.grantTable(t.roles.admin, connectionId, '*', { read: true, create: true, update: true, delete: true });
  // The same rules, stored against this connection.
  const from = overridesRepo(h.meta);
  const to = overridesRepo(t.meta);
  for (const row of await from.listForConnection(h.connectionId, { status: 'active' })) {
    await to.create({ connectionId, op: row.op, tableName: row.tableName, columnName: row.columnName, value: row.value, origin: row.origin });
  }
  await t.meta.db.updateTable('adminium_connections').set({ currency } as never).where('id', '=', connectionId).execute();

  const schema = await t.app.inject({ method: 'GET', url: `/api/v1/connections/${connectionId}/schema`, headers: asUser(t.users.admin) });
  const model = schema.json<{
    model: { tables: { id: string; name: string }[]; relations: { id: string; through: unknown; from: { tableId: string }; to: { tableId: string } }[] };
  }>().model;
  const table = (ref: string) => model.tables.find((candidate) => candidate.name === h.real(ref))!.id;
  const relation = (childRef: string) => model.relations.find((r) => r.through === null && r.from.tableId === table(childRef))!.id;
  const headers = asUser(t.users.admin);
  return {
    t,
    connectionId,
    table,
    relation,
    post: (ref, body) => t.app.inject({ method: 'POST', url: `/api/v1/data/${connectionId}/${table(ref)}`, headers, payload: body as never }),
    patch: (ref, id, body) =>
      t.app.inject({ method: 'PATCH', url: `/api/v1/data/${connectionId}/${table(ref)}/${String(id)}`, headers, payload: body as never }),
    undo: (token) => t.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token}`, headers }),
    close: async () => {
      await t.app.close();
      await t.meta.db.destroy().catch(() => undefined);
    },
  };
}
