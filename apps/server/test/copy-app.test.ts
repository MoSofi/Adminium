// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Make it yours" keeps every word of the manifest. A copy is the renamed
 * manifest written as part files: a field the parts have no file for, a rule
 * still under the old key, or a sample file still under the old name would be
 * a copy that is not the app — so each is pinned here, on a manifest that
 * uses every newer word.
 */
import { composeManifest, installFloorWords, validateManifest, type ManifestPartFile } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { lostFields, planCopy, renameManifest, sampleFileFor } from '../src/project/apps/copy-app.js';
import { LEDGER_HOST } from '../../../packages/manifest/test/ledger-kit-fixture.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests reach into a manifest freely
type Doc = Record<string, any>;

/** An app under the key `shop` that posts into an add-on, ships a rule, grants a role an add-on's table and carries the add-on's sample rows. */
function shop(): Doc {
  const doc = structuredClone(LEDGER_HOST) as Doc;
  doc.key = 'shop';
  doc.name = 'Shop';
  const orders = doc.requiredSchema.tables.find((table: Doc) => table.ref === 'orders');
  orders.indexes = [['status', 'hold_until']];
  orders.states.actions = [
    { id: 'ready', label: 'Mark ready', move: { to: 'ready' }, tone: 'primary' },
    { id: 'list', label: 'Back to the list', link: { page: 'shop-orders', param: 'order' }, in: ['placed'] },
    { id: 'count', label: 'Count it', link: { addOnPage: 'ledger-kit:ledger-kit-count', param: 'order' }, in: ['ready'] },
  ];
  doc.pages = [
    {
      ...doc.pages[0],
      ref: 'shop-orders',
      config: {
        tabs: { order_lines: { empty: 'No lines yet', noNew: true } },
        layout: { toolbar: { links: [{ label: 'All orders', href: '/p/shop-orders?view=all', tone: 'primary' }, { label: 'Stock', href: '/add-ons/ledger-kit/ledger-kit-count' }] } },
      },
    },
  ];
  doc.roles = [
    {
      key: 'desk',
      name: 'Desk',
      permissions: ['table:@orders:read', 'page:@shop-orders:view'],
      tables: [{ addOn: 'ledger-kit', table: 'accounts', actions: ['read', 'update'], limit: { writable: ['note'] } }],
    },
  ];
  doc.sampleData = { file: 'seeds/shop.sample.json', addOns: { 'ledger-kit': { file: 'seeds/shop.ledger-kit.sample.json' } } };
  doc.automations = [
    {
      key: 'shop-restock',
      name: { 'en-US': 'Tell the desk' },
      enabled: true,
      trigger: { kind: 'record', event: 'updated', table: 'orders', changedColumn: 'status', when: [{ left: { field: 'status' }, op: 'is', right: 'cancelled' }] },
      graph: {
        version: 1,
        nodes: [
          { id: 't', kind: 'trigger', title: 'An order is cancelled' },
          { id: 'n', kind: 'action', title: 'Tell the desk', action: { kind: 'notification', to: { roles: ['desk'] }, title: 'Order {{record.id}} was cancelled' } },
        ],
      },
    },
  ];
  return doc;
}

/** The app's repository: its manifest, the two build lines, its key in a module, and its sample files. */
function sourceOf(doc: Doc): Map<string, Buffer> {
  const file = (text: string) => Buffer.from(text, 'utf8');
  return new Map([
    ['manifest.json', file(JSON.stringify(doc))],
    [
      'package.json',
      file(
        JSON.stringify(
          {
            name: 'shop-app',
            scripts: {
              'build:surface': 'npm run build:staff && npm run build:customer',
              'build:staff': 'vite build --base=/apps/shop/staff/ --outDir dist-surface/shop/staff',
              'build:customer': 'vite build --base=/apps/shop/customer/ --outDir dist-surface/shop/customer',
            },
          },
          null,
          2,
        ),
      ),
    ],
    ['src/app.ts', file(`export const APP_KEY = 'shop';\nexport const SAMPLE = 'seeds/shop.sample.json';\nexport const STOCK = 'seeds/shop.ledger-kit.sample.json';\n`)],
    ['seeds/shop.sample.json', file(JSON.stringify({ app: 'shop', tables: {} }))],
    ['seeds/shop.ledger-kit.sample.json', file(JSON.stringify({ app: 'shop', addOn: 'ledger-kit', tables: {} }))],
    ['seeds/other.sample.json', file(JSON.stringify({ app: 'other' }))],
  ]);
}

const partsOf = (files: ReadonlyMap<string, Buffer>): ManifestPartFile[] =>
  [...files].filter(([path]) => path.startsWith('manifest/')).map(([path, bytes]) => ({ path: path.slice('manifest/'.length), text: bytes.toString('utf8') }));

describe('a copy of an app that uses every newer word', () => {
  const original = shop();
  const plan = planCopy(sourceOf(original), { to: 'my-shop', name: 'My shop' });
  const renamed = renameManifest(original, 'my-shop', 'My shop');
  const written = composeManifest(partsOf(plan.files));

  it('the fixture is a valid app that uses those words', () => {
    const checked = validateManifest(structuredClone(original));
    expect(checked.ok ? [] : checked.issues).toEqual([]);
    const words = installFloorWords(original).map((found) => found.word);
    for (const word of ['automations', 'table.postings', 'table.indexes', 'states.actions', 'roles.tables', 'config.tabs', 'toolbar.links', 'sampleData.addOns', 'column.addOnLink']) expect(words, word).toContain(word);
  });

  it('has no problem, and its part files compose to the renamed manifest, whole', () => {
    expect(plan.problems).toEqual([]);
    expect(renamed.leftovers).toEqual([]);
    expect(written.ok, JSON.stringify(written)).toBe(true);
    if (!written.ok) return;
    expect(lostFields(renamed.manifest, written.document)).toEqual([]);
    expect(Object.keys(written.document).sort()).toEqual(Object.keys(renamed.manifest).sort());
    expect(plan.files.has('manifest/automations.json')).toBe(true);
    const checked = validateManifest(written.document, { allowLocalPublisher: true });
    expect(checked.ok ? [] : checked.issues).toEqual([]);
  });

  it('a rule it ships, a page and what names the page are under the new key', () => {
    const copy = renamed.manifest as Doc;
    expect(copy.key).toBe('my-shop');
    expect(copy.automations[0].key).toBe('my-shop-restock');
    expect(copy.pages[0].ref).toBe('my-shop-orders');
    expect(copy.roles[0].permissions).toEqual(['table:@orders:read', 'page:@my-shop-orders:view']);
    const orders = copy.requiredSchema.tables.find((table: Doc) => table.ref === 'orders');
    expect(orders.states.actions[1].link).toEqual({ page: 'my-shop-orders', param: 'order' });
    expect(copy.pages[0].config.layout.toolbar.links[0].href).toBe('/p/my-shop-orders?view=all');
  });

  it('what names the add-on is as it was', () => {
    const copy = renamed.manifest as Doc;
    const before = (ref: string) => original.requiredSchema.tables.find((table: Doc) => table.ref === ref);
    const after = (ref: string) => copy.requiredSchema.tables.find((table: Doc) => table.ref === ref);
    expect(copy.roles[0].tables).toEqual(original.roles[0].tables);
    expect(after('order_lines').postings).toEqual(before('order_lines').postings);
    expect(after('order_lines').columns).toEqual(before('order_lines').columns);
    expect(after('orders').indexes).toEqual([['status', 'hold_until']]);
    expect(after('orders').states.actions[2].link).toEqual({ addOnPage: 'ledger-kit:ledger-kit-count', param: 'order' });
    expect(copy.pages[0].config.tabs).toEqual(original.pages[0].config.tabs);
    expect(copy.pages[0].config.layout.toolbar.links[1].href).toBe('/add-ons/ledger-kit/ledger-kit-count');
    expect(copy.addOns).toEqual(original.addOns);
  });

  it('its sample files are the copy\'s by name, in the manifest, on disk and where the source imports them', () => {
    expect((renamed.manifest as Doc).sampleData).toEqual({ file: 'seeds/my-shop.sample.json', addOns: { 'ledger-kit': { file: 'seeds/my-shop.ledger-kit.sample.json' } } });
    const seeds = [...plan.files.keys()].filter((path) => path.startsWith('seeds/')).sort();
    expect(seeds).toEqual(['seeds/my-shop.ledger-kit.sample.json', 'seeds/my-shop.sample.json', 'seeds/other.sample.json']);
    expect(JSON.parse(plan.files.get('seeds/my-shop.ledger-kit.sample.json')!.toString('utf8'))).toEqual({ app: 'my-shop', addOn: 'ledger-kit', tables: {} });
    expect(plan.files.get('seeds/other.sample.json')!.toString('utf8')).toBe(JSON.stringify({ app: 'other' }));
    const module = plan.files.get('src/app.ts')!.toString('utf8');
    expect(module).toContain(`APP_KEY = 'my-shop'`);
    expect(module).toContain(`'seeds/my-shop.sample.json'`);
    expect(module).toContain(`'seeds/my-shop.ledger-kit.sample.json'`);
  });

  it('a sample file is only the app\'s own or one it carries for an add-on', () => {
    expect(sampleFileFor('seeds/shop.sample.json', 'shop', 'my-shop')).toBe('seeds/my-shop.sample.json');
    expect(sampleFileFor('seeds/shop.ledger-kit.sample.json', 'shop', 'my-shop')).toBe('seeds/my-shop.ledger-kit.sample.json');
    expect(sampleFileFor('seeds/shopping.sample.json', 'shop', 'my-shop')).toBeNull();
    expect(sampleFileFor('seeds/shop.a.b.sample.json', 'shop', 'my-shop')).toBeNull();
    expect(sampleFileFor('seeds/shop.notes.json', 'shop', 'my-shop')).toBeNull();
    expect(sampleFileFor('src/shop.sample.json', 'shop', 'my-shop')).toBeNull();
  });

  it('a field the part files cannot hold is a problem said out loud, never a copy written without it', () => {
    expect(lostFields({ key: 'a', automations: [1], pages: [{ ref: 'b' }, { ref: 'a' }] }, { pages: [{ ref: 'a' }, { ref: 'b' }], key: 'a' })).toEqual(['automations']);
    expect(lostFields({ key: 'a', requiredSchema: { tables: [{ ref: 'b', columns: [2, 1] }, { ref: 'a' }] } }, { key: 'a', requiredSchema: { tables: [{ ref: 'a' }, { columns: [2, 1], ref: 'b' }] } })).toEqual([]);
    expect(lostFields({ key: 'a', roles: [{ key: 'r', tables: [1] }] }, { key: 'a', roles: [{ key: 'r' }] })).toEqual(['roles']);
    // A column list is in the order it was written: a change of it is a change.
    expect(lostFields({ requiredSchema: { tables: [{ ref: 'a', columns: [1, 2] }] } }, { requiredSchema: { tables: [{ ref: 'a', columns: [2, 1] }] } })).toEqual(['requiredSchema']);
  });

  it('a rule already under another name is left as it is', () => {
    const doc = shop();
    doc.automations[0].key = 'restock';
    expect((renameManifest(doc, 'my-shop', 'My shop').manifest as Doc).automations[0].key).toBe('restock');
    expect(planCopy(sourceOf(doc), { to: 'my-shop', name: 'My shop' }).problems).toEqual([]);
  });
});
