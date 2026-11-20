// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A shopper's lists (`filterable`, `searchable`, `orderable`, `via`,
 * `count`) and an entry's own pages from any file: which entries may say
 * them, of which columns, and the floor that holds them back from an older
 * Adminium. Each rule broken once on a manifest that otherwise validates.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';
import { entryOf, issuesText, kitchen, messages, type Doc } from './orders-stays-fixture.js';

/** The kitchen, on the release that reads the words, its menu a list anyone reads with a shopper's lists. */
function shop(lists: Doc = {}): Doc {
  const m = kitchen();
  m['compatibility'] = { minAdminiumVersion: '0.3.68' };
  Object.assign(entryOf(m, 'menu_items', 'GET'), {
    filterable: ['price', { column: 'name', ops: ['eq', 'in'] }],
    searchable: ['name'],
    orderable: ['price', 'name'],
    via: { entry: 'modifier_groups', on: 'item_id', columns: ['name'] },
    count: true,
    pagination: { defaultLimit: 24, maxLimit: 48, order: 'price.asc' },
    ...lists,
  });
  return m;
}

describe("a shopper's lists on a list anyone reads", () => {
  it('validate, read back as said, and carry the floor', () => {
    expect(messages(shop())).toEqual([]);
    const result = validateManifest(shop());
    if (!result.ok || result.manifest.kind !== 'app') throw new Error('invalid');
    const menu = result.manifest.publicAccess!.find((entry) => entry.table === 'menu_items')!;
    expect(menu.filterable).toEqual(['price', { column: 'name', ops: ['eq', 'in'] }]);
    expect(menu.via).toEqual({ entry: 'modifier_groups', on: 'item_id', columns: ['name'] });
    const words = installFloorWords(shop()).map((found) => found.word);
    for (const word of ['publicAccess.filterable', 'publicAccess.searchable', 'publicAccess.orderable', 'publicAccess.via', 'publicAccess.count', 'publicAccess.appPagination'] as const) {
      expect(words).toContain(word);
      expect(WORD_FLOORS[word]).toBe('0.3.68');
    }
  });

  it('are refused by a manifest that says an older Adminium', () => {
    const m = shop();
    m['compatibility'] = { minAdminiumVersion: '0.3.67' };
    expect(issuesText(m)).toContain('0.3.68');
  });

  it('take no pattern and no operator outside the six', () => {
    expect(issuesText(shop({ filterable: [{ column: 'price', ops: ['like'] }] }))).toContain('filterable');
    expect(issuesText(shop({ filterable: [{ column: 'price', ops: ['eq', 'eq'] }] }))).toContain('an operator is listed once');
    expect(issuesText(shop({ filterable: ['price', 'price'] }))).toContain('"price" is listed twice');
  });

  it('are said only of a list anyone reads, GET alone, of no person', () => {
    // A person's own rows (claimed), and a table people sign in on.
    const claimed = kitchen();
    claimed['compatibility'] = { minAdminiumVersion: '0.3.68' };
    const own = (claimed['publicAccess'] as Doc[]).find((entry) => entry['table'] === 'orders' && entry['claimedBy'] !== undefined && (entry['methods'] as string[]).includes('GET'))!;
    own['searchable'] = ['status'];
    expect(issuesText(claimed)).toContain("a shopper's searchable is said only of a list anyone reads, with no sign-in");
    // A list that also writes.
    const writes = shop();
    (entryOf(writes, 'menu_items', 'GET')['methods'] as string[]).push('POST');
    expect(issuesText(writes)).toContain('a list that only reads (GET alone)');
    // A list opened by a code.
    expect(issuesText(shop({ unlockBy: { table: 'settings', column: 'bank_name', link: 'id' } }))).toContain('a list no code opens');
  });

  it('ask only of columns the list shows, never a secret, personal data or a file', () => {
    expect(issuesText(shop({ filterable: ['available'] }))).toContain('"available" is not shown by the entry (its select)');
    const m = shop();
    const menu = (m['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === 'menu_items')!;
    (menu['columns'] as Doc[]).push({ ref: 'chef_email', type: 'text', maxLength: 120, nullable: true }, { ref: 'extras', type: 'json', nullable: true });
    (entryOf(m, 'menu_items', 'GET')['select'] as string[]).push('extras');
    Object.assign(entryOf(m, 'menu_items', 'GET'), { filterable: ['price', 'extras'] });
    expect(issuesText(m)).toContain('"extras" holds JSON, which no list asks about');
    // Personal data is refused by the entry's own rule before it can be listed: it is not even selected.
    const personal = shop();
    const items = (personal['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === 'menu_items')!;
    (items['columns'] as Doc[]).push({ ref: 'chef_email', type: 'text', maxLength: 120, nullable: true });
    Object.assign(entryOf(personal, 'menu_items', 'GET'), { filterable: ['price', 'chef_email'] });
    expect(issuesText(personal)).toContain('"chef_email" is not shown by the entry');
  });

  it('search text, and order by a column that is never empty', () => {
    expect(issuesText(shop({ searchable: ['price'] }))).toContain('"price" is searched as text: a text column');
    const nullable = shop({ orderable: ['price'], pagination: { defaultLimit: 24, maxLimit: 48, order: 'price.asc' } });
    const menu = (nullable['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === 'menu_items')!;
    (menu['columns'] as Doc[]).push({ ref: 'rank', type: 'int', nullable: true });
    (entryOf(nullable, 'menu_items', 'GET')['select'] as string[]).push('rank');
    Object.assign(entryOf(nullable, 'menu_items', 'GET'), { orderable: ['price', 'rank'] });
    expect(issuesText(nullable)).toContain('"rank" may be empty, and an empty value sorts first on one engine and last on another');
  });

  it('filter through ONE other list anyone reads, whose link points here', () => {
    expect(issuesText(shop({ via: { entry: 'modifiers', on: 'group_id', columns: ['name'] } }))).toContain('"modifiers.group_id" is not a link to "menu_items"');
    expect(issuesText(shop({ via: { entry: 'menu_items', on: 'id', columns: ['name'] } }))).toContain('a filter through another list names another table');
    expect(issuesText(shop({ via: { entry: 'modifier_groups', on: 'item_id', columns: ['min_people'] } }))).toContain('"modifier_groups" has no column "min_people"');
    // The link must be one the other list shows, or the filter says what it hides.
    const hidden = shop();
    entryOf(hidden, 'modifier_groups', 'GET')['select'] = ['id', 'name', 'min', 'max'];
    expect(issuesText(hidden)).toContain('"item_id" joins "modifier_groups" to this list');
    // The other list is a person's: closed to it.
    expect(issuesText(shop({ via: { entry: 'customers', on: 'id', columns: ['name'] } }))).toContain('customers');
  });

  it('filter through a list that also answers stock words: the words are no second list', () => {
    const m = shop();
    (m['publicAccess'] as Doc[]).push({ table: 'modifier_groups', kind: 'availability', methods: ['GET'] });
    expect(issuesText(m)).not.toContain('a filter through "modifier_groups" names the one entry');
  });

  it('page at most a hundred from a file not made on an Adminium, by a column the list shows', () => {
    expect(issuesText(shop({ pagination: { defaultLimit: 24, maxLimit: 101, order: 'price.asc' } }))).toContain('a page holds at most 100 rows');
    expect(issuesText(shop({ pagination: { defaultLimit: 24, maxLimit: 48, order: 'available.asc' } }))).toContain('"available" is not shown by the entry, and an order says what a column holds');
    // Its own address, rate and reply stay a file made on an Adminium's.
    expect(issuesText(shop({ rateLimit: { requests: 100, window: '1m' } }))).toContain('"rateLimit" is read only from a file made on an Adminium');
  });
});

describe("an add-on's list held to its app", () => {
  it('never asks about the app a row is for', () => {
    const m = shop();
    const menu = (m['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === 'menu_items')!;
    (menu['columns'] as Doc[]).push({ ref: 'app', type: 'text', maxLength: 64 });
    (entryOf(m, 'menu_items', 'GET')['select'] as string[]).push('app');
    Object.assign(entryOf(m, 'menu_items', 'GET'), { appColumn: 'app', filterable: ['price', 'app'] });
    expect(issuesText(m)).toContain('"app" holds the app the row is for, which Adminium alone fills');
  });
});
