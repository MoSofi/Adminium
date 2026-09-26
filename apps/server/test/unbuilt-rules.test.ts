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
  refuseUnbuiltTable,
  unbuiltEntryRuleOf,
  unbuiltRuleOf,
  type UnbuiltEntryRule,
  type UnbuiltTableRule,
} from '../src/crud/unbuilt-rules.js';

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
  it('knows a window read from moments, and not a list of values or a window in minutes', () => {
    expect(unbuiltEntryRuleOf({ writable_when: { starts_at: { after: { minus: { hours: 2 } } } } })).toBe('writable_when');
    expect(unbuiltEntryRuleOf({ writable_when: { status: ['booked', 'held'], starts_at: { within: 30 } } })).toBeNull();
    expect(unbuiltEntryRuleOf({ writable_when: { paid_at: [null], starts_at: 'from-now' } })).toBeNull();
    expect(unbuiltEntryRuleOf({ source: 'tickets', children: {} })).toBe('children');
    expect(unbuiltEntryRuleOf({ source: 'tickets', withhold: { columns: ['code'], unless_holder: 'holder_customer_id' } })).toBe('withhold');
    expect(unbuiltEntryRuleOf({ source: 'tickets' })).toBeNull();
  });
});
