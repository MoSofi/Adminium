// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on that keeps tables of its own declares what an app declares:
 * generated pages, roles, rules, option lists, emails, sample data, public
 * entries. Everything released before that still validates, byte for byte;
 * what stays refused is a frontend and an add-on that needs another.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ADD_ON_INSTALL_FLOOR, installFloorWords, installsLikeAnApp, validateManifest, type Manifest } from '../src/index.js';
import { KIT } from './add-on-kit-fixture.js';

const dir = new URL('./fixtures/released/', import.meta.url);
const INDEX = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')) as { file: string }[];
const RELEASED = INDEX.filter((entry) => entry.file.endsWith('.manifest.json')).map(
  (entry) => [entry.file, JSON.parse(readFileSync(new URL(entry.file, dir), 'utf8')) as Record<string, unknown>] as const,
);

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

type Doc = Record<string, unknown>;
const kit = (over: Doc = {}): Doc => ({ ...structuredClone(KIT), ...over });

describe('what was released before an add-on could install like an app', () => {
  it('the seven released add-ons and the six apps validate unchanged', () => {
    expect(RELEASED.filter(([, doc]) => doc['kind'] === 'add-on' && doc['version'] === '1.0.7').map(([, doc]) => doc['key']).sort()).toEqual([
      'barcode-labels',
      'design-studio',
      'holiday-calendars',
      'import-canva',
      'invoices',
      'personalizer',
      'shipping-dhl',
    ]);
    expect(new Set(RELEASED.filter(([, doc]) => doc['kind'] !== 'add-on').map(([, doc]) => doc['key'])).size).toBe(6);
    for (const [file, doc] of RELEASED) expect(issuesOf(doc), file).toEqual([]);
  });

  it('none of them uses a word that needs the install floor, and none installs like an app', () => {
    for (const [file, doc] of RELEASED) {
      expect(installFloorWords(doc), file).toEqual([]);
      const result = validateManifest(doc);
      if (result.ok && result.manifest.kind === 'add-on') expect(installsLikeAnApp(result.manifest), file).toBe(false);
    }
  });

  it('a code page ref is exempt below the floor', () => {
    const invoices = RELEASED.find(([file]) => file === 'invoices-1.0.7.manifest.json')![1];
    const refs = ((invoices['addOn'] as { pages: { ref: string }[] }).pages ?? []).map((page) => page.ref);
    expect(refs).toEqual(['documents']);
    expect(issuesOf(invoices)).toEqual([]);
    // The same document at the floor is held to its key.
    expect(issuesOf({ ...invoices, compatibility: { minAdminiumVersion: ADD_ON_INSTALL_FLOOR } }).join('\n')).toContain('a page of "invoices" is addressed under its key');
  });
});

describe('an add-on that installs like an app', () => {
  it('validates with a prefix, a rule, a generated page, a code page and a role', () => {
    expect(issuesOf(kit())).toEqual([]);
    const result = validateManifest(kit());
    expect(result.ok && installsLikeAnApp(result.manifest as Manifest)).toBe(true);
  });

  it('a page built into a file a slot loads is refused: a slot\'s code is handed to everybody signed in', () => {
    const slot = { slot: 'order.dispatch.panel', client: 'pages/count.js', order: 10 };
    const shared = kit({ addOn: { ...KIT.addOn, slots: [slot] } });
    expect(issuesOf(shared).join('\n')).toContain('addOn.pages.0.client: the page "kit-count" is built into "pages/count.js", which a slot loads too');
    // A file of its own beside the slot's is what every add-on ships.
    expect(issuesOf(kit({ addOn: { ...KIT.addOn, slots: [{ ...slot, client: 'client/panel.js' }] } }))).toEqual([]);
  });

  it('a page ref outside the add-on\'s key is refused', () => {
    const generated = kit({ pages: [{ ...KIT.pages[0], ref: 'items' }], roles: [] });
    expect(issuesOf(generated).join('\n')).toContain('pages.0.ref: a page of "kit" is addressed under its key');
    const code = kit({ addOn: { ...KIT.addOn, pages: [{ ...KIT.addOn.pages[0], ref: 'count' }] }, roles: [] });
    expect(issuesOf(code).join('\n')).toContain('addOn.pages.0.ref: a page of "kit" is addressed under its key');
    // The key alone is a ref; a ref is used once across both lists.
    expect(issuesOf(kit({ pages: [{ ...KIT.pages[0], ref: 'kit' }], roles: [] }))).toEqual([]);
    const twice = kit({ pages: [{ ...KIT.pages[0], ref: 'kit-count' }], roles: [] });
    expect(issuesOf(twice).join('\n')).toContain('the page ref "kit-count" is used twice');
  });

  it('a new block under a floor before the install floor is refused', () => {
    const issues = issuesOf(kit({ compatibility: { minAdminiumVersion: '0.3.17' } })).join('\n');
    expect(issues).toContain('pages: "pages" is read by Adminium 0.3.18 and later, and compatibility.minAdminiumVersion is 0.3.17');
    expect(issues).toContain('roles: "roles" is read by');
    expect(issues).toContain('requiredSchema.prefixed: "requiredSchema.prefixed" is read by');
  });

  it('pages that need the data kit say so with hostApi 2, from the install floor up', () => {
    const withKit = kit({ addOn: { ...KIT.addOn, hostApi: 2 } });
    expect(issuesOf(withKit)).toEqual([]);
    expect(installFloorWords(withKit).map((found) => found.word)).toContain('addOn.hostApi.2');
    expect(issuesOf({ ...withKit, compatibility: { minAdminiumVersion: '0.3.17' } }).join('\n')).toContain('addOn.hostApi: "addOn.hostApi.2" is read by Adminium 0.3.18 and later');
  });

  it('frontends, addOns.requires and addOns.features stay refused', () => {
    expect(issuesOf(kit({ frontends: [{ side: 'customer', kind: 'spa' }] })).join('\n')).toContain('Unrecognized key');
    const need = { key: 'invoices', range: '>=1.0.7', reason: { 'en-US': 'Prints orders.' } };
    expect(issuesOf(kit({ addOns: { suggests: [need] } }))).toEqual([]);
    expect(issuesOf(kit({ addOns: { requires: [need] } })).join('\n')).toContain('Unrecognized key');
    expect(issuesOf(kit({ addOns: { features: [{ id: 'print', label: { 'en-US': 'Print' }, requires: ['invoices'] }] } })).join('\n')).toContain('Unrecognized key');
  });

  it('a block that names tables needs tables', () => {
    const { requiredSchema: _tables, ...bare } = kit();
    const issues = issuesOf(bare).join('\n');
    expect(issues).toContain('pages: "pages" names tables, and this add-on declares none');
    expect(issues).toContain('names a table, and this add-on declares none');
  });

  it('a role grants the add-on\'s own tables, pages and settings, and nothing of an app', () => {
    const withGrant = (grant: string, extra: Doc = {}) => issuesOf(kit({ roles: [{ key: 'manager', name: 'Manager', permissions: [grant], ...extra }] })).join('\n');
    expect(withGrant('app:@:staff')).toContain("an add-on's role grants its own tables");
    expect(withGrant('page:@kit-count:edit')).toContain('edits one of its generated pages');
    expect(withGrant('page:@kit-items:edit')).toBe('');
    expect(withGrant('addOn:invoices:settings')).toContain("an add-on's role grants its own tables");
    expect(withGrant('table:@items:read', { screensOnly: true })).toContain('never screensOnly');
  });

  it('public entries need a prefix, and sample data skips nothing', () => {
    const entry = { table: 'items', methods: ['GET'], select: ['name'] };
    const plain = kit({ publicAccess: [entry], requiredSchema: { tables: KIT.requiredSchema.tables } });
    expect(issuesOf(plain).join('\n')).toContain('an add-on with public entries prefixes its tables');
    expect(issuesOf(kit({ publicAccess: [entry] }))).toEqual([]);
    const sample = kit({ sampleData: { file: 'seeds/kit.sample.json', skipWhenShared: { table: 'items', skip: ['items'] } } });
    expect(issuesOf(sample).join('\n')).toContain('its sample data skips nothing');
  });
});

describe('a link into an add-on\'s table', () => {
  const app = (column: Doc, addOns: Doc | null = { suggests: [{ key: 'kit', range: '>=1.0.0', reason: { 'en-US': 'Stock.' } }] }): Doc => ({
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
    pages: [{ ref: 'lines', template: 'page-crud', title: { key: 't', fallback: 'Lines' }, nav: { group: 'manage', icon: 'list', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    ...(addOns === null ? {} : { addOns }),
    requiredSchema: {
      tables: [
        {
          ref: 'lines',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'typed', type: 'text', maxLength: 40, nullable: true },
            column,
          ],
        },
      ],
    },
  });
  const link = { addOn: 'kit', table: 'items' };

  it('is a nullable plain column that names an add-on the manifest names', () => {
    expect(issuesOf(app({ ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: link } }))).toEqual([]);
    expect(issuesOf(app({ ref: 'item_id', type: 'int', rules: { addOnLink: link } })).join('\n')).toContain('a link into an add-on is a nullable int, bigint or text column');
    expect(issuesOf(app({ ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: link } }, null)).join('\n')).toContain('"kit" is not an add-on this manifest names');
    expect(issuesOf(app({ ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'shop', table: 'lines' } } })).join('\n')).toContain('a link into its own table is a foreign key');
  });

  it('a lookup into the add-on\'s table fills a column that links there', () => {
    const lookup = { from: 'typed', table: link, column: 'sku' };
    expect(issuesOf(app({ ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: link, lookup } }))).toEqual([]);
    expect(issuesOf(app({ ref: 'item_id', type: 'int', nullable: true, rules: { lookup } })).join('\n')).toContain('give "lines.item_id" rules.addOnLink {"addOn": "kit", "table": "items"}');
  });

  it('needs the install floor, as every word a newer Adminium reads', () => {
    const doc = app({ ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: link } });
    expect(issuesOf({ ...doc, compatibility: { minAdminiumVersion: '0.3.17' } }).join('\n')).toContain('"column.addOnLink" is read by Adminium 0.3.18 and later');
  });

  describe('filled from the settings row', () => {
    const place = { addOn: 'kit', table: 'places' };
    /** A line whose shelf comes from the shop's settings, and the settings column it comes from. */
    const shop = (setting: Doc, rules: Doc = { addOnLink: place, default: { from: { table: 'settings', column: 'place_id' } } }, floor = '0.3.19'): Doc => {
      const doc = app({ ref: 'place_id', type: 'int', nullable: true, rules }) as Doc & { requiredSchema: { tables: Doc[] } };
      return {
        ...doc,
        compatibility: { minAdminiumVersion: floor },
        requiredSchema: { tables: [...doc.requiredSchema.tables, { ref: 'settings', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'note', type: 'text', maxLength: 40, nullable: true }, setting] }] },
      };
    };
    const kept = (rules?: Doc, type = 'int'): Doc => ({ ref: 'place_id', type, nullable: true, ...(type === 'text' ? { maxLength: 40 } : {}), ...(rules === undefined ? {} : { rules }) });
    const only = 'a link into an add-on takes its default only from a column of the settings row that links into the same table of the same add-on';

    it('takes the settings row\'s own link into the same table', () => {
      expect(issuesOf(shop(kept({ addOnLink: place })))).toEqual([]);
    });

    it('is refused when the settings column links into nothing', () => {
      expect(issuesOf(shop(kept())).join('\n')).toContain(`${only}: "settings.place_id" links into none`);
    });

    it('is refused when the settings column links into another add-on', () => {
      const doc = shop(kept({ addOnLink: { addOn: 'other-kit', table: 'places' } })) as Doc & { addOns: { suggests: Doc[] } };
      const both = { ...doc, addOns: { suggests: [...doc.addOns.suggests, { key: 'other-kit', range: '>=1.0.0', reason: { 'en-US': 'More.' } }] } };
      expect(issuesOf(both).join('\n')).toContain(`${only}: "settings.place_id" links into "other-kit", not "kit"`);
    });

    it('is refused when the settings column links into another table', () => {
      expect(issuesOf(shop(kept({ addOnLink: { addOn: 'kit', table: 'items' } }))).join('\n')).toContain(`${only}: "settings.place_id" links into "items", not "places"`);
    });

    it('is refused when the two columns keep the key as different types', () => {
      expect(issuesOf(shop(kept({ addOnLink: place }, 'text'))).join('\n')).toContain('kept as the same type: "settings.place_id" is text, not int');
    });

    it('takes no other default, and no other rule that fills', () => {
      expect(issuesOf(shop(kept({ addOnLink: place }), { addOnLink: place, default: { from: 'connection.currency' } })).join('\n')).toContain(only);
      expect(issuesOf(shop(kept({ addOnLink: place }), { addOnLink: place, default: { from: { addOn: 'kit', setting: 'default_place' } } })).join('\n')).toContain(only);
      expect(issuesOf(shop(kept({ addOnLink: place }), { addOnLink: place, stamp: { set: 'now', on: 'create' } })).join('\n')).toContain('a link into an add-on is filled by a person, a lookup or the settings row, not by stamp');
    });

    it('needs the release that reads it, one after the install floor', () => {
      const words = installFloorWords(shop(kept({ addOnLink: place }))).map((found) => found.word);
      expect(words).toContain('column.addOnLink.default');
      expect(issuesOf(shop(kept({ addOnLink: place }), undefined, ADD_ON_INSTALL_FLOOR)).join('\n')).toContain('"column.addOnLink.default" is read by Adminium 0.3.19 and later, and compatibility.minAdminiumVersion is 0.3.18');
      // A word of the install floor is still asked for that floor, not the newer one.
      expect(issuesOf(shop(kept({ addOnLink: place }), undefined, ADD_ON_INSTALL_FLOOR)).join('\n')).not.toContain('"column.addOnLink" is read');
      expect(issuesOf(shop(kept({ addOnLink: place }), undefined, '0.3.17')).join('\n')).toContain('"column.addOnLink" is read by Adminium 0.3.18 and later');
    });
  });

  it('a table name is kept in a bounded text column', () => {
    expect(issuesOf(app({ ref: 'source', type: 'text', maxLength: 128, nullable: true, rules: { tableRef: true } }))).toEqual([]);
    expect(issuesOf(app({ ref: 'source', type: 'int', nullable: true, rules: { tableRef: true } })).join('\n')).toContain('a table name is kept in a text column with maxLength');
  });
});
