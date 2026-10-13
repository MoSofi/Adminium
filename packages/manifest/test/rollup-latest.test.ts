// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `rollup.latest`: a column that holds the newest child row's value (a deal's
 * amount from its last sent quote), in place of a sum or a count. What the
 * manifest accepts of it, and what it refuses.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

type Change = (tables: { deals: Record<string, any>[]; quotes: Record<string, any>[] }) => void;

function crm(change: Change = () => {}, floor = '0.3.28'): Record<string, unknown> {
  const deals: Record<string, any>[] = [
    id,
    { ref: 'quoted', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'quotes', via: 'deal_id', latest: { of: 'total', by: 'sent_at', row: 'quote_id' } } } },
    { ref: 'quote_id', type: 'int', nullable: true },
    { ref: 'fee', type: 'decimal', scale: 2, default: 0 },
    { ref: 'left', type: 'decimal', scale: 2, default: 0 },
    { ref: 'may', type: 'bool', default: false },
  ];
  const quotes: Record<string, any>[] = [
    id,
    { ref: 'deal_id', type: 'fk', references: 'deals' },
    { ref: 'total', type: 'decimal', scale: 2, default: 0 },
    { ref: 'label', type: 'text', maxLength: 40, nullable: true },
    { ref: 'sent_at', type: 'timestamptz', nullable: true },
  ];
  change({ deals, quotes });
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A CRM' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: { prefixed: true, tables: [{ ref: 'deals', columns: deals }, { ref: 'quotes', columns: quotes }] },
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const said = (manifest: Record<string, unknown>): string[] => {
  const result = validateManifest(manifest);
  return result.ok ? [] : result.issues.map((issue) => issue.message);
};
const rollupOf = (deals: Record<string, any>[]): Record<string, any> => deals[1]!['rules']['rollup'];

describe('the newest row\'s value (rollup.latest)', () => {
  it('is accepted: the value, and the key of the row it came from', () => {
    expect(said(crm())).toEqual([]);
  });

  it('is accepted without a column for the row\'s key, and by a date or a number', () => {
    expect(said(crm(({ deals }) => delete rollupOf(deals)['latest']['row']))).toEqual([]);
    expect(said(crm(({ quotes }) => (quotes[4]!['type'] = 'date')))).toEqual([]);
    expect(said(crm(({ quotes }) => (quotes[4]!['type'] = 'int')))).toEqual([]);
  });

  it('needs the floor that first reads it', () => {
    expect(said(crm(() => {}, '0.3.26')).join('\n')).toMatch(/0\.3\.27/);
  });

  it('is one of three: not beside a sum or a count', () => {
    expect(said(crm(({ deals }) => (rollupOf(deals)['sum'] = 'total'))).join('\n')).toMatch(/one of the three/);
    expect(said(crm(({ deals }) => (rollupOf(deals)['count'] = true))).join('\n')).toMatch(/one of the three/);
    expect(said(crm(({ deals }) => delete rollupOf(deals)['latest'])).join('\n')).toMatch(/one of the three/);
  });

  it('takes nothing a total takes: no times, balance or cap', () => {
    expect(said(crm(({ deals }) => (rollupOf(deals)['times'] = 'total'))).join('\n')).toMatch(/takes no `times`, `balance` or `cap`/);
    expect(said(crm(({ deals }) => (rollupOf(deals)['balance'] = { column: 'left', of: 'fee' }))).join('\n')).toMatch(/takes no `times`, `balance` or `cap`/);
    expect(said(crm(({ deals }) => Object.assign(rollupOf(deals), { cap: true, capUnless: { column: 'may' } }))).join('\n')).toMatch(/takes no `times`, `balance` or `cap`/);
  });

  it('reads columns the child has: a value of the column\'s own type, told apart by a date, a time or a number', () => {
    expect(said(crm(({ deals }) => (rollupOf(deals)['latest']['of'] = 'nope'))).join('\n')).toMatch(/"quotes" has no column "nope"/);
    expect(said(crm(({ deals }) => (rollupOf(deals)['latest']['by'] = 'nope'))).join('\n')).toMatch(/"quotes" has no column "nope"/);
    expect(said(crm(({ deals }) => (rollupOf(deals)['latest']['of'] = 'label'))).join('\n')).toMatch(/kept in a column of its own type/);
    expect(said(crm(({ deals }) => (rollupOf(deals)['latest']['by'] = 'label'))).join('\n')).toMatch(/told by a date, a time or a number/);
  });

  it('is empty while no row qualifies: the column, and the key beside it, are nullable', () => {
    expect(said(crm(({ deals }) => delete deals[1]!['nullable'])).join('\n')).toMatch(/"deals\.quoted" is empty while no row qualifies/);
    expect(said(crm(({ deals }) => delete deals[2]!['nullable'])).join('\n')).toMatch(/"deals\.quote_id" is empty while no row qualifies/);
  });

  it('keeps the row\'s key in a column of this table that nothing else decides', () => {
    expect(said(crm(({ deals }) => (rollupOf(deals)['latest']['row'] = 'nope'))).join('\n')).toMatch(/"deals" has no column "nope"/);
    expect(said(crm(({ deals }) => (rollupOf(deals)['latest']['row'] = 'quoted'))).join('\n')).toMatch(/kept in a column of its own/);
    expect(said(crm(({ deals }) => (deals[2]!['rules'] = { stamp: { set: 'now', on: 'create' } }))).join('\n')).toMatch(/takes no rules of its own/);
    expect(said(crm(({ deals }) => (rollupOf(deals)['latest']['row'] = 'may'))).join('\n')).toMatch(/holds a key of "quotes"/);
  });

  it('holds that column to the key it names: a whole number is no place for a uuid, and a table with no one-column key names no row', () => {
    // The quotes are keyed by a uuid, and the deal keeps a whole number: every write of the total would be refused by the database.
    const uuidKey = ({ quotes }: { quotes: Record<string, any>[] }) => (quotes[0] = { ref: 'id', type: 'uuid', role: 'pk' });
    expect(said(crm(uuidKey)).join('\n')).toMatch(/"deals\.quote_id" is int and the key of "quotes" is uuid/);
    expect(said(crm((tables) => { uuidKey(tables); tables.deals[2] = { ref: 'quote_id', type: 'uuid', nullable: true }; }))).toEqual([]);
    // A whole number of either width holds a whole-number key.
    expect(said(crm(({ deals }) => (deals[2] = { ref: 'quote_id', type: 'bigint', nullable: true })))).toEqual([]);
    expect(said(crm(({ deals }) => (deals[2] = { ref: 'quote_id', type: 'text', maxLength: 40, nullable: true }))).join('\n')).toMatch(/is text and the key of "quotes" is int/);
    // No key of one column: there is nothing to keep.
    expect(said(crm(({ quotes }) => (quotes[0] = { ref: 'id', type: 'int' }))).join('\n')).toMatch(/"quotes" has no key of one column/);
  });

  it('keeps that key as a plain column, never a link: a link would stop the row it names being deleted', () => {
    expect(said(crm(({ deals }) => (deals[2] = { ref: 'quote_id', type: 'fk', references: 'quotes', nullable: true }))).join('\n')).toMatch(/is a link: the key of the row Adminium took is kept as a plain column/);
  });
});
