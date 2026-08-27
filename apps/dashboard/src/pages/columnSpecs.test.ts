// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { gridColumnSpecSchema, type GridColumnSpec } from '@adminium/widgets';

import { withFkDisplay } from './columnSpecs.js';

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
