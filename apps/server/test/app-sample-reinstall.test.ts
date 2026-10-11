// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP REMOVED, THEN INSTALLED AGAIN: WHAT BECOMES OF ITS SAMPLE.
 *
 * Over the tables it kept: the tables are found and taken as they are. The
 * list of the sample's rows is one of the things kept, and is taken back with
 * them: the sample is still the sample afterwards — it is not offered a second
 * time over itself, and it can still be removed.
 *
 * On tables of its own (the earlier ones were dropped with it, or were an
 * older version's under plain names): the earlier list is of rows this
 * install does not read. It is not counted with the new sample, and the rows
 * an earlier version left are the operator's, untouched.
 */
import { readFileSync } from 'node:fs';

import { appTablesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ENGINES, installHarness, type Harness as InstallHarness } from './app-install-harness.js';
import { LEGS } from './invoicing-install.helpers.js';
import { pointOfSale } from '../../../packages/manifest/test/menu-sharing-fixture.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const pk = { ref: 'id', type: 'int', role: 'pk' };
const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'shop',
  name: 'Shop',
  version: '0.3.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'd' },
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  requiredSchema: { tables: [{ ref: 'orders', columns: [pk, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] }] },
  sampleData: { file: 'seeds/shop.sample.json' },
};
const FILES = { 'seeds/shop.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', tables: [{ ref: 'orders', rows: [{ note: 'First order' }, { note: 'Second order' }] }] }) };
const OPTS = { locale: 'en-US', userId: null, userLabel: 'test' };

describe.each(LEGS)('an app installed again over the tables it kept — %s', (dialect, available) => {
  it.runIf(available)('its sample is still the sample: loaded, not doubled, and removable', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const service = () => createSampleDataService(h!.sampleData);
    const app = async () => (await findSampleApp(h!.meta, 'shop'))!;
    const orders = async () => Number((await h!.rows('SELECT COUNT(*) AS n FROM orders'))[0]!['n']);

    await h.stageApp(MANIFEST, FILES);
    expect((await h.install('shop', '0.3.0')).statusCode).toBe(200);
    await service().add(await app(), OPTS);
    // One row of the owner's own beside the sample's two.
    await h.rows("INSERT INTO orders (note) VALUES ('Mine')");
    expect(await orders()).toBe(3);

    const gone = await h.inject({ method: 'DELETE', url: '/apps/shop' });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await orders()).toBe(3);
    await h.stageApp(MANIFEST, FILES);
    const again = await h.install('shop', '0.3.0');
    expect(again.statusCode, again.body).toBe(200);
    expect(await orders()).toBe(3);

    const status = await service().status(await app());
    expect(status).toMatchObject({ offered: true, loaded: true, total: 2 });
    expect(status.addedAt).not.toBeNull();
    // Removed as a sample is: its two rows go, the owner's stays.
    expect(await service().remove(await app(), { keepChanged: true, userId: null, userLabel: 'test' })).toMatchObject({ removed: 2 });
    expect(await orders()).toBe(1);
  });
});

// ── A released app (Point of Sale), with its own sample, on every engine this run can reach ──────────────────────────

const POS_FILES = {
  'seeds/pos.sample.json': readFileSync(new URL('../../../packages/manifest/test/fixtures/released/point-of-sale-0.2.2.sample.json', import.meta.url), 'utf8'),
};
const SLOW = 240_000;
const who = { locale: 'en-US', userId: null, userLabel: 'test' } as const;

let open: InstallHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

describe.each(ENGINES)('an app installed again over the tables it left — %s', (dialect, available) => {
  it.skipIf(!available)(
    'still knows its sample data: counted as loaded, and removable',
    async () => {
      const pos = (open = await installHarness(dialect, { superAdmin: true, full: true }));
      const samples = pos.samples!;
      const ledgerOf = async () => (await appTablesRepo(pos.meta).forInstall(pos.connectionId, 'pos')).find((record) => record.role === 'sample-ledger');
      const dishes = async () => (await pos.rows(`SELECT id FROM pos_menu_items`)).length;

      const first = await pos.install(pointOfSale(), {}, POS_FILES);
      expect(first.statusCode, first.body).toBe(200);
      await samples.add((await findSampleApp(pos.meta, 'pos'))!, who);
      const before = await samples.status((await findSampleApp(pos.meta, 'pos'))!);
      expect(before.loaded).toBe(true);
      expect(before.total).toBeGreaterThan(0);
      const sampleDishes = await dishes();
      expect(sampleDishes).toBeGreaterThan(0);

      // Removed, its tables kept: the list of its sample rows is kept with them.
      const removed = await pos.inject({ method: 'DELETE', url: '/apps/pos' });
      expect(removed.statusCode, removed.body).toBe(200);
      expect((await ledgerOf())?.state).toBe('released');
      expect(await dishes()).toBe(sampleDishes);

      const again = await pos.install(pointOfSale(), {}, POS_FILES);
      expect(again.statusCode, again.body).toBe(200);
      const app = (await findSampleApp(pos.meta, 'pos'))!;
      expect(await ledgerOf()).toMatchObject({ state: 'created', manifestId: app.manifestId });

      // The same sample, by the same count, table for table.
      const after = await samples.status(app);
      expect({ loaded: after.loaded, total: after.total }).toEqual({ loaded: true, total: before.total });
      expect([...after.tables].sort((a, b) => a.ref.localeCompare(b.ref))).toEqual([...before.tables].sort((a, b) => a.ref.localeCompare(b.ref)));

      // And it can still be removed, every row of it.
      const gone = await samples.remove(app, { keepChanged: false, userId: null, userLabel: 'test' });
      expect(gone.removed).toBe(before.total);
      expect(await dishes()).toBe(0);
      expect((await samples.status(app)).loaded).toBe(false);
    },
    SLOW,
  );

  it.skipIf(!available)(
    'starts its sample afresh when the new version starts on tables of its own',
    async () => {
      const pos = (open = await installHarness(dialect, { superAdmin: true, full: true }));
      const samples = pos.samples!;
      const ledgerOf = async () => (await appTablesRepo(pos.meta).forInstall(pos.connectionId, 'pos')).find((record) => record.role === 'sample-ledger');
      // The version an older install came from: plain names.
      const plain = pointOfSale();
      const { prefixed: _prefixed, ...unprefixed } = plain['requiredSchema'] as Record<string, unknown>;
      plain['requiredSchema'] = unprefixed;

      const first = await pos.install(plain, {}, POS_FILES);
      expect(first.statusCode, first.body).toBe(200);
      await samples.add((await findSampleApp(pos.meta, 'pos'))!, who);
      const before = await samples.status((await findSampleApp(pos.meta, 'pos'))!);
      const plainDishes = (await pos.rows(`SELECT id FROM menu_items`)).length;
      expect(plainDishes).toBeGreaterThan(0);
      const removed = await pos.inject({ method: 'DELETE', url: '/apps/pos' });
      expect(removed.statusCode, removed.body).toBe(200);

      // The prefixed version makes its own tables, empty: the kept list is of rows it does not read.
      const again = await pos.install(pointOfSale(), {}, POS_FILES);
      expect(again.statusCode, again.body).toBe(200);
      const app = (await findSampleApp(pos.meta, 'pos'))!;
      expect((await pos.rows(`SELECT id FROM pos_menu_items`)).length).toBe(0);
      expect((await ledgerOf())?.state).toBe('dropped');
      expect(await samples.status(app)).toMatchObject({ offered: true, loaded: false, total: 0 });

      // Its own sample is counted once: the earlier version's list is not added to it.
      await samples.add(app, who);
      const after = await samples.status(app);
      expect({ loaded: after.loaded, total: after.total }).toEqual({ loaded: true, total: before.total });
      expect((await pos.rows(`SELECT id FROM pos_menu_items`)).length).toBe(plainDishes);
      const gone = await samples.remove(app, { keepChanged: false, userId: null, userLabel: 'test' });
      expect(gone.removed).toBe(before.total);
      expect((await pos.rows(`SELECT id FROM pos_menu_items`)).length).toBe(0);
      // The rows the earlier version left are the operator's now, untouched.
      expect((await pos.rows(`SELECT id FROM menu_items`)).length).toBe(plainDishes);
    },
    SLOW,
  );

  it.skipIf(!available)(
    'starts its sample afresh after its tables were dropped with it',
    async () => {
      const pos = (open = await installHarness(dialect, { superAdmin: true, full: true }));
      const samples = pos.samples!;
      const ledgerOf = async () => (await appTablesRepo(pos.meta).forInstall(pos.connectionId, 'pos')).find((record) => record.role === 'sample-ledger');
      const dishes = async () => (await pos.rows(`SELECT id FROM pos_menu_items`)).length;

      const first = await pos.install(pointOfSale(), {}, POS_FILES);
      expect(first.statusCode, first.body).toBe(200);
      await samples.add((await findSampleApp(pos.meta, 'pos'))!, who);
      const before = await samples.status((await findSampleApp(pos.meta, 'pos'))!);
      const sampleDishes = await dishes();
      expect(sampleDishes).toBeGreaterThan(0);

      const removed = await pos.inject({ method: 'DELETE', url: '/apps/pos', payload: { dropTables: true, confirmKey: 'pos' } });
      expect(removed.statusCode, removed.body).toBe(200);
      // The list went with the tables it was of.
      expect((await ledgerOf())?.state).toBe('dropped');
      await expect(pos.rows(`SELECT seq FROM pos_sample_data`)).rejects.toThrow();

      const again = await pos.install(pointOfSale(), {}, POS_FILES);
      expect(again.statusCode, again.body).toBe(200);
      const app = (await findSampleApp(pos.meta, 'pos'))!;
      expect(await dishes()).toBe(0);
      expect(await samples.status(app)).toMatchObject({ offered: true, loaded: false, total: 0 });

      // Added again, it is the sample it was: the same count, and all of it removable.
      await samples.add(app, who);
      const after = await samples.status(app);
      expect({ loaded: after.loaded, total: after.total }).toEqual({ loaded: true, total: before.total });
      expect(await dishes()).toBe(sampleDishes);
      const gone = await samples.remove(app, { keepChanged: false, userId: null, userLabel: 'test' });
      expect(gone.removed).toBe(before.total);
      expect(await dishes()).toBe(0);
    },
    SLOW,
  );
});
