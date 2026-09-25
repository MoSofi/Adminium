// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  isoDurationMs,
  sampleBundleIssues,
  sampleBundleSchema,
  sampleDirective,
  validateManifest,
  type Manifest,
} from '../src/index.js';
import { valid } from './invoicing-fixture.js';

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'pos',
  name: 'Point of Sale',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A till.' },
  categories: ['hospitality'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: {
    tables: [
      { ref: 'menu_categories', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text' }] },
      {
        ref: 'menu_items',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'category_id', type: 'fk', references: 'menu_categories' },
          { ref: 'name', type: 'text' },
          { ref: 'image', type: 'text', nullable: true },
          { ref: 'added_at', type: 'timestamptz', nullable: true },
        ],
      },
    ],
  },
  pages: [
    {
      ref: 'pos-menu',
      template: 'page-crud',
      title: { key: 't', fallback: 'Menu' },
      nav: { group: 'library', icon: 'list', order: 1 },
      bindings: { rows: 'menu_items' },
    },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

function manifest(): Manifest {
  const result = validateManifest(MANIFEST);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest as Manifest;
}

const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'pos',
  assets: { 'img:latte': { file: 'seeds/images/latte.webp', sha256: 'a'.repeat(64) } },
  tables: [
    { ref: 'menu_categories', rows: [{ '@label': 'cat:coffee', name: { '@t': { 'en-US': 'Coffee', 'de-DE': 'Kaffee' } } }] },
    {
      ref: 'menu_items',
      rows: [
        {
          '@label': 'item:latte',
          category_id: { '@ref': 'cat:coffee' },
          name: 'Latte',
          image: { '@asset': 'img:latte' },
          added_at: { '@ago': 'P1DT2H' },
        },
      ],
    },
  ],
};

describe('adminium.sample/1', () => {
  it('reads a well-formed bundle and finds nothing wrong with it', () => {
    const bundle = sampleBundleSchema.parse(BUNDLE);
    expect(sampleBundleIssues(bundle, manifest())).toEqual([]);
  });

  it('names every table, column, label, reference and asset that does not fit', () => {
    const bundle = sampleBundleSchema.parse({
      ...BUNDLE,
      app: 'other',
      tables: [
        { ref: 'shifts', rows: [{ name: 'x' }] },
        {
          ref: 'menu_items',
          rows: [
            { '@label': 'a', category_id: { '@ref': 'later' }, colour: 'red' },
            { '@label': 'a', image: { '@asset': 'img:none' } },
            { '@label': 'self', category_id: { '@ref': 'self' } },
            { '@label': 'later', name: 'x' },
          ],
        },
      ],
    });
    const messages = sampleBundleIssues(bundle, manifest()).map((issue) => issue.message);
    expect(messages).toEqual([
      'The bundle is for "other", not "pos".',
      '"shifts" is not a table this app declares.',
      '"later" is not an earlier row: a referenced row must come first.',
      '"menu_items" has no column "colour".',
      'The label "a" is used twice.',
      '"img:none" is not one of the bundle’s assets.',
      '"self" is not an earlier row: a referenced row must come first.',
    ]);
  });

  it('refuses a malformed directive or format', () => {
    expect(sampleBundleSchema.safeParse({ ...BUNDLE, format: 'adminium.sample/2' }).success).toBe(false);
    const bundle = sampleBundleSchema.parse({
      ...BUNDLE,
      tables: [
        {
          ref: 'menu_categories',
          rows: [{ name: { '@ago': 'yesterday' } }, { name: { '@day': 1, '@time': '25:00' } }, { name: { '@t': {} } }],
        },
      ],
    });
    // Each would otherwise have been written into the column as JSON.
    expect(sampleBundleIssues(bundle, manifest()).map((issue) => issue.path)).toEqual([
      'tables.0.rows.0.name',
      'tables.0.rows.1.name',
      'tables.0.rows.2.name',
    ]);
  });

  it('reads a directive for what it is', () => {
    expect(sampleDirective({ '@ref': 'x' })).toEqual({ kind: 'ref', label: 'x' });
    expect(sampleDirective({ '@ago': 'PT5M' })).toEqual({ kind: 'ago', duration: 'PT5M' });
    expect(sampleDirective({ '@day': -1, '@time': '09:30' })).toEqual({ kind: 'wall', day: -1, time: '09:30', workdays: false });
    expect(sampleDirective({ '@t': { 'en-US': 'Hi' } })).toEqual({ kind: 't', texts: { 'en-US': 'Hi' } });
    expect(sampleDirective({ '@asset': 'img' })).toEqual({ kind: 'asset', label: 'img' });
    expect(sampleDirective('plain')).toBeNull();
    expect(sampleDirective({ a: 1 })).toBeNull();
    expect(sampleDirective([1])).toBeNull();
  });

  it('turns a duration into milliseconds', () => {
    expect(isoDurationMs('PT19M')).toBe(19 * 60_000);
    expect(isoDurationMs('P1DT2H')).toBe(26 * 3_600_000);
    expect(isoDurationMs('P2W')).toBe(14 * 86_400_000);
    expect(isoDurationMs('PT1.5S')).toBe(1500);
    expect(() => isoDurationMs('P')).toThrow();
  });
});

describe('numbers without gaps', () => {
  const studio = () => {
    const result = validateManifest(valid());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return result.manifest as Manifest;
  };
  const bundleOf = (rows: Record<string, unknown>[]) =>
    sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'studio', tables: [{ ref: 'invoices', rows }] });

  it('asks every sample row to spell its gapless number null, so the load never numbers it into the real series', () => {
    expect(sampleBundleIssues(bundleOf([{ number_seq: null, number: 'INV-S2041' }]), studio())).toEqual([]);
    expect(sampleBundleIssues(bundleOf([{ number: 'INV-S2042' }, { number_seq: 7, number: 'INV-S2043' }]), studio())).toEqual([
      { path: 'tables.0.rows.0.number_seq', message: '"number_seq" is numbered without gaps: a sample row spells it null, so it stays off the real series.' },
      { path: 'tables.0.rows.1.number_seq', message: '"number_seq" is numbered without gaps: a sample row spells it null, so it stays off the real series.' },
    ]);
  });
});

describe('days, working days and the clock', () => {
  const bundleWith = (row: Record<string, unknown>) =>
    sampleBundleSchema.parse({
      format: 'adminium.sample/1',
      app: 'pos',
      tables: [
        { ref: 'menu_categories', rows: [{ '@label': 'c', name: 'Drinks' }] },
        { ref: 'menu_items', rows: [{ category_id: { '@ref': 'c' }, name: 'Tea', ...row }] },
      ],
    });

  it('reads a date alone, and working days on either form', () => {
    expect(sampleDirective({ '@day': 2 })).toEqual({ kind: 'date', day: 2, workdays: false });
    expect(sampleDirective({ '@day': 0, '@workdays': true })).toEqual({ kind: 'date', day: 0, workdays: true });
    expect(sampleDirective({ '@day': -1, '@time': '09:30', '@workdays': true })).toEqual({ kind: 'wall', day: -1, time: '09:30', workdays: true });
    expect(sampleBundleIssues(bundleWith({ added_at: { '@day': 1, '@workdays': true } }), manifest())).toEqual([]);
    // A malformed one is refused rather than written into the column.
    expect(sampleBundleIssues(bundleWith({ added_at: { '@day': 1, '@workdays': 'yes' } }), manifest()).map((i) => i.message)).toEqual([
      '"added_at" holds a directive that is not well formed.',
    ]);
  });

  it('reads a day of a month back, with or without its time, and refuses one in the future', () => {
    expect(sampleDirective({ '@month': -2, '@dom': 14 })).toEqual({ kind: 'month', months: -2, dom: 14, time: null });
    expect(sampleDirective({ '@month': 0, '@dom': 31, '@time': '10:00' })).toEqual({ kind: 'month', months: 0, dom: 31, time: '10:00' });
    expect(sampleBundleIssues(bundleWith({ added_at: { '@month': -5, '@dom': 3 } }), manifest())).toEqual([]);
    for (const bad of [{ '@month': 1, '@dom': 3 }, { '@month': -1, '@dom': 0 }, { '@month': -1, '@dom': 32 }, { '@month': -1 }, { '@month': -1, '@dom': 3, '@workdays': true }]) {
      expect(sampleBundleIssues(bundleWith({ added_at: bad }), manifest()).map((i) => i.message)).toEqual([
        '"added_at" holds a directive that is not well formed.',
      ]);
    }
  });

  it('knows @onlyIfEmpty as a row directive, true or absent', () => {
    expect(sampleBundleIssues(bundleWith({ '@onlyIfEmpty': true }), manifest())).toEqual([]);
    expect(sampleBundleIssues(bundleWith({ '@onlyIfEmpty': 'yes' }), manifest()).map((i) => i.message)).toEqual(['"@onlyIfEmpty" is true, or absent.']);
  });

  it('knows @byClock as a row directive: its time, its sets, their columns', () => {
    const clock = { at: 'added_at', before: { name: 'Old tea' }, around: { '@skip': true } };
    expect(sampleBundleIssues(bundleWith({ added_at: { '@day': 0, '@time': '09:00' }, '@byClock': clock }), manifest())).toEqual([]);
    const messages = (row: Record<string, unknown>) => sampleBundleIssues(bundleWith(row), manifest()).map((i) => i.message);
    expect(messages({ '@byClock': clock })).toEqual(['"added_at" is not a column this row sets.']);
    expect(messages({ added_at: { '@day': 0, '@time': '09:00' }, '@byClock': { ...clock, after: { nope: 1 } } })).toEqual(['"menu_items" has no column "nope".']);
    expect(messages({ '@byClock': { at: { '@day': 0 }, before: {} } })).toEqual(['The time is a column of the row or a `@day` with a `@time`.']);
    expect(messages({ '@byClock': { at: 'added_at', before: { '@skip': 'yes' } }, added_at: { '@day': 0, '@time': '09:00' } })).toEqual(['"@skip" is true, or absent.']);
  });
});
