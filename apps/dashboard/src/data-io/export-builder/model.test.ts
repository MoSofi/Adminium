// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Export Builder's draft rules (41-export-builder.md §3.7): the comp's
 * header casing (D4), the three add outcomes (731-737), the per-family
 * budgets (D9, D11), duplicate headers, reorder, the wire shape (D1) and the
 * round trip a finished export makes back into a draft ("Based on").
 */
import { describe, expect, it } from 'vitest';

import type { SchemaReply, SchemaTable } from '../../studio/api.js';
import { inboundLinks } from '../../studio/pages/columnSpecBuilder.js';
import {
  MAX_CALCULATED,
  MAX_LINKED,
  MAX_TOTALS,
  addColumn,
  defaultDraft,
  draftFromPage,
  draftFromSource,
  dropColumn,
  duplicateHeaders,
  mkArith,
  mkCount,
  mkFold,
  mkLinked,
  mkPercent,
  mkRule,
  moveColumn,
  operandsOf,
  removeColumn,
  sentence,
  setHeader,
  suggestionsFor,
  toSource,
  type Draft,
} from './model.js';

const invoices: SchemaTable = {
  id: 'main.invoices',
  schema: 'main',
  name: 'invoices',
  rowCountEstimate: 1248,
  primaryKey: ['id'],
  columns: [
    { name: 'id', ordinal: 0, logicalType: 'bigint', isPrimaryKey: true },
    { name: 'number', ordinal: 1, logicalType: 'text' },
    { name: 'client_id', ordinal: 2, logicalType: 'bigint', references: { tableId: 'main.clients', column: 'id' } },
    { name: 'tax_rate', ordinal: 3, logicalType: 'decimal' },
    { name: 'issued_on', ordinal: 4, logicalType: 'date' },
    { name: 'api_secret', ordinal: 5, logicalType: 'text', semantics: { primary: 'plain', flags: { secret: true } } },
  ],
};
const clients: SchemaTable = {
  id: 'main.clients',
  schema: 'main',
  name: 'clients',
  label: 'Clients',
  rowCountEstimate: 64,
  primaryKey: ['id'],
  columns: [
    { name: 'id', ordinal: 0, logicalType: 'bigint', isPrimaryKey: true },
    { name: 'company', ordinal: 1, logicalType: 'text' },
    { name: 'email', ordinal: 2, logicalType: 'text', semantics: { primary: 'email', flags: { pii: 'email' } } },
  ],
};
const items: SchemaTable = {
  id: 'main.invoice_items',
  schema: 'main',
  name: 'invoice_items',
  label: 'Invoice items',
  rowCountEstimate: 4391,
  primaryKey: ['id'],
  columns: [
    { name: 'id', ordinal: 0, logicalType: 'bigint', isPrimaryKey: true },
    { name: 'invoice_id', ordinal: 1, logicalType: 'bigint', references: { tableId: 'main.invoices', column: 'id' } },
    { name: 'qty', ordinal: 2, logicalType: 'decimal' },
    { name: 'rate', ordinal: 3, logicalType: 'decimal' },
    { name: 'line_total', ordinal: 4, logicalType: 'decimal', semantics: { primary: 'money' } },
  ],
};
const schema: SchemaReply = {
  connectionId: 'conn_1',
  snapshotId: 'snap_1',
  checksum: 'x',
  createdAt: 1,
  source: 'live',
  model: { tables: [invoices, clients, items] },
  appliedOverrides: 0,
};
const itemsLink = inboundLinks(schema, invoices)[0];
if (itemsLink === undefined) throw new Error('fixture: no inbound link');

describe('headers follow the comp (D4)', () => {
  it('sentence-cases a column name and reads a trailing id as ID', () => {
    expect(sentence('contact_name')).toBe('Contact name');
    expect(sentence('client_id')).toBe('Client ID');
    expect(sentence('id')).toBe('ID');
    expect(sentence('issued_on')).toBe('Issued on');
  });

  it('names a linked value, a count and a fold the way the comp does', () => {
    const linked = mkLinked([{ via: 'client_id', table: clients }], clients.columns[1] as never, new Set());
    expect(linked.header).toBe('Client company');
    expect(linked.source).toBe('clients.company via client_id');
    expect(linked.spec).toEqual({ name: 'client_id__company', lookup: { path: ['client_id'], select: 'company' } });

    const count = mkCount(itemsLink, new Set());
    expect(count.column.header).toBe('Invoice items count');
    expect(count.measure).toEqual({ id: 'invoice_items__count', table: 'main.invoice_items', fkColumn: 'invoice_id', fn: 'count' });

    const fold = mkFold(itemsLink, 'sum', [items.columns[2] as never, items.columns[3] as never], new Set());
    expect(fold.column.header).toBe('Sum of qty × rate');
    expect(fold.measure.of).toEqual({ terms: [{ sign: 'plus', factors: ['qty', 'rate'] }] });
    expect(mkFold(itemsLink, 'min', [items.columns[4] as never], new Set()).column.header).toBe('Min line total');
  });
});

describe('the default draft and the add outcomes', () => {
  it('starts from every non-secret column, keys and all', () => {
    const draft = defaultDraft(invoices);
    expect(draft.columns.map((column) => column.spec.name)).toEqual(['id', 'number', 'client_id', 'tax_rate', 'issued_on']);
    expect(draft.columns[0]?.badges).toEqual(['key']);
    expect(draft.columns[0]?.readOnly).toBe(true);
  });

  it('refuses a column already in the file, adds a new one with its measure', () => {
    const draft = defaultDraft(invoices);
    const again = addColumn(draft, draft.columns[1] as never);
    expect(again).toEqual({ ok: false, reason: 'already' });
    const count = mkCount(itemsLink, new Set());
    const added = addColumn(draft, count.column, { measure: count.measure }, invoices.columns.map((column) => column.name));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.draft.measures).toHaveLength(1);
    expect(added.draft.columns.at(-1)?.kind).toBe('count');
  });

  it('budgets per family — twelve linked, twelve totals, eight calculated (D9, D11)', () => {
    let draft: Draft = { columns: [], measures: [], fields: [] };
    for (let i = 0; i < MAX_LINKED; i += 1) {
      const column = mkLinked([{ via: 'client_id', table: clients }], { name: `c${i}`, logicalType: 'text' }, new Set());
      const out = addColumn(draft, column);
      if (out.ok) draft = out.draft;
    }
    expect(draft.columns).toHaveLength(MAX_LINKED);
    const thirteenth = addColumn(draft, mkLinked([{ via: 'client_id', table: clients }], { name: 'c13', logicalType: 'text' }, new Set()));
    expect(thirteenth).toEqual({ ok: false, reason: 'limit' });
    // A total still fits: the other family's budget is its own.
    const count = mkCount(itemsLink, new Set());
    expect(addColumn(draft, count.column, { measure: count.measure }).ok).toBe(true);

    let totals: Draft = { columns: [], measures: [], fields: [] };
    for (let i = 0; i < MAX_TOTALS; i += 1) {
      const fold = mkFold({ ...itemsLink, table: { ...items, id: `main.t${i}`, name: `t${i}` } }, 'sum', [items.columns[2] as never], new Set(totals.measures.map((m) => m.id)));
      const out = addColumn(totals, fold.column, { measure: fold.measure });
      if (out.ok) totals = out.draft;
    }
    expect(totals.columns).toHaveLength(MAX_TOTALS);
    expect(MAX_CALCULATED).toBe(8);
  });

  it('runs a calculated column through the shipped parser before authoring it', () => {
    let draft = defaultDraft(invoices);
    const fold = mkFold(itemsLink, 'sum', [items.columns[4] as never], new Set());
    const withFold = addColumn(draft, fold.column, { measure: fold.measure }, ['id', 'number', 'client_id', 'tax_rate', 'issued_on']);
    if (!withFold.ok) throw new Error('fold refused');
    draft = withFold.draft;
    const operands = operandsOf(draft);
    // Every numeric base column (the comp's `numCols`, 1018 — keys and links
    // included) and the fold; never a linked value (D10).
    expect(operands.map((operand) => operand.column.spec.name)).toEqual(['id', 'client_id', 'tax_rate', 'invoice_items__line_total']);
    const tax = operands[2] as never;
    const subtotal = operands[3] as never;
    const pct = mkPercent('20', subtotal, new Set(['tax_rate']));
    expect(pct?.column.header).toBe('20% of Sum of line total');
    const rule = mkRule(subtotal, '5,000', 'Waived', 'Standard', new Set());
    expect(rule?.field.result).toBe('text');
    expect(rule?.column.header).toBe('Waived or Standard');
    expect(rule?.column.source).toBe('if Sum of line total is over 5,000 then Waived, else Standard');
    const arith = mkArith(subtotal, '−', tax, new Set());
    expect(arith.column.header).toBe('Sum of line total − Tax rate');
    const added = addColumn(draft, rule!.column, { field: rule!.field }, ['id', 'number', 'client_id', 'tax_rate', 'issued_on']);
    expect(added.ok).toBe(true);
    // A threshold the literal grammar refuses is never authored.
    expect(mkRule(subtotal, 'lots', 'a', 'b', new Set())).toBeNull();
  });
});

describe('editing the list', () => {
  it('finds duplicate headers case- and whitespace-insensitively', () => {
    let draft = defaultDraft(invoices);
    draft = setHeader(draft, draft.columns[1]!.id, ' number ');
    draft = setHeader(draft, draft.columns[3]!.id, 'Number');
    expect(duplicateHeaders(draft).has('number')).toBe(true);
  });

  it('moves by arrow and by drop, and removes a column with its measure', () => {
    let draft = defaultDraft(invoices);
    const ids = draft.columns.map((column) => column.id);
    draft = moveColumn(draft, ids[0]!, 1);
    expect(draft.columns.map((column) => column.id).slice(0, 2)).toEqual([ids[1], ids[0]]);
    draft = dropColumn(draft, ids[4]!, ids[1]!, true);
    expect(draft.columns[0]?.id).toBe(ids[4]);
    const fold = mkFold(itemsLink, 'sum', [items.columns[4] as never], new Set());
    const withFold = addColumn(draft, fold.column, { measure: fold.measure }, ['id', 'number', 'client_id', 'tax_rate', 'issued_on']);
    if (!withFold.ok) throw new Error('fold refused');
    const removed = removeColumn(withFold.draft, fold.column.id);
    expect(removed.measures).toEqual([]);
  });
});

describe('the wire and the round trip (D1)', () => {
  it('writes a page-config-shaped body and reads it back as the same draft', () => {
    let draft = defaultDraft(invoices);
    const linked = mkLinked([{ via: 'client_id', table: clients }], clients.columns[1] as never, new Set());
    draft = (addColumn(draft, linked) as { ok: true; draft: Draft }).draft;
    const fold = mkFold(itemsLink, 'sum', [items.columns[4] as never], new Set());
    draft = (addColumn(draft, fold.column, { measure: fold.measure }, ['id', 'number', 'client_id', 'tax_rate', 'issued_on']) as { ok: true; draft: Draft }).draft;
    draft = setHeader(draft, draft.columns[1]!.id, 'Invoice number');

    const source = toSource(draft, invoices, { format: 'csv', scope: 'all', view: null, headerRow: false, name: 'Invoices Q3' });
    expect(source.kind).toBe('table');
    expect(source.columns?.map((column) => column.label)).toEqual(['ID', 'Invoice number', 'Client ID', 'Tax rate', 'Issued on', 'Client company', 'Sum of line total']);
    expect(source.columns?.[5]).toEqual({ name: 'client_id__company', label: 'Client company', lookup: { path: ['client_id'], select: 'company' } });
    expect(source.columns?.[6]).toEqual({ name: 'invoice_items__line_total', label: 'Sum of line total', derived: { ref: 'invoice_items__line_total' } });
    expect(source.derived).toEqual({ measures: [fold.measure], fields: [] });
    expect(source.options).toEqual({ headerRow: false, fileName: 'Invoices Q3' });

    const back = draftFromSource(source, schema, invoices);
    expect(back.columns.map((column) => [column.kind, column.header])).toEqual(draft.columns.map((column) => [column.kind, column.header]));
    expect(back.measures).toEqual(draft.measures);
  });

  it('starts from a page body — the page’s own labels, counts as reverse blocks, hidden columns left out', () => {
    const draft = draftFromPage(
      {
        columns: [
          { name: 'number', label: 'Number', logicalType: 'text' },
          { name: 'secret_note', label: 'Hidden', logicalType: 'text', hidden: true },
          { name: 'items', label: 'Items', logicalType: 'integer', reverse: { table: 'main.invoice_items', fkColumn: 'invoice_id', agg: 'count' } },
        ],
      },
      schema,
      invoices,
    );
    expect(draft.columns.map((column) => [column.kind, column.header])).toEqual([
      ['base', 'Number'],
      ['count', 'Items'],
    ]);
    expect(draft.columns[1]?.spec.reverse?.agg).toBe('count');
  });
});

describe('suggestions (D15)', () => {
  it('offers the linked display value, the count and the money sum, hidden once added', () => {
    const suggestions = suggestionsFor(schema, invoices);
    expect(suggestions.map((suggestion) => suggestion.label)).toEqual([
      'Client company',
      'Invoice items count',
      'Sum of invoice_items line total',
    ]);
    const built = suggestions[2]!.build(new Set());
    expect(built.measure?.of).toEqual({ terms: [{ sign: 'plus', factors: ['line_total'] }] });
  });
});
