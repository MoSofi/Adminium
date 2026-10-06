// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EVERY NEW RULE SURVIVES THE TRIP from a manifest to what the write path
 * reads: the rule as the manifest spells it → the override it is stored as
 * (`opsForRules`, the table-ref mapper, the stored payload's own schema) →
 * the effective schema. A key dropped anywhere on the way is a rule that is
 * installed and never kept, with no error to say so — so each place a key
 * can drop has a test here that goes red when it does.
 */
import type { AppManifest } from '@adminium/manifest';
import { validateOverrideInput, type SchemaOverride } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { isAddOnTable, mapTableRefs } from '../src/apps/real-refs.js';
import { columnRuleIssue, postingsRuleIssue, viaPostingClash } from '../src/connections/column-rules-validation.js';
import { applyOverrides, type EffectiveModel } from '../src/connections/effective-schema.js';
import { ruleDecidedColumns } from '../src/crud/decided-columns.js';
import { renamedInRule } from '../src/schema-ddl/rename-repair.js';
import { LEDGER_HOST, LEDGER_KIT } from '../../../packages/manifest/test/ledger-kit-fixture.js';
import { manifestOf, modelOf, store, type Stored } from './rule-round-trip.helpers.js';

type Doc = Record<string, unknown>;

/**
 * The host, with what the fixture leaves out: a table of its own called
 * `accounts` (the add-on has one too), a typed code that finds a row of the
 * add-on's, the last four of a code, and a line that refuses beside a
 * sibling table's.
 */
function hostDoc(): Doc {
  const doc = structuredClone(LEDGER_HOST) as unknown as { requiredSchema: { tables: Doc[] } };
  const lines = doc.requiredSchema.tables.find((table) => table['ref'] === 'order_lines') as { columns: Doc[]; postings: Doc[] };
  lines.columns.push({ ref: 'typed_code', type: 'text', maxLength: 40, nullable: true });
  lines.columns = lines.columns.map((column) =>
    column['ref'] === 'account_id' ? { ...column, rules: { addOnLink: { addOn: 'ledger-kit', table: 'accounts' }, lookup: { from: 'typed_code', table: { addOn: 'ledger-kit', table: 'accounts' }, column: 'code' } } } : column,
  );
  lines.postings = [{ ...lines.postings[0], refuses: [{ table: 'pays', via: 'order_id', column: 'gift_ref', set: true }], only: { column: 'qty', in: [1, 2] }, multipliers: { night: 'qty' } }];
  // A second posting whose points are the line's own, under `via`.
  lines.postings.push({
    id: 'line-own',
    into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' },
    via: 'order_id',
    post: { on: { column: 'qty', in: [1], from: [2], own: true } },
    reverse: { on: { column: 'voided_at', set: true, own: true } },
    map: { account: 'account_id', quantity: 'qty' },
  });
  doc.requiredSchema.tables.push(
    { ref: 'accounts', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
    {
      ref: 'pays',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'order_id', type: 'fk', references: 'orders' },
        { ref: 'gift_ref', type: 'text', maxLength: 40, nullable: true },
        { ref: 'code', type: 'text', maxLength: 24, nullable: true, rules: { code: { prefix: 'GC-', length: 12 } } },
        { ref: 'last4', type: 'text', maxLength: 4, nullable: true, rules: { codeLast4: { of: 'code' } } },
      ],
    },
  );
  return doc as unknown as Doc;
}

const HOST = manifestOf(hostDoc()) as AppManifest;
const KIT = manifestOf(LEDGER_KIT);
const hostTables = HOST.requiredSchema.tables;
const kitTables = KIT.requiredSchema?.tables ?? [];
const hostStored = store(HOST, 'ledger_host_', expect);
const kitStored = store(KIT, 'ledger_kit_', expect);
const hostModel = applyOverrides(modelOf(hostTables, 'ledger_host_'), hostStored.rows);
const kitModel = applyOverrides(modelOf(kitTables, 'ledger_kit_'), kitStored.rows);

const tableOf = (model: EffectiveModel, name: string) => {
  const found = model.tables.find((table) => table.name === name);
  if (found === undefined) throw new Error(`no table ${name}`);
  return found;
};
const columnOf = (model: EffectiveModel, table: string, column: string) => {
  const found = tableOf(model, table).columns.find((candidate) => candidate.name === column);
  if (found === undefined) throw new Error(`no column ${table}.${column}`);
  return found;
};
const rowOf = (stored: Stored, op: string, column: string | null = null) => {
  const found = stored.rows.find((row) => row.op === op && (column === null || row.columnName === column));
  if (found === undefined) throw new Error(`no stored ${op} ${String(column)}`);
  return found;
};

describe('the stored payload keeps every key it is handed', () => {
  it.each([...hostStored.rows.map((row) => ['host', row] as const), ...kitStored.rows.map((row) => ['kit', row] as const)].map(([owner, row]) => [`${owner} ${row.op} ${row.tableName}.${row.columnName ?? ''}`, owner, row] as const))(
    '%s',
    (_name, owner, row) => {
      const stored = owner === 'host' ? hostStored : kitStored;
      const short = row.tableName.replace(/^public\.(ledger_host_|ledger_kit_)/, '');
      expect(row.value).toEqual(stored.sent.get(`${row.op}|${short}|${row.columnName ?? ''}`));
    },
  );
});

describe('a posting', () => {
  it('is stored as the manifest spells it, a sibling table by its real id, and read back whole', () => {
    const declared = hostTables.find((table) => table.ref === 'order_lines')!.postings![0]!;
    const stored = (rowOf(hostStored, 'table.postings').value as { postings: Doc[] }).postings[0]!;
    expect(stored).toEqual({ ...declared, refuses: [{ table: 'public.ledger_host_pays', via: 'order_id', column: 'gift_ref', set: true }] });
    // Every key the vocabulary has is in the fixture, so none can be dropped unseen.
    expect(Object.keys(stored).sort()).toEqual(['heldUntil', 'id', 'into', 'map', 'multipliers', 'needs', 'only', 'post', 'refuses', 'reserve', 'reverse', 'unlessSet', 'via']);
    const own = hostTables.find((table) => table.ref === 'order_lines')!.postings![1]!;
    expect(tableOf(hostModel, 'ledger_host_order_lines').postings).toEqual([stored, own]);
    expect(own.post).toEqual({ on: { column: 'qty', in: [1], from: [2], own: true } });
    expect(own.reverse).toEqual({ on: { column: 'voided_at', set: true, own: true } });
  });

  it('a column point, an own point and a fixed value come back as written', () => {
    const visit = tableOf(hostModel, 'ledger_host_visits').postings![0]!;
    expect(visit.post).toEqual({ on: { column: 'status', in: ['seen'] } });
    expect(visit.reverse).toEqual({ on: { column: 'voided_at', set: true } });
    expect(visit.map).toEqual({ account: 'account_id', quantity: { value: '1' } });
    const request = tableOf(kitModel, 'ledger_kit_requests').postings![0]!;
    expect(request.reverse).toEqual({ on: { to: ['cancelled'], from: ['sent'] } });
  });

  it('the owner\'s rule joins the manifest\'s on one table', () => {
    const own: SchemaOverride = { ...rowOf(hostStored, 'table.postings'), id: 'ovr_owner', origin: 'user', value: { postings: [{ id: 'by-hand', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, post: { on: { create: true } }, map: { account: 'account_id' } }] } };
    const both = applyOverrides(modelOf(hostTables, 'ledger_host_'), [...hostStored.rows, own]);
    expect(tableOf(both, 'ledger_host_order_lines').postings?.map((posting) => posting.id)).toEqual(['line', 'line-own', 'by-hand']);
  });

  it('is judged against the database it is stored for', () => {
    const lines = modelOf(hostTables, 'ledger_host_');
    const table = lines.tables.find((candidate) => candidate.name === 'ledger_host_order_lines')!;
    const value = rowOf(hostStored, 'table.postings').value as { postings: Doc[] };
    expect(postingsRuleIssue(value, table, lines)).toBeNull();
    expect(postingsRuleIssue({ postings: [{ ...value.postings[0], map: { account: 'gone' } }] }, table, lines)).toContain('"gone", which is not a column of ledger_host_order_lines');
    expect(postingsRuleIssue({ postings: [{ ...value.postings[0], heldUntil: { parent: 'gone' } }] }, table, lines)).toContain('"gone", which is not a column of ledger_host_orders');
    expect(postingsRuleIssue({ postings: [{ ...value.postings[0], via: 'qty' }] }, table, lines)).toContain('links ledger_host_order_lines to no table');
    expect(postingsRuleIssue({ postings: [{ ...value.postings[0], colour: 'red' }] }, table, lines)).toContain('not spelled as Adminium stores them');
    // A sibling table is named with its link to the same parent, and only by a rule whose rows are lines.
    const pays = lines.tables.find((candidate) => candidate.name === 'ledger_host_pays')!.id;
    expect(postingsRuleIssue({ postings: [{ ...value.postings[0], refuses: [{ table: pays, column: 'gift_ref', set: true }] }] }, table, lines)).toContain('both, or neither');
    expect(postingsRuleIssue({ postings: [{ ...value.postings[0], refuses: [{ via: 'order_id', column: 'gift_ref', set: true }] }] }, table, lines)).toContain('both, or neither');
    const { via: _via, ...whole } = value.postings[0] as Doc & { via?: unknown };
    expect(postingsRuleIssue({ postings: [{ ...whole, heldUntil: undefined, refuses: [{ column: 'gift_ref', set: true }] }] }, table, lines)).toContain('lines of nothing');
  });

  it('two tables of lines under one parent may not share a rule\'s id', () => {
    const lines = modelOf(hostTables, 'ledger_host_');
    const id = (name: string) => lines.tables.find((candidate) => candidate.name === name)!.id;
    const rule = (posting: string, via: string | undefined) => ({ postings: [{ id: posting, ...(via === undefined ? {} : { via }) }] });
    const rows = (second: string, via: string | null = 'order_id') => [
      { tableName: id('ledger_host_order_lines'), value: rule('line', 'order_id') },
      { tableName: id('ledger_host_pays'), value: rule(second, via ?? undefined) },
    ];
    expect(viaPostingClash(rows('line'), lines)).toContain('each have a posting "line" for lines of');
    expect(viaPostingClash(rows('pay'), lines)).toBeNull();
    // The same id on a rule that is no line of that parent is nobody's twin; nor is a table's own second row.
    expect(viaPostingClash(rows('line', null), lines)).toBeNull();
    expect(viaPostingClash([rows('line')[0]!, rows('line')[0]!], lines)).toBeNull();
    // Payments that hang under another table are lines of another parent: the same id is no clash.
    const elsewhere = { ...lines, relations: lines.relations.map((relation) => (relation.from.tableId === id('ledger_host_pays') ? { ...relation, to: { ...relation.to, tableId: id('ledger_host_visits') } } : relation)) };
    expect(viaPostingClash(rows('line'), elsewhere)).toBeNull();
  });
});

describe('the owner\'s switch', () => {
  it('is stored apart from the rule and read back', () => {
    const patch = validateOverrideInput({ connectionId: 'cnx', op: 'table.switchedOff', tableName: 'public.ledger_host_order_lines', columnName: null, value: { postings: ['line'], adjust: true } });
    expect(patch.value).toEqual({ postings: ['line'], adjust: true });
    const row: SchemaOverride = { ...rowOf(hostStored, 'table.postings'), id: 'ovr_switch', op: 'table.switchedOff', origin: 'user', value: patch.value as Record<string, unknown> };
    const model = applyOverrides(modelOf(hostTables, 'ledger_host_'), [...hostStored.rows, row]);
    expect(tableOf(model, 'ledger_host_order_lines').switchedOff).toEqual({ postings: ['line'], adjust: true });
    expect(tableOf(model, 'ledger_host_order_lines').postings).toHaveLength(2);
  });
});

describe('a link into an add-on\'s table', () => {
  it('keeps the add-on\'s key and the table\'s short name, though the app has a table of that name', () => {
    expect(hostTables.some((table) => table.ref === 'accounts')).toBe(true);
    expect(rowOf(hostStored, 'column.addOnLink', 'account_id').value).toEqual({ addOn: 'ledger-kit', table: 'accounts' });
    expect(columnOf(hostModel, 'ledger_host_order_lines', 'account_id').addOnLink).toEqual({ addOn: 'ledger-kit', table: 'accounts', tableId: null, key: null });
  });

  it('a lookup among the add-on\'s codes is carried as stored, and inert until the add-on is found', () => {
    expect(rowOf(hostStored, 'column.lookup', 'account_id').value).toEqual({ from: 'typed_code', table: { addOn: 'ledger-kit', table: 'accounts' }, column: 'code' });
    const column = columnOf(hostModel, 'ledger_host_order_lines', 'account_id');
    expect(column.addOnLookup).toEqual({ from: 'typed_code', table: { addOn: 'ledger-kit', table: 'accounts' }, column: 'code' });
    expect(column.lookup).toBeUndefined();
  });

  it('the mapper leaves exactly that form alone, and still maps every other table', () => {
    expect(isAddOnTable({ addOn: 'kit', table: 'items' })).toBe(true);
    expect(isAddOnTable({ addOn: 'kit', table: 'items', kind: 'invoice' })).toBe(false);
    const mapped = mapTableRefs({ link: { addOn: 'kit', table: 'items' }, setting: { table: 'settings', column: 'x' }, document: { addOn: 'invoices', table: 'orders', kind: 'invoice' } }, (ref) => `real_${ref}`);
    expect(mapped.value).toEqual({ link: { addOn: 'kit', table: 'items' }, setting: { table: 'real_settings', column: 'x' }, document: { addOn: 'invoices', table: 'real_orders', kind: 'invoice' } });
  });
});

describe('the column rules', () => {
  it('capUnless rides the total it lifts the cap of', () => {
    expect(columnOf(kitModel, 'ledger_kit_accounts', 'taken').rollup).toEqual({
      from: 'public.ledger_kit_entries',
      via: 'account_id',
      sum: 'amount',
      cap: true,
      capUnless: { column: 'allow_below' },
      balance: { column: 'balance', of: 'opening' },
    });
  });

  it('announce, tableRef, plainText, customerKey and codeLast4 are read back', () => {
    expect(columnOf(kitModel, 'ledger_kit_accounts', 'low').announce).toBe(true);
    expect(columnOf(kitModel, 'ledger_kit_postings', 'source_table').tableRef).toBe(true);
    expect(columnOf(kitModel, 'ledger_kit_postings', 'line_table').tableRef).toBe(true);
    expect(columnOf(hostModel, 'ledger_host_order_lines', 'buyer_note').plainText).toEqual({ digits: 4, max: 80 });
    expect(columnOf(hostModel, 'ledger_host_orders', 'buyer_key').customerKey).toEqual({ of: 'buyer_email' });
    expect(columnOf(hostModel, 'ledger_host_pays', 'last4').codeLast4).toEqual({ of: 'code' });
  });

  it('a planned move keeps its mark', () => {
    expect(tableOf(kitModel, 'ledger_kit_requests').states?.moves['done']).toEqual([{ to: 'filed', planned: true }]);
  });

  it('each is judged against the column it is stored on', () => {
    const model = modelOf(hostTables, 'ledger_host_');
    const column = (table: string, name: string) => model.tables.find((candidate) => candidate.name === table)!.columns.find((candidate) => candidate.name === name)!;
    expect(columnRuleIssue('column.addOnLink', { addOn: 'ledger-kit', table: 'accounts' }, column('ledger_host_order_lines', 'account_id'), model)).toBeNull();
    expect(columnRuleIssue('column.addOnLink', { addOn: 'ledger-kit', table: 'accounts' }, column('ledger_host_order_lines', 'order_id'), model)).toContain('never empty');
    expect(columnRuleIssue('column.plainText', { plainText: true }, column('ledger_host_order_lines', 'qty'), model)).toContain('Plain text is a rule of a text column');
    expect(columnRuleIssue('column.customerKey', { of: 'buyer_email' }, column('ledger_host_orders', 'buyer_key'), model)).toBeNull();
    expect(columnRuleIssue('column.customerKey', { of: 'gone' }, column('ledger_host_orders', 'buyer_key'), model)).toContain('no column "gone"');
    expect(columnRuleIssue('column.codeLast4', { of: 'code' }, column('ledger_host_pays', 'last4'), model)).toBeNull();
    expect(columnRuleIssue('column.tableRef', { tableRef: true }, column('ledger_host_order_lines', 'qty'), model)).toContain("A table's name is kept in text");
  });
});

describe('what a posting makes Adminium\'s own', () => {
  it('the column a hold lasts until, on the row or on the parent its lines belong to', () => {
    expect([...ruleDecidedColumns(tableOf(kitModel, 'ledger_kit_requests'), kitModel)]).toEqual(['hold_until']);
    // `order_lines` holds until its order's `hold_until`: decided on the order, not on the line.
    // (And the buyer's key, which Adminium makes from the address beside it.)
    expect([...ruleDecidedColumns(tableOf(hostModel, 'ledger_host_orders'), hostModel)].sort()).toEqual(['buyer_key', 'hold_until']);
    expect([...ruleDecidedColumns(tableOf(hostModel, 'ledger_host_order_lines'), hostModel)]).toEqual([]);
    expect([...ruleDecidedColumns(tableOf(hostModel, 'ledger_host_visits'), hostModel)]).toEqual([]);
  });

  it('a column mapped to an input the action decides, once the ledger is at hand', () => {
    const decides = (into: { action: string }) => (into.action === 'use' ? ['quantity'] : null);
    expect([...ruleDecidedColumns(tableOf(hostModel, 'ledger_host_order_lines'), hostModel, decides)]).toEqual(['qty']);
    expect([...ruleDecidedColumns(tableOf(hostModel, 'ledger_host_order_lines'), hostModel, (into) => (into.action === 'count' ? ['account'] : null))]).toEqual(['account_id']);
    expect([...ruleDecidedColumns(tableOf(hostModel, 'ledger_host_visits'), hostModel, decides)]).toEqual([]);
  });
});

describe('a column renamed under a stored rule', () => {
  const postings = () => rowOf(hostStored, 'table.postings').value as { postings: Doc[] };
  const renamed = (from: string, to: string) => (renamedInRule('table.postings', postings(), from, to) as { postings: Record<string, Doc>[] }).postings;

  it('is followed by everything a posting reads of its own table', () => {
    const [line, own] = renamed('qty', 'quantity');
    expect(line!['map']).toEqual({ account: 'account_id', quantity: 'quantity' });
    expect(line!['multipliers']).toEqual({ night: 'quantity' });
    expect(line!['only']).toEqual({ column: 'quantity', in: [1, 2] });
    expect(own!['post']).toEqual({ on: { column: 'quantity', in: [1], from: [2], own: true } });
    const [voided, voidedOwn] = renamed('voided_at', 'cancelled_at');
    expect(voided!['unlessSet']).toBe('cancelled_at');
    expect(voidedOwn!['reverse']).toEqual({ on: { column: 'cancelled_at', set: true, own: true } });
    expect(renamed('order_id', 'ticket_id').map((posting) => posting['via'])).toEqual(['ticket_id', 'ticket_id']);
  });

  it('leaves alone what is the parent\'s or another table\'s, and a rule that names no such column', () => {
    // `heldUntil: {parent: 'hold_until'}` and `refuses[].column` of the sibling table are not this table's columns.
    const value = postings();
    expect(renamedInRule('table.postings', value, 'hold_until', 'held_to')).toBe(value);
    expect(renamedInRule('table.postings', value, 'gift_ref', 'gift')).toBe(value);
    // A point of the parent's column under `via` is the parent's too.
    const parentPoint = { postings: [{ id: 'p', into: { addOn: 'kit', ledger: 'units', action: 'use' }, via: 'order_id', post: { on: { column: 'status', in: ['paid'] } }, map: {} }] };
    expect(renamedInRule('table.postings', parentPoint, 'status', 'state')).toBe(parentPoint);
    // With no `via` the same point is the row's own.
    const ownPoint = { postings: [{ id: 'p', into: { addOn: 'kit', ledger: 'units', action: 'use' }, post: { on: { column: 'status', in: ['paid'] } }, map: {} }] };
    expect((renamedInRule('table.postings', ownPoint, 'status', 'state') as typeof ownPoint).postings[0]!.post).toEqual({ on: { column: 'state', in: ['paid'] } });
  });

  it('is followed by a customer key, the last four of a code, and the yes/no that lifts a cap', () => {
    expect(renamedInRule('column.customerKey', { of: 'buyer_email' }, 'buyer_email', 'email')).toEqual({ of: 'email' });
    expect(renamedInRule('column.codeLast4', { of: 'code' }, 'code', 'card_code')).toEqual({ of: 'card_code' });
    const rollup = columnOf(kitModel, 'ledger_kit_accounts', 'taken').rollup!;
    expect(renamedInRule('column.rollup', rollup, 'allow_below', 'may_go_below')).toEqual({ ...rollup, capUnless: { column: 'may_go_below' } });
    expect(renamedInRule('column.rollup', rollup, 'amount', 'units')).toBe(rollup);
  });
});
