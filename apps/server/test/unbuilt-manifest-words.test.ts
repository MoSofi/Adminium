// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A manifest that uses a word this server reads and does not run yet is
 * refused whole, through the doors that install one. Nothing is made of it —
 * no table, no row. Every word there is today is run, so the refusal is seen
 * with a list handed in; the apps and add-ons that use today's words install.
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
          // A link into an add-on, and the last four of a code kept beside it: both words this server runs.
          { ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'kit', table: 'items' } } },
          { ref: 'code', type: 'text', maxLength: 32, rules: { code: { length: 12 } } },
          { ref: 'code_last4', type: 'text', maxLength: 4, nullable: true, rules: { codeLast4: { of: 'code' } } },
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

describe('a word this server does not run yet, and the newer ones it does', () => {
  it('an app that keeps the last four of a code is taken at the upload and installs: every word there is today is run', async () => {
    const h = (open = await installHarness('sqlite'));
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(SHOP), 'staff/index.html': '<!doctype html>' });
    const staged = await (h.inject as (request: Doc) => ReturnType<Harness['inject']>)({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(staged.statusCode, staged.body).toBe(200);
    const installed = await h.install(SHOP);
    expect(installed.statusCode, installed.body).toBe(200);
    expect((await h.rows(`SELECT name FROM pragma_table_info('shop_lines')`)).map((row) => row['name'])).toContain('code_last4');
  });

  it('an add-on that uses a word of a later release is refused at its install, by name, and makes no table', async () => {
    // The list of such words is empty today: it is handed one, as a later release's would be.
    const h = (openAddOns = await addOnHarness('sqlite', { unbuiltWords: { 'column.codeLast4': '0.3.21' } }));
    const coded = { ...KIT, requiredSchema: { prefixed: true, tables: [{ ref: 'items', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'code', type: 'text', maxLength: 32, rules: { code: { length: 12 } } }, { ref: 'code_last4', type: 'text', maxLength: 4, nullable: true, rules: { codeLast4: { of: 'code' } } }] }] } };
    await h.stageAddOn(coded, { bundled: true });
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'kit', version: '1.0.0', attachTo: [] } });
    expect(installed.statusCode, installed.body).toBe(422);
    expect(JSON.parse(installed.body)).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: '0.3.21', words: [{ word: 'column.codeLast4', path: 'requiredSchema.tables.0.columns.2.rules.codeLast4', release: '0.3.21' }] } },
    });
    expect((await h.tableNames()).filter((name) => name.startsWith('kit_'))).toEqual([]);
  });

  it('the same app without it installs, its link into an add-on that is not there included', async () => {
    const h = (open = await installHarness('sqlite'));
    const tables = (SHOP['requiredSchema'] as { tables: { columns: { ref: string }[] }[] }).tables;
    const plain = { ...SHOP, requiredSchema: { prefixed: true, tables: [{ ...tables[0], columns: tables[0]!.columns.filter((column) => column.ref !== 'code_last4') }] } };
    const installed = await h.install(plain);
    expect(installed.statusCode, installed.body).toBe(200);
  });

  it('an add-on whose pages are built on the data kit installs: the dashboard hands the kit to its pages, and the list says which need it', async () => {
    const h = (openAddOns = await addOnHarness('sqlite'));
    const page = { ref: 'kit-count', title: { key: 'kit.count', fallback: 'Count' }, icon: 'clipboard', client: 'dist/count.js' };
    await h.stageAddOn({ ...KIT, addOn: { ...(KIT['addOn'] as Doc), hostApi: 2, pages: [page] } }, { bundled: true, files: { 'dist/count.js': 'export default function Count() { return null; }' } });
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'kit', version: '1.0.0', attachTo: [] } });
    expect(installed.statusCode, installed.body).toBe(200);
    expect(await h.tableNames()).toContain('kit_items');
    const listed = (await h.inject({ method: 'GET', url: '/add-ons' })).json().addOns.find((entry: { key: string }) => entry.key === 'kit');
    expect(listed.hostApi).toBe(2);
  });

  it('the same add-on built before the kit installs too, and says so: its prefixed table and its page are words this server runs', async () => {
    const h = (openAddOns = await addOnHarness('sqlite'));
    await h.stageAddOn(KIT, { bundled: true });
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'kit', version: '1.0.0', attachTo: [] } });
    expect(installed.statusCode, installed.body).toBe(200);
    expect(await h.tableNames()).toContain('kit_items');
    const listed = (await h.inject({ method: 'GET', url: '/add-ons' })).json().addOns.find((entry: { key: string }) => entry.key === 'kit');
    expect(listed.hostApi).toBe(1);
  });
});
