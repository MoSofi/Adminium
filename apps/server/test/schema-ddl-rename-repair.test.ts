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
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  overridesRepo,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  snapshotsRepo,
  type MetaDb,
} from '@adminium/meta';

import { applyOverrides, columnPolicyFor } from '../src/connections/effective-schema.js';
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

  it('follows a renamed column into the rules of its table that read it, and nowhere else', async () => {
    const rule = (id: string, op: string, table: string, column: string, value: unknown) =>
      meta.db
        .insertInto('adminium_schema_overrides')
        .values({ id, connectionId, op, tableName: table, columnName: column, value: JSON.stringify(value), origin: 'user', status: 'active', createdAt: 1, updatedAt: 1 } as never)
        .execute();
    await rule('ovr_when', 'column.requiredWhen', 'public.events', 'person_id', { column: 'kind', in: ['away'] });
    await rule('ovr_copy', 'column.copy', 'public.events', 'rate', { via: 'kind', from: 'kind' });
    await rule('ovr_bound', 'column.bounds', 'public.events', 'ends_on', { notBefore: { column: 'kind' } });
    // A literal an `eq` compares with is not a column, even when it is spelled like one.
    await rule('ovr_formula', 'column.formula', 'public.events', 'hours', {
      formula: { if: [{ eq: ['kind', 'kind'] }, { hoursBetween: ['kind', 'ends_at'] }, { round: ['kind', 2] }] },
    });
    // Another table's column of the same name is not this one.
    await rule('ovr_other', 'column.requiredWhen', 'public.trips', 'person_id', { column: 'kind', in: ['away'] });

    const result = await repairAfterRename({ meta, connectionId, renames: [], columnRenames: [{ table: 'public.events', from: 'kind', to: 'category' }], crypto });
    const rows = await meta.db.selectFrom('adminium_schema_overrides').select(['id', 'value']).orderBy('id').execute();
    const value = (id: string) => JSON.parse(rows.find((row) => row.id === id)!.value as string) as unknown;
    expect(value('ovr_when')).toEqual({ column: 'category', in: ['away'] });
    // `copy.from` is a column of the linked table: left as it was.
    expect(value('ovr_copy')).toEqual({ via: 'category', from: 'kind' });
    expect(value('ovr_bound')).toEqual({ notBefore: { column: 'category' } });
    expect(value('ovr_formula')).toEqual({
      formula: { if: [{ eq: ['category', 'kind'] }, { hoursBetween: ['category', 'ends_at'] }, { round: ['category', 2] }] },
    });
    expect(value('ovr_other')).toEqual({ column: 'kind', in: ['away'] });
    expect(result.overrides).toBe(4);
  });

  it('is a no-op when nothing was renamed', async () => {
    expect(await repairAfterRename({ meta, connectionId, renames: [], crypto })).toEqual({
      includedTables: 0,
      overrides: 0,
      grants: 0,
      pages: 0,
      diagramLayout: 0,
      endpoints: 0,
      scopes: 0,
      appTables: 0,
    });
  });
});

describe('what a rename repairs beyond pages and grants', () => {
  it('moves public endpoints, scope documents, form relations and app records — and keeps a generated page untouched', async () => {
    const { publicEndpointsRepo, publicScopesRepo, appTablesRepo, publicApiStateRepo } = await import('@adminium/meta');
    const { stamped, isUntouched } = await import('../src/pages/generated-stamp.js');
    await publicApiStateRepo(meta).ensure();
    const endpoint = await publicEndpointsRepo(meta).create({
      connectionId,
      ref: 'clients',
      origin: 'custom',
      definition: '{\n  "source": "public.clients",\n  "methods": ["GET"]\n}',
    });
    const scope = await publicScopesRepo(meta).create({
      connectionId,
      side: 'customer',
      name: 'web',
      timezone: 'UTC',
      document: JSON.stringify({ version: 1, resources: [{ ref: 'clients', table: 'public.clients' }] }),
    });
    await appTablesRepo(meta).record({ appKey: 'crm', manifestId: null, connectionId, ref: 'clients', tableName: 'clients', owned: true, state: 'created' });
    const relation = 'fk:public.orders(client_id)->public.clients(id)';
    const page = await pagesRepo(meta).create({
      connectionId,
      slug: 'orders',
      type: 'page-crud',
      title: 'Orders',
      config: stamped({ source: { table: 'public.orders' }, config: { form: { sections: [{ fields: [{ relation }] }] } } }),
      origin: 'manifest',
    } as never);
    const revision = await publicApiStateRepo(meta).read();

    const result = await repairAfterRename({ meta, connectionId, renames: [{ from: 'public.clients', to: 'public.customers' }], crypto });
    expect(result).toMatchObject({ endpoints: 1, scopes: 1, appTables: 1, pages: 1 });

    // The endpoint's table follows; its public URL segment does not change.
    const moved = await publicEndpointsRepo(meta).findById(endpoint.id);
    expect(moved?.definition).toBe('{\n  "source": "public.customers",\n  "methods": ["GET"]\n}');
    expect(moved?.ref).toBe('clients');
    expect((await publicScopesRepo(meta).findById(scope.id))?.document).toContain('"table":"public.customers"');
    expect(await publicApiStateRepo(meta).read()).toBeGreaterThan(revision);
    expect((await appTablesRepo(meta).find(connectionId, 'crm', 'clients'))?.tableName).toBe('customers');

    const reloaded = await pagesRepo(meta).findById(page.id);
    expect(JSON.stringify(reloaded?.config)).toContain('fk:public.orders(client_id)->public.customers(id)');
    // Repaired, not edited: an update would still rebuild it.
    expect(isUntouched(reloaded?.config)).toBe(true);
  });

  it('is all or nothing: a failure part way leaves every reference on the old name', async () => {
    const connections = connectionsRepo(meta, crypto);
    await connections.update(connectionId, { settings: { includedTables: ['public.clients'] } });
    await pagesRepo(meta).create({
      connectionId,
      slug: 'clients',
      type: 'page-crud',
      title: 'Clients',
      config: { source: { table: 'public.clients' } },
      origin: 'generated',
    } as never);
    // The page rewrite fails AFTER includedTables was rewritten in the same run.
    await sql.raw(
      "CREATE TRIGGER fail_page_update BEFORE UPDATE ON adminium_pages BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    ).execute(meta.db);
    await expect(
      repairAfterRename({ meta, connectionId, renames: [{ from: 'public.clients', to: 'public.customers' }], crypto }),
    ).rejects.toThrow('disk full');
    expect((await connections.findById(connectionId))?.settings.includedTables).toEqual(['public.clients']);
  });
});

describe('a secret renamed', () => {
  /** `public.users` as introspection saw it: `api_token` a secret by its name, `hint` a plain column. */
  const usersModel = (secretName: string, plainName: string) => {
    const column = (name: string, ordinal: number, secret: boolean) => ({
      name,
      ordinal,
      dbType: 'text',
      logicalType: 'text',
      nullable: true,
      default: null,
      isPrimaryKey: false,
      isUnique: false,
      isGenerated: false,
      enumRef: null,
      maxLength: null,
      numericPrecision: null,
      numericScale: null,
      isArray: false,
      comment: null,
      references: null,
      semantics: secret
        ? { primary: 'secret', flags: { secret: true, pii: null, maskedByDefault: true }, format: null, pair: null, confidence: 0.95, source: 'heuristic' }
        : { primary: 'plain', flags: { secret: false, pii: null, maskedByDefault: false }, format: null, pair: null, confidence: 0.5, source: 'heuristic' },
    });
    return {
      irVersion: 1,
      dialect: 'postgres',
      source: { kind: 'live', connectionId },
      name: 'src',
      defaultSchema: 'public',
      schemas: ['public'],
      tables: [
        {
          id: 'public.users',
          schema: 'public',
          name: 'users',
          kind: 'table',
          comment: null,
          primaryKey: [],
          columns: [column(secretName, 1, secretName.includes('token')), column(plainName, 2, false)],
        },
      ],
      relations: [],
      enums: [],
    };
  };

  it('stays one under a name that reads as harmless, and a column said to be none is left as said', async () => {
    await snapshotsRepo(meta).create({ connectionId, source: 'introspection', schema: usersModel('api_token', 'hint'), checksum: 'before' });
    const overrides = overridesRepo(meta);
    // What introspection wrote for the guess.
    await overrides.create({ connectionId, op: 'column.pii', tableName: 'public.users', columnName: 'api_token', value: { masked: true }, origin: 'auto' });
    await repairAfterRename({ meta, connectionId, renames: [], columnRenames: [{ table: 'public.users', from: 'api_token', to: 'reference' }], crypto });

    const rows = await overrides.listForConnection(connectionId);
    expect(rows.filter((row) => row.op === 'column.secret').map((row) => [row.columnName, row.value, row.origin])).toEqual([['reference', { secret: true }, 'user']]);
    // Introspected again under its new name: still a secret, not merely masked.
    const after = applyOverrides(usersModel('reference', 'hint') as never, rows).tables[0]!;
    expect(columnPolicyFor(after).secret.has('reference')).toBe(true);
  });

  it('adds nothing for a secret the operator already declared, or a column that is none', async () => {
    await snapshotsRepo(meta).create({ connectionId, source: 'introspection', schema: usersModel('api_token', 'hint'), checksum: 'before' });
    const overrides = overridesRepo(meta);
    await overrides.create({ connectionId, op: 'column.secret', tableName: 'public.users', columnName: 'api_token', value: { secret: false }, origin: 'user' });
    await repairAfterRename({
      meta,
      connectionId,
      renames: [],
      columnRenames: [
        { table: 'public.users', from: 'api_token', to: 'reference' },
        { table: 'public.users', from: 'hint', to: 'note' },
      ],
      crypto,
    });
    expect((await overrides.listForConnection(connectionId)).filter((row) => row.op === 'column.secret').map((row) => [row.columnName, row.value])).toEqual([['reference', { secret: false }]]);
  });
});
