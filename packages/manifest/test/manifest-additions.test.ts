// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The optional fields an app manifest can now carry: prefixed tables, shared
 * shapes, capacity, column rules, its sidebar headings, public access, sample
 * data, screens-only roles and where a staff side opens. All optional, so every
 * manifest that validated before still does; each cross-reference is checked,
 * so an app's CI catches a typo before an install does.
 */
import { describe, expect, it } from 'vitest';

import { prefixFor, validateManifest } from '../src/index.js';

const base = {
  kind: 'app',
  manifestVersion: 1,
  key: 'pos',
  name: 'Point of Sale',
  version: '0.2.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'A till' },
  categories: ['hospitality'],
  compatibility: { minAdminiumVersion: '0.4.0' },
  pages: [{ ref: 'menu', template: 'page-crud', title: { key: 't', fallback: 'Menu' }, nav: { group: 'manage', icon: 'list', order: 1 } }],
  frontends: [
    { side: 'staff', kind: 'spa', placement: 'external' },
    { side: 'customer', kind: 'spa', enabled: true },
  ],
};

const tables = [
  {
    ref: 'menu_items',
    shape: 'menu@1',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 80 },
      { ref: 'price', type: 'money', default: 0 },
    ],
  },
  {
    ref: 'booking_rules',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'covers_per_slot', type: 'int', default: 12 },
      { ref: 'slot_minutes', type: 'int', default: 30 },
    ],
  },
  {
    ref: 'tickets',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'number', type: 'text', maxLength: 16, nullable: true, rules: { sequence: { start: 1000 } } },
      { ref: 'subtotal', type: 'money', default: 0, rules: { rollup: { from: 'ticket_items', via: 'ticket_id', sum: 'unit_price', times: 'qty' } } },
    ],
  },
  {
    ref: 'ticket_items',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'ticket_id', type: 'fk', references: 'tickets' },
      { ref: 'menu_item_id', type: 'fk', references: 'menu_items' },
      { ref: 'qty', type: 'int', default: 1 },
      { ref: 'unit_price', type: 'money', nullable: true, rules: { copy: { via: 'menu_item_id', from: 'price' } } },
    ],
  },
  {
    ref: 'reservations',
    capacity: {
      slot: 'starts_at',
      amount: 'party_size',
      perSlot: { table: 'booking_rules', column: 'covers_per_slot' },
      slotMinutes: { table: 'booking_rules', column: 'slot_minutes' },
      countWhere: { column: 'status', values: ['confirmed', 'seated'] },
    },
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'code', type: 'text', maxLength: 16, nullable: true, rules: { code: { prefix: 'MR-', length: 4 } } },
      { ref: 'mobile', type: 'text', maxLength: 32 },
      { ref: 'zone', type: 'text', maxLength: 32, nullable: true, rules: { options: { list: 'zones' } } },
      { ref: 'country', type: 'text', maxLength: 2, nullable: true, rules: { options: { list: 'builtin:countries' } } },
      { ref: 'party_size', type: 'int', default: 2 },
      { ref: 'starts_at', type: 'timestamptz', rules: { venueLocal: true } },
      {
        ref: 'status',
        type: 'enum',
        enum: ['confirmed', 'seated', 'cancelled'],
        default: 'confirmed',
        rules: { enumLabels: { labels: { confirmed: { 'en-US': 'Confirmed', 'de-DE': 'Bestätigt' } } } },
      },
    ],
  },
];

const publicAccess = [
  { table: 'booking_rules', methods: ['GET'], select: ['slot_minutes'] },
  { table: 'reservations', kind: 'availability', methods: ['GET'] },
  { table: 'reservations', methods: ['POST'], writable: ['mobile', 'party_size', 'starts_at'], defaults: { status: 'confirmed' } },
  { table: 'reservations', methods: ['GET', 'PATCH'], writable: ['party_size', 'starts_at'], claim: { match: ['code', 'mobile'] } },
];

const full = {
  ...base,
  requiredSchema: { prefixed: true, tables },
  navGroups: [
    { key: 'manage', label: { 'en-US': 'Manage', 'de-DE': 'Verwalten' }, order: 1 },
    { key: 'records', label: { 'en-US': 'Records' }, order: 2 },
  ],
  publicAccess,
  sampleData: { file: 'seeds/pos.sample.json' },
  optionLists: {
    zones: { label: { 'en-US': 'Zones', 'de-DE': 'Bereiche' }, values: [{ value: 'terrace', label: 'Terrace' }, { value: 'bar' }] },
  },
  roles: [{ key: 'cashier', name: 'POS cashier', screensOnly: true, permissions: ['app:@:staff'] }],
};

const issuesOf = (doc: unknown) => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => issue.message);
};

describe('an app manifest using every new field', () => {
  it('validates', () => {
    const result = validateManifest(full);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('keeps every older manifest valid (all fields optional)', () => {
    expect(validateManifest({ ...base, requiredSchema: { tables: [tables[0]] } }).ok).toBe(true);
  });

  it('derives the prefix from the key', () => {
    expect(prefixFor('pos')).toBe('pos_');
    expect(prefixFor('ecommerce-shop')).toBe('ecommerce_shop_');
  });
});

describe('the cross-references it checks', () => {
  const withTables = (patch: (t: typeof tables) => unknown[]) => ({ ...full, requiredSchema: { prefixed: true, tables: patch(structuredClone(tables)) } });

  it('a copy must go through a foreign key to a real column', () => {
    const bad = withTables((t) => {
      (t[3]!.columns[4] as { rules: unknown }).rules = { copy: { via: 'qty', from: 'price' } };
      return t;
    });
    expect(issuesOf(bad).join('\n')).toContain('"qty" is not a foreign key of "ticket_items"');
    const noColumn = withTables((t) => {
      (t[3]!.columns[4] as { rules: unknown }).rules = { copy: { via: 'menu_item_id', from: 'cost' } };
      return t;
    });
    expect(issuesOf(noColumn).join('\n')).toContain('"menu_items" has no column "cost"');
  });

  it('an option list must be one the app ships, or a built-in one', () => {
    const bad = withTables((t) => {
      const zone = (t[4]!.columns as { ref: string; rules?: unknown }[]).find((c) => c.ref === 'zone')!;
      zone.rules = { options: { list: 'areas' } };
      return t;
    });
    expect(issuesOf(bad).join('\n')).toContain('"areas" is not one of the app\'s option lists');
    const named = validateManifest({ ...full, optionLists: { Zones: full.optionLists.zones } });
    expect(named.ok ? [] : named.issues.map((issue) => String(issue.path).split('.')[0])).toContain('optionLists');
  });

  it('a rollup must read child rows that point back at it', () => {
    const bad = withTables((t) => {
      (t[2]!.columns[2] as { rules: unknown }).rules = { rollup: { from: 'ticket_items', via: 'menu_item_id', sum: 'unit_price' } };
      return t;
    });
    expect(issuesOf(bad).join('\n')).toContain('"ticket_items.menu_item_id" does not point at "tickets"');
  });

  it('a rollup leaves out voided rows only by a column the child has', () => {
    const rollup = (unlessSet: string) =>
      withTables((t) => {
        (t[2]!.columns[2] as { rules: unknown }).rules = {
          rollup: { from: 'ticket_items', via: 'ticket_id', sum: 'unit_price', times: 'qty', unlessSet },
        };
        return t;
      });
    expect(issuesOf(rollup('qty'))).toEqual([]);
    expect(issuesOf(rollup('voided_at')).join('\n')).toContain('"ticket_items" has no column "voided_at"');
  });

  it('capacity columns and settings must exist', () => {
    const bad = withTables((t) => {
      (t[4] as { capacity: Record<string, unknown> }).capacity['perSlot'] = { table: 'booking_rules', column: 'seats' };
      return t;
    });
    expect(issuesOf(bad).join('\n')).toContain('"booking_rules" has no column "seats"');
  });

  it('public access: real columns, PATCH only behind a claim, nothing Adminium decides is writable', () => {
    const unknownColumn = { ...full, publicAccess: [{ table: 'reservations', methods: ['GET'], select: ['guest_name'] }] };
    expect(issuesOf(unknownColumn).join('\n')).toContain('"reservations" has no column "guest_name"');
    const openPatch = { ...full, publicAccess: [{ table: 'reservations', methods: ['PATCH'], writable: ['party_size'] }] };
    expect(issuesOf(openPatch).join('\n')).toContain('PATCH is allowed only with a claim');
    const writesCode = { ...full, publicAccess: [{ table: 'reservations', methods: ['POST'], writable: ['code'] }] };
    expect(issuesOf(writesCode).join('\n')).toContain('"code" is decided by Adminium');
    const noCapacity = { ...full, publicAccess: [{ table: 'tickets', kind: 'availability', methods: ['GET'] }] };
    expect(issuesOf(noCapacity).join('\n')).toContain('declares no capacity');
  });

  it('a prefixed name must fit 63 characters', () => {
    const long = { ...full, key: 'a'.repeat(60), requiredSchema: { prefixed: true, tables: [tables[0]] }, publicAccess: [] };
    expect(issuesOf(long).join('\n')).toContain('longer than 63 characters');
  });

  it('refuses unknown methods, labels without US English, a sample file outside seeds/', () => {
    expect(issuesOf({ ...full, publicAccess: [{ table: 'reservations', methods: ['DELETE'] }] }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...full, navGroups: [{ key: 'manage', label: { 'de-DE': 'Verwalten' }, order: 1 }] }).join('\n')).toContain('en-US');
    expect(issuesOf({ ...full, sampleData: { file: '../etc/passwd.json' } }).length).toBeGreaterThan(0);
  });

  it('an add-on cannot prefix its tables', () => {
    const addOn = {
      kind: 'add-on',
      manifestVersion: 1,
      key: 'labels',
      name: 'Labels',
      version: '1.0.0',
      publisher: { id: 'adminium', name: 'Adminium' },
      license: 'MIT',
      description: { key: 'd', fallback: 'd' },
      categories: ['data'],
      compatibility: { minAdminiumVersion: '0.3.0' },
      addOn: { attaches: [{ app: '*', range: '*' }], provides: [], consumes: [], events: [], connect: { kind: 'none' }, scopes: [] },
      requiredSchema: { prefixed: true, tables: [tables[0]] },
    };
    expect(issuesOf(addOn).join('\n')).toContain('cannot be prefixed');
  });
});
