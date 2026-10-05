// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's sample rows for an add-on it names: a second sample file with a
 * top-level `addOn`, and the `@table` directive that fills a column holding
 * a table's stored name.
 */
import { describe, expect, it } from 'vitest';

import { ADD_ON_INSTALL_FLOOR, sampleBundleIssues, sampleBundleSchema, sampleSectionIssues, validateManifest, type AddOnManifest, type AppManifest, type SampleBundle } from '../src/index.js';
import { KIT } from './add-on-kit-fixture.js';

type Doc = Record<string, unknown>;

const LINKS = {
  ref: 'links',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'item_id', type: 'fk', references: 'items' },
    { ref: 'source_table', type: 'text', maxLength: 128, rules: { tableRef: true } },
    { ref: 'source_row', type: 'text', maxLength: 64 },
  ],
};

const kitDoc = (): Doc => ({ ...structuredClone(KIT), requiredSchema: { prefixed: true, tables: [...KIT.requiredSchema.tables, LINKS] } });

const shopDoc = (over: Doc = {}): Doc => ({
  kind: 'app',
  manifestVersion: 1,
  key: 'shop',
  name: 'Shop',
  version: '0.3.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'A shop' },
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: ADD_ON_INSTALL_FLOOR },
  pages: [{ ref: 'products', template: 'page-crud', title: { key: 't', fallback: 'Products' }, nav: { group: 'manage', icon: 'list', order: 1 } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: { suggests: [{ key: 'kit', range: '>=1.0.0', reason: { 'en-US': 'Stock.' } }] },
  sampleData: { file: 'seeds/shop.sample.json', addOns: { kit: { file: 'seeds/shop.kit.sample.json' } } },
  requiredSchema: {
    tables: [
      { ref: 'products', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
      {
        ref: 'supplies',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'product_id', type: 'fk', references: 'products' },
          { ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'kit', table: 'items' } } },
        ],
      },
    ],
  },
  ...over,
});

const manifestOf = <T,>(doc: Doc): T => {
  const result = validateManifest(doc);
  if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  return result.manifest as T;
};
const issuesOf = (doc: Doc): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

const section = (over: Doc = {}): SampleBundle =>
  sampleBundleSchema.parse({
    format: 'adminium.sample/1',
    app: 'shop',
    addOn: 'kit',
    tables: [
      { ref: 'items', rows: [{ '@label': 'kit:flour', name: 'Flour' }] },
      { ref: 'links', rows: [{ item_id: { '@ref': 'kit:flour' }, source_table: { '@table': 'products' }, source_row: { '@ref': 'shop:bread' } }] },
      { ref: 'supplies', own: true, rows: [{ product_id: { '@ref': 'shop:bread' }, item_id: { '@ref': 'kit:flour' } }] },
    ],
    ...over,
  });

const messages = (bundle: SampleBundle, app = shopDoc(), addOn: Doc | null = kitDoc()): string =>
  sampleSectionIssues(bundle, manifestOf<AppManifest>(app), addOn === null ? undefined : manifestOf<AddOnManifest>(addOn))
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('\n');

describe('the manifest names the file', () => {
  it('for an add-on the app names, in a file of its own', () => {
    expect(issuesOf(shopDoc())).toEqual([]);
    expect(issuesOf(shopDoc({ sampleData: { file: 'seeds/shop.sample.json', addOns: { offers: { file: 'seeds/shop.offers.sample.json' } } } })).join('\n')).toContain(
      'sampleData.addOns.offers: "offers" is not an add-on this app names',
    );
    expect(issuesOf(shopDoc({ sampleData: { file: 'seeds/shop.sample.json', addOns: { kit: { file: 'seeds/shop.sample.json' } } } })).join('\n')).toContain('a file of their own');
  });

  it('needs the install floor', () => {
    expect(issuesOf(shopDoc({ compatibility: { minAdminiumVersion: '0.3.17' } })).join('\n')).toContain('"sampleData.addOns" is read by Adminium 0.3.18 and later');
  });

  it('an add-on ships no rows for another add-on', () => {
    const doc = { ...kitDoc(), sampleData: { file: 'seeds/kit.sample.json', addOns: { invoices: { file: 'seeds/kit.invoices.sample.json' } } } };
    expect(issuesOf(doc).join('\n')).toContain("rows for another add-on are an app's to ship");
  });
});

describe('an app\'s rows for an add-on', () => {
  it('hold the add-on\'s tables and the app\'s own tables that link into it', () => {
    expect(messages(section())).toBe('');
    // Without the add-on's manifest at hand, what can be checked still is.
    expect(messages(section(), shopDoc(), null)).toBe('');
  });

  it('say which add-on, and one the app names', () => {
    expect(messages(section({ addOn: undefined }))).toContain('Rows for an add-on say which');
    expect(messages(section({ addOn: 'offers' }))).toContain('"offers" is not an add-on this app names');
    expect(messages(section({ app: 'till' }))).toContain('The file is for "till", not "shop".');
  });

  it('an own table without a link into the add-on is refused', () => {
    const bundle = section({ tables: [{ ref: 'products', own: true, rows: [{ name: 'Bread' }] }] });
    expect(messages(bundle)).toContain('"products" has no column that links into "kit"');
  });

  it('a table that is neither is refused once the add-on is known', () => {
    const bundle = section({ tables: [{ ref: 'supplies', rows: [{ item_id: 1 }] }] });
    expect(messages(bundle)).toContain('"supplies" is not a table of "kit". A table of the app itself is marked "own": true.');
    expect(messages(bundle, shopDoc(), null)).toBe('');
  });

  it('a column the table lacks is refused; a label of another file is left for the load', () => {
    const bundle = section({ tables: [{ ref: 'items', rows: [{ colour: 'red' }] }] });
    expect(messages(bundle)).toContain('"items" has no column "colour"');
    expect(messages(section())).not.toContain('shop:bread');
  });
});

describe('@table', () => {
  it('names a table of the app, into a column that holds a table\'s name', () => {
    const wrongTable = section({ tables: [{ ref: 'links', rows: [{ item_id: 1, source_table: { '@table': 'orders' }, source_row: '1' }] }] });
    expect(messages(wrongTable)).toContain('"orders" is not a table this app declares.');
    const wrongColumn = section({ tables: [{ ref: 'links', rows: [{ item_id: 1, source_table: 'x', source_row: { '@table': 'products' } }] }] });
    expect(messages(wrongColumn)).toContain('"links.source_row" does not hold a table\'s name');
  });

  it('in a manifest\'s own sample file names one of its own tables', () => {
    const own = sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'kit', tables: [{ ref: 'items', rows: [{ '@label': 'flour', name: 'Flour' }] }, { ref: 'links', rows: [{ item_id: { '@ref': 'flour' }, source_table: { '@table': 'items' }, source_row: '1' }] }] });
    expect(sampleBundleIssues(own, manifestOf<AddOnManifest>(kitDoc()))).toEqual([]);
    const other = sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'kit', tables: [{ ref: 'links', rows: [{ item_id: 1, source_table: { '@table': 'products' }, source_row: '1' }] }] });
    expect(sampleBundleIssues(other, manifestOf<AddOnManifest>(kitDoc())).map((issue) => issue.message).join('\n')).toContain('"products" is not a table this add-on declares.');
  });

  it('a file with an addOn is not a manifest\'s own sample file', () => {
    expect(sampleBundleIssues(section(), manifestOf<AppManifest>(shopDoc())).map((issue) => issue.path)).toEqual(expect.arrayContaining(['addOn', 'tables.2.own']));
  });
});
