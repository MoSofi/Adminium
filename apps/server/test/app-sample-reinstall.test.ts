// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP REMOVED WITH ITS TABLES KEPT, THEN INSTALLED AGAIN.
 *
 * The tables are found and taken as they are. The list of the sample's rows
 * is one of the things kept, and is taken back with them: the sample is still
 * the sample afterwards — it is not offered a second time over itself, and it
 * can still be removed.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

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
