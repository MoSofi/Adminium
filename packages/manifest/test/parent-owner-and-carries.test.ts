// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two words of a sales app's hand-over and its managers:
 *
 *  - a reach judged by the PARENT's person (`via` beside `by`): a sales
 *    manager reads the visits of the deals her team owns, and no other;
 *  - what a hand-over carries (`carries`): the old owner's booked visits and
 *    open follow-ups go to the new owner in the same write.
 *
 * One valid manifest, then each test breaks one thing and reads the sentence
 * that names it.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, installFloorWords, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const staff = (ref: string) => ({ ref, type: 'text', maxLength: 36, nullable: true, rules: { staff: true } });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references });

type Doc = Record<string, unknown>;

const BY_DEAL_OWNER = { reach: 'team', via: 'deal_id', by: 'owner_id' };
const CARRIES = [
  { table: 'site_visits', via: 'deal_id', column: 'rep_id', where: [{ column: 'state', in: ['booked'] }] },
  { table: 'follow_ups', via: 'deal_id', column: 'owner_id', where: [{ column: 'done', eq: false }] },
];

function tables(over: { action?: Doc; visits?: Doc } = {}): Doc[] {
  return [
    {
      ref: 'deals',
      columns: [id, staff('owner_id'), { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'state', type: 'enum', enum: ['open', 'won'], default: 'open' }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }],
      belongs: [{ column: 'owner_id', set: 'team' }],
      states: {
        column: 'state',
        initial: 'open',
        moves: { open: ['won'] },
        actions: [{ id: 'hand-over', label: { 'en-US': 'Hand over' }, set: {}, in: ['open'], ask: ['owner_id'], handOver: true, carries: CARRIES, ...over.action }],
      },
    },
    {
      ref: 'site_visits',
      columns: [id, fk('deal_id', 'deals'), staff('rep_id'), { ref: 'state', type: 'enum', enum: ['booked', 'done'], default: 'booked' }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }],
      belongs: [{ column: 'rep_id', set: 'team' }, { via: 'deal_id' }],
      ...over.visits,
    },
    { ref: 'follow_ups', columns: [id, fk('deal_id', 'deals'), staff('owner_id'), { ref: 'done', type: 'bool', default: false }], belongs: [{ column: 'owner_id', set: 'team' }] },
    { ref: 'notes', columns: [id, fk('deal_id', 'deals'), { ref: 'text', type: 'text', maxLength: 80 }] },
  ];
}

const managerOf = (limits: Record<string, unknown> = {}) => ({
  key: 'manager',
  name: 'Sales manager',
  permissions: ['table:@deals:read', 'table:@deals:update', 'table:@site_visits:read', 'table:@site_visits:update', 'table:@follow_ups:read', 'table:@follow_ups:update', 'table:@notes:read'],
  limits: {
    deals: { rows: { read: { reach: 'team', by: 'owner_id' }, update: { reach: 'team', by: 'owner_id' } } },
    site_visits: { rows: { read: BY_DEAL_OWNER, update: BY_DEAL_OWNER } },
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
    compatibility: { minAdminiumVersion: over.floor ?? '0.3.35' },
    requiredSchema: { tables: over.tables ?? tables() },
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    roles: over.roles ?? [managerOf()],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const messages = (document: Doc): string[] => {
  const result = validateManifest(document);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

describe('a reach judged by the parent\'s person (via)', () => {
  it('validates, as a word of 0.3.35 found where it is written', () => {
    expect(messages(manifest())).toEqual([]);
    expect(installFloorWords(manifest())).toContainEqual({ word: 'rows.via', path: 'roles.0.limits.site_visits.rows.read' });
    expect(installFloorWords(manifest())).toContainEqual({ word: 'rows.via', path: 'roles.0.limits.site_visits.rows.update' });
    expect(WORD_FLOORS['rows.via']).toBe('0.3.35');
    expect(messages(manifest({ floor: '0.3.34' })).some((message) => message.includes('0.3.35'))).toBe(true);
  });

  it('says `by` too, and is the person\'s own or their team\'s, never the rows nobody owns', () => {
    const at = (reach: Doc) => messages(manifest({ roles: [managerOf({ site_visits: { rows: { read: reach } } })] })).join('\n');
    expect(at({ reach: 'team', via: 'deal_id' })).toContain('`via` names the parent whose `by` column judges the row: say `by` too');
    expect(at({ ...BY_DEAL_OWNER, unowned: true })).toContain('takes no `unowned`');
    expect(at({ reach: 'all', via: 'deal_id', by: 'owner_id', while: { column: 'state', in: ['booked'] } })).toContain('`by` narrows the person\'s own rows or their team\'s');
    expect(messages(manifest({ roles: [managerOf({ site_visits: { rows: { read: { reach: 'own', via: 'deal_id', by: 'owner_id' } } } })] }))).toEqual([]);
  });

  it('names a link the table belongs through, and a staff column of the row it points at', () => {
    const at = (reach: Doc) => messages(manifest({ roles: [managerOf({ site_visits: { rows: { read: reach } } })] }));
    expect(at({ reach: 'team', via: 'nowhere', by: 'owner_id' })).toContain('roles.0.limits.site_visits.rows.read.via: "site_visits" has no column "nowhere"');
    expect(at({ reach: 'team', via: 'note', by: 'owner_id' })).toContain('roles.0.limits.site_visits.rows.read.via: "site_visits.note" is not a link to another of the app\'s tables');
    expect(at({ reach: 'team', via: 'deal_id', by: 'boss' })).toContain('roles.0.limits.site_visits.rows.read.by: "deals" has no column "boss"');
    expect(at({ reach: 'team', via: 'deal_id', by: 'name' })).toContain(
      'roles.0.limits.site_visits.rows.read.by: "deals.name" does not hold a staff member (rules.staff): `by` names the column of the parent that says whose the row is',
    );
    // A table with a link to the deal that does not belong through it: no parent's person says whose its rows are.
    const vias = tables({ visits: { belongs: [{ column: 'rep_id', set: 'team' }] } });
    expect(messages(manifest({ tables: vias }))).toContain('roles.0.limits.site_visits.rows.read.via: "site_visits" does not belong through "deal_id": add { "via": "deal_id" } to its "belongs"');
  });

  it('is never a private table\'s reach', () => {
    const priv = tables().map((table) => (table['ref'] === 'site_visits' ? { ...table, private: true } : table));
    expect(messages(manifest({ tables: priv, roles: [managerOf({ site_visits: { rows: { read: { reach: 'own', via: 'deal_id', by: 'owner_id' }, update: { reach: 'own' } } } })] }))).toContain(
      'roles.0.limits.site_visits.rows.read: "site_visits" is private: the role\'s read reaches the person\'s own rows only ({ "reach": "own" })',
    );
  });
});

describe('what a hand-over carries (carries)', () => {
  it('validates, as a word of 0.3.35 found where it is written', () => {
    expect(messages(manifest())).toEqual([]);
    expect(installFloorWords(manifest())).toContainEqual({ word: 'states.carries', path: 'requiredSchema.tables.0.states.actions.0.carries' });
    expect(WORD_FLOORS['states.carries']).toBe('0.3.35');
  });

  it('only on a hand-over that asks for one person, or says which one the rows follow', () => {
    const at = (action: Doc) => messages(manifest({ tables: tables({ action }) })).join('\n');
    expect(at({ handOver: undefined })).toContain('only a hand-over carries child rows: say "handOver": true');
    expect(at({ ask: ['note'] })).toContain('the action asks for no staff column: nobody is handed the row, so nothing is carried');
    expect(at({ carries: [{ ...CARRIES[0], from: 'note' }] })).toContain('"note" is not a staff column the action asks for');
    expect(messages(manifest({ tables: tables({ action: { carries: [{ ...CARRIES[0], from: 'owner_id' }] } }) }))).toEqual([]);
  });

  it('carries a person column of a table that hangs off this one, once, by conditions on its own columns', () => {
    const at = (carry: Doc) => messages(manifest({ tables: tables({ action: { carries: [carry] } }) })).join('\n');
    expect(at({ ...CARRIES[0], table: 'nowhere' })).toContain('"nowhere" is not one of this manifest\'s tables');
    expect(at({ ...CARRIES[0], table: 'deals', via: 'id', column: 'owner_id' })).toContain('a hand-over carries rows of its child tables, not of its own');
    expect(at({ ...CARRIES[0], via: 'rep_id' })).toContain('"site_visits.rep_id" is not a foreign key to "deals"');
    expect(at({ ...CARRIES[0], column: 'note' })).toContain('"site_visits.note" does not hold a staff member (rules.staff): a hand-over moves a person');
    expect(at({ ...CARRIES[0], column: 'missing' })).toContain('"site_visits" has no column "missing"');
    expect(at({ ...CARRIES[0], where: [{ column: 'state', in: ['gone'] }] })).toContain('"gone" is not a value of "site_visits.state"');
    expect(at({ ...CARRIES[0], where: [{ column: 'nope', isNull: true }] })).toContain('"site_visits" has no column "nope"');
    const twice = messages(manifest({ tables: tables({ action: { carries: [CARRIES[0], CARRIES[0]] } }) })).join('\n');
    expect(twice).toContain('"site_visits.rep_id" is carried twice');
    // A shape the validator does not know is refused by the schema: a key left out of a carry would be dropped.
    expect(messages(manifest({ tables: tables({ action: { carries: [{ ...CARRIES[0], also: true }] } }) }))).not.toEqual([]);
  });
});
