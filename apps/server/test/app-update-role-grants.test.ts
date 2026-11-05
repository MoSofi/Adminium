// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN UPDATE ASKS BEFORE IT GIVES A ROLE MORE: `privacy:@:people` and an
 * add-on's settings (`addOn:<key>:settings`).
 *
 * Each app grant is given once, so a new version that newly wants one would
 * hand it to a role nobody chose to trust with it — a shop's owner erasing
 * anybody the workspace keeps. The update's check marks each such grant
 * (`added`), and the update gives it only when the operator allows it
 * (`roleGrants: true`); without that it is refused (422 `ROLE_GRANTS_ADDED`)
 * with nothing moved. A version that wants nothing new asks nothing.
 *
 * And a screens-only role cannot take the erase right by cloning a role that
 * holds it. On every engine this run can reach.
 */
import { permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { roleIssues } from '../src/apps/manifest-roles.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const NOTES = 'notes';

const shop = (version: string, ownerGrants: string[], extraRoles: Doc[] = []): Doc => ({
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
    tables: [{ ref: 'customers', keyField: 'name', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] }],
  },
  pages: [{ ref: 'shop-customers', template: 'page-crud', title: { key: 't', fallback: 'Customers' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'customers' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  addOns: { suggests: [{ key: NOTES, range: '>=1.0.0', reason: { 'en-US': 'Keeps notes.' } }] },
  people: [{ table: 'customers', kind: 'people', email: 'email', name: 'name' }],
  roles: [{ key: 'owner', name: 'Owner', permissions: ownerGrants }, ...extraRoles],
});

const BASE = ['table:@customers:read'];
const MORE = [...BASE, 'privacy:@:people', `addOn:${NOTES}:settings`];

describe.each(LEGS)('an update that gives a role more asks first — %s', (dialect, available) => {
  let h: Harness;
  const systemGrants = async () => {
    const role = (await rolesRepo(h.meta).findBySlug('shop-owner'))!;
    return (await permissionsRepo(h.meta).listForRole(role.id)).filter((row) => row.resourceKind === 'system').map((row) => row.resourceRef);
  };
  const plan = async (version: string) => {
    const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version, connectionId: h.connectionId } });
    expect(planned.statusCode, planned.body).toBe(200);
    return (planned.json() as { plan: { privacyGrants?: Doc[]; addOnGrants?: Doc[] } }).plan;
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop('1.0.0', BASE));
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageApp(shop('1.0.1', MORE));
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await h?.close();
  });

  it.skipIf(!available)("the update's check marks what the running version's roles were not given", async () => {
    const checked = await plan('1.0.1');
    expect(checked.privacyGrants).toEqual([{ role: 'shop-owner', roleName: 'Owner', added: true }]);
    expect(checked.addOnGrants).toEqual([{ role: 'shop-owner', roleName: 'Owner', addOn: NOTES, grant: 'settings', added: true }]);
  });

  it.skipIf(!available)('without the say the update is refused, by name, and nothing moves', async () => {
    const refused = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.1' } });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.body).toContain('ROLE_GRANTS_ADDED');
    expect(refused.body).toContain('find, download and erase');
    expect(await systemGrants()).toEqual([]);
    const versions = await h.meta.db.selectFrom('adminium_manifests').select('version').where('manifestKey', '=', 'shop').execute();
    expect(versions.map((row) => row.version)).toEqual(['1.0.0']);
  });

  it.skipIf(!available)('allowed, the update gives them', async () => {
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.1', roleGrants: true } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await systemGrants()).toEqual(['privacy.people']);
  });

  it.skipIf(!available)('a version that wants nothing new asks nothing', async () => {
    await h.stageApp(shop('1.0.2', MORE));
    const checked = await plan('1.0.2');
    expect(checked.privacyGrants).toEqual([{ role: 'shop-owner', roleName: 'Owner' }]);
    expect(checked.addOnGrants).toEqual([{ role: 'shop-owner', roleName: 'Owner', addOn: NOTES, grant: 'settings' }]);
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.2' } });
    expect(updated.statusCode, updated.body).toBe(200);
  });

  it.skipIf(!available)('a new role that wants the erase right is asked about too', async () => {
    await h.stageApp(shop('1.0.3', MORE, [{ key: 'manager', name: 'Manager', permissions: ['table:@customers:read', 'privacy:@:people'] }]));
    expect((await plan('1.0.3')).privacyGrants).toEqual([{ role: 'shop-owner', roleName: 'Owner' }, { role: 'shop-manager', roleName: 'Manager', added: true }]);
    const refused = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.3' } });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.body).toContain('ROLE_GRANTS_ADDED');
    expect(await rolesRepo(h.meta).findBySlug('shop-manager')).toBeNull();
  });
});

describe('a screens-only role cannot clone the erase right', () => {
  it('a screens-only clone of a role that holds privacy:@:people is refused, by name', () => {
    const app = shop('1.0.0', MORE, [{ key: 'packer', name: 'Packer', screensOnly: true, cloneFrom: 'owner', permissions: ['app:@:staff'] }]);
    expect(roleIssues(app as never).map((issue) => issue.message)).toEqual([
      'The role "packer": it clones "owner", whose "privacy:@:people" is used on the dashboard\'s privacy page, which a screens-only role never opens: give it to a role that opens the dashboard.',
    ]);
  });

  it('a clone that opens the dashboard may take it', () => {
    const app = shop('1.0.0', MORE, [{ key: 'deputy', name: 'Deputy', cloneFrom: 'owner', permissions: ['table:@customers:read'] }]);
    expect(roleIssues(app as never)).toEqual([]);
  });
});
