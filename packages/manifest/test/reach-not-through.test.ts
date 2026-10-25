// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A change a role's reach does not count a listing for (`notThrough`): a
 * sales rep helps on a colleague's deal (`deal_members`) and reads it, its
 * quotes and their lines, and changes none of them; whoever covers for the
 * deal's owner (`covers`) changes them as before.
 *
 * One valid manifest, then each test breaks one thing and reads the sentence
 * that names it.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, installFloorWords, listingsOf, notThroughList, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const staff = (ref: string) => ({ ref, type: 'text', maxLength: 36, nullable: true, rules: { staff: true } });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references });

type Doc = Record<string, unknown>;

const NOT_HELPERS = { reach: 'own', notThrough: 'deal_members' };

function tables(over: { visits?: Doc } = {}): Doc[] {
  return [
    {
      ref: 'deals',
      columns: [id, staff('owner_id'), { ref: 'name', type: 'text', maxLength: 80 }],
      belongs: [
        { column: 'owner_id', set: 'team' },
        { through: { table: 'deal_members', link: 'deal_id', user: 'user_id' } },
        { through: { table: 'covers', link: 'owner_id', on: 'owner_id', user: 'cover_id' } },
      ],
    },
    { ref: 'deal_members', columns: [id, fk('deal_id', 'deals'), staff('user_id')] },
    { ref: 'covers', columns: [id, staff('owner_id'), staff('cover_id')] },
    { ref: 'quotes', columns: [id, fk('deal_id', 'deals'), { ref: 'total', type: 'int' }], belongs: [{ via: 'deal_id' }] },
    { ref: 'quote_lines', columns: [id, fk('quote_id', 'quotes'), { ref: 'amount', type: 'int' }], belongs: [{ via: 'quote_id' }] },
    {
      ref: 'site_visits',
      columns: [id, fk('deal_id', 'deals'), staff('rep_id'), { ref: 'note', type: 'text', maxLength: 80, nullable: true }],
      belongs: [{ column: 'rep_id' }, { via: 'deal_id' }],
      ...over.visits,
    },
    // A table that says nothing of whose its rows are, and one read through a listing of its own only.
    { ref: 'teams', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
  ];
}

const repOf = (limits: Record<string, unknown> = {}) => ({
  key: 'rep',
  name: 'Sales rep',
  permissions: [
    'table:@deals:read',
    'table:@deals:update',
    'table:@deals:delete',
    'table:@quotes:read',
    'table:@quotes:update',
    'table:@quote_lines:read',
    'table:@quote_lines:update',
    'table:@quote_lines:delete',
    'table:@site_visits:read',
    'table:@site_visits:update',
  ],
  limits: {
    deals: { rows: { read: { reach: 'own' }, update: NOT_HELPERS, delete: NOT_HELPERS } },
    quotes: { rows: { read: { reach: 'own' }, update: NOT_HELPERS } },
    // Two links up: a line hangs off a quote, which hangs off the deal the helper is listed on.
    quote_lines: { rows: { read: { reach: 'own' }, update: NOT_HELPERS, delete: [NOT_HELPERS] } },
    site_visits: { rows: { read: { reach: 'own' }, update: { reach: 'own', by: 'rep_id', notThrough: ['deal_members'] } } },
    ...limits,
  },
});

function manifest(over: { tables?: Doc[]; roles?: unknown[]; floor?: string } = {}): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'Sales',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Sales.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: over.floor ?? '0.3.36' },
    requiredSchema: { tables: over.tables ?? tables() },
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    roles: over.roles ?? [repOf()],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const messages = (document: Doc): string[] => {
  const result = validateManifest(document);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

describe('a change that does not count a listing (notThrough)', () => {
  it('validates, as a word of 0.3.36 found where it is written', () => {
    expect(messages(manifest())).toEqual([]);
    const found = installFloorWords(manifest());
    for (const path of ['deals.rows.update', 'deals.rows.delete', 'quotes.rows.update', 'quote_lines.rows.update', 'quote_lines.rows.delete', 'site_visits.rows.update']) {
      expect(found).toContainEqual({ word: 'rows.notThrough', path: `roles.0.limits.${path}` });
    }
    expect(found.filter((one) => one.word === 'rows.notThrough' && one.path.endsWith('.read'))).toEqual([]);
    expect(WORD_FLOORS['rows.notThrough']).toBe('0.3.36');
    expect(messages(manifest({ floor: '0.3.35' })).some((message) => message.includes('0.3.36'))).toBe(true);
  });

  it('holds a change only: refused on a read, which still counts the listing', () => {
    const at = messages(manifest({ roles: [repOf({ deals: { rows: { read: NOT_HELPERS } } })] }));
    expect(at).toContain('roles.0.limits.deals.rows.read.notThrough: `notThrough` holds a change (update or delete): a person listed on a row still reads it');
  });

  it('is the person\'s own rows or their team\'s, never every row, and never beside `via`', () => {
    const at = (reach: Doc) => messages(manifest({ roles: [repOf({ quotes: { rows: { read: { reach: 'own' }, update: reach } } })] })).join('\n');
    expect(at({ reach: 'all', while: { column: 'total', in: [1] }, notThrough: 'deal_members' })).toContain('every row is reached by no listing');
    expect(at({ reach: 'team', via: 'deal_id', by: 'owner_id', notThrough: 'deal_members' })).toContain('a reach judged by the parent\'s person (`via`) counts no listing already');
    expect(messages(manifest({ roles: [repOf({ quotes: { rows: { read: { reach: 'own' }, update: { reach: 'team', unowned: true, notThrough: 'deal_members' } } } })] }))).toEqual([]);
  });

  it('names a listing the table, or a row it hangs off, is read through', () => {
    const at = (table: string, reach: Doc) => messages(manifest({ roles: [repOf({ [table]: { rows: { read: { reach: 'own' }, update: reach } } })] }));
    expect(at('deals', { reach: 'own', notThrough: 'nowhere' })).toContain(
      'roles.0.limits.deals.rows.update.notThrough: "nowhere" is no listing "deals" is read through: name the table of a "through" way of "deals", or of a row it hangs off ("via")',
    );
    // A table of the app that is no listing of the deal: not one its rows are read through.
    expect(at('deals', { reach: 'own', notThrough: 'quotes' }).join('\n')).toContain('"quotes" is no listing "deals" is read through');
    // One of several: its place in the list.
    expect(at('deals', { reach: 'own', notThrough: ['covers', 'teams'] })).toContain('roles.0.limits.deals.rows.update.notThrough.1: "teams" is no listing "deals" is read through: name the table of a "through" way of "deals", or of a row it hangs off ("via")');
    expect(at('deals', { reach: 'own', notThrough: ['covers', 'covers'] })).toContain('roles.0.limits.deals.rows.update.notThrough.1: "covers" is named twice');
    expect(messages(manifest({ roles: [repOf({ deals: { rows: { read: { reach: 'own' }, update: { reach: 'own', notThrough: ['covers', 'deal_members'] } } } })] }))).toEqual([]);
    // A visit that no longer hangs off its deal is read through no listing at all.
    expect(messages(manifest({ tables: tables({ visits: { belongs: [{ column: 'rep_id' }] } }) })).join('\n')).toContain('"deal_members" is no listing "site_visits" is read through');
    // At most four, and a listing is a table's ref.
    expect(at('deals', { reach: 'own', notThrough: ['covers', 'deal_members', 'covers', 'deal_members', 'covers'] })).not.toEqual([]);
    expect(at('deals', { reach: 'own', notThrough: [] })).not.toEqual([]);
  });

  it('is never a private table\'s reach', () => {
    const priv = tables().map((table) => (table['ref'] === 'site_visits' ? { ...table, belongs: [{ column: 'rep_id' }], private: true } : table));
    expect(messages(manifest({ tables: priv, roles: [repOf({ site_visits: { rows: { read: { reach: 'own' }, update: { reach: 'own', notThrough: 'deal_members' } } } })] }))).toContain(
      'roles.0.limits.site_visits.rows.update: "site_visits" is private: the role\'s update reaches the person\'s own rows only ({ "reach": "own" })',
    );
  });

  it('reads the listings as far up as a row is followed, and a reach\'s one or several alike', () => {
    const doc = manifest();
    const shapes = (doc['requiredSchema'] as { tables: { ref: string; columns: { ref: string; type: string; references?: string }[]; belongs?: never[] }[] }).tables;
    const index = {
      table: (ref: string) => shapes.find((table) => table.ref === ref),
      column: (ref: string, column: string) => shapes.find((table) => table.ref === ref)?.columns.find((one) => one.ref === column),
    };
    const ways = (ref: string) => shapes.find((table) => table.ref === ref)?.belongs ?? [];
    expect([...listingsOf('quote_lines', index as never, ways)].sort()).toEqual(['covers', 'deal_members']);
    expect([...listingsOf('teams', index as never, ways)]).toEqual([]);
    expect(notThroughList({ notThrough: 'covers' })).toEqual(['covers']);
    expect(notThroughList({ notThrough: ['covers', 'deal_members'] })).toEqual(['covers', 'deal_members']);
    expect(notThroughList({})).toEqual([]);
  });
});
