// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A manifest that uses a word this server reads and does not run yet is
 * refused whole, through the doors that install one: an app's install and an
 * add-on's. Nothing is made of it — no table, no row.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { addOnHarness, type Harness as AddOnHarness } from './app-add-ons.helpers.js';
import { packageTarball } from './app-bundle-helpers.js';
import { installHarness, type Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;

const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT', description: { key: 'd', fallback: 'd' } };

const SHOP: Doc = {
  ...IDENTITY,
  kind: 'app',
  key: 'shop',
  name: 'Shop',
  version: '0.3.0',
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  pages: [{ ref: 'lines', template: 'page-crud', title: { key: 't', fallback: 'Lines' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'lines' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: { suggests: [{ key: 'kit', range: '>=1.0.0', reason: { 'en-US': 'Stock.' } }] },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'lines',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 80 },
          { ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'kit', table: 'items' } } },
        ],
      },
    ],
  },
};

const KIT: Doc = {
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
};

let open: Harness | null = null;
let openAddOns: AddOnHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
  await openAddOns?.close();
  openAddOns = null;
});

describe('a word this server does not run yet', () => {
  it('an app that links into an add-on is refused at the upload, and makes no table', async () => {
    const h = (open = await installHarness('sqlite'));
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(SHOP), 'staff/index.html': '<!doctype html>' });
    const staged = await (h.inject as (request: Doc) => ReturnType<Harness['inject']>)({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(staged.statusCode, staged.body).toBe(422);
    expect(JSON.parse(staged.body)).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: '0.3.18', words: [{ word: 'column.addOnLink', path: 'requiredSchema.tables.0.columns.2.rules.addOnLink', release: '0.3.18' }] } },
    });
    expect(await h.rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'shop_%'`)).toEqual([]);
  });

  it('the same app without the link installs', async () => {
    const h = (open = await installHarness('sqlite'));
    const tables = (SHOP['requiredSchema'] as { tables: { columns: { ref: string }[] }[] }).tables;
    const plain = { ...SHOP, requiredSchema: { prefixed: true, tables: [{ ...tables[0], columns: tables[0]!.columns.filter((column) => column.ref !== 'item_id') }] } };
    const installed = await h.install(plain);
    expect(installed.statusCode, installed.body).toBe(200);
  });

  it('an add-on with sample data of its own is refused at its install, and makes no table', async () => {
    const h = (openAddOns = await addOnHarness('sqlite'));
    await h.stageAddOn({ ...KIT, sampleData: { file: 'seeds/sample.json' } }, { bundled: true });
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'kit', version: '1.0.0', attachTo: [] } });
    expect(installed.statusCode, installed.body).toBe(422);
    expect(installed.body).toContain('uses \\"sampleData\\", which Adminium 0.3.18 runs');
    expect((await h.tableNames()).filter((name) => name.includes('items'))).toEqual([]);
  });

  it('the same add-on without it installs: its prefixed table and its page are words this server runs', async () => {
    const h = (openAddOns = await addOnHarness('sqlite'));
    await h.stageAddOn(KIT, { bundled: true });
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'kit', version: '1.0.0', attachTo: [] } });
    expect(installed.statusCode, installed.body).toBe(200);
    expect(await h.tableNames()).toContain('kit_items');
  });
});
