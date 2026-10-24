// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN ADD-ON LETS AN APP'S ROLE HOLD OF ITS TABLES (`appGrants`).
 *
 * The add-on says, of its own tables, the most an app's role may be given:
 * actions and columns. An app's grant is cut to it — an action or a column
 * past it is left out and said by name — and a grant on such a table is
 * written with its column lists, never whole; a table the add-on gives no app
 * is given to no app's role. The install check shows each role's hold with its
 * columns; an update whose roles hold more than the running version's is
 * refused until the operator allows it.
 */
import { permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { shopManifest } from './fixtures/cards-kit/index.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const KIT = 'ledger-kit';

const CEILING: Record<string, Doc> = {
  accounts: { actions: ['read', 'update'], readable: ['id', 'name', 'balance', 'reorder_at', 'low'], writable: ['name', 'reorder_at'] },
  settings: { actions: ['read'], never: ['misbehave'] },
  entries: { actions: ['read'], never: ['note'] },
};

/** The kit, saying what an app's role may hold of three of its tables, and so of no other. */
function ceilingKit(grants: Record<string, Doc> = CEILING, version = '1.0.0'): Doc {
  const kit = ledgerKitManifest() as Doc & { compatibility: Doc; requiredSchema: { tables: (Doc & { ref: string })[] } };
  kit.compatibility = { ...kit.compatibility, minAdminiumVersion: '0.3.28' };
  kit['version'] = version;
  kit.requiredSchema.tables = kit.requiredSchema.tables.map((table) => (grants[table.ref] === undefined ? table : { ...table, appGrants: grants[table.ref] }));
  return kit;
}

/** A release of the kit that lets an app's role read an account's total and add settings rows: more than 1.0.0 gave. */
const WIDER: Record<string, Doc> = {
  ...CEILING,
  accounts: { ...CEILING['accounts'], readable: [...(CEILING['accounts']!['readable'] as string[]), 'taken'] },
  settings: { actions: ['read', 'create'], never: ['misbehave'], creatable: ['note'] },
};

const ACCOUNTS_ASKED = { readable: ['id', 'name', 'balance', 'taken'], writable: ['name', 'allow_below'], writableFrom: { name: ['Till float'] } };

const shop = (accountsRead: string[] = ACCOUNTS_ASKED.readable, over: Doc = {}): Doc =>
  shopManifest({
    addOns: { suggests: [{ key: KIT, range: '*', reason: { 'en-US': 'Keeps units.' } }] },
    compatibility: { minAdminiumVersion: '0.3.19' },
    roles: [
      {
        key: 'floor',
        name: 'Floor',
        permissions: ['table:@products:read'],
        tables: [
          // More than the kit allows: a column it keeps back from apps, and one it does not let them change.
          { addOn: KIT, table: 'accounts', actions: ['read', 'update'], limit: { ...ACCOUNTS_ASKED, readable: accountsRead } },
          // A create the kit does not allow; the read asked whole.
          { addOn: KIT, table: 'settings', actions: ['read', 'create'], limit: { creatable: ['note'] } },
          { addOn: KIT, table: 'entries', actions: ['read'] },
          // A table the kit gives to no app.
          { addOn: KIT, table: 'requests', actions: ['read'] },
        ],
      },
      // An update asked whole: given only the columns the kit lets an app change.
      { key: 'till', name: 'Till', permissions: ['table:@products:read'], tables: [{ addOn: KIT, table: 'accounts', actions: ['update'] }] },
    ],
    ...over,
  });

describe.each(LEGS)('an add-on\'s ceiling on an app\'s roles — %s', (dialect, available) => {
  let h: Harness;
  afterEach(async () => {
    if (available) await h.close();
  });

  const stageKit = async () => {
    const kit = ceilingKit();
    await h.stageAddOn(kit, { files: ledgerKitFiles(kit) });
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
      out[table] = Object.fromEntries(Object.entries(row.actions as Doc).filter(([, value]) => value !== false));
    }
    return out;
  };
  const plan = async (version = '1.0.0') => {
    const res = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version, connectionId: h.connectionId } });
    expect(res.statusCode, res.body).toBe(200);
    return ((res.json() as { plan: { roleTables?: Doc[] } }).plan.roleTables ?? []) as Doc[];
  };

  const WRITTEN = {
    ledger_kit_accounts: { read: true, update: true, readLimit: { readable: ['id', 'name', 'balance'] }, updateLimit: { writable: ['name'], writableFrom: { name: ['Till float'] } } },
    // The read asked whole is written with the kit's columns; the create is not given.
    ledger_kit_settings: { read: true, readLimit: { readable: ['id', 'show_left_below', 'note'] } },
    ledger_kit_entries: { read: true, readLimit: { readable: ['id', 'account_id', 'amount', 'kind', 'receipt_id', 'made_by'] } },
  };

  it.skipIf(!available)('cut to the ceiling when written, said by name; never whole; a table the kit gives no app is not given', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
    await stageKit();
    const res = await addKit();
    expect(res.statusCode, res.body).toBe(200);
    expect(await held('floor')).toEqual(WRITTEN);
    // An update asked whole is held to the columns the kit lets an app change: never every column.
    expect(await held('till')).toEqual({ ledger_kit_accounts: { update: true, updateLimit: { writable: ['name', 'reorder_at'] } } });
    const said = (res.json() as { publicAccessByApp: { shop: { roleTables: Doc[] } } }).publicAccessByApp.shop.roleTables.filter((entry) => entry['role'] === 'floor');
    expect(said).toEqual([
      { role: 'floor', addOn: KIT, table: 'accounts', actions: ['read', 'update'], readable: ['id', 'name', 'balance'], writable: ['name'], narrowed: { actions: [], readable: ['taken'], writable: ['allow_below'] }, skipped: 'ceiling' },
      { role: 'floor', addOn: KIT, table: 'settings', actions: ['read'], readable: ['id', 'show_left_below', 'note'], narrowed: { actions: ['create'], readable: ['misbehave'] }, skipped: 'ceiling' },
      { role: 'floor', addOn: KIT, table: 'entries', actions: ['read'], readable: ['id', 'account_id', 'amount', 'kind', 'receipt_id', 'made_by'], narrowed: { actions: [], readable: ['note'] }, skipped: 'ceiling' },
      { role: 'floor', addOn: KIT, table: 'requests', actions: [], narrowed: { actions: ['read'] }, skipped: 'not-offered' },
    ]);
  });

  it.skipIf(!available)('the install check lists each role\'s hold with its columns: cut where the add-on is here, as asked where it is not', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    // No kit on this server: what the app asks, marked so.
    const asked = (await plan()).filter((entry) => entry['role'] === 'floor');
    expect(asked[0]).toEqual({ role: 'floor', roleName: 'Floor', addOn: KIT, table: 'accounts', actions: ['read', 'update'], readable: ACCOUNTS_ASKED.readable, writable: ACCOUNTS_ASKED.writable, unchecked: true });
    await stageKit();
    expect((await addKit([])).statusCode).toBe(200);
    const checked = await plan();
    expect(checked.filter((entry) => entry['role'] === 'floor').map((entry) => [entry['table'], entry['actions'], entry['readable'], entry['skipped']])).toEqual([
      ['accounts', ['read', 'update'], ['id', 'name', 'balance'], 'ceiling'],
      ['settings', ['read'], ['id', 'show_left_below', 'note'], 'ceiling'],
      ['entries', ['read'], ['id', 'account_id', 'amount', 'kind', 'receipt_id', 'made_by'], 'ceiling'],
      ['requests', [], undefined, 'not-offered'],
    ]);
    expect(checked.find((entry) => entry['role'] === 'till')).toMatchObject({ table: 'accounts', actions: ['update'], writable: ['name', 'reorder_at'] });
    expect(checked.some((entry) => entry['unchecked'] !== undefined || entry['wider'] !== undefined)).toBe(false);
  });

  it.skipIf(!available)('a release of the add-on that sets its ceiling narrows what an app\'s roles already hold', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
    // 1.0.0 says nothing: the kit's shape alone, as before the word.
    const plain = ledgerKitManifest();
    await h.stageAddOn(plain, { files: ledgerKitFiles(plain) });
    expect((await addKit()).statusCode).toBe(200);
    expect(await held('floor')).toMatchObject({ ledger_kit_requests: { read: true }, ledger_kit_settings: { read: true, create: true } });
    expect(await held('till')).toEqual({ ledger_kit_accounts: { update: true } });
    // 1.0.1 sets it: the update settles the grants again, cut to it.
    const next = { ...ceilingKit(), version: '1.0.1' };
    await h.stageAddOn(next, { files: ledgerKitFiles(next) });
    const updated = await h.inject({ method: 'POST', url: `/add-ons/${KIT}/update`, payload: {} });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await held('floor')).toEqual(WRITTEN);
    expect(await held('till')).toEqual({ ledger_kit_accounts: { update: true, updateLimit: { writable: ['name', 'reorder_at'] } } });
  });

  it.skipIf(!available)('an update whose roles hold more of the add-on\'s tables is refused until allowed; one that holds no more is not asked', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
    await stageKit();
    expect((await addKit()).statusCode).toBe(200);

    // 1.0.1 asks for a column the kit keeps back anyway: the role would hold nothing more, and nothing is asked.
    await h.stageApp(shop([...ACCOUNTS_ASKED.readable, 'opening'], { version: '1.0.1' }));
    expect((await plan('1.0.1')).some((entry) => entry['wider'] !== undefined)).toBe(false);
    const quiet = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(quiet.statusCode, quiet.body).toBe(200);
    expect(await held('floor')).toEqual(WRITTEN);

    // 1.0.2 lets the floor read the reorder level too: said on the check, refused without a yes, before anything moves.
    await h.stageApp(shop([...ACCOUNTS_ASKED.readable, 'reorder_at'], { version: '1.0.2' }));
    expect((await plan('1.0.2')).filter((entry) => entry['wider'] !== undefined)).toEqual([
      expect.objectContaining({ role: 'floor', table: 'accounts', wider: { actions: [], columns: ['reorder_at'] } }),
    ]);
    const refused = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({ error: { details: { reason: 'ROLE_TABLES_WIDER', roleTables: [{ role: 'floor', roleName: 'Floor', addOn: KIT, table: 'accounts', wider: { actions: [], columns: ['reorder_at'] } }] } } });
    expect(await held('floor')).toEqual(WRITTEN);
    const allowed = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { roleTables: true } });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect((await held('floor'))['ledger_kit_accounts']).toMatchObject({ readLimit: { readable: ['id', 'name', 'balance', 'reorder_at'] } });

    // 1.0.3 drops the value the floor's change of a name was held to: no new column, and a widening all the same.
    const roles = structuredClone((shop([...ACCOUNTS_ASKED.readable, 'reorder_at']) as { roles: { tables?: { table: string; limit?: Doc }[] }[] }).roles);
    delete roles[0]!.tables!.find((one) => one.table === 'accounts')!.limit!['writableFrom'];
    await h.stageApp(shop([...ACCOUNTS_ASKED.readable, 'reorder_at'], { version: '1.0.3', roles }));
    expect((await plan('1.0.3')).filter((entry) => entry['wider'] !== undefined)).toEqual([
      expect.objectContaining({ role: 'floor', table: 'accounts', wider: { actions: [], columns: ['(writableFrom)'] } }),
    ]);
    const loosened = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(loosened.statusCode, loosened.body).toBe(422);
    expect(loosened.json()).toMatchObject({ error: { details: { reason: 'ROLE_TABLES_WIDER' } } });
  });

  it.skipIf(!available)('an update of the add-on whose appGrants give an app\'s roles more is refused at both doors until allowed; one that gives no more is not asked', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
    await stageKit();
    expect((await addKit()).statusCode).toBe(200);
    expect(await held('floor')).toEqual(WRITTEN);
    const version = async () => ((await h.inject({ method: 'GET', url: '/add-ons' })).json() as { addOns: { key: string; version: string }[] }).addOns.find((one) => one.key === KIT)?.version;

    // 1.0.1 lets an app's role read an account's total and add a settings row: the floor asked for both.
    const wider = ceilingKit(WIDER, '1.0.1');
    await h.stageAddOn(wider, { files: ledgerKitFiles(wider) });
    const widened = [
      { app: 'shop', appName: 'Shop', role: 'floor', roleName: 'Floor', addOn: KIT, table: 'accounts', wider: { actions: [], columns: ['taken'] } },
      { app: 'shop', appName: 'Shop', role: 'floor', roleName: 'Floor', addOn: KIT, table: 'settings', wider: { actions: ['create'], columns: ['note'] } },
    ];
    // Said on the check, each grant with its app.
    const checked = await h.inject({ method: 'POST', url: `/add-ons/${KIT}/update/plan`, payload: {} });
    expect(checked.statusCode, checked.body).toBe(200);
    expect((checked.json() as { roleTables?: Doc[] }).roleTables).toEqual(widened.map((entry) => expect.objectContaining(entry)));
    // Refused without a yes, at the update and at the old upgrade door, before anything moves.
    for (const url of [`/add-ons/${KIT}/update`, `/add-ons/${KIT}/upgrade`]) {
      const refused = await h.inject({ method: 'POST', url, ...(url.endsWith('update') ? { payload: {} } : {}) });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json()).toMatchObject({ error: { details: { reason: 'ROLE_TABLES_WIDER', roleTables: widened } } });
      expect((refused.json() as { error: { message: string } }).error.message).toContain('Shop\'s Floor on ledger-kit\'s "accounts" (taken)');
    }
    expect(await version()).toBe('1.0.0');
    expect(await held('floor')).toEqual(WRITTEN);
    // Allowed: given.
    const allowed = await h.inject({ method: 'POST', url: `/add-ons/${KIT}/update`, payload: { roleTables: true } });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(await version()).toBe('1.0.1');
    const now = await held('floor');
    expect(now['ledger_kit_accounts']).toMatchObject({ readLimit: { readable: ['id', 'name', 'balance', 'taken'] } });
    expect(now['ledger_kit_settings']).toMatchObject({ read: true, create: true, createLimit: { writable: ['note'] } });

    // 1.0.2 lets an app read an entry's note: the floor reads entries whole, so it is more again — allowed at the old door.
    const notes = ceilingKit({ ...WIDER, entries: { actions: ['read'] } }, '1.0.2');
    await h.stageAddOn(notes, { files: ledgerKitFiles(notes) });
    const old = await h.inject({ method: 'POST', url: `/add-ons/${KIT}/upgrade` });
    expect(old.statusCode, old.body).toBe(422);
    expect(old.json()).toMatchObject({ error: { details: { reason: 'ROLE_TABLES_WIDER', roleTables: [{ role: 'floor', table: 'entries', wider: { actions: [], columns: ['note'] } }] } } });
    const oldAllowed = await h.inject({ method: 'POST', url: `/add-ons/${KIT}/upgrade`, payload: { roleTables: true } });
    expect(oldAllowed.statusCode, oldAllowed.body).toBe(200);
    expect(await version()).toBe('1.0.2');

    // 1.0.3 lets an app read an account's opening, which no role asked for: nothing more is held, and nothing is asked.
    const quiet = ceilingKit({ ...WIDER, entries: { actions: ['read'] }, accounts: { ...(WIDER['accounts'] as Doc), readable: [...((WIDER['accounts'] as Doc)['readable'] as string[]), 'opening'] } }, '1.0.3');
    await h.stageAddOn(quiet, { files: ledgerKitFiles(quiet) });
    const plain = await h.inject({ method: 'POST', url: `/add-ons/${KIT}/update/plan`, payload: {} });
    expect((plain.json() as { roleTables?: Doc[] }).roleTables).toBeUndefined();
    const went = await h.inject({ method: 'POST', url: `/add-ons/${KIT}/update`, payload: {} });
    expect(went.statusCode, went.body).toBe(200);
    expect(await version()).toBe('1.0.3');
  });

  it.skipIf(!available)('an app\'s update or install that brings the widening release along asks too: for its own roles and for another app\'s', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
    await stageKit();
    expect((await addKit()).statusCode).toBe(200);
    const wider = ceilingKit(WIDER, '1.0.1');
    await h.stageAddOn(wider, { files: ledgerKitFiles(wider) });

    // Another app installed with "update the kit too": the shop's floor would get more, so the install asks first.
    const stall = shopManifest({ key: 'stall', name: 'Stall', addOns: { suggests: [{ key: KIT, range: '*', reason: { 'en-US': 'Keeps units.' } }] }, publicAccess: [], pages: [{ ref: 'stall-home', template: 'page-dashboard', title: { key: 'mft.stall.page.home', fallback: 'Home' }, nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 } }] });
    await h.stageApp(stall);
    const checked = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'stall', version: '1.0.0', connectionId: h.connectionId } });
    expect(checked.statusCode, checked.body).toBe(200);
    expect(((checked.json() as { plan: { roleTables?: Doc[] } }).plan.roleTables ?? []).filter((entry) => entry['app'] !== undefined)).toEqual([
      expect.objectContaining({ app: 'shop', role: 'floor', table: 'accounts', wider: { actions: [], columns: ['taken'] } }),
      expect.objectContaining({ app: 'shop', role: 'floor', table: 'settings', wider: { actions: ['create'], columns: ['note'] } }),
    ]);
    const bring = { addOns: [{ key: KIT, version: '1.0.1', update: true }] };
    const refused = await h.install('stall', '1.0.0', bring);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({ error: { details: { reason: 'ROLE_TABLES_WIDER', roleTables: [{ app: 'shop', table: 'accounts' }, { app: 'shop', table: 'settings' }] } } });
    expect(await held('floor')).toEqual(WRITTEN);
    // Installed without the kit's update: nothing is asked.
    const without = await h.install('stall', '1.0.0');
    expect(without.statusCode, without.body).toBe(200);

    // The shop's own update bringing the kit's release: its floor gets more, so the update asks first.
    await h.stageApp(shop(ACCOUNTS_ASKED.readable, { version: '1.0.1' }));
    const own = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: bring });
    expect(own.statusCode, own.body).toBe(422);
    expect(own.json()).toMatchObject({ error: { details: { reason: 'ROLE_TABLES_WIDER', roleTables: [{ role: 'floor', table: 'accounts', wider: { actions: [], columns: ['taken'] } }, { role: 'floor', table: 'settings', wider: { actions: ['create'], columns: ['note'] } }] } } });
    expect(await held('floor')).toEqual(WRITTEN);
    const allowed = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { ...bring, roleTables: true } });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect((await held('floor'))['ledger_kit_accounts']).toMatchObject({ readLimit: { readable: ['id', 'name', 'balance', 'taken'] } });
  });
});
