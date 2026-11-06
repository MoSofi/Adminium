// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DATABASE'S ROLES, SAVED AS AN APP AND INSTALLED AGAIN.
 *
 * A role a person made travels with its grants named by the file's refs: its
 * tables, its pages, people's data, one add-on's settings, and what its
 * update writes. A grant on every table becomes one on each of the app's own
 * tables, and Check says so. A console permission is named so the install can
 * list it, and is never given. A built-in role never travels; what it holds
 * here is said. On every engine the machine runs.
 */
import { manifestsRepo, pagesRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINES, type Harness } from './app-install-harness.js';
import { afterInstallOf, APP_KEY, expectValid, installFile, leaked, save, sourceDatabase, standIns, target, type Doc, type Source } from './app-save-rules.helpers.js';

const ALL = { read: false, create: false, update: false, delete: false, export: false, import: false };

/** An add-on kept on this database: its settings are a grant a role may carry. */
async function addOnHere(source: Source, key: string): Promise<void> {
  await manifestsRepo(source.h.meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
    manifestKey: key,
    version: '1.2.0',
    kind: 'add-on',
    source: 'file',
    document: { kind: 'add-on', key },
    connectionId: source.h.connectionId,
    scopeKey: source.h.connectionId,
  });
}

/** A clerk (tables, a limit, a page, people's data, an add-on's settings, a console permission) and a viewer of everything. */
async function roles(source: Source) {
  const { meta, connectionId } = source.h;
  const permissions = permissionsRepo(meta);
  const clerk = await rolesRepo(meta).create({ slug: 'clerk', name: 'Clerk', names: { from: 'Clerk', names: { 'de-DE': 'Sachbearbeiter' } } });
  await permissions.grant(clerk.id, 'table', `${connectionId}/${source.tableId('orders')}`, { ...ALL, read: true, update: true, updateLimit: { writable: ['status'], writableValues: { status: ['open', 'done'] } }, readLimit: { readable: ['status', 'total'] } });
  await permissions.grant(clerk.id, 'table', `${connectionId}/${source.tableId('customers')}`, { ...ALL, read: true, read_pii: true });
  await permissions.grant(clerk.id, 'page', source.pageId('order-list'), { view: true, edit: false });
  await permissions.grant(clerk.id, 'system', 'privacy.people', { allowed: true });
  await permissions.grant(clerk.id, 'system', 'users.manage', { allowed: true });
  await permissions.grant(clerk.id, 'app', 'add-on/letterhead', { staff: true });
  const viewer = await rolesRepo(meta).create({ slug: 'looker', name: 'Looker' });
  await permissions.grant(viewer.id, 'table', `${connectionId}/*`, { ...ALL, read: true });
  await permissions.grant(viewer.id, 'page', '*', { view: true, edit: false });
  // A built-in role a person gave a grant here: it stays here.
  const builtin = (await rolesRepo(meta).list()).find((role) => role.isBuiltin)!;
  await permissions.grant(builtin.id, 'table', `${connectionId}/${source.tableId('orders')}`, { ...ALL, read: true });
  return { clerk, viewer, builtin };
}

/** The file, with the add-on the clerk's settings grant names (the add-ons part writes it). */
const withAddOn = (doc: Doc) => ({ ...doc, addOns: { suggests: [{ key: 'letterhead', range: '>=1.0.0', reason: { 'en-US': 'Letterhead for printed orders.' } }] } });

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a database's roles, saved and installed [${dialect}]`, () => {
    let source: Source | null = null;
    let other: Harness | null = null;
    afterEach(async () => {
      await source?.h.close();
      await other?.close();
      source = null;
      other = null;
    });

    it('writes each grant by its ref, narrows a wildcard, names a console permission for the owner, and installs it so', async () => {
      source = await sourceDatabase(dialect);
      await addOnHere(source, 'letterhead');
      const { clerk, viewer, builtin } = await roles(source);
      const { manifest, check } = await save(source);
      const doc = manifest as unknown as Doc;

      const byKey = Object.fromEntries((doc['roles'] as Doc[]).map((role) => [role.key, role]));
      expect(Object.keys(byKey).sort()).toEqual(['clerk', 'looker']);
      expect(byKey['clerk']).toEqual({
        key: 'clerk',
        name: 'Clerk',
        names: { 'de-DE': 'Sachbearbeiter' },
        permissions: expect.any(Array),
        limits: { orders: { writable: ['status'], writableValues: { status: ['open', 'done'] }, readable: ['status', 'total'] } },
      });
      expect([...byKey['clerk'].permissions].sort()).toEqual(
        ['addOn:letterhead:settings', 'page:@order-list:view', 'privacy:@:people', 'system:users:manage', 'table:@customers:read', 'table:@customers:read_pii', 'table:@orders:read', 'table:@orders:update'].sort(),
      );
      // Every table and page: each of the app's own.
      expect([...byKey['looker'].permissions].sort()).toEqual(['page:@customer-list:view', 'page:@order-list:view', 'table:@customers:read', 'table:@orders:read']);

      const said = check.map((item) => [item.group, item.code, item.item]);
      expect(said).toContainEqual(['info', 'WILDCARD_NARROWED', 'Looker']);
      expect(said).toContainEqual(['info', 'BUILTIN_ROLE_CHANGED', builtin.name]);
      expect(check).toContainEqual(expect.objectContaining({ group: 'after', code: 'SYSTEM_GRANT', item: 'Clerk', field: 'system:users:manage', afterKind: 'system-grant' }));

      // No id of the source: not the database's, a role's, a page's or a person's.
      const owner = await usersRepo(source.h.meta).findByEmail('owner@test');
      expect(leaked(doc, [source.h.connectionId, clerk.id, viewer.id, builtin.id, source.pageId('order-list'), source.pageId('customer-list'), owner!.id])).toEqual([]);

      const file = withAddOn(standIns(doc));
      expectValid(file);
      other = await target(dialect);
      await installFile(other, file);

      const installed = await rolesRepo(other.meta).findBySlug(`${APP_KEY}-clerk`);
      expect(installed).not.toBeNull();
      expect(installed!.names).toEqual({ from: 'Clerk', names: { 'de-DE': 'Sachbearbeiter' } });
      const rows = await permissionsRepo(other.meta).listForRole(installed!.id);
      const orders = rows.find((row) => row.resourceKind === 'table' && row.resourceRef.endsWith('orders'));
      expect(orders?.actions).toMatchObject({ read: true, update: true, updateLimit: { writable: ['status'], writableValues: { status: ['open', 'done'] } }, readLimit: { readable: ['status', 'total'] } });
      const page = await pagesRepo(other.meta).findBySlug(other.connectionId, 'order-list');
      expect(rows.find((row) => row.resourceKind === 'page' && row.resourceRef === page!.id)?.actions).toEqual({ view: true, edit: false });
      // People's data and the add-on's settings are given; the console permission never is.
      expect(rows.some((row) => row.resourceKind === 'system' && row.resourceRef === 'privacy.people')).toBe(true);
      expect(rows.some((row) => row.resourceKind === 'app' && row.resourceRef === 'add-on/letterhead')).toBe(true);
      expect(rows.some((row) => row.resourceKind === 'system' && row.resourceRef === 'users.manage')).toBe(false);
      expect(await afterInstallOf(other)).toContainEqual(['system-grant', 'clerk', 'system:users:manage']);

      const viewerHere = await rolesRepo(other.meta).findBySlug(`${APP_KEY}-looker`);
      const viewerRows = await permissionsRepo(other.meta).listForRole(viewerHere!.id);
      // Narrower than every table: no wildcard row at all.
      expect(viewerRows.some((row) => row.resourceRef.endsWith('/*') || row.resourceRef === '*')).toBe(false);
      expect(viewerRows.filter((row) => row.resourceKind === 'table')).toHaveLength(2);
    });

    it('leaves out a grant on a table that does not travel, and the settings of an add-on this database lacks', async () => {
      source = await sourceDatabase(dialect);
      await roles(source);
      const { manifest, check } = await save(source, { tables: [source.tableId('orders')] });
      const clerkHere = ((manifest as unknown as Doc)['roles'] as Doc[]).find((role) => role.key === 'clerk')!;
      expect(clerkHere.permissions).not.toContain('table:@customers:read');
      expect(clerkHere.permissions).not.toContain('addOn:letterhead:settings');
      expect(check).toContainEqual(expect.objectContaining({ group: 'info', code: 'GRANT_TABLE_LEFT_OUT', item: 'Clerk' }));
      expect(check).toContainEqual(expect.objectContaining({ group: 'info', code: 'ADD_ON_NOT_HERE', item: 'Clerk', field: 'letterhead' }));
    });
  });
}

describe('a console permission in a file', () => {
  let h: Harness | null = null;
  afterEach(async () => {
    await h?.close();
    h = null;
  });

  const app = (publisher: { id: string; name: string }, saved = true): Doc =>
    standIns({
      ...(saved ? { provenance: { lineage: 'lin-test-0002', savedAt: '2026-11-06T09:00:00Z', adminiumVersion: '0.3.49', label: 'Corner shop, Leith' } } : {}),
      kind: 'app',
      manifestVersion: 1,
      key: APP_KEY,
      name: 'Corner shop',
      version: '1.0.0',
      publisher,
      license: 'UNLICENSED',
      description: { key: `${APP_KEY}.description`, fallback: 'A shop.' },
      categories: ['operations'],
      compatibility: { minAdminiumVersion: '0.3.49' },
      requiredSchema: { tables: [] },
      pages: [],
      frontends: [{ side: 'staff', kind: 'none' }],
      roles: [{ key: 'clerk', name: 'Clerk', permissions: ['table:@orders:read', 'system:users:manage', 'system:audit:read'] }],
    });

  it('saved from a database: never given, listed in the review and after installing', async () => {
    h = await target('sqlite');
    const doc = app({ id: 'local', name: 'Corner shop, Leith' });
    expectValid(doc);
    await h.stage(doc);
    const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: APP_KEY, version: '1.0.0', connectionId: h.connectionId } });
    expect(planned.statusCode, planned.body).toBe(200);
    const plan = (JSON.parse(planned.body) as { plan: { afterInstall?: Doc[] } }).plan;
    expect((plan.afterInstall ?? []).map((item) => [item['kind'], item['item'], item['field']])).toEqual([
      ['system-grant', 'clerk', 'system:users:manage'],
      ['system-grant', 'clerk', 'system:audit:read'],
    ]);
    await installFile(h, doc);
    const role = await rolesRepo(h.meta).findBySlug(`${APP_KEY}-clerk`);
    const rows = await permissionsRepo(h.meta).listForRole(role!.id);
    expect(rows.filter((row) => row.resourceKind === 'system')).toEqual([]);
    expect(await afterInstallOf(h)).toEqual([
      ['system-grant', 'clerk', 'system:audit:read'],
      ['system-grant', 'clerk', 'system:users:manage'],
    ]);
  });

  it('from a publisher, or a project\'s own app: refused, as before', async () => {
    for (const publisher of [{ id: 'adminium', name: 'Adminium' }, { id: 'local', name: 'This project' }]) {
      h = await target('sqlite');
      const reply = await h.install(app(publisher, false));
      expect(reply.statusCode).not.toBe(200);
      expect(reply.body).toContain('console permission');
      await h.close();
      h = null;
    }
  });
});
