// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whose a row is: a staff column, the ways people belong to a table's rows
 * (`belongs`), a private table, and a role whose read, update or delete
 * reaches only some rows (`rows`). One valid manifest with every way in it,
 * then each test breaks one thing and reads the sentence that names it.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, installFloorWords, validateManifest } from '../src/index.js';
import { KIT } from './add-on-kit-fixture.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const staff = (ref: string, nullable = true) => ({ ref, type: 'text', maxLength: 36, nullable, rules: { staff: true } });
const fk = (ref: string, references: string, nullable = false) => ({ ref, type: 'fk', references, nullable });

type Doc = Record<string, unknown>;

function tables(): Doc[] {
  return [
    { ref: 'deals', columns: [id, staff('owner_id'), { ref: 'state', type: 'enum', enum: ['open', 'won', 'lost'] }], belongs: [{ column: 'owner_id', set: 'team' }, { through: { table: 'deal_members', link: 'deal_id', user: 'user_id' } }, { through: { table: 'covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', from: 'starts_on', to: 'ends_on' } }] },
    { ref: 'deal_members', columns: [id, fk('deal_id', 'deals'), staff('user_id', false)] },
    { ref: 'covers', columns: [id, staff('owner_id', false), staff('cover_id', false), { ref: 'starts_on', type: 'date' }, { ref: 'ends_on', type: 'date', nullable: true }] },
    { ref: 'quotes', columns: [id, fk('deal_id', 'deals')], belongs: [{ via: 'deal_id' }] },
    { ref: 'quote_lines', columns: [id, fk('quote_id', 'quotes')], belongs: [{ via: 'quote_id' }] },
    { ref: 'crews', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] },
    { ref: 'crew_members', columns: [id, fk('crew_id', 'crews'), staff('user_id', false)] },
    { ref: 'deliveries', columns: [id, fk('crew_id', 'crews', true)], belongs: [{ through: { table: 'crew_members', link: 'crew_id', on: 'crew_id', user: 'user_id' } }] },
    { ref: 'agents', columns: [id, staff('user_id')] },
    { ref: 'tickets', columns: [id, fk('assignee_id', 'agents', true)], belongs: [{ column: 'assignee_id', person: 'user_id', set: 'anyone' }] },
    { ref: 'one_to_ones', columns: [id, staff('manager_id', false), staff('rep_id', false), { ref: 'note', type: 'text', maxLength: 400 }], belongs: [{ column: 'manager_id' }, { column: 'rep_id', set: 'team' }], private: true },
  ];
}

const own = { reach: 'own' };
const rep = {
  key: 'rep',
  name: 'Sales rep',
  permissions: ['table:@deals:read', 'table:@deals:create', 'table:@deals:update', 'table:@quotes:read', 'table:@tickets:read', 'table:@one_to_ones:read', 'table:@one_to_ones:create', 'table:@one_to_ones:update'],
  limits: {
    deals: { rows: { read: own, update: own } },
    quotes: { rows: { read: own } },
    tickets: { rows: { read: { reach: 'own', unowned: true } } },
    one_to_ones: { rows: { read: own, update: own } },
  },
};
const manager = {
  key: 'manager',
  name: 'Sales manager',
  permissions: ['table:@deals:read', 'table:@deals:update', 'table:@deals:delete'],
  limits: { deals: { rows: { read: { reach: 'team' }, update: { reach: 'team' }, delete: { reach: 'team', while: { column: 'state', in: ['lost'] } } } } },
};
const accounts = {
  key: 'accounts',
  name: 'Account manager',
  permissions: ['table:@deals:read'],
  limits: { deals: { rows: { read: { reach: 'all', while: { column: 'state', in: ['won'] } } } } },
};

function manifest(over: { tables?: Doc[]; roles?: unknown[]; floor?: string; extra?: Doc } = {}): Doc {
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
    compatibility: { minAdminiumVersion: over.floor ?? '0.3.27' },
    requiredSchema: { tables: over.tables ?? tables() },
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    roles: over.roles ?? [rep, manager, accounts],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    ...(over.extra ?? {}),
  };
}

const messages = (document: Doc): string[] => {
  const result = validateManifest(document);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

/** The tables with one of them changed. */
const withTable = (ref: string, change: (table: Doc) => Doc): Doc[] => tables().map((table) => (table['ref'] === ref ? change(table) : table));

describe('whose a row is', () => {
  it('validates with every way in it: a column, a person’s row, a listing with dates, a parent two links up, a private pair', () => {
    expect(messages(manifest())).toEqual([]);
  });

  it('is four words of 0.3.27, each found where it is written', () => {
    const words = installFloorWords(manifest()).filter((found) => ['column.staff', 'table.belongs', 'table.private', 'roles.rows'].includes(found.word));
    expect(words).toContainEqual({ word: 'column.staff', path: 'requiredSchema.tables.0.columns.1.rules.staff' });
    expect(words).toContainEqual({ word: 'table.belongs', path: 'requiredSchema.tables.0.belongs' });
    expect(words).toContainEqual({ word: 'table.private', path: 'requiredSchema.tables.10.private' });
    expect(words).toContainEqual({ word: 'roles.rows', path: 'roles.0.limits.deals.rows' });
    for (const word of ['column.staff', 'table.belongs', 'table.private', 'roles.rows'] as const) expect(WORD_FLOORS[word]).toBe('0.3.27');
    // An older floor is told which release reads them.
    expect(messages(manifest({ floor: '0.3.26' })).some((message) => message.includes('0.3.27'))).toBe(true);
    // A grant on an add-on's table carries the word too.
    const grant = { ...accounts, tables: [{ addOn: 'invoices', table: 'invoices', actions: ['read'], limit: { rows: { read: { reach: 'all', while: { column: 'status', in: ['sent'] } } } } }] };
    expect(installFloorWords(manifest({ roles: [grant] }))).toContainEqual({ word: 'roles.rows', path: 'roles.0.tables.0.limit.rows' });
  });

  it('a record\'s button may be marked as a hand-over: a fifth word, on a button that writes', () => {
    const states = (actions: unknown[]) => ({ column: 'state', initial: 'open', moves: { open: ['won', 'lost'] }, actions });
    const give = { id: 'give', label: 'Hand over', set: {}, in: ['open'], ask: ['owner_id'], handOver: true };
    const withActions = (actions: unknown[]) => manifest({ tables: withTable('deals', (table) => ({ ...table, states: states(actions) })) });
    expect(messages(withActions([give]))).toEqual([]);
    expect(messages(withActions([{ id: 'win', label: 'Won', move: { to: 'won' }, ask: ['owner_id'], handOver: true }]))).toEqual([]);
    expect(installFloorWords(withActions([{ id: 'win', label: 'Won', move: { to: 'won' } }, give]))).toContainEqual({ word: 'states.handOver', path: 'requiredSchema.tables.0.states.actions.1.handOver' });
    expect(WORD_FLOORS['states.handOver']).toBe('0.3.27');
    // Only `true`, and only on a button that writes the row: a link to a page hands nothing over.
    expect(messages(withActions([{ ...give, handOver: false }]))).not.toEqual([]);
    expect(messages(withActions([{ id: 'open', label: 'Open', link: { page: 'crm-deals', param: 'deal' }, in: ['open'], handOver: true }]))).not.toEqual([]);
  });

  it('keeps a staff member in a text column only', () => {
    const broken = withTable('agents', (table) => ({ ...table, columns: [id, { ref: 'user_id', type: 'int', nullable: true, rules: { staff: true } }] }));
    expect(messages(manifest({ tables: broken }))).toContain('requiredSchema.tables.8.columns.1.rules.staff: a staff member is kept in a text column');
  });
});

describe('belongs', () => {
  it('reads a person from a staff column, or from the row a link points at', () => {
    expect(messages(manifest({ tables: withTable('deals', (table) => ({ ...table, belongs: [{ column: 'state' }] })) }))).toContain(
      'requiredSchema.tables.0.belongs.0.column: "deals.state" does not hold a staff member: mark it (rules.staff), or say which column of the row it links to does (person)',
    );
    expect(messages(manifest({ tables: withTable('deals', (table) => ({ ...table, belongs: [{ column: 'boss' }] })) }))).toContain('requiredSchema.tables.0.belongs.0.column: "deals" has no column "boss"');
    expect(messages(manifest({ tables: withTable('tickets', (table) => ({ ...table, belongs: [{ column: 'assignee_id', person: 'id' }] })) }))).toContain(
      'requiredSchema.tables.9.belongs.0.person: "agents.id" does not hold a staff member (rules.staff)',
    );
    expect(messages(manifest({ tables: withTable('tickets', (table) => ({ ...table, belongs: [{ column: 'assignee_id', person: 'nobody' }] })) }))).toContain(
      'requiredSchema.tables.9.belongs.0.person: "agents" has no column "nobody"',
    );
    expect(messages(manifest({ tables: withTable('agents', (table) => ({ ...table, belongs: [{ column: 'user_id', person: 'user_id' }] })) }))).toContain(
      'requiredSchema.tables.8.belongs.0.column: "agents.user_id" is not a link, so there is no row to read "user_id" from',
    );
  });

  it('reads a listing from a table of the app whose link holds the row’s key, or the column it names', () => {
    const through = (over: Doc) => withTable('deals', (table) => ({ ...table, belongs: [{ through: { table: 'deal_members', link: 'deal_id', user: 'user_id', ...over } }] }));
    expect(messages(manifest({ tables: through({ table: 'helpers' }) }))).toContain('requiredSchema.tables.0.belongs.0.through.table: "helpers" is not a table of this manifest');
    expect(messages(manifest({ tables: through({ link: 'deal' }) }))).toContain('requiredSchema.tables.0.belongs.0.through.link: "deal_members" has no column "deal"');
    expect(messages(manifest({ tables: through({ link: 'user_id' }) }))).toContain(
      'requiredSchema.tables.0.belongs.0.through.link: "deal_members.user_id" is not a link to "deals": name the column of "deals" it matches (on)',
    );
    expect(messages(manifest({ tables: through({ on: 'owner' }) }))).toContain('requiredSchema.tables.0.belongs.0.through.on: "deals" has no column "owner"');
    expect(messages(manifest({ tables: through({ user: 'deal_id' }) }))).toContain(
      'requiredSchema.tables.0.belongs.0.through.user: "deal_members.deal_id" does not hold a staff member: mark it (rules.staff), or say which column of the row it links to does (person)',
    );
    expect(messages(manifest({ tables: through({ from: 'deal_id' }) }))).toContain('requiredSchema.tables.0.belongs.0.through.from: "deal_members.deal_id" is not a date');
    expect(messages(manifest({ tables: through({ to: 'until' }) }))).toContain('requiredSchema.tables.0.belongs.0.through.to: "deal_members" has no column "until"');
    expect(messages(manifest({ tables: withTable('deals', (table) => ({ ...table, belongs: [{ through: { table: 'deals', link: 'id', on: 'id', user: 'owner_id' } }] })) }))).toContain(
      'requiredSchema.tables.0.belongs.0.through.table: a table does not list the people of its own rows: use a column',
    );
  });

  it('follows a link to a table people belong to, two links at most, and never in a ring', () => {
    expect(messages(manifest({ tables: withTable('quotes', (table) => ({ ...table, belongs: [{ via: 'id' }] })) }))).toContain(
      'requiredSchema.tables.3.belongs.0.via: "quotes.id" is not a link to a table of this manifest',
    );
    expect(messages(manifest({ tables: withTable('deliveries', (table) => ({ ...table, belongs: [{ via: 'crew_id' }] })) }))).toContain(
      'requiredSchema.tables.7.belongs.0.via: "crews" does not say how people belong to its rows: give it "belongs"',
    );
    // A third link: a part of a quote line.
    const deep = [...tables(), { ref: 'line_parts', columns: [id, fk('line_id', 'quote_lines')], belongs: [{ via: 'line_id' }] }];
    expect(messages(manifest({ tables: deep }))).toContain('requiredSchema.tables.11.belongs.0.via: a row is reached through at most 2 links');
    // A ring: deals through quotes, quotes through deals.
    const ring = withTable('deals', (table) => ({ ...table, columns: [...(table['columns'] as unknown[]), fk('quote_id', 'quotes', true)], belongs: [{ via: 'quote_id' }] }));
    expect(messages(manifest({ tables: ring, roles: [] })).filter((message) => message.includes('which is reached through'))).not.toEqual([]);
  });
});

describe('a role’s rows', () => {
  const only = (limits: Doc, permissions = rep.permissions) => messages(manifest({ roles: [{ ...rep, permissions, limits }] }));

  it('limit an action the role grants, on a table that says whose its rows are', () => {
    expect(only({ deals: { rows: { delete: own } } })).toContain('roles.0.limits.deals.rows.delete: the role does not grant table:@deals:delete, so there is nothing to limit');
    expect(only({ crews: { rows: { read: own } } }, [...rep.permissions, 'table:@crews:read'])).toContain(
      'roles.0.limits.crews.rows.read.reach: "crews" does not say how people belong to its rows: give the table "belongs"',
    );
    // Every row while a value holds needs no owner at all.
    expect(only({ crews: { rows: { read: { reach: 'all', while: { column: 'name', in: ['North'] } } } } }, [...rep.permissions, 'table:@crews:read']).filter((message) => message.includes('crews'))).toEqual([]);
  });

  it('name a column and values the table has', () => {
    expect(only({ deals: { rows: { read: { reach: 'own', while: { column: 'stage', in: ['open'] } } } } })).toContain('roles.0.limits.deals.rows.read.while.column: "deals" has no column "stage"');
    expect(only({ deals: { rows: { read: { reach: 'own', while: { column: 'state', in: ['gone'] } } } } })).toContain('roles.0.limits.deals.rows.read.while.in: "gone" is not a value of "deals.state"');
  });

  it('refuse "every row" with nothing to narrow it, and an empty limit', () => {
    expect(only({ deals: { rows: { read: { reach: 'all' } } } }).some((message) => message.includes('a reach of every row is no limit'))).toBe(true);
    expect(only({ deals: { rows: { read: { reach: 'all', unowned: true, while: { column: 'state', in: ['won'] } } } } }).some((message) => message.includes('every row includes the rows nobody owns'))).toBe(true);
    expect(only({ deals: { rows: {} } }).some((message) => message.includes('name the action whose rows are limited'))).toBe(true);
    expect(only({ deals: { rows: { read: { reach: 'mine' } } } })).not.toEqual([]);
  });

  it('on an add-on’s table are limited by a value only', () => {
    const grant = (limit: Doc) => ({ ...accounts, tables: [{ addOn: 'invoices', table: 'invoices', actions: ['read'], limit }] });
    const named = { addOns: { requires: [{ key: 'invoices', range: '>=1.0.8', reason: { 'en-US': 'Prints quotes.' } }] } };
    const said = (limit: Doc) => messages(manifest({ roles: [grant(limit)], extra: named })).filter((message) => message.startsWith('roles.0.tables'));
    expect(said({ rows: { read: { reach: 'all', while: { column: 'status', in: ['sent'] } } } })).toEqual([]);
    expect(said({ rows: { read: own } })).toEqual(['roles.0.tables.0.limit.rows.read.reach: an add-on\'s table does not say how people belong to its rows: limit it by a value ({ "reach": "all", "while": … })']);
    expect(said({ rows: { update: { reach: 'all', while: { column: 'status', in: ['sent'] } } } })).toEqual(['roles.0.tables.0.limit.rows.update: the grant has no "update", so there is nothing for its rows to limit']);
  });
});

describe('a screen anyone can walk up to (a staff-bound key)', () => {
  const floor = { key: 'floor', name: 'Shop floor', screensOnly: true, permissions: ['app:@:staff'] };
  const screen = (limits?: Doc) => manifest({
    roles: [rep, manager, accounts, limits === undefined ? floor : { ...floor, limits }],
    extra: { publicKeys: { kiosk: { requiresStaff: { role: 'floor' } } }, publicAccess: [{ key: 'kiosk', table: 'deliveries', methods: ['GET'], select: ['id'] }] },
  });
  const said = 'publicAccess.0.table: "kiosk" shows "deliveries" to everybody signed in as "floor", and that role reaches only some of its rows: a screen\'s key is not held to a person\'s rows, so give the table one or the other';

  it('is not bound to a role that reaches only some rows of a table it shows', () => {
    expect(messages(screen({ deliveries: { rows: { read: own } } })).join(' || ')).toContain(said);
  });

  it('shows a table its role does not limit by rows, whatever other roles do', () => {
    expect(messages(screen()).filter((message) => message.includes('a screen\'s key is not held'))).toEqual([]);
  });
});

describe('a private table', () => {
  it('says whose its rows are, by its own staff columns', () => {
    expect(messages(manifest({ tables: withTable('one_to_ones', ({ belongs: _gone, ...table }) => table) }))).toContain('requiredSchema.tables.10.private: a private table says whose its rows are: give it "belongs"');
    const through = withTable('one_to_ones', (table) => ({ ...table, belongs: [{ column: 'manager_id' }, { through: { table: 'deal_members', link: 'deal_id', on: 'id', user: 'user_id' } }] }));
    expect(messages(manifest({ tables: through }))).toContain('requiredSchema.tables.10.belongs.1: a private table is reached by its own staff columns only');
  });

  it('is held by no role beyond the person’s own rows, and is not exported', () => {
    const wide = { ...rep, limits: { ...rep.limits, one_to_ones: { rows: { read: { reach: 'team' }, update: own } } } };
    expect(messages(manifest({ roles: [wide] }))).toContain('roles.0.limits.one_to_ones.rows.read: "one_to_ones" is private: the role\'s read reaches the person\'s own rows only ({ "reach": "own" })');
    const bare = { ...rep, limits: { deals: rep.limits.deals, quotes: rep.limits.quotes, tickets: rep.limits.tickets } };
    expect(messages(manifest({ roles: [bare] })).filter((message) => message.includes('is private'))).toHaveLength(2);
    const exporter = { ...rep, permissions: [...rep.permissions, 'table:@one_to_ones:export'] };
    expect(messages(manifest({ roles: [exporter] }))).toContain('roles.0.permissions: "one_to_ones" is private: it is not exported (table:@one_to_ones:export)');
    // A clone of a role is held to it too, and carries the limit it clones.
    expect(messages(manifest({ roles: [rep, { key: 'junior', name: 'Junior', cloneFrom: 'rep' }] }))).toEqual([]);
  });

  it('is named by no rule, public entry, document or mail, and no other table is reached through it', () => {
    const rule = {
      automations: [
        {
          key: 'told',
          name: 'Told',
          enabled: true,
          trigger: { kind: 'record', event: 'created', table: 'one_to_ones' },
          graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 't' }, { id: 'n', kind: 'action', title: 'n', action: { kind: 'notification', to: { roles: ['manager'] }, title: 'A one-to-one' } }] },
        },
      ],
    };
    expect(messages(manifest({ extra: rule })).some((message) => message.includes('"one_to_ones" is private: only the people its rows belong to read it, so no automations entry names it'))).toBe(true);
    const child = [...tables(), { ref: 'actions', columns: [id, fk('meeting_id', 'one_to_ones')], belongs: [{ via: 'meeting_id' }] }];
    expect(messages(manifest({ tables: child }))).toContain('requiredSchema.tables.11.belongs.0.via: "one_to_ones" is private: no other table\'s rows are reached through it');
  });
});

describe('an add-on', () => {
  it('does not say whose its rows are yet', () => {
    const kit = structuredClone(KIT) as unknown as Record<string, unknown>;
    const result = validateManifest({
      ...kit,
      compatibility: { minAdminiumVersion: '0.3.27' },
      requiredSchema: { prefixed: true, tables: [...KIT.requiredSchema.tables, { ref: 'notes', columns: [id, staff('owner_id')], belongs: [{ column: 'owner_id' }], private: true }] },
    });
    const said = result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
    expect(said).toContain('requiredSchema.tables.1.belongs: "belongs" is not read on an add-on\'s table yet');
    expect(said).toContain('requiredSchema.tables.1.private: "private" is not read on an add-on\'s table yet');
    expect(said).toContain('requiredSchema.tables.1.columns.1.rules.staff: a staff column is not read on an add-on\'s table yet');
  });
});
