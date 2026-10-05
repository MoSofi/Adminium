// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dirty-state buffer core: keying, stage/drop/revert semantics, change
 * listing, and the EXACT `PUT /connections/:id/overrides` document shape.
 * The literals asserted here are re-validated against the real server Zod
 * schemas in `apps/server/test/remap-payload-contract.test.ts` — keep the
 * two in sync when the vocabulary changes.
 */
import { describe, expect, it } from 'vitest';

import {
  baselineFromRows,
  bufferChanges,
  buildPutDocument,
  dropEntry,
  effectiveEntry,
  labelText,
  overrideKey,
  revertEntry,
  stageEntry,
  type OverrideDto,
  type RemapOverride,
} from './overrides.js';

const labelOp: RemapOverride = {
  op: 'table.label',
  tableName: 'public.customers',
  value: { label: 'Customers', icon: 'users' },
};
const piiOp: RemapOverride = {
  op: 'column.pii',
  tableName: 'public.customers',
  columnName: 'email',
  value: { masked: true, kind: 'email' },
};

function row(partial: Partial<OverrideDto> & Pick<OverrideDto, 'op' | 'tableName' | 'value'>): OverrideDto {
  return {
    id: 'ovr_1',
    columnName: null,
    origin: 'user',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe('overrideKey', () => {
  it('keys table/column ops by target and relation ops by value identity', () => {
    expect(overrideKey(labelOp)).toBe('table.label::public.customers::');
    expect(overrideKey(piiOp)).toBe('column.pii::public.customers::email');
    expect(
      overrideKey({
        op: 'relation.add',
        tableName: 'public.order_notes',
        value: { fromColumn: 'order_ref', toTable: 'public.orders', toColumn: 'id', cardinality: 'many-to-one' },
      }),
    ).toBe('relation.add::public.order_notes::order_ref->public.orders');
    expect(
      overrideKey({
        op: 'relation.remove',
        tableName: 'public.order_notes',
        value: { fromColumn: 'order_ref', toTable: 'public.orders' },
      }),
    ).toBe('relation.remove::public.order_notes::order_ref->public.orders');
  });
});

describe('stage / drop / revert', () => {
  const baseline = baselineFromRows([
    row({ op: 'table.label', tableName: 'public.customers', value: { label: 'Customers', icon: 'users' } }),
  ]);

  it('stages a new op and reverts it per item', () => {
    let overlay = stageEntry(baseline, new Map(), { item: piiOp });
    expect(bufferChanges(baseline, overlay)).toHaveLength(1);
    expect(bufferChanges(baseline, overlay)[0]?.kind).toBe('add');

    overlay = revertEntry(overlay, overrideKey(piiOp));
    expect(bufferChanges(baseline, overlay)).toHaveLength(0);
  });

  it('editing an existing op is an edit; re-staging the baseline value collapses', () => {
    const edited: RemapOverride = {
      op: 'table.label',
      tableName: 'public.customers',
      value: { label: 'Clients', icon: 'users' },
    };
    let overlay = stageEntry(baseline, new Map(), { item: edited });
    const changes = bufferChanges(baseline, overlay);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe('edit');

    // Staging the exact baseline value again is not a change.
    overlay = stageEntry(baseline, overlay, { item: labelOp });
    expect(bufferChanges(baseline, overlay)).toHaveLength(0);
    expect(overlay.size).toBe(0);
  });

  it('drop removes a baseline op (a "remove" change) and is a no-op otherwise', () => {
    const key = overrideKey(labelOp);
    let overlay = dropEntry(baseline, new Map(), key);
    expect(bufferChanges(baseline, overlay)).toEqual([
      expect.objectContaining({ key, kind: 'remove', next: null }),
    ]);
    expect(effectiveEntry(baseline, overlay, key)).toBeNull();

    overlay = dropEntry(baseline, new Map(), overrideKey(piiOp));
    expect(bufferChanges(baseline, overlay)).toHaveLength(0);
  });
});

describe('buildPutDocument — exact server contract', () => {
  it('emits the full document: one item per op, columnName only on column ops', () => {
    const baseline = baselineFromRows([
      row({ op: 'table.label', tableName: 'public.customers', value: { label: 'Customers', icon: 'users' } }),
      row({
        id: 'ovr_2',
        op: 'column.enumLabels',
        tableName: 'public.orders',
        columnName: 'status',
        value: { labels: { paid: 'Paid' }, tones: { paid: 'pos', cancelled: 'danger' } },
      }),
    ]);
    let overlay = stageEntry(baseline, new Map(), { item: piiOp });
    overlay = stageEntry(baseline, overlay, {
      item: {
        op: 'relation.add',
        tableName: 'public.order_notes',
        value: { fromColumn: 'order_ref', toTable: 'public.orders', toColumn: 'id', cardinality: 'many-to-one' },
      },
    });
    overlay = stageEntry(baseline, overlay, {
      item: { op: 'table.exclude', tableName: 'public.order_notes', value: { excluded: true } },
    });

    // EXACT document PUT to /connections/:id/overrides (server overridesPutBody).
    expect(buildPutDocument(baseline, overlay)).toEqual({
      overrides: [
        {
          op: 'column.enumLabels',
          tableName: 'public.orders',
          columnName: 'status',
          value: { labels: { paid: 'Paid' }, tones: { paid: 'pos', cancelled: 'danger' } },
        },
        {
          op: 'column.pii',
          tableName: 'public.customers',
          columnName: 'email',
          value: { masked: true, kind: 'email' },
        },
        {
          op: 'relation.add',
          tableName: 'public.order_notes',
          value: { fromColumn: 'order_ref', toTable: 'public.orders', toColumn: 'id', cardinality: 'many-to-one' },
        },
        {
          op: 'table.exclude',
          tableName: 'public.order_notes',
          value: { excluded: true },
        },
        {
          op: 'table.label',
          tableName: 'public.customers',
          value: { label: 'Customers', icon: 'users' },
        },
      ],
    });
  });

  it('carries a price by the night back with its column', () => {
    const value = { from: 'arrive', to: 'depart', rate: { via: 'room_type_id', column: 'base_rate' } };
    const baseline = baselineFromRows([row({ op: 'column.perNight', tableName: 'public.stays', columnName: 'room_total', value })]);
    expect(buildPutDocument(baseline, new Map())).toEqual({ overrides: [{ op: 'column.perNight', tableName: 'public.stays', columnName: 'room_total', value }] });
  });

  it('carries the rules an install keeps back, each with its own column, and a table\'s postings whole', () => {
    const rows = [
      row({ op: 'column.addOnLink', tableName: 'public.order_lines', columnName: 'item_id', value: { addOn: 'kit', table: 'items' } }),
      row({ op: 'column.addOnLink', tableName: 'public.order_lines', columnName: 'batch_id', value: { addOn: 'kit', table: 'batches' } }),
      row({ op: 'column.tableRef', tableName: 'public.links', columnName: 'source_table', value: { tableRef: true } }),
      row({ op: 'column.announce', tableName: 'public.items', columnName: 'low', value: { announce: true } }),
      row({ op: 'column.codeLast4', tableName: 'public.cards', columnName: 'last4', value: { of: 'code' } }),
      row({ op: 'column.plainText', tableName: 'public.order_lines', columnName: 'note', value: { plainText: { digits: 4, max: 80 } } }),
      row({ op: 'column.customerKey', tableName: 'public.orders', columnName: 'buyer_key', value: { of: 'buyer_email' } }),
      row({ op: 'table.postings', tableName: 'public.order_lines', value: { postings: [{ id: 'line', into: { addOn: 'kit', ledger: 'units', action: 'use' }, via: 'order_id', reserve: { on: { create: true } }, map: { account: 'item_id' } }] } }),
      row({ op: 'table.switchedOff', tableName: 'public.order_lines', value: { postings: ['line'] } }),
    ];
    const put = buildPutDocument(baselineFromRows(rows), new Map());
    expect(put.overrides).toHaveLength(rows.length);
    // Two links of one table are two rows: keyed by their column, sent with it.
    expect(put.overrides.filter((item) => item.op === 'column.addOnLink').map((item) => item.columnName).sort()).toEqual(['batch_id', 'item_id']);
    for (const item of put.overrides) {
      const sent = rows.find((candidate) => candidate.op === item.op && (candidate.columnName ?? undefined) === item.columnName);
      expect(sent, `${item.op} ${String(item.columnName)}`).toBeDefined();
      expect(item.value).toEqual(sent!.value);
      expect(item.columnName === undefined).toBe(item.op.startsWith('table.'));
    }
  });

  it('keeps disabled rows disabled and drops removed baseline ops', () => {
    const baseline = baselineFromRows([
      row({ op: 'table.label', tableName: 'public.customers', value: { label: 'Customers' } }),
      row({
        id: 'ovr_2',
        op: 'column.hidden',
        tableName: 'public.customers',
        columnName: 'email',
        value: { hidden: true },
        status: 'disabled',
      }),
    ]);
    const overlay = dropEntry(baseline, new Map(), overrideKey(labelOp));
    expect(buildPutDocument(baseline, overlay)).toEqual({
      overrides: [
        {
          op: 'column.hidden',
          tableName: 'public.customers',
          columnName: 'email',
          value: { hidden: true },
          status: 'disabled',
        },
      ],
    });
  });
});

describe('labelText', () => {
  it('reads a stored label in the person’s language, else English, else any', () => {
    const label = { en_US: 'Category', de_DE: 'Kategorie' };
    expect(labelText(label, 'de_DE')).toBe('Kategorie');
    expect(labelText(label, 'fr_FR')).toBe('Category');
    expect(labelText({ da_DK: 'Kategori' }, 'fr_FR')).toBe('Kategori');
    expect(labelText('Plain', 'de_DE')).toBe('Plain');
    expect(labelText(undefined, 'de_DE')).toBe('');
  });
});
