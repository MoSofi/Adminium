// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PRICE RULE SURVIVES THE TRIP from a manifest to what the write path
 * reads: stored with every key it was written with, its child tables by
 * their real ids, read back whole — and with it what it makes Adminium's
 * own, on the order's table and on each child table it names.
 */
import type { AppManifest } from '@adminium/manifest';
import { validateOverrideInput, type SchemaOverride } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { adjustRuleIssue } from '../src/connections/column-rules-validation.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { ruleDecidedColumns } from '../src/crud/decided-columns.js';
import { UNBUILT_MANIFEST_WORDS, UNBUILT_TABLE_RULES, unbuiltInManifest, unbuiltRuleOf } from '../src/crud/unbuilt-rules.js';
import { renamedInRule } from '../src/schema-ddl/rename-repair.js';
import { ADJUST, ADJUST_HOST, OFFERS_KIT } from '../../../packages/manifest/test/adjust-fixture.js';
import { manifestOf, modelOf, store } from './rule-round-trip.helpers.js';

type Doc = Record<string, unknown>;

/** The host with a posting that records uses, so every key of the rule is in the fixture. */
function hostDoc(): Doc {
  const doc = structuredClone(ADJUST_HOST) as unknown as { requiredSchema: { tables: Doc[] } };
  doc.requiredSchema.tables = doc.requiredSchema.tables.map((table) =>
    table['ref'] === 'orders'
      ? {
          ...table,
          adjust: { ...structuredClone(ADJUST), uses: 'redeem', lines: [...structuredClone(ADJUST.lines), { self: true, price: 'tax_rate', quantity: 'tax_rate', discount: 'discount', what: [] }] },
          postings: [{ id: 'redeem', into: { addOn: 'offers-kit', ledger: 'value', action: 'redeem' }, post: { on: { to: ['paid'] } }, map: { what: { row: true } } }],
        }
      : table,
  );
  return doc as unknown as Doc;
}

const HOST = manifestOf(hostDoc()) as AppManifest;
const tables = HOST.requiredSchema.tables;
const stored = store(HOST, 'adjust_host_', expect);
const base = modelOf(tables, 'adjust_host_');
const model = applyOverrides(base, stored.rows);
const row = stored.rows.find((candidate) => candidate.op === 'table.adjust') as SchemaOverride;
const id = (ref: string) => `public.adjust_host_${ref}`;
const tableOf = (ref: string) => model.tables.find((table) => table.id === id(ref))!;

describe('the stored price rule', () => {
  it('keeps every key it is handed, its child tables by their real ids', () => {
    const declared = tables.find((table) => table.ref === 'orders')!.adjust!;
    expect(row.value).toEqual(stored.sent.get('table.adjust|orders|'));
    expect(row.value).toEqual({
      ...declared,
      lines: [{ ...declared.lines[0], table: id('order_lines') }, declared.lines[1]],
      codes: { ...declared.codes, table: id('order_codes') },
      refunds: { ...declared.refunds, table: id('refunds'), lines: { ...declared.refunds!.lines, table: id('refund_lines') } },
    });
    // Every key the vocabulary has is in the fixture, so none can be dropped unseen.
    expect(Object.keys(row.value).sort()).toEqual(['by', 'codes', 'expect', 'frozen', 'lines', 'needs', 'order', 'refunds', 'uses']);
    const [part] = (row.value as { lines: Doc[] }).lines;
    expect(Object.keys(part!).sort()).toEqual(['discount', 'excludes', 'only', 'paidBy', 'price', 'quantity', 'table', 'unlessSet', 'via', 'what']);
    expect(Object.keys((row.value as { order: Doc }).order).sort()).toEqual(['currency', 'customer', 'discount', 'staff']);
    expect(Object.keys((row.value as { order: { customer: Doc } }).order.customer).sort()).toEqual(['address', 'counts', 'link', 'proved']);
  });

  it('is read back whole on the order\'s table', () => {
    expect(tableOf('orders').adjust).toEqual(row.value);
    expect(tableOf('order_lines').adjust).toBeUndefined();
  });

  it('where an app\'s and an owner\'s are both stored, the app\'s stands, whichever is read first', () => {
    const owners: SchemaOverride = { ...row, id: 'ovr_owner', origin: 'user', value: { ...row.value, expect: 'net' } };
    for (const rows of [[...stored.rows, owners], [owners, ...stored.rows]]) {
      const both = applyOverrides(base, rows);
      expect(both.tables.find((table) => table.id === id('orders'))!.adjust?.expect).toBe('total');
    }
    const alone = applyOverrides(base, [owners]);
    expect(alone.tables.find((table) => table.id === id('orders'))!.adjust?.expect).toBe('net');
  });

  it('is judged against the database it is stored for', () => {
    const table = base.tables.find((candidate) => candidate.id === id('orders'))!;
    const value = row.value as Doc & { lines: Doc[]; order: Doc; codes: Doc };
    expect(adjustRuleIssue(value, table, base)).toBeNull();
    expect(adjustRuleIssue({ ...value, expect: 'grand_total' }, table, base)).toContain('"grand_total", which is not a column of adjust_host_orders');
    expect(adjustRuleIssue({ ...value, lines: [{ ...value.lines[0], price: 'cost' }] }, table, base)).toContain('"cost", which is not a column of adjust_host_order_lines');
    expect(adjustRuleIssue({ ...value, lines: [{ ...value.lines[0], table: id('items') }] }, table, base)).toContain('does not link adjust_host_items to adjust_host_orders');
    expect(adjustRuleIssue({ ...value, codes: { ...value.codes, table: 'public.gone' } }, table, base)).toContain('"public.gone", which is not in this database');
    expect(adjustRuleIssue({ ...value, colour: 'red' }, table, base)).toContain('not spelled as Adminium stores it');
  });

  it('the owner\'s switch on it is stored beside it', () => {
    const patch = validateOverrideInput({ connectionId: 'cnx', op: 'table.switchedOff', tableName: id('orders'), columnName: null, value: { postings: [], adjust: true } });
    const off: SchemaOverride = { ...row, id: 'ovr_switch', op: 'table.switchedOff', origin: 'user', value: patch.value as Record<string, unknown> };
    const switched = applyOverrides(base, [...stored.rows, off]).tables.find((table) => table.id === id('orders'))!;
    expect(switched.switchedOff).toEqual({ postings: [], adjust: true });
    expect(switched.adjust).toBeDefined();
  });
});

describe('what the price rule makes Adminium\'s own', () => {
  const decided = (ref: string) => [...ruleDecidedColumns(tableOf(ref), model)].sort();

  it('on the order: its reduction, who gave one by hand, whether the customer was proved', () => {
    expect(decided('orders')).toEqual(['customer_proved', 'discount', 'staff_by']);
  });

  it('on each child table the rule names: a line\'s reduction, the links a code fills, a refund\'s amount and tax', () => {
    expect(decided('order_lines')).toEqual(['discount']);
    expect(decided('order_codes')).toEqual(['code_id', 'voucher_id']);
    expect(decided('refunds')).toEqual(['amount', 'tax']);
    expect(decided('refund_lines')).toEqual([]);
    expect(decided('customers')).toEqual([]);
  });
});

describe('until the price question is asked', () => {
  it('the order\'s table and each table of its lines, codes and refunds take no writes', () => {
    // The one rule this is about: some of these tables carry another rule not run yet as well (a link into the add-on).
    const adjust = UNBUILT_TABLE_RULES.filter((rule) => rule.rule === 'adjust');
    for (const ref of ['orders', 'order_lines', 'order_codes', 'refunds']) expect(unbuiltRuleOf(tableOf(ref), adjust, model), ref).toBe('adjust');
    for (const ref of ['customers', 'items', 'payments', 'refund_lines']) expect(unbuiltRuleOf(tableOf(ref), adjust, model), ref).toBeNull();
    // Without the model a child table cannot know it is a line of an order.
    expect(unbuiltRuleOf(tableOf('refunds'), adjust)).toBeNull();
  });

  it('a manifest that asks it, or answers it, needs the release that does', () => {
    expect(unbuiltInManifest(hostDoc()).filter((found) => found.word === 'table.adjust')).toEqual([{ word: 'table.adjust', path: 'requiredSchema.tables.3.adjust', release: '0.3.19' }]);
    expect(unbuiltInManifest(OFFERS_KIT).find((found) => found.word === 'addOn.adjuster')).toEqual({ word: 'addOn.adjuster', path: 'addOn.adjuster', release: '0.3.19' });
    const deciding = { kind: 'add-on', addOn: { ledgers: [{ id: 'value', actions: { spend: { decides: [{ input: 'amount' }] }, load: {} } }] } };
    expect(unbuiltInManifest(deciding).filter((found) => found.word === 'ledger.decides')).toEqual([{ word: 'ledger.decides', path: 'addOn.ledgers.0.actions.spend.decides', release: '0.3.19' }]);
    expect(UNBUILT_MANIFEST_WORDS['automations']).toBe('0.3.18');
  });
});

describe('a column of the order renamed under its price rule', () => {
  const renamed = (from: string, to: string) => renamedInRule('table.adjust', row.value, from, to) as Doc & { order: Doc & { customer: Doc; staff: Doc }; lines: Doc[]; refunds: Doc; frozen: Doc };

  it('is followed by everything the rule reads of the order', () => {
    expect(renamed('discount', 'reduction').order.discount).toBe('reduction');
    expect(renamed('discount', 'reduction').lines[1]!['discount']).toBe('reduction');
    expect(renamed('customer_proved', 'known').order.customer['proved']).toBe('known');
    expect(renamed('customer_id', 'buyer_id').order.customer['link']).toBe('buyer_id');
    expect(renamed('status', 'state').order.customer['counts']).toEqual({ column: 'state', in: ['placed', 'paid'] });
    expect(renamed('staff_by', 'given_by').order.staff).toEqual({ kind: 'staff_kind', value: 'staff_value', reason: 'staff_reason', by: 'given_by' });
    expect(renamed('total', 'grand_total')['expect']).toBe('grand_total');
    expect(renamed('total', 'grand_total').refunds['of']).toBe('grand_total');
    expect(renamed('tax', 'vat').refunds['taxOf']).toBe('vat');
  });

  it('leaves a child table\'s column of the same name alone, and a rule that names no such column', () => {
    // `discount` is also the line's column: the line part keeps it, the order's part and total follow.
    expect(renamed('discount', 'reduction').lines[0]!['discount']).toBe('discount');
    expect(renamedInRule('table.adjust', row.value, 'email', 'address')).toBe(row.value);
    expect(renamedInRule('table.adjust', row.value, 'qty', 'quantity')).toBe(row.value);
  });
});
