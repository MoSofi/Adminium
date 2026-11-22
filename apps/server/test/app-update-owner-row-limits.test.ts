// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP UPDATE KEEPS THE ROW LIMITS ITS OWNER SET.
 *
 * Which rows a role reaches is the one limit an owner can set by hand, on the
 * Rows dialog. An update writes the limits its app declares and takes back
 * those it stopped declaring, and leaves the owner's alone: where the app
 * declares a limit of its own on the same action, the owner's stands, so an
 * update never leaves a role reaching more than its owner allowed. Real
 * installs and updates, on every engine this run can reach.
 */
import { permissionsRepo, rolesRepo, type TableActions } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;

const READS = ['table:@customers:read', 'table:@customers:update'];

const shop = (version: string, roles: Doc[]): Doc => ({
  kind: 'app',
  manifestVersion: 1,
  key: 'shop',
  name: 'Shop',
  version,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'A shop.' },
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
  pages: [{ ref: 'shop-customers', template: 'page-crud', title: { key: 't', fallback: 'Customers' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { rows: 'customers' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  roles,
});

const OWN = { reach: 'own' };
const TEAM = { reach: 'team' };
const limited = (read: Doc) => ({ limits: { customers: { rows: { read } } } });

describe.each(LEGS)('an app update and the owner\'s row limits — %s', (dialect, available) => {
  let h: Harness;

  const rowOf = async (key: string): Promise<{ roleId: string; ref: string; actions: TableActions }> => {
    const role = (await rolesRepo(h.meta).findBySlug(`shop-${key}`))!;
    const row = (await permissionsRepo(h.meta).listForRole(role.id)).find((one) => one.resourceKind === 'table')!;
    return { roleId: role.id, ref: row.resourceRef, actions: row.actions as TableActions };
  };
  const update = async (version: string, roles: Doc[]): Promise<void> => {
    await h.stageApp(shop(version, roles));
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: version } });
    expect(updated.statusCode, updated.body).toBe(200);
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop('1.0.0', [
      { key: 'rep', name: 'Rep', permissions: READS },
      { key: 'clerk', name: 'Clerk', permissions: READS, ...limited(OWN) },
      { key: 'solo', name: 'Solo', permissions: ['table:@customers:read'] },
    ]));
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    // What the Rows dialog stores for the owner: the rep reaches only their own rows.
    const rep = await rowOf('rep');
    await permissionsRepo(h.meta).grant(rep.roleId, 'table', rep.ref, { ...rep.actions, rowLimit: { read: OWN, update: OWN }, ownerRows: { read: OWN, update: OWN } } as never);
    const solo = await rowOf('solo');
    await permissionsRepo(h.meta).grant(solo.roleId, 'table', solo.ref, { ...solo.actions, rowLimit: { read: OWN }, ownerRows: { read: OWN } } as never);
  }, 240_000);
  afterAll(async () => {
    if (available) await h?.close();
  });

  it.skipIf(!available)('keeps the owner\'s limit through an update that also changes the role', async () => {
    await update('1.0.1', [
      { key: 'rep', name: 'Rep', permissions: [...READS, 'table:@customers:create'] },
      { key: 'clerk', name: 'Clerk', permissions: READS, ...limited(OWN) },
      { key: 'solo', name: 'Solo', permissions: ['table:@customers:read'] },
    ]);
    const rep = await rowOf('rep');
    expect(rep.actions.create).toBe(true);
    expect(rep.actions.rowLimit).toEqual({ read: OWN, update: OWN });
  });

  it.skipIf(!available)('keeps the owner\'s limit where the app now declares a wider one on the same action', async () => {
    await update('1.0.2', [
      { key: 'rep', name: 'Rep', permissions: [...READS, 'table:@customers:create'], ...limited(TEAM) },
      { key: 'clerk', name: 'Clerk', permissions: READS, ...limited(TEAM) },
      { key: 'solo', name: 'Solo', permissions: ['table:@customers:read'] },
    ]);
    expect((await rowOf('rep')).actions.rowLimit).toEqual({ read: OWN, update: OWN });
    // A limit the owner did not touch follows the app.
    expect((await rowOf('clerk')).actions.rowLimit).toEqual({ read: TEAM });
  });

  it.skipIf(!available)('takes back a limit only the app wrote, and still not the owner\'s', async () => {
    await update('1.0.3', [
      { key: 'rep', name: 'Rep', permissions: [...READS, 'table:@customers:create'] },
      { key: 'clerk', name: 'Clerk', permissions: READS },
      { key: 'solo', name: 'Solo', permissions: ['table:@customers:read'] },
    ]);
    expect((await rowOf('clerk')).actions.rowLimit).toBeUndefined();
    expect((await rowOf('rep')).actions.rowLimit).toEqual({ read: OWN, update: OWN });
  });

  it.skipIf(!available)('keeps the owner\'s limit after a release that declares the same one and the next that does not', async () => {
    await update('1.0.4', [
      { key: 'rep', name: 'Rep', permissions: [...READS, 'table:@customers:create'], limits: { customers: { rows: { read: OWN, update: OWN } } } },
      { key: 'clerk', name: 'Clerk', permissions: READS },
      { key: 'solo', name: 'Solo', permissions: ['table:@customers:read'] },
    ]);
    await update('1.0.5', [
      { key: 'rep', name: 'Rep', permissions: [...READS, 'table:@customers:create'], ...limited(TEAM) },
      { key: 'clerk', name: 'Clerk', permissions: READS },
      { key: 'solo', name: 'Solo', permissions: ['table:@customers:read'] },
    ]);
    expect((await rowOf('rep')).actions.rowLimit).toEqual({ read: OWN, update: OWN });
  });

  it.skipIf(!available)('keeps the owner\'s limit while a release takes the role\'s grant away, for when one gives it back', async () => {
    await update('1.0.6', [
      { key: 'rep', name: 'Rep', permissions: [...READS, 'table:@customers:create'] },
      { key: 'clerk', name: 'Clerk', permissions: READS },
      { key: 'solo', name: 'Solo', permissions: ['table:@customers:create'] },
    ]);
    await update('1.0.7', [
      { key: 'rep', name: 'Rep', permissions: [...READS, 'table:@customers:create'] },
      { key: 'clerk', name: 'Clerk', permissions: READS },
      { key: 'solo', name: 'Solo', permissions: ['table:@customers:read', 'table:@customers:create'] },
    ]);
    const solo = await rowOf('solo');
    expect(solo.actions.read).toBe(true);
    expect(solo.actions.rowLimit).toEqual({ read: OWN });
  });
});
