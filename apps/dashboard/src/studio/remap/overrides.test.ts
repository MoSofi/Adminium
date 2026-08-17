// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dirty-state buffer core: keying, stage/drop/revert semantics, change
 * listing, and the EXACT `PUT /connections/:id/overrides` document shape.
 * The literals asserted here are re-validated against the real server Zod
 * schemas in `apps/server/test/remap-payload-contract.test.ts` — keep the
 * two in sync when the §3.15 vocabulary changes.
 */
import { describe, expect, it } from 'vitest';

import {
  baselineFromRows,
  bufferChanges,
  buildPutDocument,
  dropEntry,
  effectiveEntry,
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
