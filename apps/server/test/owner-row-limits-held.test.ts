// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NO UPDATE, RESTART, RENAME OR EDIT LEAVES A ROLE REACHING MORE ROWS THAN IT DID.
 *
 * Real installs, updates, saves on the roles route, a real rename repair and a
 * real config bundle, on every engine this run can reach.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { permissionsRepo, rolesRepo, settingsRepo, snapshotsRepo, usersRepo, type RowLimit, type TableActions } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markOwnerRowLimits } from '../src/apps/mark-owner-row-limits.js';
import { importZip } from '../src/export/import-service.js';
import { exportZip } from '../src/export/zip-service.js';
import { rolesRoutes } from '../src/routes/roles/index.js';
import { repairAfterRename } from '../src/schema-ddl/rename-repair.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;

const PENDING = 'system.ownerRowLimitsPending' as const;
const OWN = { reach: 'own' as const };
const TEAM = { reach: 'team' as const };
const READ_UPDATE = ['table:@customers:read', 'table:@customers:update'];
const UPDATE = ['table:@customers:update'];
const CRYPTO = { encrypt: (value: string) => value, decrypt: (value: string) => value };

const app = (key: string, version: string, roles: Doc[]): Doc => ({
  kind: 'app',
  manifestVersion: 1,
  key,
  name: key,
  version,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'An app.' },
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.47' },
  requiredSchema: {
    prefixed: true,
    tables: [{
      ref: 'customers',
      keyField: 'name',
      belongs: [{ column: 'owner_id', set: 'team' }],
      indexes: [['owner_id']],
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text', maxLength: 80, nullable: true },
        { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
      ],
    }],
  },
  pages: [{ ref: `${key}-customers`, template: 'page-crud', title: { key: 't', fallback: 'Customers' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { rows: 'customers' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  roles,
});

const FIRST: Doc[] = [
  { key: 'rep', name: 'Rep', permissions: READ_UPDATE },
  { key: 'clerk', name: 'Clerk', permissions: READ_UPDATE, limits: { customers: { rows: { read: OWN } } } },
];
const repOnly = (permissions: string[]): Doc[] => [{ key: 'rep', name: 'Rep', permissions }, FIRST[1]!];

describe.each(LEGS)('a role never reaches more rows than it did — %s', (dialect, available) => {
  let h: Harness;

  const rowOf = async (key: string, appKey = 'shop'): Promise<{ roleId: string; ref: string; actions: TableActions }> => {
    const role = (await rolesRepo(h.meta).findBySlug(`${appKey}-${key}`))!;
    const row = (await permissionsRepo(h.meta).listForRole(role.id)).find((one) => one.resourceKind === 'table')!;
    return { roleId: role.id, ref: row.resourceRef, actions: row.actions as TableActions };
  };
  const update = async (version: string, roles: Doc[]): Promise<void> => {
    await h.stageApp(app('shop', version, roles));
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: version } });
    expect(updated.statusCode, updated.body).toBe(200);
  };
  const save = async (key: string, actions: readonly string[], limit: RowLimit | null, as?: Awaited<ReturnType<ReturnType<typeof usersRepo>['create']>>) => {
    const row = await rowOf(key);
    const [connectionId, ...table] = row.ref.split('/');
    return h.inject({
      method: 'PUT',
      url: `/roles/${row.roleId}/permissions`,
      payload: { grants: actions.map((action) => `table:${connectionId ?? ''}:${table.join('/')}:${action}`), rows: { [row.ref]: limit } },
      ...(as === undefined ? {} : { as }),
    });
  };
  const saved = async (key: string, actions: readonly string[], limit: RowLimit | null): Promise<void> => {
    const reply = await save(key, actions, limit);
    expect(reply.statusCode, reply.body).toBe(200);
  };
  /** A limit as stored before limits said whose they are. */
  const storedEarlier = async (key: string, rowLimit: RowLimit): Promise<void> => {
    const row = await rowOf(key);
    const { ownerRows: _ownerRows, ...actions } = row.actions;
    await permissionsRepo(h.meta).grant(row.roleId, 'table', row.ref, { ...actions, rowLimit });
  };
  const installId = async (key: string): Promise<string> => {
    const row = await h.meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', key).executeTakeFirstOrThrow();
    return row.id;
  };
  const moveInstall = async (key: string, connectionId: string): Promise<void> => {
    await h.meta.db.updateTable('adminium_manifests').set({ connectionId }).where('manifestKey', '=', key).execute();
  };
  const sort = (): Promise<number> => markOwnerRowLimits({ meta: h.meta });

  beforeEach(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {}, routes: () => [rolesRoutes] });
    await h.stageApp(app('shop', '1.0.0', FIRST));
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
  }, 240_000);
  afterEach(async () => {
    if (available) await h?.close();
  }, 60_000);

  it.skipIf(!available)('keeps a limit waiting on one action through a save of another', async () => {
    await saved('rep', ['read', 'update'], { read: OWN, update: OWN });
    await update('1.0.1', repOnly(UPDATE));
    await saved('rep', ['update'], { update: TEAM });
    await update('1.0.2', repOnly(READ_UPDATE));
    const rep = await rowOf('rep');
    expect(rep.actions.read).toBe(true);
    expect(rep.actions.rowLimit).toEqual({ read: OWN, update: TEAM });
  }, 120_000);

  it.skipIf(!available)('moves a rename through the owner\'s limit too, and through one that waits', async () => {
    const through = { reach: 'own' as const, notThrough: 'public.old_listing' };
    const moved = { reach: 'own' as const, notThrough: 'public.new_listing' };
    const rep = await rowOf('rep');
    await permissionsRepo(h.meta).grant(rep.roleId, 'table', rep.ref, { ...rep.actions, rowLimit: { read: through }, ownerRows: { read: through } });
    const clerk = await rowOf('clerk');
    const { rowLimit: _rowLimit, ...plain } = clerk.actions;
    await permissionsRepo(h.meta).grant(clerk.roleId, 'table', clerk.ref, { ...plain, read: false, ownerRows: { read: through } });
    await repairAfterRename({ meta: h.meta, connectionId: h.connectionId, renames: [{ from: 'public.old_listing', to: 'public.new_listing' }], crypto: CRYPTO } as never);
    expect((await rowOf('rep')).actions).toMatchObject({ rowLimit: { read: moved }, ownerRows: { read: moved } });
    expect((await rowOf('clerk')).actions.ownerRows).toEqual({ read: moved });
  }, 120_000);

  it.skipIf(!available)('counts a condition of the owner\'s that happens to name the app', async () => {
    const owners = { reach: 'own' as const, while: { column: 'name', in: ['shop'] } };
    await storedEarlier('clerk', { read: owners });
    await settingsRepo(h.meta).set(PENDING, [await installId('shop')]);
    await sort();
    expect((await rowOf('clerk')).actions.ownerRows).toEqual({ read: owners });
    await update('1.0.1', FIRST);
    expect((await rowOf('clerk')).actions.rowLimit).toEqual({ read: owners });
  }, 120_000);

  it.skipIf(!available)('asks for the action before a limit waiting on it is changed', async () => {
    await saved('rep', ['read', 'update'], { read: OWN, update: OWN });
    await update('1.0.1', repOnly(UPDATE));
    const rep = await rowOf('rep');
    const manager = await rolesRepo(h.meta).create({ slug: 'manager', name: 'Manager' });
    await permissionsRepo(h.meta).grant(manager.id, 'system', 'roles.manage', { allowed: true });
    await permissionsRepo(h.meta).grant(manager.id, 'table', rep.ref, { read: false, create: false, update: true, delete: false, export: false, import: false });
    const person = await usersRepo(h.meta).create({ email: 'manager@adminium.test', name: 'Manager', passwordHash: 'test-hash', status: 'active' });
    await rolesRepo(h.meta).assignToUser(person.id, manager.id);

    const refused = await save('rep', ['update'], null, person);
    expect(refused.statusCode, refused.body).toBe(403);
    expect((await rowOf('rep')).actions.ownerRows).toMatchObject({ read: OWN });
    await saved('rep', ['update'], null);
    expect((await rowOf('rep')).actions.ownerRows).toBeUndefined();
  }, 120_000);

  it.skipIf(!available)('sorts every install it can when one cannot be read', async () => {
    await h.stageApp(app('desk', '1.0.0', FIRST));
    const desk = await h.install('desk', '1.0.0');
    expect(desk.statusCode, desk.body).toBe(200);
    const broken = await h.addConnection('broken');
    await snapshotsRepo(h.meta).create({ connectionId: broken, source: 'introspection', schema: { broken: true }, checksum: 'broken' } as never);
    await moveInstall('desk', broken);
    await storedEarlier('rep', { read: OWN });
    const [bad, good] = [await installId('desk'), await installId('shop')];
    await settingsRepo(h.meta).set(PENDING, [bad, good]);
    await sort();
    expect((await rowOf('rep')).actions.ownerRows).toEqual({ read: OWN });
    expect(await settingsRepo(h.meta).get(PENDING)).toEqual([bad]);
  }, 180_000);

  it.skipIf(!available)('comes back to an install it could not read', async () => {
    const empty = await h.addConnection('empty');
    await h.meta.db.deleteFrom('adminium_schema_snapshots').where('connectionId', '=', empty).execute();
    await moveInstall('shop', empty);
    await storedEarlier('rep', { read: OWN });
    const id = await installId('shop');
    await settingsRepo(h.meta).set(PENDING, [id]);
    await sort();
    expect(await settingsRepo(h.meta).get(PENDING)).toEqual([id]);
    await moveInstall('shop', h.connectionId);
    await sort();
    expect((await rowOf('rep')).actions.ownerRows).toEqual({ read: OWN });
    expect(await settingsRepo(h.meta).get(PENDING)).toEqual([]);
  }, 120_000);

  it.skipIf(!available)('changes no limit of an install still to be sorted', async () => {
    await storedEarlier('rep', { read: OWN });
    await settingsRepo(h.meta).set(PENDING, [await installId('shop')]);
    await update('1.0.1', FIRST);
    expect((await rowOf('rep')).actions.rowLimit).toEqual({ read: OWN });
  }, 120_000);

  it.skipIf(!available)('holds the app\'s limit again the moment the owner\'s comes off', async () => {
    await saved('clerk', ['read', 'update'], { read: TEAM });
    await saved('clerk', ['read', 'update'], null);
    expect((await rowOf('clerk')).actions.rowLimit).toEqual({ read: OWN });
    await saved('clerk', ['read', 'update'], { read: TEAM, update: OWN });
    await saved('clerk', ['read', 'update'], { update: OWN });
    expect((await rowOf('clerk')).actions.rowLimit).toEqual({ read: OWN, update: OWN });
  }, 120_000);

  it.skipIf(!available)('keeps the limits of an older bundle through the next update', async () => {
    await sort();
    await storedEarlier('rep', { read: OWN });
    const dir = await mkdtemp(join(tmpdir(), 'owner-rows-'));
    try {
      const bundle = await exportZip({ meta: h.meta, outPath: join(dir, 'config.zip'), dataDir: h.dataDir, includeSecrets: false });
      await importZip({ meta: h.meta, inPath: bundle.path });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    await sort();
    await update('1.0.1', FIRST);
    expect((await rowOf('rep')).actions.rowLimit).toEqual({ read: OWN });
  }, 120_000);

  it.skipIf(!available)('holds only the install whose roles a bundle takes, and none for a role an install left behind', async () => {
    await sort();
    const dir = await mkdtemp(join(tmpdir(), 'owner-rows-'));
    try {
      // Exported before the second install existed, so it carries none of that install's roles.
      const bundle = await exportZip({ meta: h.meta, outPath: join(dir, 'config.zip'), dataDir: h.dataDir, includeSecrets: false });
      const first = await h.meta.db.selectFrom('adminium_manifests').selectAll().where('manifestKey', '=', 'shop').executeTakeFirstOrThrow();
      const elsewhere = await h.addConnection('elsewhere');
      const copy = Object.fromEntries(Object.entries(first).map(([column, value]) => [column, typeof value === 'object' && value !== null ? JSON.stringify(value) : value]));
      await h.meta.db.insertInto('adminium_manifests').values({ ...copy, id: 'shop-elsewhere', connectionId: elsewhere, scopeKey: elsewhere, instanceSlug: 'elsewhere' } as never).execute();

      await importZip({ meta: h.meta, inPath: bundle.path });
      expect(await settingsRepo(h.meta).get(PENDING)).toEqual([first.id]);

      await settingsRepo(h.meta).set(PENDING, []);
      await h.meta.db.updateTable('adminium_roles').set({ manifestId: null }).where('appKey', '=', 'shop').execute();
      await importZip({ meta: h.meta, inPath: bundle.path });
      expect(await settingsRepo(h.meta).get(PENDING)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
