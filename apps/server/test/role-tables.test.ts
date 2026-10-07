// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN APP'S ROLES HOLD OF AN ADD-ON'S TABLES (`roles[].tables`).
 *
 * The grant is the app's and the table is the add-on's: it is written while
 * the add-on is there for the app — with its limit, in one row — and taken
 * back when it is not; given again when it returns. It never reaches a
 * ledger's receipts, is read-only on a table a ledger's code writes, and an
 * entry that names a table or a column the add-on has not is left out, by
 * name: a role is then narrower than the app asked, never wider.
 */
import { appTablesRepo, permissionsRepo, rolesRepo, settingsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { roleTablesAsked } from '../src/apps/manifest-role-tables.js';
import { writeManifestRoles } from '../src/apps/manifest-roles.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { shopManifest } from './fixtures/cards-kit/index.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const KIT = 'ledger-kit';

const FLOOR = [
  // Changes an account's name and reorder level; reads four of its columns.
  { addOn: KIT, table: 'accounts', actions: ['read', 'update'], limit: { readable: ['id', 'name', 'balance', 'reorder_at'], writable: ['name', 'reorder_at'] } },
  // A table the kit's ledger writes: asked for more than it may hold.
  { addOn: KIT, table: 'entries', actions: ['read', 'create', 'update'] },
  // The ledger's receipts: nobody's.
  { addOn: KIT, table: 'postings', actions: ['read'] },
  // A table of the kit's no ledger writes: a row may be added, with two of its columns.
  { addOn: KIT, table: 'settings', actions: ['read', 'create'], limit: { creatable: ['note', 'show_left_below'] } },
];

const shop = (over: Doc = {}): Doc =>
  shopManifest({
    addOns: { suggests: [{ key: KIT, range: '*', reason: { 'en-US': 'Keeps units.' } }] },
    roles: [
      { key: 'floor', name: 'Floor', permissions: ['table:@products:read'], tables: FLOOR },
      // A copy of a limited role is limited alike.
      { key: 'night', name: 'Night', cloneFrom: 'floor' },
      { key: 'till', name: 'Till', permissions: ['table:@products:read'] },
    ],
    ...over,
  });

describe.each(LEGS)('an app\'s roles on an add-on\'s tables — %s', (dialect, available) => {
  let h: Harness;
  afterEach(async () => {
    if (available) await h.close();
  });

  const start = async (manifest: Doc = shop()) => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(manifest);
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    const kit = ledgerKitManifest();
    await h.stageAddOn(kit, { files: ledgerKitFiles(kit) });
    return installed;
  };
  const addKit = (attachTo: string[] = ['shop']) => h.inject({ method: 'POST', url: '/add-ons', payload: { key: KIT, version: '1.0.0', attachTo } });
  /** What a role holds of each of the kit's tables, by the table's real name. */
  const held = async (role = 'floor'): Promise<Record<string, Doc>> => {
    const found = await rolesRepo(h.meta).findBySlug(`shop-${role}`);
    const out: Record<string, Doc> = {};
    for (const row of await permissionsRepo(h.meta).listForRole(found!.id)) {
      if (row.resourceKind !== 'table') continue;
      const table = row.resourceRef.slice(row.resourceRef.indexOf('/') + 1).split('.').pop()!;
      if (!table.startsWith('ledger_kit_')) continue;
      const actions = row.actions as Doc;
      out[table] = Object.fromEntries(Object.entries(actions).filter(([, value]) => value !== false));
    }
    return out;
  };
  const pairs = async () => (await settingsRepo(h.meta).get('system.seededAppRoleGrants')).filter((pair) => pair.includes(`table:@${KIT}/`));
  const WRITTEN = {
    ledger_kit_accounts: { read: true, update: true, readLimit: { readable: ['id', 'name', 'balance', 'reorder_at'] }, updateLimit: { writable: ['name', 'reorder_at'] } },
    // Read only: the ledger's code writes this table, nobody else does.
    ledger_kit_entries: { read: true },
    ledger_kit_settings: { read: true, create: true, createLimit: { writable: ['note', 'show_left_below'] } },
  };

  it.skipIf(!available)('inert while the add-on is absent: no row, no error — and the install check lists what each role will hold', async () => {
    const installed = await start();
    expect(await held()).toEqual({});
    expect(await pairs()).toEqual([]);
    expect(installed.json().roles).not.toHaveProperty('tables');
    const asked = roleTablesAsked(shop() as never);
    expect(asked.filter((entry) => entry.role === 'floor').map((entry) => `${entry.addOn}/${entry.table}:${entry.actions.join('+')}`)).toEqual([`${KIT}/accounts:read+update`, `${KIT}/entries:read+create+update`, `${KIT}/postings:read`, `${KIT}/settings:read+create`]);
    // The copy asks the same; a role with none asks nothing.
    expect(asked.filter((entry) => entry.role === 'night')).toHaveLength(4);
    expect(asked.some((entry) => entry.role === 'till')).toBe(false);
    const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
    if (plan.statusCode === 200) expect((plan.json() as { plan: { roleTables?: unknown[] } }).plan.roleTables).toHaveLength(8);
  });

  it.skipIf(!available)('written when the add-on is attached, with its limit, in one row; never a receipt table; a ledger table is read-only', async () => {
    await start();
    const res = await addKit();
    expect(res.statusCode, res.body).toBe(200);
    expect(await held('floor')).toEqual(WRITTEN);
    expect(await held('night')).toEqual(WRITTEN);
    expect(await held('till')).toEqual({});
    // Said by name: what was given, what was narrowed, what was left out.
    const said = (res.json() as { publicAccessByApp: { shop: { roleTables: Doc[] } } }).publicAccessByApp.shop.roleTables.filter((entry) => entry['role'] === 'floor');
    expect(said).toEqual([
      { role: 'floor', addOn: KIT, table: 'accounts', actions: ['read', 'update'] },
      { role: 'floor', addOn: KIT, table: 'entries', actions: ['read'], skipped: 'ledger-table' },
      { role: 'floor', addOn: KIT, table: 'postings', actions: [], skipped: 'ledger-table' },
      { role: 'floor', addOn: KIT, table: 'settings', actions: ['read', 'create'] },
    ]);
    expect((await pairs()).filter((pair) => pair.startsWith('shop-floor|'))).toEqual([
      `shop-floor|table:@${KIT}/accounts:read`,
      `shop-floor|table:@${KIT}/accounts:update`,
      `shop-floor|table:@${KIT}/entries:read`,
      `shop-floor|table:@${KIT}/settings:create`,
      `shop-floor|table:@${KIT}/settings:read`,
    ]);
  });

  it.skipIf(!available)('taken back when it is switched off or detached, and given again when it is back; uninstalled, nothing is left', async () => {
    await start();
    expect((await addKit()).statusCode).toBe(200);
    const off = await h.inject({ method: 'PATCH', url: `/add-ons/${KIT}`, payload: { attachedTo: 'shop', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    expect(await held('floor')).toEqual({});
    expect(await held('night')).toEqual({});
    expect(await pairs()).toEqual([]);
    const on = await h.inject({ method: 'PATCH', url: `/add-ons/${KIT}`, payload: { attachedTo: 'shop', enabled: true } });
    expect(on.statusCode, on.body).toBe(200);
    expect(await held('floor')).toEqual(WRITTEN);
    expect((on.json() as { roleTables: Doc[] }).roleTables.filter((entry) => entry['role'] === 'night').map((entry) => entry['table'])).toEqual(['accounts', 'entries', 'postings', 'settings']);
    const gone = await h.inject({ method: 'DELETE', url: `/add-ons/${KIT}` });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await held('floor')).toEqual({});
    expect(await pairs()).toEqual([]);
    // The app's own grants were never this writer's to touch.
    const own = await permissionsRepo(h.meta).listForRole((await rolesRepo(h.meta).findBySlug('shop-floor'))!.id);
    expect(own.filter((row) => row.resourceKind === 'table').map((row) => (row.actions as Doc)['read'])).toEqual([true]);
  });

  it.skipIf(!available)('installed after the add-on, the app gets its grants at its own install; an update that stops asking takes them back', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const kit = ledgerKitManifest();
    await h.stageAddOn(kit, { files: ledgerKitFiles(kit) });
    expect((await addKit([])).statusCode).toBe(200);
    await h.stageApp(shop());
    const installed = await h.install('shop', '1.0.0', { addOns: [{ key: KIT, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    if (Object.keys(await held('floor')).length === 0) {
      // Not attached by the install itself here: attached now, which gives them.
      expect((await h.inject({ method: 'POST', url: `/add-ons/${KIT}/attachments`, payload: { app: 'shop' } })).statusCode).toBe(200);
    }
    expect(await held('floor')).toEqual(WRITTEN);

    // 1.0.1: the floor keeps the accounts, read only and unlimited; nothing else of the kit.
    await h.stageApp(shop({ version: '1.0.1', roles: [{ key: 'floor', name: 'Floor', permissions: ['table:@products:read'], tables: [{ addOn: KIT, table: 'accounts', actions: ['read'] }] }, { key: 'night', name: 'Night', cloneFrom: 'floor' }, { key: 'till', name: 'Till', permissions: ['table:@products:read'] }] }));
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.1' } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await held('floor')).toEqual({ ledger_kit_accounts: { read: true } });
    expect((await pairs()).filter((pair) => pair.startsWith('shop-floor|'))).toEqual([`shop-floor|table:@${KIT}/accounts:read`]);
    const reply = updated.json() as { roles?: { tables: Doc[] }; app?: { roles: { tables: Doc[] } } };
    expect((reply.app?.roles ?? reply.roles!).tables.filter((entry) => entry['role'] === 'floor')).toEqual([{ role: 'floor', addOn: KIT, table: 'accounts', actions: ['read'] }]);
  });

  it.skipIf(!available)('an operator\'s narrowing of the role survives an app update; the limit is written again every time', async () => {
    await start();
    expect((await addKit()).statusCode).toBe(200);
    const role = (await rolesRepo(h.meta).findBySlug('shop-floor'))!;
    const row = (await permissionsRepo(h.meta).listForRole(role.id)).find((one) => one.resourceRef.endsWith('ledger_kit_accounts'))!;
    // The owner takes the update away, and (by hand) the read limit too.
    await permissionsRepo(h.meta).grant(role.id, 'table', row.resourceRef, { read: true, create: false, update: false, delete: false, export: false, import: false } as never);
    // The app's own role writer, run alone, leaves what the role holds of the kit as it is: the limit stays on its row.
    const before = await held('night');
    await writeManifestRoles({ meta: h.meta, manifest: shop() as never, connectionId: h.connectionId, names: await appTablesRepo(h.meta).realNames(h.connectionId, 'shop') });
    expect(await held('night')).toEqual(before);
    expect(before).toEqual(WRITTEN);
    await h.stageApp(shop({ version: '1.0.1' }));
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.1' } });
    expect(updated.statusCode, updated.body).toBe(200);
    // Not given again; what the role still holds is held under the app's limit again — and the limit of the action
    // the owner took away waits on the row: ticked again, it is limited as the app wrote it, never whole.
    expect((await held('floor'))['ledger_kit_accounts']).toEqual({ read: true, readLimit: { readable: ['id', 'name', 'balance', 'reorder_at'] }, updateLimit: { writable: ['name', 'reorder_at'] } });
    expect((await held('floor'))['ledger_kit_settings']).toEqual(WRITTEN.ledger_kit_settings);

    // A role the owner deleted is made again by the next update — and given its hold on the kit afresh, whatever the ledger remembered.
    const night = (await rolesRepo(h.meta).findBySlug('shop-night'))!;
    // (As the roles route deletes one: its rows, then the role.)
    await h.meta.db.deleteFrom('adminium_role_permissions').where('roleId', '=', night.id).execute();
    await h.meta.db.deleteFrom('adminium_roles').where('id', '=', night.id).execute();
    expect((await pairs()).some((pair) => pair.startsWith('shop-night|'))).toBe(true);
    await h.stageApp(shop({ version: '1.0.2' }));
    expect((await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.2' } })).statusCode).toBe(200);
    expect(await held('night')).toEqual(WRITTEN);
  });

  it.skipIf(!available)('a column, or a table, the add-on does not have skips the entry — never a grant without its limit', async () => {
    await start(
      shop({
        roles: [
          {
            key: 'floor',
            name: 'Floor',
            tables: [
              { addOn: KIT, table: 'accounts', actions: ['read'], limit: { readable: ['id', 'name', 'cost_avg'] } },
              { addOn: KIT, table: 'shelves', actions: ['read'] },
              { addOn: KIT, table: 'requests', actions: ['read'] },
            ],
          },
        ],
      }),
    );
    // A table of the owner's own that happens to carry the name the kit would give one: it is not the kit's, and no grant falls on it.
    await h.rows('CREATE TABLE ledger_kit_shelves (id INT PRIMARY KEY)');
    const res = await addKit();
    expect(res.statusCode, res.body).toBe(200);
    expect(await held('floor')).toEqual({ ledger_kit_requests: { read: true } });
    expect((res.json() as { publicAccessByApp: { shop: { roleTables: Doc[] } } }).publicAccessByApp.shop.roleTables).toEqual([
      { role: 'floor', addOn: KIT, table: 'accounts', actions: [], skipped: 'unknown-column' },
      { role: 'floor', addOn: KIT, table: 'shelves', actions: [], skipped: 'unknown-table' },
      { role: 'floor', addOn: KIT, table: 'requests', actions: ['read'] },
    ]);
  });
});
