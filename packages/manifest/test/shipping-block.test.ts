// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's `shipping` block: where its orders keep what a carrier needs. It is
 * optional (a released app has none), strict, and checked against the app's own
 * tables and columns; it survives being split into a project's files.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, composeManifest, installFloorWords, splitManifest, validateManifest } from '../src/index.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a manifest bent per test

const text = (ref: string) => ({ ref, type: 'text', maxLength: 120, nullable: true });
const address = { name: 'ship_name', lines: ['ship_line1', 'ship_line2'], city: 'ship_city', region: 'ship_region', postcode: 'ship_postcode', country: 'ship_country', phone: 'ship_phone', email: 'ship_email', company: 'ship_company' };

function app(shipping?: unknown): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.72', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      tables: [
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            text('number'),
            ...Object.values(address).flat().map(text),
            { ref: 'weight', type: 'decimal', scale: 'currency', nullable: true },
          ],
        },
        { ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('body')] },
      ],
    },
    pages: [{ ref: 'shop-home', template: 'page-dashboard', title: { key: 't', fallback: 'Home' }, nav: { group: 'shop', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    ...(shipping === undefined ? {} : { shipping }),
  };
}

const entry = (over: Doc = {}) => ({ table: 'orders', reference: 'number', address, ...over });
const messages = (doc: Doc): string[] => {
  const read = validateManifest(doc);
  return read.ok ? [] : read.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

describe('the shipping block', () => {
  it('is optional: a released app with none is valid', () => {
    expect(messages(app())).toEqual([]);
  });

  it('asks for the release that reads it, so an older server says so', () => {
    expect(WORD_FLOORS['shipping']).toBe('0.3.72');
    expect(installFloorWords(app({ orders: [entry()] }))).toContainEqual({ word: 'shipping', path: 'shipping' });
    const old = app({ orders: [entry()] });
    old['compatibility'].minAdminiumVersion = '0.3.71';
    expect(messages(old).join()).toContain('"shipping" is read by Adminium 0.3.72 and later');
  });

  describe('where an order\'s goods are, for a parcel going abroad', () => {
    const lines = { table: 'order_lines', order: 'order_id', quantity: 'qty', unitValue: 'unit_price', description: 'name' };
    const withLines = (customs: unknown, floor = '0.3.74'): Doc => {
      const doc = app({ orders: [entry({ customs })] });
      doc['compatibility'].minAdminiumVersion = floor;
      doc['requiredSchema'].tables.push(
        {
          ref: 'order_lines',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'order_id', type: 'fk', references: 'orders' },
            text('name'),
            text('code'),
            { ref: 'qty', type: 'int', nullable: true },
            { ref: 'unit_price', type: 'decimal', scale: 'currency', nullable: true },
            { ref: 'grams', type: 'int', nullable: true },
            { ref: 'stage', type: 'enum', nullable: true, enum: ['make', 'ready', 'cancelled'] },
          ],
        },
        { ref: 'products', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('sku')] },
      );
      return doc;
    };

    it('takes the required columns, and every optional one', () => {
      expect(messages(withLines({ lines }))).toEqual([]);
      expect(messages(withLines({ currency: 'ship_country', lines: { ...lines, sku: 'code', unitWeight: 'grams', weightUnit: 'g', product: { column: 'order_id', table: 'products', sku: 'sku' }, unlessSet: 'code' } }))).toEqual([]);
    });

    it('takes a line priced as a whole, in place of one unit\'s value', () => {
      expect(messages(withLines({ lines: { table: 'order_lines', order: 'order_id', quantity: 'qty', description: 'name', lineTotal: 'unit_price' } }))).toEqual([]);
    });

    it('takes the values that leave a line out, and the order column that holds its refunds', () => {
      expect(messages(withLines({ refunded: 'weight', lines: { ...lines, unless: { column: 'stage', in: ['cancelled'] } } }))).toEqual([]);
    });

    it.each([
      ['a value column it does not have', { lines: { ...lines, unless: { column: 'nope', in: ['cancelled'] } } }, 'has no column "nope"'],
      ['no values', { lines: { ...lines, unless: { column: 'stage', in: [] } } }, 'unless'],
      ['a value the column can never hold', { lines: { ...lines, unless: { column: 'stage', in: ['lost'] } } }, 'can never hold "lost"'],
      ['a refund column it does not have', { refunded: 'nope', lines }, 'has no column "nope"'],
      ['a refund column that is not money', { refunded: 'ship_name', lines }, 'cannot hold this'],
    ])('refuses %s', (_name, customs, message) => {
      expect(messages(withLines(customs)).join()).toContain(message);
    });

    it('asks for the release that reads each of them', () => {
      expect(WORD_FLOORS['shipping.customs.lineUnless']).toBe('0.3.74');
      expect(WORD_FLOORS['shipping.customs.refunded']).toBe('0.3.74');
      const doc = withLines({ refunded: 'weight', lines: { ...lines, unless: { column: 'stage', in: ['cancelled'] } } }, '0.3.72');
      expect(installFloorWords(doc)).toContainEqual({ word: 'shipping.customs.lineUnless', path: 'shipping.orders.0.customs.lines.unless' });
      expect(installFloorWords(doc)).toContainEqual({ word: 'shipping.customs.refunded', path: 'shipping.orders.0.customs.refunded' });
    });

    it('asks for the release that reads it', () => {
      expect(WORD_FLOORS['shipping.customs']).toBe('0.3.74');
      const doc = withLines({ lines }, '0.3.72');
      expect(installFloorWords(doc)).toContainEqual({ word: 'shipping.customs', path: 'shipping.orders.0.customs' });
      expect(messages(doc).join()).toContain('"shipping.customs" is read by Adminium 0.3.74 and later');
    });

    it.each([
      ['a table the app does not have', { lines: { ...lines, table: 'nope' } }, 'is not a table of this app'],
      ['a column the lines do not have', { lines: { ...lines, quantity: 'nope' } }, 'has no column "nope"'],
      ['a quantity that is not a whole number', { lines: { ...lines, quantity: 'name' } }, 'cannot hold this'],
      ['a value that is not money', { lines: { ...lines, unitValue: 'qty' } }, 'cannot hold this'],
      ['a line total that is not money', { lines: { table: 'order_lines', order: 'order_id', quantity: 'qty', description: 'name', lineTotal: 'name' } }, 'cannot hold this'],
      ['both a unit value and a line total', { lines: { ...lines, lineTotal: 'unit_price' } }, 'name one of unitValue and lineTotal'],
      ['neither a unit value nor a line total', { lines: { table: 'order_lines', order: 'order_id', quantity: 'qty', description: 'name' } }, 'name one of unitValue and lineTotal'],
      ['a weight with no unit', { lines: { ...lines, unitWeight: 'grams' } }, 'unitWeight and weightUnit go together'],
      ['a unit with no weight', { lines: { ...lines, weightUnit: 'kg' } }, 'unitWeight and weightUnit go together'],
      ['a product table it does not have', { lines: { ...lines, product: { column: 'order_id', table: 'nope', sku: 'sku' } } }, 'is not a table of this app'],
      ['a cancelled-line column it does not have', { lines: { ...lines, unlessSet: 'nope' } }, 'has no column "nope"'],
      ['a product SKU it does not have', { lines: { ...lines, product: { column: 'order_id', table: 'products', sku: 'nope' } } }, 'has no column "nope"'],
    ])('refuses %s', (_name, customs, message) => {
      expect(messages(withLines(customs)).join()).toContain(message);
    });

    it('refuses a key it does not know', () => {
      expect(messages(withLines({ lines: { ...lines, value: 'unit_price' } })).length).toBeGreaterThan(0);
    });
  });

  it('takes a full entry, and one with only the required fields', () => {
    expect(messages(app({ orders: [entry()] }))).toEqual([]);
    expect(messages(app({ orders: [entry({ address: { name: 'ship_name', lines: ['ship_line1'], city: 'ship_city', postcode: 'ship_postcode', country: 'ship_country' } })] }))).toEqual([]);
  });

  it.each([
    ['reference', { reference: undefined }],
    ['name', { address: { ...address, name: undefined } }],
    ['lines', { address: { ...address, lines: undefined } }],
    ['city', { address: { ...address, city: undefined } }],
    ['postcode', { address: { ...address, postcode: undefined } }],
    ['country', { address: { ...address, country: undefined } }],
  ])('needs %s', (_field, over) => {
    expect(messages(app({ orders: [entry(over)] })).length).toBeGreaterThan(0);
  });

  it('is strict at each level, and holds one to three lines', () => {
    expect(messages(app({ orders: [entry()], extra: true })).length).toBeGreaterThan(0);
    expect(messages(app({ orders: [entry({ weight: 'weight' })] })).length).toBeGreaterThan(0);
    expect(messages(app({ orders: [entry({ address: { ...address, fax: 'ship_phone' } })] })).length).toBeGreaterThan(0);
    expect(messages(app({ orders: [entry({ address: { ...address, lines: [] } })] })).length).toBeGreaterThan(0);
    expect(messages(app({ orders: [entry({ address: { ...address, lines: ['ship_line1', 'ship_line2', 'ship_city', 'ship_region'] } })] })).length).toBeGreaterThan(0);
    expect(messages(app({ orders: [] })).length).toBeGreaterThan(0);
  });

  it('is checked against the app\'s own tables and columns', () => {
    expect(messages(app({ orders: [entry({ table: 'invoices' })] })).join()).toContain('"invoices" is not a table of this app');
    expect(messages(app({ orders: [entry({ reference: 'nope' })] })).join()).toContain('"orders" has no column "nope"');
    expect(messages(app({ orders: [entry({ address: { ...address, city: 'nope' } })] })).join()).toContain('shipping.orders.0.address.city');
    expect(messages(app({ orders: [entry({ address: { ...address, lines: ['ship_line1', 'nope'] } })] })).join()).toContain('shipping.orders.0.address.lines.1');
    // A number is not a street.
    expect(messages(app({ orders: [entry({ address: { ...address, city: 'weight' } })] })).join()).toContain('is a decimal column');
    expect(messages(app({ orders: [entry({ reference: 'weight' })] })).join()).toContain('is a decimal column');
  });

  it('names a table once, and a line once', () => {
    expect(messages(app({ orders: [entry(), entry()] })).join()).toContain('"orders" is named twice');
    expect(messages(app({ orders: [entry({ address: { ...address, lines: ['ship_line1', 'ship_line1'] } })] })).join()).toContain('"ship_line1" is named twice');
  });

  it('survives being split into a project\'s files and put back', () => {
    const doc = app({ orders: [entry()] });
    const files = splitManifest(doc);
    expect(files.map((file) => file.path)).toContain('shipping.json');
    const composed = composeManifest(files);
    expect(composed.ok).toBe(true);
    if (composed.ok) expect((composed.document as Doc)['shipping']).toEqual(doc['shipping']);
  });
});
