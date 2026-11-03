// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `rules.band` as the manifest can see it: a link filled with the band a
 * number of the row falls in. A shop's lines pick their product's quantity
 * break; its orders pick a delivery band by their summed weight. Each test
 * breaks one thing.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

type Doc = Record<string, unknown>;

const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string, rules?: Doc) => ({ ref, type: 'decimal', scale: 2, nullable: true, ...(rules === undefined ? {} : { rules }) });

function manifest(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A shop' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'products', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, money('price'), { ref: 'code', type: 'text', maxLength: 20, nullable: true }] },
        {
          ref: 'breaks',
          columns: [id, { ref: 'product_id', type: 'fk', references: 'products' }, { ref: 'min_qty', type: 'int' }, { ref: 'max_qty', type: 'int', nullable: true }, { ref: 'multiplier', type: 'decimal', scale: 4 }, { ref: 'label', type: 'text', maxLength: 20, nullable: true }],
        },
        { ref: 'weight_bands', columns: [id, { ref: 'min_kg', type: 'decimal', scale: 3 }, { ref: 'max_kg', type: 'decimal', scale: 3, nullable: true }, money('price')] },
        {
          ref: 'orders',
          columns: [
            id,
            { ref: 'weight', type: 'decimal', scale: 3, nullable: true, rules: { rollup: { from: 'lines', via: 'order_id', sum: 'weight' } } },
            { ref: 'band_id', type: 'fk', references: 'weight_bands', nullable: true, rules: { band: { table: 'weight_bands', min: 'min_kg', max: 'max_kg', value: 'weight', over: 'empty' } } },
            money('delivery', { copy: { via: 'band_id', from: 'price', mode: 'always' } }),
            money('total', { formula: { coalesce: ['delivery', 0] } }),
          ],
        },
        {
          ref: 'lines',
          columns: [
            id,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'product_id', type: 'fk', references: 'products' },
            { ref: 'qty', type: 'int' },
            { ref: 'note', type: 'text', maxLength: 40, nullable: true },
            { ref: 'break_id', type: 'fk', references: 'breaks', nullable: true, rules: { band: { table: 'breaks', min: 'min_qty', value: 'qty', scope: [{ column: 'product_id', equals: 'product_id' }] } } },
            { ref: 'multiplier', type: 'decimal', scale: 4, nullable: true, rules: { copy: { via: 'break_id', from: 'multiplier', mode: 'always' } } },
            { ref: 'weight', type: 'decimal', scale: 3, nullable: true, rules: { formula: { mul: ['qty', 2] } } },
          ],
        },
      ],
    },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'shop', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

const tables = (m: Doc) => (m['requiredSchema'] as { tables: Doc[] }).tables;
const columnOf = (m: Doc, table: string, ref: string) => (tables(m).find((t) => t['ref'] === table)!['columns'] as Doc[]).find((c) => c['ref'] === ref)!;
const bandOf = (m: Doc, table: string, ref: string) => (columnOf(m, table, ref)['rules'] as { band: Doc }).band;
const issues = (m: Doc) => {
  const result = validateManifest(m);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

describe('rules.band', () => {
  it('takes a quantity break scoped to the product and a weight band over a total', () => {
    expect(issues(manifest())).toEqual([]);
  });

  it('fills a nullable foreign key to its band table, and nothing else', () => {
    let m = manifest();
    columnOf(m, 'lines', 'break_id')['nullable'] = false;
    expect(issues(m).join('\n')).toContain(`a band fills this table's link to "breaks": the column is a nullable foreign key to it`);
    m = manifest();
    bandOf(m, 'lines', 'break_id')['table'] = 'weight_bands';
    expect(issues(m).join('\n')).toContain(`a band fills this table's link to "weight_bands"`);
    m = manifest();
    bandOf(m, 'lines', 'break_id')['table'] = 'nope';
    expect(issues(m).join('\n')).toContain('"nope" is not a table of this app');
  });

  it('reads its bounds from number columns of the band table, two different ones', () => {
    let m = manifest();
    bandOf(m, 'lines', 'break_id')['min'] = 'label';
    expect(issues(m).join('\n')).toContain('"breaks.label" is not a number, so no value is placed against it');
    m = manifest();
    bandOf(m, 'lines', 'break_id')['max'] = 'nope';
    expect(issues(m).join('\n')).toContain('"breaks" has no column "nope"');
    m = manifest();
    bandOf(m, 'lines', 'break_id')['max'] = 'min_qty';
    expect(issues(m).join('\n')).toContain('a band reads its lower and its upper bound from two different columns');
    m = manifest();
    bandOf(m, 'lines', 'break_id')['max'] = 'max_qty';
    expect(issues(m)).toEqual([]);
  });

  it("places a number of this table's", () => {
    let m = manifest();
    bandOf(m, 'lines', 'break_id')['value'] = 'note';
    expect(issues(m).join('\n')).toContain('"lines.note" is not a number, so it falls in no band');
    m = manifest();
    bandOf(m, 'lines', 'break_id')['value'] = 'nope';
    expect(issues(m).join('\n')).toContain('"lines" has no column "nope"');
  });

  it('scopes by columns on both sides that hold the same thing, at most two', () => {
    let m = manifest();
    bandOf(m, 'lines', 'break_id')['scope'] = [{ column: 'product_id', equals: 'order_id' }];
    expect(issues(m).join('\n')).toContain('"lines.order_id" and "breaks.product_id" hold different things');
    m = manifest();
    bandOf(m, 'lines', 'break_id')['scope'] = [{ column: 'nope', equals: 'product_id' }];
    expect(issues(m).join('\n')).toContain('"breaks" has no column "nope"');
    m = manifest();
    bandOf(m, 'lines', 'break_id')['scope'] = [{ column: 'product_id', equals: 'nope' }];
    expect(issues(m).join('\n')).toContain('"lines" has no column "nope"');
    m = manifest();
    const pair = { column: 'product_id', equals: 'product_id' };
    bandOf(m, 'lines', 'break_id')['scope'] = [pair, pair, pair];
    expect(issues(m).length).toBeGreaterThan(0);
  });

  it('says what happens past the top only as refuse or empty', () => {
    const m = manifest();
    bandOf(m, 'orders', 'band_id')['over'] = 'quote';
    expect(issues(m).length).toBeGreaterThan(0);
  });

  it('is the one filler of its column', () => {
    const m = manifest();
    (columnOf(m, 'lines', 'break_id')['rules'] as Doc)['copy'] = { via: 'product_id', from: 'id' };
    expect(issues(m).join('\n')).toContain('a column is decided by one rule, and this one has copy, band');
  });

  it('refuses a number that reads what is copied through its own band', () => {
    // The order's weight reads the delivery price copied through the band: the band would decide itself.
    let m = manifest();
    columnOf(m, 'orders', 'weight')['rules'] = { formula: { add: [{ coalesce: ['delivery', 0] }, 1] } };
    expect(issues(m).join('\n')).toContain('"orders.weight" reads what is copied through "band_id", so the band would decide itself');
    // Through a line that copies the order's delivery into the weight the order adds up.
    m = manifest();
    const lines = tables(m).find((t) => t['ref'] === 'lines')!['columns'] as Doc[];
    lines.push(money('order_delivery', { copy: { via: 'order_id', from: 'delivery' } }));
    columnOf(m, 'lines', 'weight')['rules'] = { formula: { add: ['qty', { coalesce: ['order_delivery', 0] }] } };
    expect(issues(m).join('\n')).toContain('"orders.weight" reads what is copied through "band_id", so the band would decide itself');
  });

  it('keeps the link out of every writer the manifest names: a public entry may not write it', () => {
    const m = manifest();
    m['frontends'] = [{ side: 'staff', kind: 'spa' }, { side: 'customer', kind: 'spa' }];
    m['publicAccess'] = [{ table: 'lines', methods: ['POST'], writable: ['qty', 'break_id'], select: ['id'], humanCheck: true }];
    expect(issues(m).join('\n')).toMatch(/break_id/);
  });
});
