// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rename repair.
 *
 * The assertion that matters: after a table is renamed, Adminium's OWN
 * references follow it, and the ones D33 deliberately leaves alone stay put.
 * A rename that only ran the DDL would leave a page that resolves to nothing
 * and a grant that matches nothing, with no error anywhere.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  type MetaDb,
} from '@adminium/meta';

import { repairAfterRename } from '../src/schema-ddl/rename-repair.js';

const crypto = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.slice(4) };
let meta: MetaDb;
let connectionId: string;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const connection = await connectionsRepo(meta, crypto).create({
    name: 'src',
    engine: 'postgres',
    sourceKind: 'dsn',
    introspectDsn: 'postgres://x',
    createdBy: null,
  } as never);
  connectionId = connection.id;
});

afterEach(async () => {
  await meta.db.destroy();
});

describe('what a rename repairs (D33)', () => {
  it('follows the table through includedTables, overrides, pages, grants and the layout', async () => {
    const connections = connectionsRepo(meta, crypto);
    await connections.update(connectionId, {
      settings: { includedTables: ['public.clients', 'public.orders'] },
    });
    await connections.setDiagramLayout(connectionId, {
      'public.clients': { x: 1, y: 2 },
      'public.orders': { x: 3, y: 4 },
    });

    await meta.db
      .insertInto('adminium_schema_overrides')
      .values({
        id: 'ovr_1',
        connectionId,
        op: 'table.label',
        tableName: 'public.clients',
        columnName: null,
        value: JSON.stringify({ label: 'Clients' }),
        origin: 'user',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      } as never)
      .execute();

    const page = await pagesRepo(meta).create({
      connectionId,
      slug: 'clients',
      type: 'page-crud',
      title: 'Clients',
      config: { source: { table: 'public.clients' } },
      origin: 'generated',
    } as never);

    const role = await rolesRepo(meta).findBySlug('admin');
    await permissionsRepo(meta).grant(role!.id, 'table', `${connectionId}/clients`, {
      read: true,
      create: false,
      update: false,
      delete: false,
      export: false,
      import: false,
    });

    const result = await repairAfterRename({
      meta,
      connectionId,
      renames: [{ from: 'public.clients', to: 'public.customers' }],
      crypto,
    });

    expect(result).toMatchObject({
      includedTables: 1,
      overrides: 1,
      pages: 1,
      grants: 1,
      diagramLayout: 1,
    });

    const after = await connections.findById(connectionId);
    expect(after?.settings.includedTables).toEqual(['public.customers', 'public.orders']);
    expect(after?.diagramLayout).toMatchObject({ 'public.customers': { x: 1, y: 2 } });

    const overrides = await meta.db
      .selectFrom('adminium_schema_overrides')
      .selectAll()
      .execute();
    expect(overrides[0]?.tableName).toBe('public.customers');

    const reloaded = await pagesRepo(meta).findById(page.id);
    expect((reloaded?.config as { source: { table: string } }).source.table).toBe('public.customers');

    const grants = await permissionsRepo(meta).listForResource(
      'table',
      `${connectionId}/customers`,
    );
    expect(grants).toHaveLength(1);
    // …and nothing is left under the old name.
    expect(await permissionsRepo(meta).listForResource('table', `${connectionId}/clients`)).toEqual([]);
  });

  it('leaves audit history alone — a log says what a table was called at the time', async () => {
    await meta.db
      .insertInto('adminium_audit_log')
      .values({
        id: 'aud_1',
        actorKind: 'user',
        actorId: null,
        actorLabel: 'Ava',
        category: 'data',
        action: 'record.update',
        connectionId,
        entityTable: 'public.clients',
        entityId: '1',
        createdAt: 1,
      } as never)
      .execute();

    await repairAfterRename({
      meta,
      connectionId,
      renames: [{ from: 'public.clients', to: 'public.customers' }],
      crypto,
    });

    const rows = await meta.db.selectFrom('adminium_audit_log').selectAll().execute();
    // D33: rewriting this would falsify the record of what happened.
    expect(rows[0]?.entityTable).toBe('public.clients');
  });

  it('is a no-op when nothing was renamed', async () => {
    expect(await repairAfterRename({ meta, connectionId, renames: [], crypto })).toEqual({
      includedTables: 0,
      overrides: 0,
      grants: 0,
      pages: 0,
      diagramLayout: 0,
    });
  });
});
