// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ways around apps-need-add-ons an adversarial review found, each shut:
 *
 *  - an app role whose name meets a role the app does not own is refused, and
 *    never merged into it (its grants would outlive the app);
 *  - an app role's `addOn:<key>:settings` counts only while THAT app has the
 *    add-on connected and switched on; every settings value is checked
 *    against its declaration, whoever saves it; the plan lists the grant;
 *  - an add-on's tables are held: an app may not rename one out of the way,
 *    nor drop one when it is uninstalled;
 *  - an app update that stops after its add-on step answers a coded 409 that
 *    "Try again" finishes, and the add-on's earlier version stays on disk
 *    until the update is done;
 *  - installing a new version over an installed app is held to the attached
 *    add-ons' ranges as an update is;
 *  - a version that stops declaring an add-on grant takes it back;
 *  - who uses an add-on is for those who manage add-ons.
 */
import { validateManifest, type Manifest } from '@adminium/manifest';
import { manifestsRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { RoleTakenError, writeManifestRoles } from '../src/apps/manifest-roles.js';

import { addOnHarness, addOnManifest, appManifest, CRYPTO, ENGINES, type Harness } from './app-add-ons.helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const invoices = addOnManifest('invoices', {
  version: '1.1.0',
  name: 'Invoices',
  settings: [
    { key: 'business_name', type: 'string', default: 'Your business' },
    { key: 'payment_instructions', type: 'string' },
    { key: 'paper', type: 'enum', enum: ['a4', 'letter'] },
  ],
  addOn: { attaches: [{ app: '*' }], publicSettings: ['business_name'] },
});

const kit = addOnManifest('ledger-kit', {
  version: '1.1.0',
  name: 'Ledger kit',
  requiredSchema: {
    tables: [
      {
        ref: 'kit_entries',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'note', type: 'text', nullable: true },
        ],
      },
    ],
  },
});

const needs = (key: string, list: 'requires' | 'suggests' = 'requires', range = '>=1.0.0') => ({
  [list]: [{ key, range, reason: { 'en-US': 'x' } }],
});

describe('an app role that meets a role the app does not own', () => {
  it('is refused at the check and at the install, and the operator’s role gains nothing', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoices, { bundled: true });
    const custom = await rolesRepo(h.meta).create({ slug: 'front-desk', name: 'Front Desk' });
    const app = appManifest('front', {
      addOns: needs('invoices'),
      roles: [{ key: 'desk', name: 'Desk', permissions: ['addOn:invoices:settings'] }],
    });
    const planned = await h.plan(app);
    expect(planned.json().plan.installable).toBe(false);
    expect(planned.json().plan.problems).toContainEqual(
      expect.objectContaining({ code: 'ROLE_INVALID', table: 'desk', message: expect.stringContaining('"front-desk" is taken') }),
    );
    const refused = await h.install('front', '0.2.0');
    expect(refused.statusCode, refused.body).toBe(422);
    expect(await permissionsRepo(h.meta).listForRole(custom.id)).toEqual([]);

    // And were the role made between the check and the install, writing the
    // app's roles stops rather than merge into it.
    const parsed = validateManifest(app);
    expect(parsed.ok).toBe(true);
    await expect(
      writeManifestRoles({ meta: h.meta, manifest: (parsed as { manifest: Manifest }).manifest, connectionId: h.connectionId, names: {} }),
    ).rejects.toBeInstanceOf(RoleTakenError);
    expect(await permissionsRepo(h.meta).listForRole(custom.id)).toEqual([]);
  });
});

describe('the add-on settings grant', () => {
  it('counts only while the granting app has the add-on connected and switched on', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoices, { bundled: true });
    // The till only SUGGESTS invoices and never connects it, yet grants its settings.
    await h.stageApp(
      appManifest('till', {
        addOns: needs('invoices', 'suggests'),
        roles: [{ key: 'cashier', name: 'Cashier', permissions: ['app:@:staff', 'addOn:invoices:settings'] }],
      }),
    );
    const plan = await h.plan(
      appManifest('till', {
        addOns: needs('invoices', 'suggests'),
        roles: [{ key: 'cashier', name: 'Cashier', permissions: ['app:@:staff', 'addOn:invoices:settings'] }],
      }),
    );
    // The operator sees the grant before installing.
    expect(plan.json().plan.addOnGrants).toEqual([{ role: 'till-cashier', roleName: 'Cashier', addOn: 'invoices', grant: 'settings' }]);
    expect((await h.install('till', '0.2.0')).statusCode).toBe(200);
    // Another way in installs invoices, for the dashboard only.
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'invoices', version: '1.1.0', attachTo: [] } })).statusCode).toBe(200);

    const cashier = await usersRepo(h.meta).create({ email: 'c@test', name: 'C' });
    await rolesRepo(h.meta).assignToUser(cashier.id, (await rolesRepo(h.meta).findBySlug('till-cashier'))!.id);
    const put = (as = cashier, values: Record<string, unknown> = { payment_instructions: 'Pay IBAN ATTACKER' }) =>
      h!.inject({ method: 'PUT', url: '/add-ons/invoices/settings', payload: { values }, as });
    expect((await put()).statusCode).toBe(403);

    // Connected to the till, the grant works; switched off there, it stops again.
    expect((await h.inject({ method: 'POST', url: '/add-ons/invoices/attachments', payload: { app: 'till' } })).statusCode).toBe(200);
    expect((await put()).statusCode).toBe(200);
    expect((await h.inject({ method: 'PATCH', url: '/add-ons/invoices', payload: { attachedTo: 'till', enabled: false } })).statusCode).toBe(200);
    expect((await put()).statusCode).toBe(403);

    // An operator's own role holding it by name is the operator's decision.
    const custom = await rolesRepo(h.meta).create({ slug: 'bookkeeper', name: 'Bookkeeper' });
    await permissionsRepo(h.meta).grant(custom.id, 'app', 'add-on/invoices', { staff: true });
    const keeper = await usersRepo(h.meta).create({ email: 'k@test', name: 'K' });
    await rolesRepo(h.meta).assignToUser(keeper.id, custom.id);
    expect((await put(keeper)).statusCode).toBe(200);
  });

  it('checks every value against its declaration, whoever saves it', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoices, { bundled: true });
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'invoices', version: '1.1.0' } })).statusCode).toBe(200);
    for (const values of [
      { business_name: { evil: 1 } },
      { paper: 'tabloid' },
      { invented: 'x' },
      { payment_instructions: 'x'.repeat(300 * 1024) },
    ]) {
      const refused = await h.inject({ method: 'PUT', url: '/add-ons/invoices/settings', payload: { values } });
      expect(refused.statusCode, JSON.stringify(values)).toBe(422);
      expect(refused.json().error.details.code).toBe('SETTING_INVALID');
    }
    const saved = await h.inject({ method: 'PUT', url: '/add-ons/invoices/settings', payload: { values: { paper: 'a4', business_name: 'Acme' } } });
    expect(saved.statusCode, saved.body).toBe(200);
  });

  it('is taken back when a version of the app stops declaring it', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoices, { bundled: true });
    const role = (permissions: string[]) => [{ key: 'manager', name: 'Manager', permissions }];
    await h.stageApp(appManifest('studio', { addOns: needs('invoices'), roles: role(['app:@:staff', 'addOn:invoices:settings']) }));
    expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
    const manager = (await rolesRepo(h.meta).findBySlug('studio-manager'))!;
    const refs = async () => (await permissionsRepo(h!.meta).listForRole(manager.id)).map((row) => row.resourceRef).sort();
    expect(await refs()).toEqual(['add-on/invoices', 'studio']);
    await h.stageApp(appManifest('studio', { version: '0.2.1', addOns: needs('invoices'), roles: role(['app:@:staff']) }));
    const updated = await h.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await refs()).toEqual(['studio']);
  });
});

describe('who uses an add-on', () => {
  it('is listed for those who manage add-ons, and left out for everyone else', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoices, { bundled: true });
    await h.stageApp(appManifest('studio', { addOns: needs('invoices') }));
    expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
    expect((await h.inject({ method: 'GET', url: '/add-ons' })).json().addOns[0].usedBy).toHaveLength(1);
    const reader = await usersRepo(h.meta).create({ email: 'r@test', name: 'R' });
    const list = await h.inject({ method: 'GET', url: '/add-ons', as: reader });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().addOns[0].usedBy).toEqual([]);
  });
});

describe('installing a new version over an installed app', () => {
  it('is held to an attached add-on’s binding range, as an update is', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(
      addOnManifest('pinned', {
        version: '1.0.0',
        compatibility: { minAdminiumVersion: '0.3.5', requires: [] },
        addOn: { attaches: [{ app: 'studio', range: '^0.2.0' }] },
      }),
      { bundled: true },
    );
    await h.stageApp(appManifest('studio'));
    expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'pinned', version: '1.0.0', attachTo: ['studio'] } })).statusCode).toBe(200);
    await h.stageApp(appManifest('studio', { version: '0.3.0' }));
    const refused = await h.install('studio', '0.3.0');
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe('ADD_ON_RANGE');
    expect((await manifestsRepo(h.meta, CRYPTO).findByKey('studio'))!.row.version).toBe('0.2.0');
  });
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`an add-on’s tables are held, on ${dialect}`, () => {
    it('are never renamed out of the way by another app, nor dropped by one', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(kit, { bundled: true });
      await h.stageApp(appManifest('alpha', { addOns: needs('ledger-kit') }));
      expect((await h.install('alpha', '0.2.0')).statusCode).toBe(200);
      await h.rows(`INSERT INTO kit_entries (id, note) VALUES (1, 'alpha data')`);

      const beta = appManifest('beta', {
        addOns: needs('ledger-kit'),
        requiredSchema: {
          tables: [
            {
              ref: 'kit_entries',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'title', type: 'text', nullable: true },
              ],
            },
          ],
        },
      });
      const planned = await h.plan(beta);
      const table = planned.json().plan.tables.find((t: { ref: string }) => t.ref === 'kit_entries');
      expect(table.offers).not.toContain('rename-existing');
      expect(planned.json().plan.problems).toContainEqual(expect.objectContaining({ code: 'PREFIX_COLLISION', table: 'kit_entries' }));
      const refused = await h.install('beta', '0.2.0', { choices: { kit_entries: { action: 'rename-existing', to: 'kit_entries_old' } } });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(await h.tableNames()).not.toContain('kit_entries_old');
      expect(await h.rows('SELECT note FROM kit_entries')).toEqual([{ note: 'alpha data' }]);
    });

    it('are never dropped with an app that made a table of the same name first', async () => {
      h = await addOnHarness(dialect);
      // An app made kit_entries itself; the add-on then found and reused it.
      await h.stageApp(
        appManifest('gamma', {
          requiredSchema: {
            tables: [
              {
                ref: 'kit_entries',
                columns: [
                  { ref: 'id', type: 'int', role: 'pk' },
                  { ref: 'note', type: 'text', nullable: true },
                ],
              },
            ],
          },
        }),
      );
      expect((await h.install('gamma', '0.2.0')).statusCode).toBe(200);
      await h.stageAddOn(kit, { bundled: true });
      expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'ledger-kit', version: '1.1.0', attachTo: ['gamma'] } })).statusCode).toBe(200);
      const plan = await h.inject({ method: 'GET', url: '/apps/gamma/uninstall-plan' });
      expect(plan.json().tables).toEqual([{ table: 'kit_entries', droppable: false }]);
      const gone = await h.inject({ method: 'DELETE', url: '/apps/gamma', payload: { dropTables: true, confirmKey: 'gamma' } });
      expect(gone.statusCode, gone.body).toBe(200);
      expect(await h.tableNames()).toContain('kit_entries');
    });
  });

  describe.skipIf(!available)(`an app install that stops after it updated an add-on, on ${dialect}`, () => {
    it('keeps the add-on’s earlier version until the install is done', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(addOnManifest('kit', { version: '1.0.0' }), { bundled: true });
      expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'kit', version: '1.0.0' } })).statusCode).toBe(200);
      await h.stageAddOn(addOnManifest('kit', { version: '2.0.0' }));
      await h.stageApp(appManifest('studio', { addOns: { requires: [{ key: 'kit', range: '^2.0.0', reason: { 'en-US': 'x' } }] } }));
      const body = { addOns: [{ key: 'kit', version: '2.0.0', update: true }] };
      h.failNextTables();
      const failed = await h.install('studio', '0.2.0', body);
      expect(failed.statusCode, failed.body).toBe(409);
      expect(failed.json().error.code).toBe('APP_INSTALL_INCOMPLETE');
      expect(await h.addOnStore.versions('kit')).toEqual(['2.0.0', '1.0.0']);
      const again = await h.install('studio', '0.2.0');
      expect(again.statusCode, again.body).toBe(200);
      expect(await h.addOnStore.versions('kit')).toEqual(['2.0.0']);
    });
  });

  describe.skipIf(!available)(`an app update that stops after its add-on step, on ${dialect}`, () => {
    it('answers a coded 409, keeps the add-on’s earlier version, and “Try again” finishes', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(addOnManifest('kit', { version: '1.0.0' }), { bundled: true });
      const need = (range: string) => ({ requires: [{ key: 'kit', range, reason: { 'en-US': 'x' } }] });
      await h.stageApp(appManifest('studio', { addOns: need('^1.0.0') }));
      expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
      await h.stageAddOn(addOnManifest('kit', { version: '2.0.0' }));
      await h.stageApp(
        appManifest('studio', {
          version: '0.3.0',
          addOns: need('^2.0.0'),
          requiredSchema: {
            tables: [
              { ref: 'jobs', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'title', type: 'text', nullable: true }] },
              { ref: 'extras', columns: [{ ref: 'id', type: 'int', role: 'pk' }] },
            ],
          },
        }),
      );
      const body = { addOns: [{ key: 'kit', version: '2.0.0', update: true }] };
      h.failNextTables();
      const failed = await h.inject({ method: 'POST', url: '/apps/studio/update', payload: body });
      expect(failed.statusCode, failed.body).toBe(409);
      expect(failed.json().error.code).toBe('APP_UPDATE_INCOMPLETE');
      expect(failed.json().error.details.stage).toBe('tables');
      const m = manifestsRepo(h.meta, CRYPTO);
      // The running app is still inside the range of the add-on it runs on.
      expect((await m.findByKey('studio'))!.row.version).toBe('0.2.0');
      expect((await m.findByKey('kit'))!.row.version).toBe('1.0.0');
      expect(await h.addOnStore.versions('kit')).toEqual(['2.0.0', '1.0.0']);

      const again = await h.inject({ method: 'POST', url: '/apps/studio/update', payload: body });
      expect(again.statusCode, again.body).toBe(200);
      expect((await m.findByKey('studio'))!.row.version).toBe('0.3.0');
      expect((await m.findByKey('kit'))!.row.version).toBe('2.0.0');
      // Done: the earlier version goes.
      expect(await h.addOnStore.versions('kit')).toEqual(['2.0.0']);
    });
  });
}
