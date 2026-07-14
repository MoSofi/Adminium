/**
 * Contract pin for the Studio remap editor (M5-T04): the exact PUT documents
 * the dashboard's edit buffer emits (see
 * apps/dashboard/src/studio/remap/overrides.test.ts — the literals here are
 * copies of the ones asserted there) must parse against the real server
 * schemas: `overridesPutBody` (route body) and `validateOverrideInput`
 * (@adminium/meta §3.15 op vocabulary). Offline — no DB, no HTTP.
 */
import { describe, expect, it } from 'vitest';
import { MetaValidationError, validateOverrideInput } from '@adminium/meta';

import { overridesPutBody } from '../src/routes/schema/schema.js';

/** Documents the dashboard buffer builds (`buildPutDocument`) — keep in sync. */
const DASHBOARD_DOCUMENTS = [
  {
    name: 'single table.label edit',
    document: {
      overrides: [{ op: 'table.label', tableName: 'public.customers', value: { label: 'Clients' } }],
    },
  },
  {
    name: 'one op of every kind the editor emits',
    document: {
      overrides: [
        {
          op: 'column.enumLabels',
          tableName: 'public.orders',
          columnName: 'status',
          value: { labels: { paid: 'Paid' }, tones: { paid: 'pos', cancelled: 'danger' } },
        },
        {
          op: 'column.label',
          tableName: 'public.orders',
          columnName: 'total',
          value: { label: 'Order total' },
        },
        {
          op: 'column.pii',
          tableName: 'public.customers',
          columnName: 'email',
          value: { masked: false, kind: 'email' },
        },
        {
          op: 'column.semanticType',
          tableName: 'public.orders',
          columnName: 'total',
          value: { semanticType: 'money', currency: 'USD' },
        },
        {
          op: 'relation.add',
          tableName: 'public.order_notes',
          value: { fromColumn: 'order_ref', toTable: 'public.orders', toColumn: 'id', cardinality: 'many-to-one' },
        },
        {
          op: 'relation.remove',
          tableName: 'public.order_notes',
          value: { fromColumn: 'order_ref', toTable: 'public.orders' },
        },
        { op: 'table.exclude', tableName: 'public.order_notes', value: { excluded: true } },
        { op: 'table.label', tableName: 'public.customers', value: { label: 'Clients', icon: 'users' } },
      ],
    },
  },
  {
    name: 'disabled row survives the round trip',
    document: {
      overrides: [
        {
          op: 'column.hidden',
          tableName: 'public.customers',
          columnName: 'email',
          value: { hidden: true },
          status: 'disabled',
        },
      ],
    },
  },
] as const;

describe('dashboard PUT documents parse against the route body schema', () => {
  for (const { name, document } of DASHBOARD_DOCUMENTS) {
    it(name, () => {
      const parsed = overridesPutBody.safeParse(document);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    });
  }
});

describe('every item passes the §3.15 op-vocabulary validation', () => {
  it('accepts each dashboard-emitted item', () => {
    for (const { document } of DASHBOARD_DOCUMENTS) {
      for (const item of document.overrides) {
        expect(() =>
          validateOverrideInput({
            connectionId: 'conn_1',
            op: item.op,
            tableName: item.tableName,
            columnName: 'columnName' in item ? item.columnName : null,
            value: item.value,
          }),
        ).not.toThrow();
      }
    }
  });

  it('rejects the shapes the editor must never emit', () => {
    // Table-level op with a columnName (the buffer omits columnName for these).
    expect(() =>
      validateOverrideInput({
        connectionId: 'conn_1',
        op: 'table.label',
        tableName: 'public.customers',
        columnName: 'name',
        value: { label: 'Clients' },
      }),
    ).toThrow(MetaValidationError);
    // Column op without a columnName.
    expect(() =>
      validateOverrideInput({
        connectionId: 'conn_1',
        op: 'column.pii',
        tableName: 'public.customers',
        columnName: null,
        value: { masked: true },
      }),
    ).toThrow(MetaValidationError);
    // Unknown op (e.g. the not-yet-specced table.navGroup) stays rejected.
    expect(() =>
      validateOverrideInput({
        connectionId: 'conn_1',
        op: 'table.navGroup',
        tableName: 'public.customers',
        columnName: null,
        value: { group: 'workspace' },
      }),
    ).toThrow(MetaValidationError);
    // relation.add with a cardinality outside the op vocabulary.
    expect(() =>
      validateOverrideInput({
        connectionId: 'conn_1',
        op: 'relation.add',
        tableName: 'public.order_notes',
        columnName: null,
        value: { fromColumn: 'order_ref', toTable: 'public.orders', toColumn: 'id', cardinality: 'sideways' },
      }),
    ).toThrow(MetaValidationError);
  });
});
