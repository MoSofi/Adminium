// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Apps that need add-ons, on SQLite, Postgres and MySQL: the install check
 * shows each add-on's state, source and own plan; the install puts the
 * add-on in the app's database FIRST, then the app's tables (one of which
 * points at the add-on's); nothing is written when a required add-on cannot
 * be had; an add-on an app requires cannot be taken from under it — not even
 * while the app is switched off; a failed app install keeps the add-on and
 * "Try again" does not install it twice; ranges bind only add-ons whose floor
 * says so.
 */
import { manifestsRepo, auditRepo, appTablesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, addOnManifest, appManifest, CRYPTO, ENGINES, type Harness } from './app-add-ons.helpers.js';

const KIT_TABLES = {
  tables: [
    {
      ref: 'kit_entries',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'note', type: 'text', nullable: true },
      ],
    },
  ],
};

/** An add-on with a table of its own. */
const kit = (version: string, over: Record<string, unknown> = {}) =>
  addOnManifest('ledger-kit', { version, name: 'Ledger kit', requiredSchema: KIT_TABLES, ...over });

/** An app that requires the kit, with a table pointing at the kit's. */
const studio = (range = '>=1.1.0', over: Record<string, unknown> = {}) =>
  appManifest('studio', {
    addOns: { requires: [{ key: 'ledger-kit', range, reason: { 'en-US': 'Keeps the ledger.' } }] },
    requiredSchema: {
      tables: [
        {
          ref: 'jobs',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'title', type: 'text', nullable: true },
            { ref: 'entry_id', type: 'fk', references: 'kit_entries', nullable: true },
          ],
        },
      ],
    },
    ...over,
  });

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const installedKeys = async (harness: Harness) =>
  (await manifestsRepo(harness.meta, CRYPTO).list()).map((m) => `${m.row.kind}:${m.row.manifestKey}@${m.row.version}`).sort();

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`apps that need add-ons on ${dialect}`, () => {
    it('installs a required add-on from the bundled set first, then the app’s tables, and then will not let it be removed', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(kit('1.1.0'), { bundled: true });

      const planned = await h.plan(studio());
      expect(planned.statusCode, planned.body).toBe(200);
      const plan = planned.json().plan;
      expect(plan.installable).toBe(true);
      expect(plan.addOns).toHaveLength(1);
      expect(plan.addOns[0]).toMatchObject({
        key: 'ledger-kit',
        name: 'Ledger kit',
        need: 'requires',
        state: 'absent',
        source: 'bundled',
        installedVersion: null,
        offeredVersion: '1.1.0',
        staged: true,
        action: 'install',
        problems: [],
      });
      // Its own plan, as its consent dialog would show it.
      expect(plan.addOns[0].plan.create.map((t: { ref: string }) => t.ref)).toEqual(['kit_entries']);
      // The app's link into it resolves, because the add-on's table is coming.
      expect(plan.references).toContainEqual(expect.objectContaining({ fromColumn: 'entry_id', to: 'kit_entries', resolution: 'host' }));

      const installed = await h.install('studio', '0.2.0', { planChecksum: plan.checksum });
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().addOns).toEqual({
        installed: [{ key: 'ledger-kit', name: 'Ledger kit', version: '1.1.0' }],
        updated: [],
        attached: [],
      });
      expect(await h.tableNames()).toEqual(expect.arrayContaining(['kit_entries', 'jobs']));
      const row = await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit');
      expect(row!.attachments.map((a) => a.attachedTo)).toEqual(['studio']);
      // The foreign key from the app's table into the add-on's is real.
      await h.rows(`INSERT INTO kit_entries (id, note) VALUES (1, 'first')`);
      await h.rows(`INSERT INTO jobs (id, title, entry_id) VALUES (1, 'Logo', 1)`);
      await expect(h.rows(`INSERT INTO jobs (id, title, entry_id) VALUES (2, 'Poster', 99)`)).rejects.toThrow();

      const removed = await h.inject({ method: 'DELETE', url: '/add-ons/ledger-kit' });
      expect(removed.statusCode, removed.body).toBe(409);
      expect(removed.json().error.code).toBe('ADD_ON_REQUIRED_BY');
      expect(removed.json().error.message).toContain('Studio');
      expect(removed.json().error.details.apps).toEqual([{ app: 'studio', name: 'Studio', status: 'installed' }]);

      // The list says who uses it before anyone clicks.
      const list = await h.inject({ method: 'GET', url: '/add-ons' });
      expect(list.json().addOns[0].usedBy).toEqual([
        { app: 'studio', appName: 'Studio', status: 'installed', need: 'requires', range: '>=1.1.0', features: [] },
      ]);
      // The app's settings read carries its add-ons.
      const settings = await h.inject({ method: 'GET', url: '/apps/studio/settings' });
      expect(settings.json().addOns[0]).toMatchObject({ key: 'ledger-kit', state: 'attached', source: 'bundled', enabled: true });
    });

    it('refuses before anything is written when a required add-on cannot be had, and says why', async () => {
      h = await addOnHarness(dialect);
      const planned = await h.plan(studio());
      expect(planned.statusCode, planned.body).toBe(200);
      expect(planned.json().plan.addOns[0]).toMatchObject({ state: 'unavailable', source: null, action: null });
      expect(planned.json().plan.addOns[0].problems[0].code).toBe('ADD_ON_UNAVAILABLE');

      const before = await h.tableNames();
      const refused = await h.install('studio', '0.2.0');
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.code).toBe('ADD_ON_REQUIRED');
      expect(refused.json().error.details.addOn).toBe('ledger-kit');
      expect(refused.json().error.message).toContain('Studio needs ledger-kit, which isn’t available here.');
      // Nothing: no app row, no add-on row, no table.
      expect(await installedKeys(h)).toEqual([]);
      expect(await h.tableNames()).toEqual(before);
      expect(await appTablesRepo(h.meta).forConnection(h.connectionId)).toEqual([]);
    });

    it('updates an outdated add-on with the app only when asked to, and connects it', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(kit('1.0.0'));
      const first = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'ledger-kit', version: '1.0.0', attachTo: [] } });
      expect(first.statusCode, first.body).toBe(200);
      await h.stageAddOn(kit('1.1.0'));

      const planned = await h.plan(studio());
      const row = planned.json().plan.addOns[0];
      expect(row).toMatchObject({ state: 'outdated', installedVersion: '1.0.0', offeredVersion: '1.1.0', satisfiesRange: false, action: 'update' });

      const unticked = await h.install('studio', '0.2.0');
      expect(unticked.statusCode, unticked.body).toBe(422);
      expect(unticked.json().error.code).toBe('ADD_ON_REQUIRED');
      expect(unticked.json().error.message).toContain('Update it too');
      expect(await installedKeys(h)).toEqual(['add-on:ledger-kit@1.0.0']);

      const ticked = await h.install('studio', '0.2.0', { addOns: [{ key: 'ledger-kit', version: '1.1.0', update: true }] });
      expect(ticked.statusCode, ticked.body).toBe(200);
      expect(ticked.json().addOns.updated).toEqual([{ key: 'ledger-kit', name: 'Ledger kit', from: '1.0.0', to: '1.1.0' }]);
      const after = await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit');
      expect(after!.row.version).toBe('1.1.0');
      expect(after!.attachments.map((a) => a.attachedTo)).toEqual(['studio']);
    });

    it('keeps the add-on when the app install fails, and “Try again” does not install it twice', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(kit('1.1.0'), { bundled: true });
      await h.stageApp(studio());
      h.failNextTables();
      const failed = await h.install('studio', '0.2.0');
      expect(failed.statusCode, failed.body).toBe(409);
      expect(failed.json().error.code).toBe('APP_INSTALL_INCOMPLETE');
      expect(failed.json().error.details.stage).toBe('tables');
      expect(failed.json().error.details.addOns.installed).toEqual([{ key: 'ledger-kit', name: 'Ledger kit', version: '1.1.0' }]);
      // Kept: it is shared.
      expect(await installedKeys(h)).toEqual(['add-on:ledger-kit@1.1.0', 'app:studio@0.2.0']);
      expect(await h.tableNames()).toContain('kit_entries');

      const again = await h.install('studio', '0.2.0');
      expect(again.statusCode, again.body).toBe(200);
      // The done line still names what the first attempt installed.
      expect(again.json().addOns.installed).toEqual([{ key: 'ledger-kit', name: 'Ledger kit', version: '1.1.0' }]);
      const installs = (await auditRepo(h.meta).list({ category: 'add-on', limit: 50 })).filter((e) => e.action === 'add-on.installed');
      expect(installs).toHaveLength(1);
      expect(await h.tableNames()).toEqual(expect.arrayContaining(['kit_entries', 'jobs']));
    });

    it('a switched-off app still holds its requirement; only the requiring app’s switch is refused', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(kit('1.1.0'), { bundled: true });
      await h.stageApp(studio());
      expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
      const off = await h.inject({ method: 'POST', url: '/apps/studio/disable' });
      expect(off.statusCode, off.body).toBe(200);

      const removed = await h.inject({ method: 'DELETE', url: '/add-ons/ledger-kit' });
      expect(removed.statusCode).toBe(409);
      expect(removed.json().error.details.apps).toEqual([{ app: 'studio', name: 'Studio', status: 'disabled' }]);

      const switched = await h.inject({ method: 'PATCH', url: '/add-ons/ledger-kit', payload: { attachedTo: 'studio', enabled: false } });
      expect(switched.statusCode, switched.body).toBe(409);
      expect(switched.json().error.code).toBe('ADD_ON_REQUIRED_BY');

      // A key nothing answers to is no host.
      const nowhere = await h.inject({ method: 'POST', url: '/add-ons/ledger-kit/attachments', payload: { app: 'nobody' } });
      expect(nowhere.statusCode, nowhere.body).toBe(404);
      // Another host's switch is free.
      const attached = await h.inject({ method: 'POST', url: '/add-ons/ledger-kit/attachments', payload: { app: 'dashboard' } });
      expect(attached.statusCode, attached.body).toBe(200);
      expect(attached.json().change).toBe('attached');
      const other = await h.inject({ method: 'PATCH', url: '/add-ons/ledger-kit', payload: { attachedTo: 'dashboard', enabled: false } });
      expect(other.statusCode, other.body).toBe(200);

      // Uninstalling the app releases it: its link goes, the add-on stays.
      const plan = await h.inject({ method: 'GET', url: '/apps/studio/uninstall-plan' });
      expect(plan.json().addOns).toEqual([{ key: 'ledger-kit', name: 'Ledger kit', version: '1.1.0' }]);
      const gone = await h.inject({ method: 'DELETE', url: '/apps/studio' });
      expect(gone.statusCode, gone.body).toBe(200);
      expect(gone.json().kept.addOns).toEqual(['ledger-kit']);
      const kept = await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit');
      expect(kept!.attachments.map((a) => a.attachedTo)).toEqual(['dashboard']);
      const now = await h.inject({ method: 'DELETE', url: '/add-ons/ledger-kit' });
      expect(now.statusCode, now.body).toBe(200);
    });
  });
}

describe('ranges and features (sqlite)', () => {
  it('an add-on whose floor is at or below 0.3.0 still attaches to a 0.2.0 app despite range ^1.0.0', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(
      addOnManifest('holidays', {
        version: '1.0.2',
        compatibility: { minAdminiumVersion: '0.3.0', requires: [] },
        addOn: { attaches: [{ app: 'studio', range: '^1.0.0' }] },
      }),
      { bundled: true },
    );
    await h.stageApp(appManifest('studio', { addOns: { requires: [{ key: 'holidays', range: '>=1.0.0', reason: { 'en-US': 'Days off.' } }] } }));
    const installed = await h.install('studio', '0.2.0');
    expect(installed.statusCode, installed.body).toBe(200);
    expect(installed.json().addOns.installed.map((a: { key: string }) => a.key)).toEqual(['holidays']);
  });

  it('refuses an app update that leaves a binding attach range, naming the add-on — never a silent detach', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(
      addOnManifest('holidays', {
        version: '1.1.0',
        name: 'Holiday calendars',
        compatibility: { minAdminiumVersion: '0.3.1', requires: [] },
        addOn: { attaches: [{ app: 'studio', range: '^0.2.0' }] },
      }),
      { bundled: true },
    );
    await h.stageApp(appManifest('studio', { addOns: { suggests: [{ key: 'holidays', range: '>=1.1.0', reason: { 'en-US': 'Days off.' } }] } }));
    const installed = await h.install('studio', '0.2.0', { addOns: [{ key: 'holidays', version: '1.1.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);

    await h.stageApp(appManifest('studio', { version: '0.3.0' }));
    const refused = await h.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe('ADD_ON_RANGE');
    expect(refused.json().error.details).toMatchObject({ addOn: 'holidays', app: 'studio' });
    expect(refused.json().error.message).toContain('Holiday calendars');
    const row = (await manifestsRepo(h.meta, CRYPTO).list('app'))[0]!;
    expect(row.row.version).toBe('0.2.0');
    const attachment = (await manifestsRepo(h.meta, CRYPTO).findByKey('holidays'))!.attachments;
    expect(attachment.map((a) => [a.attachedTo, a.disabledAt])).toEqual([['studio', null]]);
  });

  it('an app with no addOns installs and updates exactly as before', async () => {
    h = await addOnHarness('sqlite');
    const planned = await h.plan(appManifest('plain'));
    expect(planned.statusCode, planned.body).toBe(200);
    expect(planned.json().plan).not.toHaveProperty('addOns');
    const installed = await h.install('plain', '0.2.0', { planChecksum: planned.json().plan.checksum });
    expect(installed.statusCode, installed.body).toBe(200);
    expect(installed.json()).not.toHaveProperty('addOns');
    await h.stageApp(appManifest('plain', { version: '0.2.1' }));
    const updated = await h.inject({ method: 'POST', url: '/apps/plain/update' });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().app).not.toHaveProperty('addOns');
    expect(h.rebuilds()).toBe(0);
  });

  it('a feature need does not stop a removal, and the reply names the features that stop', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(addOnManifest('receipts', { version: '1.0.0' }), { bundled: true });
    await h.stageApp(
      appManifest('till', {
        addOns: {
          suggests: [{ key: 'receipts', range: '>=1.0.0', reason: { 'en-US': 'Emails receipts.' } }],
          features: [{ id: 'emailed-receipts', label: { 'en-US': 'Emailed receipts' }, requires: ['receipts'] }],
        },
      }),
    );
    const installed = await h.install('till', '0.2.0', { addOns: [{ key: 'receipts', version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    const removed = await h.inject({ method: 'DELETE', url: '/add-ons/receipts' });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().features).toEqual([
      expect.objectContaining({ app: 'till', need: 'feature', features: [{ id: 'emailed-receipts', label: { 'en-US': 'Emailed receipts' } }] }),
    ]);
  });

  it('bounds an add-on’s record scopes by the tables of the app it is mounted on', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(addOnManifest('reader', { version: '1.0.0', addOn: { attaches: [{ app: '*' }], scopes: ['records:orders:read'] } }), {
      bundled: true,
    });
    const app = appManifest('studio', { addOns: { requires: [{ key: 'reader', range: '>=1.0.0', reason: { 'en-US': 'Reads.' } }] } });
    const planned = await h.plan(app);
    expect(planned.json().plan.addOns[0].problems).toContainEqual(expect.objectContaining({ code: 'SCOPE_OUT_OF_RANGE' }));
    const refused = await h.install('studio', '0.2.0');
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().error.code).toBe('ADD_ON_REQUIRED');
    expect(await installedKeys(h)).toEqual([]);
  });

  it('refuses an add-on upgrade that leaves the range an installed app requires, naming the app', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(kit('1.1.0'), { bundled: true });
    await h.stageApp(studio('^1.1.0'));
    expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
    await h.stageAddOn(kit('2.0.0'));
    const refused = await h.inject({ method: 'POST', url: '/add-ons/ledger-kit/upgrade' });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe('ADD_ON_RANGE');
    expect(refused.json().error.details).toMatchObject({ addOn: 'ledger-kit', app: 'studio', range: '^1.1.0' });
    expect((await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit'))!.row.version).toBe('1.1.0');
  });

  it('mounts an add-on with pages on the dashboard too, so its page reaches the rail', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(
      addOnManifest('paged', {
        version: '1.0.0',
        addOn: {
          attaches: [{ app: '*' }],
          hostApi: 1,
          pages: [{ ref: 'home', title: { key: 'addon.paged.home', fallback: 'Home' }, icon: 'file', client: 'dist/client.js' }],
        },
      }),
    );
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'paged', version: '1.0.0', attachTo: [] } });
    expect(installed.statusCode, installed.body).toBe(200);
    expect(installed.json().addOn.attachments).toEqual([{ attachedTo: 'dashboard', enabled: true }]);
  });

  it('answers SCHEMA_DRIFT when an add-on moved between the check and the install', async () => {
    h = await addOnHarness('sqlite');
    // No tables of its own: only what the install would do to it can move.
    await h.stageAddOn(addOnManifest('notes', { version: '1.1.0' }), { bundled: true });
    const planned = await h.plan(appManifest('studio', { addOns: { requires: [{ key: 'notes', range: '>=1.1.0', reason: { 'en-US': 'Notes.' } }] } }));
    const checksum = planned.json().plan.checksum;
    // Someone installs the add-on from Studio in between.
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'notes', version: '1.1.0' } })).statusCode).toBe(200);
    const drifted = await h.install('studio', '0.2.0', { planChecksum: checksum });
    expect(drifted.statusCode, drifted.body).toBe(409);
    expect(drifted.json().error.code).toBe('SCHEMA_DRIFT');
    expect(await installedKeys(h)).toEqual(['add-on:notes@1.1.0']);
  });

  it('refuses a catalogue add-on whose bytes are not here yet, before writing anything', async () => {
    h = await addOnHarness('sqlite');
    h.catalog.on = true;
    await h.addOnStore.writeCatalogCache(
      {
        schemaVersion: 3,
        generatedAt: '2026-09-25T00:00:00Z',
        addOns: [
          {
            key: 'ledger-kit',
            version: '1.1.0',
            integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
            connect: { kind: 'none' },
            name: { en: 'Ledger kit' },
            tagline: { en: 'Keeps the ledger.' },
            minAdminiumVersion: '0.3.0',
          },
        ],
      } as never,
      Date.now(),
    );
    const planned = await h.plan(studio());
    expect(planned.json().plan.addOns[0]).toMatchObject({ state: 'absent', source: 'catalog', staged: false, plan: null });
    const refused = await h.install('studio', '0.2.0');
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe('ADD_ON_DOWNLOAD_REQUIRED');
    expect(await installedKeys(h)).toEqual([]);
  });
});
