/**
 * Binding-draft translation + validity (04-widget-registry.md §5.1).
 *
 * The first block is the acceptance test for the whole binding editor: a widget
 * the user drags in through `placement.ts` starts with NO `binding` key — the
 * shared config schema has it `.optional()`, so `safeParse({})` cannot invent
 * one — which means `extractBindings` skips it and the widget renders
 * `demoData(seed)` in production, forever. Authoring a binding has to close
 * that loop end to end, so the assertion is on the far end of it: the saved
 * layout, read back the way the dashboard reads it.
 */
import { describe, expect, it } from 'vitest';
import { getWidget } from '@adminium/widgets';
import type { PageLayout, QueryDescriptor } from '@adminium/engine/config';

import { extractBindings } from '../../api/widgetData.js';
import { makeDashboardEnvelope } from '../../test/fixtures.js';
import {
  authorableShapes,
  descriptorFromDraft,
  draftFromDescriptor,
  draftIsLossy,
  emptyDraft,
  summarizeBinding,
  type BindingDraft,
} from './bindingDraft.js';
import { insertWidget, updateItemConfig } from './placement.js';

const EMPTY: PageLayout = { version: 1, items: [] };

/** A complete draft over `public.orders`, as the editor's controls would leave it. */
function ordersDraft(overrides: Partial<BindingDraft> = {}): BindingDraft {
  return {
    ...emptyDraft('conn_1', 'single-metric'),
    schema: 'public',
    table: 'orders',
    ...overrides,
  };
}

describe('inserted widget → saved layout → extractBindings', () => {
  it('carries the authored binding all the way to the widget-data batch', () => {
    const definition = getWidget('kpi-stat-card');
    expect(definition).toBeDefined();

    // 1. The user adds a widget from the palette.
    const { layout, itemId } = insertWidget(EMPTY, definition!);
    const inserted = layout.items.find((item) => item.i === itemId);
    expect(inserted?.config['binding']).toBeUndefined(); // demo data — the defect

    // 2. The user authors a query in the binding editor.
    const built = descriptorFromDraft(ordersDraft({ measureFn: 'sum', measureColumn: 'total' }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // 3. The inspector writes it onto the item's stored config and the layout saves.
    const saved = updateItemConfig(layout, itemId, {
      ...inserted!.config,
      binding: built.descriptor,
    });
    const page = makeDashboardEnvelope({ config: { layout: saved } });

    // 4. The dashboard collects it on the next mount.
    const { requests, invalid } = extractBindings(page);
    expect(invalid.size).toBe(0);
    const request = requests.find((entry) => entry.instanceId === itemId);
    expect(request).toBeDefined();
    expect(request?.descriptor.source).toEqual({ schema: 'public', name: 'orders', type: 'table' });
    expect(request?.descriptor.aggregations).toEqual([
      { fn: 'sum', column: 'total', alias: 'value' },
    ]);
  });

  it('clearing the binding puts the widget back on demo data', () => {
    const definition = getWidget('kpi-stat-card');
    const { layout, itemId } = insertWidget(EMPTY, definition!);
    const built = descriptorFromDraft(ordersDraft());
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const bound = updateItemConfig(layout, itemId, { binding: built.descriptor });
    const cleared = updateItemConfig(bound, itemId, {});
    expect(extractBindings(makeDashboardEnvelope({ config: { layout: bound } })).requests).toHaveLength(1);
    expect(extractBindings(makeDashboardEnvelope({ config: { layout: cleared } })).requests).toHaveLength(0);
  });
});

describe('descriptorFromDraft', () => {
  it('emits count(*) with the generator alias when no measure column is chosen', () => {
    const built = descriptorFromDraft(ordersDraft());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.kind).toBe('table-query');
    expect(built.descriptor.aggregations).toEqual([{ fn: 'count', alias: 'value' }]);
    // Metric shapes carry no limit — the compiler rejects grouping/bucketing on
    // them and needs no row cap for a scalar.
    expect(built.descriptor.limit).toBeUndefined();
  });

  it('omits `schema` for engines that have none', () => {
    const built = descriptorFromDraft(ordersDraft({ schema: '' }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.source).toEqual({ name: 'orders', type: 'table' });
  });

  it('requires a column for every function except count', () => {
    expect(descriptorFromDraft(ordersDraft({ measureFn: 'sum' }))).toEqual({
      ok: false,
      issues: ['measureColumn'],
    });
    expect(descriptorFromDraft(ordersDraft({ measureFn: 'count' })).ok).toBe(true);
  });

  it('requires a table', () => {
    expect(descriptorFromDraft(ordersDraft({ table: '' }))).toEqual({ ok: false, issues: ['table'] });
  });

  it('builds a timeseries with a bucket and a row cap', () => {
    const built = descriptorFromDraft(
      ordersDraft({ shape: 'timeseries', bucketColumn: 'created_at', bucketUnit: 'month', limit: 100 }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.bucket).toEqual({ column: 'created_at', unit: 'month' });
    expect(built.descriptor.limit).toBe(100);
  });

  it('refuses a timeseries with no time axis', () => {
    expect(descriptorFromDraft(ordersDraft({ shape: 'timeseries' }))).toEqual({
      ok: false,
      issues: ['bucket'],
    });
  });

  it('builds a categorical with exactly one groupBy', () => {
    const built = descriptorFromDraft(ordersDraft({ shape: 'categorical', groupBy: ['status'], limit: 8 }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.groupBy).toEqual(['status']);
    expect(built.descriptor.bucket).toBeUndefined();
  });

  it('builds a metric+delta with a prior-period window', () => {
    const built = descriptorFromDraft(
      ordersDraft({ shape: 'metric+delta', windowColumn: 'created_at', windowLast: 30, windowUnit: 'day' }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.window).toEqual({
      column: 'created_at',
      last: 30,
      unit: 'day',
      compareToPrior: true,
    });
  });

  it('builds a record-list as a projection, never an aggregation', () => {
    const built = descriptorFromDraft(
      ordersDraft({
        shape: 'record-list',
        select: ['id', 'status', 'total'],
        orderByColumn: 'created_at',
        orderByDir: 'desc',
        limit: 50,
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.aggregations).toBeUndefined();
    expect(built.descriptor.select).toEqual(['id', 'status', 'total']);
    expect(built.descriptor.orderBy).toEqual([{ column: 'created_at', dir: 'desc' }]);
  });

  it('refuses a record-list with nothing selected', () => {
    expect(descriptorFromDraft(ordersDraft({ shape: 'record-list' }))).toEqual({
      ok: false,
      issues: ['select'],
    });
  });

  it('types filter operands by the column kind and splits list operators', () => {
    const built = descriptorFromDraft(
      ordersDraft({
        filters: [
          { column: 'status', op: 'in', value: 'open, paid', kind: 'text' },
          { column: 'total', op: 'gte', value: '250', kind: 'number' },
          { column: 'archived', op: 'eq', value: 'false', kind: 'boolean' },
          { column: 'closed_at', op: 'is_null', value: '', kind: 'text' },
        ],
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.filters).toEqual([
      { column: 'status', op: 'in', value: ['open', 'paid'] },
      { column: 'total', op: 'gte', value: 250 },
      { column: 'archived', op: 'eq', value: false },
      { column: 'closed_at', op: 'is_null' },
    ]);
  });

  it('reports a filter row with no column', () => {
    const built = descriptorFromDraft(
      ordersDraft({ filters: [{ column: '', op: 'eq', value: 'x', kind: 'text' }] }),
    );
    expect(built).toEqual({ ok: false, issues: ['filters'] });
  });
});

describe('draftFromDescriptor', () => {
  it('round-trips a descriptor the generator writes', () => {
    // `kpi.money-sum` in packages/widgets/src/registry/candidates.ts, verbatim.
    const generated: QueryDescriptor = {
      kind: 'table-query',
      connectionId: 'conn_1',
      source: { schema: 'public', name: 'orders', type: 'table' },
      shape: 'single-metric',
      aggregations: [{ fn: 'sum', column: 'total', alias: 'value' }],
    };
    const rebuilt = descriptorFromDraft(draftFromDescriptor(generated));
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.descriptor).toEqual(generated);
  });

  it('renders filter operands back into their text controls', () => {
    const draft = draftFromDescriptor({
      kind: 'table-query',
      connectionId: 'conn_1',
      source: { name: 'orders', type: 'table' },
      shape: 'single-metric',
      aggregations: [{ fn: 'count', alias: 'value' }],
      filters: [{ column: 'status', op: 'in', value: ['open', 'paid'] }],
    });
    expect(draft.filters).toEqual([
      { column: 'status', op: 'in', value: 'open, paid', kind: 'text' },
    ]);
  });

  it('falls back to a metric shape when the stored shape is not compilable', () => {
    // `geo-points` is one of the five shapes 04 §5.2 still lists as outstanding
    // in the compiler — a descriptor carrying it has no form to load into.
    const draft = draftFromDescriptor({
      kind: 'table-query',
      connectionId: 'conn_1',
      source: { name: 'stores', type: 'table' },
      shape: 'geo-points',
    });
    expect(draft.shape).toBe('single-metric');
  });
});

describe('draftIsLossy', () => {
  const base: QueryDescriptor = {
    kind: 'table-query',
    connectionId: 'conn_1',
    source: { name: 'orders', type: 'table' },
    shape: 'single-metric',
    aggregations: [{ fn: 'count', alias: 'value' }],
  };

  it('is false for anything the form can express', () => {
    expect(draftIsLossy(base)).toBe(false);
  });

  it('flags multi-aggregation descriptors', () => {
    expect(
      draftIsLossy({
        ...base,
        aggregations: [
          { fn: 'percentile', column: 'ms', p: 0.5, alias: 'p50' },
          { fn: 'percentile', column: 'ms', p: 0.9, alias: 'p90' },
        ],
      }),
    ).toBe(true);
  });

  it('flags a filter bound to a page control', () => {
    expect(
      draftIsLossy({ ...base, filters: [{ column: 'created_at', op: 'gte', param: 'dateRange.start' }] }),
    ).toBe(true);
  });
});

describe('authorableShapes', () => {
  it('widens metric+delta to the single-metric the generator already binds', () => {
    // COMPILABLE_DATA_SHAPES order, not declaration order — two widgets that
    // accept the same set must offer the picker in the same order.
    expect(authorableShapes('metric+delta')).toEqual(['single-metric', 'metric+delta']);
  });

  it('drops shapes the compiler cannot produce yet', () => {
    expect(authorableShapes(['record-list', 'geo-points'])).toEqual(['record-list']);
    expect(authorableShapes('flows')).toEqual([]);
  });

  it('matches every widget the registry ships', () => {
    // The registry's own contract is the input; this pins that the widening
    // table never invents a shape outside COMPILABLE_DATA_SHAPES.
    const definition = getWidget('data-grid');
    expect(authorableShapes(definition!.dataContract)).toEqual(['record-list']);
  });
});

describe('summarizeBinding', () => {
  it('reads a measure binding', () => {
    expect(
      summarizeBinding({
        kind: 'table-query',
        connectionId: 'conn_1',
        source: { schema: 'public', name: 'orders', type: 'table' },
        shape: 'single-metric',
        aggregations: [{ fn: 'count', alias: 'value' }],
        filters: [{ column: 'status', op: 'eq', value: 'open' }],
      }),
    ).toEqual({
      source: 'public.orders',
      measure: 'count(*)',
      columns: null,
      shape: 'single-metric',
      filterCount: 1,
    });
  });

  it('reads a projection binding', () => {
    expect(
      summarizeBinding({
        kind: 'table-query',
        connectionId: 'conn_1',
        source: { name: 'orders', type: 'table' },
        shape: 'record-list',
        select: ['id', 'status'],
      }),
    ).toEqual({
      source: 'orders',
      measure: null,
      columns: 2,
      shape: 'record-list',
      filterCount: 0,
    });
  });
});
