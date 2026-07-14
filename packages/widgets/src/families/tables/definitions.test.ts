import { describe, expect, it } from 'vitest';

import { tablesWidgetDefinitions } from './definitions.js';
import { buildRegistry } from '../../registry/index.js';

/**
 * Registry-metadata contract for the tables family (annex §3 sizing rows —
 * annex heights are rows, sizing uses 40px half-units → ×2).
 */
describe('tablesWidgetDefinitions', () => {
  const byId = new Map(tablesWidgetDefinitions.map((d) => [d.id, d]));

  it('registers the M4-T03 slice with unique ids', () => {
    expect([...byId.keys()].sort()).toEqual([
      'bulk-action-toolbar',
      'data-grid',
      'detail-key-value',
      'mini-table',
      'pagination-footer',
    ]);
    expect(() => buildRegistry(tablesWidgetDefinitions)).not.toThrow();
  });

  it('all belong to the tables family', () => {
    for (const definition of tablesWidgetDefinitions) expect(definition.family).toBe('tables');
  });

  it('data-grid: record-list contract, annex sizing 6×3 → 12×5, table skeleton', () => {
    const grid = byId.get('data-grid');
    expect(grid?.dataContract).toBe('record-list');
    expect(grid?.sizing).toEqual({ minW: 6, minH: 6, defaultW: 12, defaultH: 10 });
    expect(grid?.skeleton).toBe('table');
    expect(grid?.placement).toBe('grid');
    expect(grid?.capabilities?.editsData).toBe(true);
    expect(grid?.capabilities?.exportCsv).toBe(true);
  });

  it('detail-key-value: record contract, annex 4×3 → 4×4', () => {
    const detail = byId.get('detail-key-value');
    expect(detail?.dataContract).toBe('record');
    expect(detail?.sizing).toEqual({ minW: 4, minH: 6, defaultW: 4, defaultH: 8 });
  });

  it('mini-table: annex 3×2 → 4×3, list skeleton', () => {
    const mini = byId.get('mini-table');
    expect(mini?.dataContract).toBe('record-list');
    expect(mini?.sizing).toEqual({ minW: 3, minH: 4, defaultW: 4, defaultH: 6 });
    expect(mini?.skeleton).toBe('list');
  });

  it('attached widgets are inline placements', () => {
    expect(byId.get('pagination-footer')?.placement).toBe('inline');
    expect(byId.get('bulk-action-toolbar')?.placement).toBe('inline');
  });

  it('demoData is deterministic per seed and matches the record-list shape', () => {
    const grid = byId.get('data-grid');
    const a = grid?.demoData(7);
    const b = grid?.demoData(7);
    const c = grid?.demoData(8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const payload = a as { data: unknown[]; columns: unknown[] };
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data.length).toBeGreaterThan(0);
    expect(Array.isArray(payload.columns)).toBe(true);
    // pg-style serialization: money rides as a string (defect-input realism)
    const first = payload.data[0] as Record<string, unknown>;
    expect(typeof first['mrr']).toBe('string');
  });

  it('every config schema accepts {} (shared-config defaults)', () => {
    for (const definition of tablesWidgetDefinitions) {
      expect(definition.configSchema.safeParse({}).success).toBe(true);
    }
  });
});
