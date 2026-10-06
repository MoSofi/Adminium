// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SAMPLE ROW AN ADD-ON LINK NAMES IS IN USE.
 *
 * A column that links a row to an add-on's row (`addOnLink`) has no foreign
 * key behind it. An owner who tries an add-on with its sample items, writes
 * a real line that names one, and then removes the sample rows keeps that
 * item: taken out, their line would name nothing, and could never be posted.
 * Before anything was posted for the line no receipt names the item either,
 * so only the link itself says it is in use.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleOwner } from '../src/apps/sample-data.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT', description: { key: 'd', fallback: 'd' } };

const SHOP = {
  ...IDENTITY,
  kind: 'app',
  key: 'shop',
  name: 'Shop',
  version: '0.3.0',
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  pages: [{ ref: 'shop-lines', template: 'page-crud', title: { key: 't', fallback: 'Lines' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'lines' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: { suggests: [{ key: 'kit', range: '>=1.0.0', reason: { 'en-US': 'Stock.' } }] },
  requiredSchema: {
    prefixed: true,
    tables: [{ ref: 'lines', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'kit', table: 'items' } } }] }],
  },
};

const KIT = {
  ...IDENTITY,
  kind: 'add-on',
  key: 'kit',
  name: 'Kit',
  version: '1.0.0',
  categories: ['data'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' } },
  requiredSchema: { prefixed: true, tables: [{ ref: 'items', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] }] },
  pages: [{ ref: 'kit-items', template: 'page-crud', title: { key: 't', fallback: 'Items' }, nav: { group: 'manage', icon: 'box', order: 1 }, bindings: { main: 'items' } }],
  sampleData: { file: 'seeds/kit.sample.json' },
};
const BUNDLE = { format: 'adminium.sample/1', app: 'kit', tables: [{ ref: 'items', rows: [{ '@label': 'tote', name: 'Tote' }, { '@label': 'mug', name: 'Mug' }] }] };

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

describe.each(LEGS)('a sample row an add-on link names — %s', (dialect, available) => {
  it.runIf(available)('is kept when a real row names it, and goes when none does', async () => {
    h = await addOnHarness(dialect);
    await h.stageApp(SHOP);
    expect((await h.install('shop', '0.3.0')).statusCode).toBe(200);
    await h.stageAddOn(KIT, { bundled: true, files: { 'seeds/kit.sample.json': JSON.stringify(BUNDLE) } });
    const reply = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'kit', version: '1.0.0', attachTo: ['shop'] } });
    expect(reply.statusCode, reply.body).toBe(200);
    const service = createSampleDataService(h.sampleData);
    const owner = (await findSampleOwner(h.meta, 'kit', 'add-on'))!;
    await service.add(owner, { locale: 'en-US', userId: h.owner.id, userLabel: 'owner@test' });
    const items = await h.rows('SELECT id, name FROM kit_items ORDER BY id');
    expect(items.map((row) => row['name'])).toEqual(['Tote', 'Mug']);
    // The owner's own line names the tote; nothing was posted for it, and no foreign key says so.
    await h.rows(`INSERT INTO shop_lines (name, item_id) VALUES ('A real line', ${String(items[0]!['id'])})`);
    const removed = await service.remove(owner, { keepChanged: false, userId: h.owner.id, userLabel: 'owner@test' });
    expect(removed).toMatchObject({ removed: 1, kept: 1 });
    expect((await h.rows('SELECT name FROM kit_items')).map((row) => row['name'])).toEqual(['Tote']);
  });
});
