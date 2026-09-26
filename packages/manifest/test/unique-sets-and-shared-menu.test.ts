// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two table-level promises in the manifest: columns unique together (one
 * waitlist entry per show per address), and a menu two apps share, checked
 * against the menu Point of Sale 0.2.2 declares — plus the name the unique
 * index of a set is given.
 */
import { describe, expect, it } from 'vitest';

import { TABLE_SHAPES, manifestWarnings, shapeTables, tableShapeOf, uniqueSetName, validateManifest, type Manifest } from '../src/index.js';

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const label = { 'en-US': 'Name', 'de-DE': 'Name' };

/** The four menu tables exactly as Point of Sale 0.2.2 declares them (labels and hints included). */
function menuTables(): Doc[] {
  return [
    {
      ref: 'menu_categories',
      shape: 'menu@1',
      label: 'Category',
      labelPlural: 'Categories',
      keyField: 'name',
      columns: [
        id,
        { ref: 'slug', type: 'text', maxLength: 48, label, nullable: true },
        { ref: 'name', type: 'text', maxLength: 80, semantic: 'name', label },
        { ref: 'position', type: 'int', default: 0, label },
        { ref: 'icon', type: 'text', maxLength: 40, nullable: true, label },
        { ref: 'tint', type: 'text', maxLength: 32, nullable: true, label },
      ],
    },
    {
      ref: 'menu_items',
      shape: 'menu@1',
      columns: [
        id,
        { ref: 'category_id', type: 'fk', references: 'menu_categories', nullable: true, label },
        { ref: 'slug', type: 'text', maxLength: 64, label, nullable: true },
        { ref: 'name', type: 'text', maxLength: 80, semantic: 'name', label },
        { ref: 'short_name', type: 'text', maxLength: 24, nullable: true },
        { ref: 'description', type: 'text', maxLength: 280, nullable: true },
        { ref: 'price', type: 'money', default: 0, semantic: 'money' },
        { ref: 'image', type: 'text', semantic: 'image', nullable: true },
        { ref: 'available', type: 'bool', default: true },
        { ref: 'featured', type: 'bool', default: false },
        { ref: 'tags', type: 'text', maxLength: 120, nullable: true },
        { ref: 'position', type: 'int', default: 0 },
        { ref: 'barcode', type: 'text', maxLength: 64, nullable: true },
      ],
    },
    {
      ref: 'modifier_groups',
      shape: 'menu@1',
      columns: [
        id,
        { ref: 'item_id', type: 'fk', references: 'menu_items' },
        { ref: 'slug', type: 'text', maxLength: 48, nullable: true },
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'kind', type: 'enum', enum: ['radio', 'check'], default: 'radio', rules: { enumLabels: { labels: { radio: 'Pick one', check: 'Pick any' } } } },
        { ref: 'min', type: 'int', default: 0 },
        { ref: 'max', type: 'int', default: 1 },
        { ref: 'hint', type: 'text', maxLength: 120, nullable: true },
        { ref: 'position', type: 'int', default: 0 },
      ],
    },
    {
      ref: 'modifiers',
      shape: 'menu@1',
      columns: [
        id,
        { ref: 'group_id', type: 'fk', references: 'modifier_groups' },
        { ref: 'slug', type: 'text', maxLength: 48, nullable: true },
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'price_delta', type: 'money', default: 0 },
        { ref: 'available', type: 'bool', default: true },
        { ref: 'position', type: 'int', default: 0 },
      ],
    },
  ];
}

function app(tables: Doc[]): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'shop.description', fallback: 'A shop' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: { tables },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'shop', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

function waitlist(): Doc {
  return {
    ref: 'waitlist',
    columns: [
      id,
      { ref: 'event_id', type: 'fk', references: 'events' },
      { ref: 'email', type: 'text', maxLength: 200, rules: { normalize: 'email' } },
      { ref: 'note', type: 'json', nullable: true },
      { ref: 'free_text', type: 'text', nullable: true },
      { ref: 'number', type: 'int', nullable: true, rules: { sequence: { gapless: true, scope: 'event_id' } } },
    ],
    unique: [['event_id', 'email']],
  };
}
const events = { ref: 'events', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] };

const issues = (m: Doc) => {
  const result = validateManifest(m);
  return result.ok ? [] : result.issues;
};
const text = (m: Doc) => issues(m).map((i) => `${i.path}: ${i.message}`).join('\n');
const codes = (m: Doc) => issues(m).map((i) => i.code).filter((code) => code !== undefined);
const tableOf = (m: Doc, ref: string) => ((m['requiredSchema'] as { tables: Doc[] }).tables).find((t) => t['ref'] === ref)!;

describe('columns unique together', () => {
  it('takes sets of two to four columns of the table', () => {
    expect(text(app([events, waitlist()]))).toBe('');
  });

  it('refuses a column the table lacks, a column named twice, a set given twice, and a column no index holds', () => {
    let m = app([events, waitlist()]);
    tableOf(m, 'waitlist')['unique'] = [['event_id', 'mail']];
    expect(text(m)).toContain('no column "mail" to be unique with');
    m = app([events, waitlist()]);
    tableOf(m, 'waitlist')['unique'] = [['event_id', 'event_id']];
    expect(text(m)).toContain('a unique set names each column once');
    m = app([events, waitlist()]);
    tableOf(m, 'waitlist')['unique'] = [['event_id', 'email'], ['email', 'event_id']];
    expect(text(m)).toContain('the same columns are unique twice');
    m = app([events, waitlist()]);
    tableOf(m, 'waitlist')['unique'] = [['event_id', 'note']];
    expect(text(m)).toContain('unique needs columns that can be indexed: not json or blob, text with maxLength ("note")');
    m = app([events, waitlist()]);
    tableOf(m, 'waitlist')['unique'] = [['event_id', 'free_text']];
    expect(text(m)).toContain('("free_text")');
  });

  it('refuses a set its running number keeps already, a single column, five columns, and nine sets', () => {
    let m = app([events, waitlist()]);
    tableOf(m, 'waitlist')['unique'] = [['number', 'event_id']];
    expect(text(m)).toContain('already unique by its number rule');
    m = app([events, waitlist()]);
    tableOf(m, 'waitlist')['unique'] = [['email']];
    expect(text(m)).not.toBe('');
    m = app([events, waitlist()]);
    tableOf(m, 'waitlist')['unique'] = [['id', 'event_id', 'email', 'number', 'note']];
    expect(text(m)).not.toBe('');
    m = app([events, waitlist()]);
    tableOf(m, 'waitlist')['unique'] = Array.from({ length: 9 }, () => ['event_id', 'email']);
    expect(text(m)).not.toBe('');
  });

  it('warns — never refuses — of text MySQL compares ignoring case', () => {
    const m = app([events, { ...waitlist(), columns: [...(waitlist()['columns'] as Doc[]), { ref: 'code', type: 'text', maxLength: 20 }], unique: [['event_id', 'code']] }]);
    const result = validateManifest(m);
    expect(result.ok).toBe(true);
    expect(manifestWarnings(m as unknown as Manifest).map((w) => w.message)).toContain(
      'MySQL compares "waitlist.code" ignoring case and accents, Postgres and SQLite do not: give it normalize "email" or "trim"',
    );
    expect(manifestWarnings(app([events, waitlist()]) as unknown as Manifest).filter((w) => w.message.startsWith('MySQL'))).toEqual([]);
  });
});

describe('the name of a unique set\'s index', () => {
  it('is uq_<table>_<columns>, as a column\'s own is', () => {
    expect(uniqueSetName('ev_waitlist', ['event_id', 'email'])).toBe('uq_ev_waitlist_event_id_email');
  });

  it('is cut to 63 bytes with a hash when it is too long, the same every time', () => {
    const long = uniqueSetName('an_app_with_a_rather_long_prefix_order_item_modifiers', ['order_item_id', 'modifier_id']);
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(63);
    expect(long).toMatch(/^uq_an_app_with_a_rather_long_prefix_order_item_modifie\w*_[0-9a-f]{8}$/);
    expect(uniqueSetName('an_app_with_a_rather_long_prefix_order_item_modifiers', ['order_item_id', 'modifier_id'])).toBe(long);
    expect(uniqueSetName('an_app_with_a_rather_long_prefix_order_item_modifiers', ['modifier_id', 'order_item_id'])).not.toBe(long);
  });

  it('is hashed when another index of the database has the plain name', () => {
    // A single column "b" of table "t_a" is named uq_t_a_b too.
    const name = uniqueSetName('t', ['a', 'b'], new Set(['uq_t_a_b']));
    expect(name).not.toBe('uq_t_a_b');
    expect(name).toMatch(/^uq_t_[0-9a-f]{8}$/);
    expect(uniqueSetName('t', ['a', 'b'], new Set(['uq_t_a_b', name]))).not.toBe(name);
  });
});

describe('a menu shared with Point of Sale', () => {
  it('takes the four tables as Point of Sale 0.2.2 declares them, and any subset closed under its links', () => {
    expect(text(app(menuTables()))).toBe('');
    expect(text(app(menuTables().slice(0, 2)))).toBe('');
    expect(text(app(menuTables().slice(0, 1)))).toBe('');
    expect(TABLE_SHAPES.has('menu@1')).toBe(true);
  });

  it('refuses a shape Adminium does not know, and a table that is no part of it', () => {
    let m = app(menuTables());
    tableOf(m, 'menu_items')['shape'] = 'menu@2';
    expect(codes(m)).toContain('TABLE_SHAPE_UNKNOWN');
    m = app([...menuTables(), { ref: 'menu_notes', shape: 'menu@1', columns: [id] }]);
    expect(codes(m)).toEqual(['TABLE_SHAPE_PART']);
  });

  it('refuses a part column missing or declared otherwise, and a narrowing rule on one', () => {
    let m = app(menuTables());
    (tableOf(m, 'menu_items')['columns'] as Doc[]).splice(12, 1);
    expect(codes(m)).toEqual(['TABLE_SHAPE_MISMATCH']);
    expect(text(m)).toContain('"menu_items" has no column "barcode"');
    m = app(menuTables());
    (tableOf(m, 'menu_items')['columns'] as Doc[])[3]!['maxLength'] = 120;
    expect(codes(m)).toEqual(['TABLE_SHAPE_MISMATCH']);
    m = app(menuTables());
    (tableOf(m, 'menu_items')['columns'] as Doc[])[3]!['rules'] = { validation: { minLength: 3 } };
    expect(codes(m)).toEqual(['TABLE_SHAPE_MISMATCH']);
    expect(text(m)).toContain('adds a validation rule the shape does not keep');
  });

  it('refuses a part that links to a part the app does not declare', () => {
    const m = app(menuTables().slice(1, 2));
    expect(codes(m)).toContain('TABLE_SHAPE_REFERENCE');
    expect(text(m)).toContain('"menu_items.category_id" links to the "menu@1" table "menu_categories", so the app declares that table too');
  });

  it('takes an extra column the other app can ignore, and refuses one it would have to fill', () => {
    let m = app(menuTables());
    (tableOf(m, 'menu_items')['columns'] as Doc[]).push({ ref: 'stock_today', type: 'int', nullable: true }, { ref: 'hue', type: 'text', maxLength: 32, default: 'teal' });
    expect(text(m)).toBe('');
    m = app(menuTables());
    (tableOf(m, 'menu_items')['columns'] as Doc[]).push({ ref: 'stock_today', type: 'int' });
    expect(codes(m)).toEqual(['TABLE_SHAPE_EXTRA']);
    m = app(menuTables());
    (tableOf(m, 'menu_items')['columns'] as Doc[]).push({ ref: 'sku', type: 'text', maxLength: 32, nullable: true, unique: true });
    expect(codes(m)).toEqual(['TABLE_SHAPE_EXTRA']);
    m = app(menuTables());
    (tableOf(m, 'menu_items')['columns'] as Doc[]).push({ ref: 'code', type: 'text', maxLength: 12, nullable: true, rules: { code: { length: 8 } } });
    expect(codes(m)).toContain('TABLE_SHAPE_EXTRA');
    m = app([...menuTables(), events]);
    (tableOf(m, 'menu_items')['columns'] as Doc[]).push({ ref: 'event_id', type: 'fk', references: 'events', nullable: true });
    expect(codes(m)).toEqual(['TABLE_SHAPE_EXTRA']);
  });

  it('refuses a unique set, states, a capacity or a booking rule on a shared table', () => {
    let m = app(menuTables());
    tableOf(m, 'modifier_groups')['unique'] = [['item_id', 'slug']];
    expect(codes(m)).toEqual(['TABLE_SHAPE_TABLE_RULE']);
    expect(text(m)).toContain('"modifier_groups" is shared under "menu@1", so it keeps no unique rule');
    m = app(menuTables());
    (tableOf(m, 'modifier_groups')['columns'] as Doc[]).push({ ref: 'status', type: 'enum', enum: ['on', 'off'], default: 'on' });
    tableOf(m, 'modifier_groups')['states'] = { column: 'status', initial: 'on', moves: { on: ['off'] } };
    expect(codes(m)).toEqual(['TABLE_SHAPE_TABLE_RULE']);
  });

  it('lists the tables of each shape, and the shape of one', () => {
    const m = app([...menuTables(), events]) as unknown as Manifest;
    expect(shapeTables(m).get('menu@1')).toEqual(['menu_categories', 'menu_items', 'modifier_groups', 'modifiers']);
    expect(tableShapeOf(m, 'menu_items')).toBe('menu@1');
    expect(tableShapeOf(m, 'events')).toBeNull();
  });
});
