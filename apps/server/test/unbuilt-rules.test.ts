// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule a manifest may declare before the server keeps it: the table takes
 * no creates or changes (501 `RULE_NOT_BUILT`), and a public entry using one
 * serves nothing.
 */
import { describe, expect, it } from 'vitest';

import type { EffectiveTable } from '../src/connections/effective-schema.js';
import {
  RuleNotBuiltError,
  UNBUILT_ENTRY_RULES,
  UNBUILT_MANIFEST_WORDS,
  UNBUILT_TABLE_RULES,
  refuseUnbuiltManifest,
  refuseUnbuiltTable,
  unbuiltEntryRuleOf,
  unbuiltInManifest,
  unbuiltRuleOf,
  type UnbuiltEntryRule,
  type UnbuiltTableRule,
} from '../src/crud/unbuilt-rules.js';
import { APP_VERSION } from '../src/version.js';

const table = (extra: Record<string, unknown>) => ({ id: 'main.orders', name: 'orders', columns: [], ...extra }) as unknown as EffectiveTable;
const RULES: UnbuiltTableRule[] = [
  { rule: 'capacity.kind', on: (t) => (t as unknown as { capacity?: { kind?: string } }).capacity?.kind === 'parent' },
  { rule: 'states.timed', on: (t) => (t as unknown as { states?: { timed?: unknown } }).states?.timed !== undefined },
];

describe('a table carrying a rule not built yet', () => {
  it('names the first such rule, and nothing for a table without one', () => {
    expect(unbuiltRuleOf(table({ capacity: { kind: 'parent' }, states: { timed: [] } }), RULES)).toBe('capacity.kind');
    expect(unbuiltRuleOf(table({ states: { timed: [] } }), RULES)).toBe('states.timed');
    expect(unbuiltRuleOf(table({ capacity: { kind: 'slot' } }), RULES)).toBeNull();
    expect(unbuiltRuleOf(undefined, RULES)).toBeNull();
  });

  it('is refused with 501 RULE_NOT_BUILT naming the table and the rule', () => {
    const target = { table: { id: 'main.orders', table: table({ capacity: { kind: 'parent' } }) } };
    expect(() => refuseUnbuiltTable(target, RULES)).toThrow(RuleNotBuiltError);
    try {
      refuseUnbuiltTable(target, RULES);
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 501, code: 'RULE_NOT_BUILT', details: { table: 'main.orders', rule: 'capacity.kind' } });
    }
    expect(() => refuseUnbuiltTable({ table: { id: 'main.orders', table: table({}) } }, RULES)).not.toThrow();
  });
});

describe('a public entry carrying a rule not built yet', () => {
  const ENTRY: UnbuiltEntryRule[] = [{ rule: 'unlock_by', on: (entry) => entry['unlock_by'] !== undefined }];
  it('names the rule, and nothing for a plain entry', () => {
    expect(unbuiltEntryRuleOf({ source: 'ticket_types', unlock_by: { column: 'code' } }, ENTRY)).toBe('unlock_by');
    expect(unbuiltEntryRuleOf({ source: 'ticket_types' }, ENTRY)).toBeNull();
  });
});

describe('the entries this server does not run yet', () => {
  it('serves a window read from moments, a list of values and a window in minutes alike', () => {
    expect(unbuiltEntryRuleOf({ writable_when: { starts_at: { after: { minus: { hours: 2 } } } } })).toBeNull();
    expect(unbuiltEntryRuleOf({ writable_when: { status: ['booked', 'held'], starts_at: { within: 30 } } })).toBeNull();
    expect(unbuiltEntryRuleOf({ writable_when: { paid_at: [null], starts_at: 'from-now' } })).toBeNull();
    // A create with its child rows, its checks, a dry run, a price check and a retry key run now.
    expect(unbuiltEntryRuleOf({ source: 'tickets', children: {}, agrees: [], dry_run: true, expect: 'total', client_key: 'client_key' })).toBeNull();
    // A person found by address, the new row's own link, and a read for a session alone run now.
    expect(unbuiltEntryRuleOf({ source: 'tickets', children: {}, find_or_create: { identity_ref: 'customers' } })).toBeNull();
    expect(unbuiltEntryRuleOf({ source: 'orders', share_link: { column: 'link_token', key: 'link' } })).toBeNull();
    expect(unbuiltEntryRuleOf({ source: 'settings', session_only: true })).toBeNull();
    // A ticket sent on to a friend: the change's limits and what its holder alone reads run now.
    expect(unbuiltEntryRuleOf({ source: 'tickets', withhold: { columns: ['code'], unless_holder: 'holder_customer_id' } })).toBeNull();
    expect(unbuiltEntryRuleOf({ source: 'tickets', limits: { per_value: { columns: ['pending_email'], n: 5 } } })).toBeNull();
    expect(unbuiltEntryRuleOf({ source: 'tickets' })).toBeNull();
  });
});

describe('a manifest that uses a word this server does not run yet', () => {
  const ADD_ON = {
    kind: 'add-on',
    key: 'kit',
    pages: [{ ref: 'kit-items' }],
    roles: [],
    requiredSchema: { prefixed: true, tables: [{ ref: 'items', indexes: [['name']], columns: [{ ref: 'link', rules: { tableRef: true } }] }] },
  };
  const APP = {
    kind: 'app',
    key: 'shop',
    pages: [{ ref: 'orders' }],
    roles: [],
    requiredSchema: { prefixed: true, tables: [{ ref: 'lines', columns: [{ ref: 'item_id', rules: { addOnLink: { addOn: 'kit', table: 'items' } } }] }] },
    publicAccess: [{ table: 'lines', methods: ['GET'], unlockBy: { header: true, column: 'code', self: true } }],
  };

  it('names each word, where it is written and the release that runs it', () => {
    expect(unbuiltInManifest(ADD_ON)).toEqual([
      { word: 'pages', path: 'pages', release: '0.3.18' },
      { word: 'roles', path: 'roles', release: '0.3.18' },
      { word: 'requiredSchema.prefixed', path: 'requiredSchema.prefixed', release: '0.3.18' },
      { word: 'table.indexes', path: 'requiredSchema.tables.0.indexes', release: '0.3.18' },
      { word: 'column.tableRef', path: 'requiredSchema.tables.0.columns.0.rules.tableRef', release: '0.3.18' },
    ]);
  });

  it('an app\'s own pages, roles and prefix are no such word; its link into an add-on is', () => {
    expect(unbuiltInManifest(APP).map((found) => found.word)).toEqual(['column.addOnLink', 'unlockBy.self']);
    expect(unbuiltInManifest({ ...APP, requiredSchema: { tables: [] }, publicAccess: [] })).toEqual([]);
  });

  it('is refused whole, with the release to move to', () => {
    expect(() => refuseUnbuiltManifest(APP, '"shop"', '0.3.17')).toThrowError(
      '"shop" uses "column.addOnLink", "unlockBy.self", which Adminium 0.3.18 runs and this Adminium 0.3.17 does not. Take them out, or move to Adminium 0.3.18.',
    );
    try {
      refuseUnbuiltManifest(APP, '"shop"', '0.3.17');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED', details: { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: '0.3.18', serverVersion: '0.3.17' } });
      expect((error as { details: { words: unknown[] } }).details.words).toHaveLength(2);
    }
    // A word built since is let through: the list is the only thing that refuses.
    expect(() => refuseUnbuiltManifest(APP, '"shop"', '0.3.18', {})).not.toThrow();
  });

  it('a self-unlock stored by hand serves nothing either', () => {
    expect(unbuiltEntryRuleOf({ source: 'cards', unlock_by: { table: 'cards', column: 'code', link: 'id', self: true } })).toBe('unlock_by.self');
    expect(unbuiltEntryRuleOf({ source: 'ticket_types', unlock_by: { table: 'codes', column: 'code', link: 'type_id' } })).toBeNull();
  });
});

describe('a release', () => {
  /** Numeric order of two versions; a pre-release sorts before its release. */
  const before = (a: string, b: string): boolean => {
    const [coreA, preA] = a.split('-');
    const [coreB, preB] = b.split('-');
    const order = (coreA as string).localeCompare(coreB as string, undefined, { numeric: true });
    return order !== 0 ? order < 0 : preA !== undefined && preB === undefined;
  };

  it('ships with every word it says it runs: none of the words not run yet names this version or an earlier one', () => {
    const due = Object.entries(UNBUILT_MANIFEST_WORDS).filter(([, release]) => !before(APP_VERSION, release));
    expect(due).toEqual([]);
  });

  it('refuses, table by table, exactly the rules listed here: each leaves in the change that builds it', () => {
    expect(UNBUILT_TABLE_RULES.map((rule) => rule.rule)).toEqual(['postings', 'states.planned', 'column.addOnLink', 'rollup.capUnless', 'column.announce', 'column.tableRef', 'adjust']);
    expect(UNBUILT_ENTRY_RULES.map((rule) => rule.rule)).toEqual(['unlock_by.self']);
  });

  it('every table rule refused has a word that refuses its manifest too', () => {
    const words = Object.keys(UNBUILT_MANIFEST_WORDS);
    expect(words).toEqual(expect.arrayContaining(['table.postings', 'states.planned', 'column.addOnLink', 'rollup.capUnless', 'column.announce', 'column.tableRef', 'table.adjust']));
  });
});

describe('a table that carries one of the new rules', () => {
  const column = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra });
  const carrying = (extra: Record<string, unknown>) => unbuiltRuleOf(table(extra));

  it('takes no writes: a posting, a planned move, a link into an add-on, an announced total, a stored table name', () => {
    expect(carrying({ postings: [{ id: 'line' }] })).toBe('postings');
    expect(carrying({ states: { column: 'status', initial: 'draft', moves: { draft: [{ to: 'filed', planned: true }] } } })).toBe('states.planned');
    expect(carrying({ columns: [column('item_id', { addOnLink: { addOn: 'kit', table: 'items', tableId: null, key: null } })] })).toBe('column.addOnLink');
    expect(carrying({ columns: [column('item_id', { addOnLookup: { from: 'typed', table: { addOn: 'kit', table: 'items' }, column: 'code' } })] })).toBe('column.addOnLink');
    expect(carrying({ columns: [column('low', { announce: true })] })).toBe('column.announce');
    expect(carrying({ columns: [column('source_table', { tableRef: true })] })).toBe('column.tableRef');
    expect(carrying({ states: { column: 'status', initial: 'draft', moves: { draft: ['sent', { to: 'done' }] } }, columns: [column('name')] })).toBeNull();
  });

  it('a target built by hand, with no columns at all, carries none of them', () => {
    const bare = { id: 'main.orders', name: 'orders' } as unknown as EffectiveTable;
    expect(unbuiltRuleOf(bare)).toBeNull();
    expect(unbuiltRuleOf(bare, undefined, { tables: [bare], relations: [] })).toBeNull();
    expect(() => refuseUnbuiltTable({ table: { id: 'main.orders', table: bare } })).not.toThrow();
  });

  it('a cap lifted for some rows stops the parent and the child whose rows it judges', () => {
    const parent = table({ id: 'main.accounts', columns: [column('taken', { rollup: { from: 'main.entries', via: 'account_id', sum: 'amount', cap: true, capUnless: { column: 'allow_below' } } })] });
    const child = table({ id: 'main.entries' });
    const other = table({ id: 'main.notes' });
    const model = { tables: [parent, child, other], relations: [] };
    expect(unbuiltRuleOf(parent, undefined, model)).toBe('rollup.capUnless');
    expect(unbuiltRuleOf(child, undefined, model)).toBe('rollup.capUnless');
    expect(unbuiltRuleOf(other, undefined, model)).toBeNull();
  });
});
