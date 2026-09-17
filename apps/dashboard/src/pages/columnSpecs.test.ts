// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { gridColumnSpecSchema, type CrudApi, type GridColumnSpec } from '@adminium/widgets';

import { parseColumns, projectionParamsOf, withFkDisplay, withLookups } from './columnSpecs.js';

/**
 * `withFkDisplay` — the FK-chip display derivation: `fk.display` (the
 * generator's stamp) becomes a `lookup=` param + a `displayKey`, inside the
 * server's MAX_LOOKUPS budget and never displacing an explicit lookup column.
 */

function col(input: Record<string, unknown>): GridColumnSpec {
  return gridColumnSpecSchema.parse({ label: 'Col', logicalType: 'integer', ...input });
}

const fkClient = col({
  name: 'client_id',
  semantic: 'fk',
  fk: { table: 'public.clients', column: 'id', display: 'name' },
});

describe('withFkDisplay', () => {
  it('derives the display lookup and stamps displayKey', () => {
    const plan = withFkDisplay([fkClient]);
    expect(plan.lookups).toEqual(['client_id__display:client_id.name']);
    expect(plan.columns[0]?.fk).toEqual({
      table: 'public.clients',
      column: 'id',
      display: 'name',
      displayKey: 'client_id__display',
    });
  });

  it('leaves stored-config columns without fk.display untouched (no params, no stamps)', () => {
    const legacy = col({ name: 'client_id', semantic: 'fk', fk: { table: 'public.clients', column: 'id' } });
    const plan = withFkDisplay([legacy]);
    expect(plan.lookups).toEqual([]);
    expect(plan.columns[0]).toEqual(legacy);
  });

  it('respects a pre-set displayKey instead of deriving a second lookup', () => {
    const preset = col({
      name: 'client_id',
      semantic: 'fk',
      fk: { table: 'public.clients', column: 'id', display: 'name', displayKey: 'client_name' },
    });
    const plan = withFkDisplay([preset]);
    expect(plan.lookups).toEqual([]);
    expect(plan.columns[0]?.fk?.displayKey).toBe('client_name');
  });

  it('reuses an explicit single-hop lookup of the same display value instead of spending budget', () => {
    const linked = col({
      name: 'client_id__name',
      logicalType: 'varchar',
      lookup: { path: ['client_id'], select: 'name' },
      sortable: false,
    });
    const plan = withFkDisplay([fkClient, linked]);
    // One param — the explicit column's own — and the chip reads its alias.
    expect(plan.lookups).toEqual(['client_id__name:client_id.name']);
    expect(plan.columns[0]?.fk?.displayKey).toBe('client_id__name');
  });

  it('keeps explicit lookups first and drops derived overflow deterministically at the cap', () => {
    const explicit = Array.from({ length: 11 }, (_, i) =>
      col({
        name: `lk_${String(i)}`,
        logicalType: 'varchar',
        lookup: { path: ['ref_id'], select: `col_${String(i)}` },
        sortable: false,
      }),
    );
    const fkOther = col({
      name: 'vendor_id',
      semantic: 'fk',
      fk: { table: 'public.vendors', column: 'id', display: 'name' },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // 11 explicit + 2 candidates → budget 1: first FK wins, second drops.
      const plan = withFkDisplay([...explicit, fkClient, fkOther]);
      expect(plan.lookups).toHaveLength(12);
      expect(plan.lookups.at(-1)).toBe('client_id__display:client_id.name');
      expect(plan.columns.at(-1)?.fk?.displayKey).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('vendor_id'));
    } finally {
      warn.mockRestore();
    }
  });

  it('skips an alias that collides with a spec name (server refuses shadowing aliases)', () => {
    const shadow = col({ name: 'client_id__display', logicalType: 'varchar' });
    const plan = withFkDisplay([fkClient, shadow]);
    expect(plan.lookups).toEqual([]);
    expect(plan.columns[0]?.fk?.displayKey).toBeUndefined();
  });

  it('skips aliases outside the server grammar (64-byte column names)', () => {
    const long = col({
      name: 'a'.repeat(60),
      semantic: 'fk',
      fk: { table: 'public.clients', column: 'id', display: 'name' },
    });
    const plan = withFkDisplay([long]);
    expect(plan.lookups).toEqual([]);
  });
});


/**
 * `projectionParamsOf` — the wire params a page's projections spend. Three
 * foot-guns, all of which blank a whole page as a 422 if they reach the
 * server.
 */
describe('projectionParamsOf', () => {
  const reverse = (name: string, agg = 'count') =>
    col({ name, reverse: { table: 'public.invoice_items', fkColumn: 'invoice_id', agg } });

  const OWNERS_DERIVED = {
    measures: [
      {
        id: 'subtotal',
        table: 'public.invoice_items',
        fkColumn: 'invoice_id',
        fn: 'sum',
        of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
      },
    ],
    fields: [
      { id: 'total', scale: 2, expr: { op: 'add', args: [{ measure: 'subtotal' }, { lit: '0' }] } },
    ],
  };

  it('emits count aggregates and the derived block', () => {
    const params = projectionParamsOf([reverse('item_count')], { derived: OWNERS_DERIVED });
    expect(params.agg).toEqual(['item_count:public.invoice_items.invoice_id:count']);
    expect(JSON.parse(params.compute ?? 'null')).toEqual(OWNERS_DERIVED);
  });

  it('never lets a stored non-count agg reach the wire', () => {
    // `reverse.agg` is an open string the config schema and the PATCH route
    // both accept, and the server's grammar is `count` — a stored `sum` is a
    // hard 422 that blanks the page, so it is dropped instead (D15).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const params = projectionParamsOf([reverse('total', 'sum'), reverse('item_count')]);
    expect(params.agg).toEqual(['item_count:public.invoice_items.invoice_id:count']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops the 13th projection with a warning rather than 422ing the page', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const columns = Array.from({ length: 13 }, (_, i) => reverse(`c${String(i)}`));
    expect(projectionParamsOf(columns).agg).toHaveLength(12);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops the WHOLE derived block when the shared budget cannot hold it', () => {
    // Partial is worse than none: a field referencing a dropped measure is
    // itself a 422, so half a block trades one refusal for another.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const columns = Array.from({ length: 12 }, (_, i) => reverse(`c${String(i)}`));
    const params = projectionParamsOf(columns, { derived: OWNERS_DERIVED });
    expect(params.agg).toHaveLength(12);
    expect(params.compute).toBeUndefined();
    warn.mockRestore();
  });

  it('degrades an unreadable derived block to none', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(projectionParamsOf([], { derived: { measures: 'nope' } }).compute).toBeUndefined();
    expect(projectionParamsOf([], {}).compute).toBeUndefined();
    warn.mockRestore();
  });
});

describe('parseColumns forces projections closed to sorting (D14)', () => {
  it('overrides a hand-edited sortable:true on every projection family', () => {
    const columns = parseColumns(
      {
        columns: [
          { name: 'id', label: 'Id', logicalType: 'integer', sortable: true },
          { name: 'client', label: 'Client', lookup: { path: ['client_id'], select: 'name' }, sortable: true },
          {
            name: 'items',
            label: 'Items',
            reverse: { table: 'public.invoice_items', fkColumn: 'invoice_id', agg: 'count' },
            sortable: true,
          },
          { name: 'total', label: 'Total', derived: { ref: 'total' }, sortable: true },
        ],
      },
      'page_1',
    );
    expect(columns.map((column) => column.sortable)).toEqual([true, false, false, false]);
  });
});

describe('withLookups', () => {
  it('adds compute to both reads, and stays a pass-through with nothing to add', () => {
    const calls: unknown[] = [];
    const api = {
      list: (params: unknown) => {
        calls.push(params);
        return Promise.resolve({ data: [] });
      },
      get: (_id: string, options: unknown) => {
        calls.push(options);
        return Promise.resolve({ data: {} });
      },
    } as unknown as CrudApi;
    const decorated = withLookups(api, [], [], '{"measures":[]}');
    void decorated.list({});
    void decorated.get('7');
    expect(calls).toEqual([{ compute: '{"measures":[]}' }, { compute: '{"measures":[]}' }]);
    expect(withLookups(api, [], [])).toBe(api);
  });
});
