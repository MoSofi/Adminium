// SPDX-License-Identifier: AGPL-3.0-only
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
  opTakesValue,
  rolesFor,
  summarizeBinding,
  withShape,
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

  it('builds the rollup form of the shapes that have two — never the row form', () => {
    // The server accepts an adjacency projection for `hierarchy/tree` and a
    // coordinate one for `geo-points`; the editor authors the ROLLUP of each,
    // which is spelled exactly like `matrix`/`categorical` and so needs no
    // bespoke control (see SHAPE_CONTROLS).
    const tree = descriptorFromDraft(
      ordersDraft({ shape: 'hierarchy/tree', groupBy: ['status', 'channel'], limit: 100 }),
    );
    expect(tree.ok).toBe(true);
    if (!tree.ok) return;
    expect(tree.descriptor.groupBy).toEqual(['status', 'channel']);
    expect(tree.descriptor.select).toBeUndefined();

    const flows = descriptorFromDraft(
      ordersDraft({ shape: 'flows', groupBy: ['source', 'target'], limit: 100 }),
    );
    expect(flows.ok).toBe(true);
    if (!flows.ok) return;
    expect(flows.descriptor.aggregations).toEqual([{ fn: 'count', alias: 'value' }]);

    const geo = descriptorFromDraft(ordersDraft({ shape: 'geo-points', groupBy: ['region'] }));
    expect(geo.ok).toBe(true);

    // Two keys are not optional for the two-key rollups.
    expect(descriptorFromDraft(ordersDraft({ shape: 'hierarchy/tree', groupBy: ['status'] }))).toEqual({
      ok: false,
      issues: ['groupBy'],
    });
  });

  it('builds a bucketed ohlc: one value column, no measure', () => {
    const built = descriptorFromDraft(
      ordersDraft({ shape: 'ohlc', bucketColumn: 'created_at', bucketUnit: 'day', select: ['total'] }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.aggregations).toBeUndefined();
    expect(built.descriptor.bucket).toEqual({ column: 'created_at', unit: 'day' });
    expect(built.descriptor.select).toEqual(['total']);
    // The server caps its own fold, so the editor offers no row control.
    expect(built.descriptor.limit).toBeUndefined();
  });

  it('builds a boolean-map positionally and refuses a half-filled projection', () => {
    const built = descriptorFromDraft(
      ordersDraft({ shape: 'boolean-map', select: ['status', 'archived'], limit: 100 }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.select).toEqual(['status', 'archived']);

    // Both slots are required, and order names them — a single column cannot be
    // stored as "whichever one the user meant".
    expect(descriptorFromDraft(ordersDraft({ shape: 'boolean-map', select: ['status'] }))).toEqual({
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
    // `static` is config-only — no server round trip, so no form to load into.
    // Not a compiler gap waiting to close: this fallback is permanent for it
    // and for `form-state`, which the CRUD form path feeds instead.
    const draft = draftFromDescriptor({
      kind: 'table-query',
      connectionId: 'conn_1',
      source: { name: 'stores', type: 'table' },
      shape: 'static',
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

  it('drops shapes no query descriptor can produce', () => {
    expect(authorableShapes(['record-list', 'static'])).toEqual(['record-list']);
    expect(authorableShapes('form-state')).toEqual([]);
  });

  it('offers the shapes the compiler learned last, in COMPILABLE_DATA_SHAPES order', () => {
    // The five that used to return `[]` here. `authorableShapes` reads the same
    // shared constant the compiler validates against, so this is a derivation,
    // not a second list to keep in step.
    expect(authorableShapes('hierarchy/tree')).toEqual(['hierarchy/tree']);
    expect(authorableShapes('geo-points')).toEqual(['geo-points']);
    expect(authorableShapes('flows')).toEqual(['flows']);
    expect(authorableShapes('ohlc')).toEqual(['ohlc']);
    expect(authorableShapes('boolean-map')).toEqual(['boolean-map']);
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

describe('withShape', () => {
  /** A draft with every control filled, whatever the shape offers. */
  const full: BindingDraft = {
    ...emptyDraft('conn_1', 'matrix'),
    schema: 'public',
    table: 'orders',
    measureFn: 'sum',
    measureColumn: 'total',
    groupBy: ['status', 'channel'],
    bucketColumn: 'created_at',
    windowColumn: 'created_at',
    select: ['id', 'status'],
    orderByColumn: 'created_at',
    limit: 7,
  };

  it('keeps the identifiers a shape switch never invalidates', () => {
    const next = withShape(full, 'timeseries');
    expect(next.connectionId).toBe('conn_1');
    expect(next.schema).toBe('public');
    expect(next.table).toBe('orders');
    expect(next.shape).toBe('timeseries');
  });

  it('truncates groupBy to what the new shape accepts', () => {
    // matrix (2 keys) → categorical (1) drops the trailing key rather than
    // handing the compiler a descriptor it rejects.
    expect(withShape(full, 'categorical').groupBy).toEqual(['status']);
    expect(withShape(full, 'timeseries').groupBy).toEqual([]);
    expect(withShape(full, 'matrix').groupBy).toEqual(['status', 'channel']);
  });

  it('resets the measure for the shapes that take none', () => {
    // `distribution` derives quantiles itself; the compiler rejects aggregations.
    const next = withShape(full, 'distribution');
    expect(next.measureFn).toBe('count');
    expect(next.measureColumn).toBe('');
    // …and keeps it for one that does.
    expect(withShape(full, 'timeseries').measureColumn).toBe('total');
  });

  it('clears the time axis, the window and the sort the new shape has no control for', () => {
    const categorical = withShape(full, 'categorical');
    expect(categorical.bucketColumn).toBe(''); // no bucket control
    expect(categorical.windowColumn).toBe(''); // window: 'off'
    expect(categorical.orderByColumn).toBe(''); // no order control

    const list = withShape(full, 'record-list');
    expect(list.orderByColumn).toBe('created_at'); // order: true — kept
    expect(list.windowColumn).toBe(''); // window: 'off' — cleared
  });

  it('clears a projection the new shape does not select', () => {
    expect(withShape(full, 'categorical').select).toEqual([]);
    expect(withShape(full, 'record-list').select).toEqual(['id', 'status']);
  });

  it('re-defaults the row cap to the new shape rather than carrying the old one', () => {
    expect(withShape(full, 'categorical').limit).toBe(8);
    expect(withShape(full, 'record-list').limit).toBe(50);
    expect(withShape(full, 'calendar-events').limit).toBe(500);
  });

  it('leaves a switched draft buildable without further edits', () => {
    // The point of the re-keying: the compiler must accept whatever the switch
    // produced, given the new shape's own required controls are filled.
    const timeseries = withShape(full, 'timeseries');
    const built = descriptorFromDraft({ ...timeseries, bucketColumn: 'created_at' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.groupBy).toBeUndefined();
    expect(built.descriptor.select).toBeUndefined();
    expect(built.descriptor.orderBy).toBeUndefined();
  });
});

describe('emptyDraft', () => {
  it('seeds the row cap from the shape, not from a single global default', () => {
    expect(emptyDraft('conn_1', 'single-metric').limit).toBe(100);
    expect(emptyDraft('conn_1', 'categorical').limit).toBe(8);
    expect(emptyDraft('conn_1', 'record-list').limit).toBe(50);
    expect(emptyDraft('conn_1', 'record').limit).toBe(1);
    expect(emptyDraft('conn_1', 'calendar-events').limit).toBe(500);
  });

  it('is incomplete until a table is chosen', () => {
    expect(descriptorFromDraft(emptyDraft('conn_1', 'single-metric'))).toEqual({
      ok: false,
      issues: ['table'],
    });
    expect(descriptorFromDraft(emptyDraft('', 'single-metric'))).toEqual({
      ok: false,
      issues: ['connection', 'table'],
    });
  });
});

describe('opTakesValue', () => {
  it('is false only for the operators with no operand', () => {
    expect(opTakesValue('is_null')).toBe(false);
    expect(opTakesValue('not_null')).toBe(false);
    expect(opTakesValue('eq')).toBe(true);
    expect(opTakesValue('in')).toBe(true);
    expect(opTakesValue('between')).toBe(true);
  });
});

describe('rolesFor', () => {
  it('names the calendar slots in descriptor order, marking the optional tail', () => {
    expect(rolesFor('calendar-events').map((role) => [role.key, role.required])).toEqual([
      ['date', true],
      ['title', true],
      ['category', false],
      ['end', false],
    ]);
  });

  it('narrows the date slots to temporal columns', () => {
    const roles = rolesFor('calendar-events');
    expect(roles.filter((role) => role.kind === 'temporal').map((role) => role.key)).toEqual(['date', 'end']);
  });

  it('is empty for a shape whose projection is not positional', () => {
    // `record-list` selects a free column list, `single-metric` selects nothing —
    // neither renders slot pickers.
    expect(rolesFor('record-list')).toEqual([]);
    expect(rolesFor('single-metric')).toEqual([]);
  });
});

describe('positional projections', () => {
  const calendar = (select: string[]): BindingDraft =>
    ordersDraft({ shape: 'calendar-events', select, orderByColumn: '', limit: 500 });

  it('stores the two required slots and allows the optional tail to stay blank', () => {
    const built = descriptorFromDraft(calendar(['due_at', 'title']));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.select).toEqual(['due_at', 'title']);
  });

  it('rejects a filled slot after a blank one — order names the roles', () => {
    // Skipping `category` but filling `end` would land the end date in the
    // category slot, where the calendar reads it as a lane name.
    expect(descriptorFromDraft(calendar(['due_at', 'title', '', 'ends_at']))).toEqual({
      ok: false,
      issues: ['select'],
    });
  });

  it('rejects a blank required slot even when the optional ones are filled', () => {
    expect(descriptorFromDraft(calendar(['', 'title', 'kind']))).toEqual({
      ok: false,
      issues: ['select'],
    });
  });

  it('accepts a contiguous run through the optional slots', () => {
    const built = descriptorFromDraft(calendar(['due_at', 'title', 'kind', 'ends_at']));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.select).toEqual(['due_at', 'title', 'kind', 'ends_at']);
  });
});

describe('single-column and free-list projections', () => {
  it('takes the first non-blank column for a one-column shape', () => {
    const built = descriptorFromDraft(
      ordersDraft({ shape: 'distribution', select: ['', 'duration_ms'], limit: 100 }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.select).toEqual(['duration_ms']);
    // `distribution` derives its own quantiles — no aggregation may ride along.
    expect(built.descriptor.aggregations).toBeUndefined();
  });

  it('lets a distribution break down by one key, and refuses two', () => {
    expect(descriptorFromDraft(ordersDraft({ shape: 'distribution', select: ['ms'], groupBy: ['region'] })).ok).toBe(
      true,
    );
    const two = descriptorFromDraft(
      ordersDraft({ shape: 'distribution', select: ['ms'], groupBy: ['region', 'tier'] }),
    );
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    // The second key is past `groupBy.max` and is dropped, not stored.
    expect(two.descriptor.groupBy).toEqual(['region']);
  });

  it('drops blank rows from a free column list and refuses an all-blank one', () => {
    const built = descriptorFromDraft(ordersDraft({ shape: 'stream', select: ['', 'body', ''], limit: 50 }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.select).toEqual(['body']);

    expect(descriptorFromDraft(ordersDraft({ shape: 'stream', select: ['', ''] }))).toEqual({
      ok: false,
      issues: ['select'],
    });
  });

  it('caps a `record` at one row without offering a row control', () => {
    const built = descriptorFromDraft(ordersDraft({ shape: 'record', select: ['id', 'status'], limit: 999 }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // `limit: false` for this shape — whatever the draft carries is not stored.
    expect(built.descriptor.limit).toBeUndefined();
  });
});

describe('filter operand coercion', () => {
  it('splits `between` into a two-element list and types both ends', () => {
    const built = descriptorFromDraft(
      ordersDraft({ filters: [{ column: 'total', op: 'between', value: '10, 250', kind: 'number' }] }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.filters).toEqual([{ column: 'total', op: 'between', value: [10, 250] }]);
  });

  it('keeps unparseable numeric text as text rather than storing NaN', () => {
    const built = descriptorFromDraft(
      ordersDraft({ filters: [{ column: 'total', op: 'gt', value: 'twelve', kind: 'number' }] }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.filters).toEqual([{ column: 'total', op: 'gt', value: 'twelve' }]);
  });

  it('reads any boolean operand other than `true` as false', () => {
    const built = descriptorFromDraft(
      ordersDraft({
        filters: [
          { column: 'archived', op: 'eq', value: 'TRUE ', kind: 'boolean' },
          { column: 'paid', op: 'eq', value: '', kind: 'boolean' },
        ],
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.filters).toEqual([
      { column: 'archived', op: 'eq', value: true },
      { column: 'paid', op: 'eq', value: false },
    ]);
  });

  it('drops the empty entries of a list operand', () => {
    const built = descriptorFromDraft(
      ordersDraft({ filters: [{ column: 'status', op: 'in', value: 'open, , paid,', kind: 'text' }] }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.descriptor.filters).toEqual([{ column: 'status', op: 'in', value: ['open', 'paid'] }]);
  });
});

describe('draftFromDescriptor — full round trip', () => {
  it('loads every control a bucketed, windowed, sorted descriptor fills', () => {
    const stored: QueryDescriptor = {
      kind: 'table-query',
      connectionId: 'conn_1',
      source: { schema: 'public', name: 'orders', type: 'view' },
      shape: 'timeseries',
      aggregations: [{ fn: 'avg', column: 'total', alias: 'value' }],
      bucket: { column: 'created_at', unit: 'week' },
      window: { column: 'created_at', last: 12, unit: 'week', compareToPrior: false },
      orderBy: [{ column: 'created_at', dir: 'asc' }],
      limit: 24,
    };
    const draft = draftFromDescriptor(stored);
    expect(draft).toMatchObject({
      schema: 'public',
      table: 'orders',
      sourceType: 'view',
      shape: 'timeseries',
      measureFn: 'avg',
      measureColumn: 'total',
      bucketColumn: 'created_at',
      bucketUnit: 'week',
      windowColumn: 'created_at',
      windowLast: 12,
      windowUnit: 'week',
      orderByColumn: 'created_at',
      orderByDir: 'asc',
      limit: 24,
    });
    // `timeseries` has no sort control, so the sort is what the round trip
    // drops — and the rebuilt window carries the delta card's flag, spelled
    // `false` here because the shape is not `metric+delta`.
    const rebuilt = descriptorFromDraft(draft);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    const { orderBy, window, ...unchanged } = stored;
    expect(orderBy).toBeDefined();
    expect(rebuilt.descriptor.orderBy).toBeUndefined();
    expect(rebuilt.descriptor.window).toEqual({ ...window, compareToPrior: false });
    expect(rebuilt.descriptor).toMatchObject(unchanged);
  });

  it('ignores a measure function the form has no control for', () => {
    // `percentile` is deliberately absent from MEASURE_FNS.
    const draft = draftFromDescriptor({
      kind: 'table-query',
      connectionId: 'conn_1',
      source: { name: 'requests', type: 'table' },
      shape: 'single-metric',
      aggregations: [{ fn: 'percentile', column: 'ms', p: 0.95, alias: 'value' }],
    });
    expect(draft.measureFn).toBe('count');
    expect(draft.measureColumn).toBe('');
  });

  it('types a numeric, boolean and valueless filter back into their controls', () => {
    const draft = draftFromDescriptor({
      kind: 'table-query',
      connectionId: 'conn_1',
      source: { name: 'orders', type: 'table' },
      shape: 'record-list',
      select: ['id'],
      filters: [
        { column: 'total', op: 'gte', value: 250 },
        { column: 'archived', op: 'eq', value: false },
        { column: 'total', op: 'between', value: [10, 250] },
        { column: 'closed_at', op: 'is_null' },
      ],
    });
    expect(draft.filters).toEqual([
      { column: 'total', op: 'gte', value: '250', kind: 'number' },
      { column: 'archived', op: 'eq', value: 'false', kind: 'boolean' },
      { column: 'total', op: 'between', value: '10, 250', kind: 'number' },
      { column: 'closed_at', op: 'is_null', value: '', kind: 'text' },
    ]);
  });

  it('keeps a positional projection in slot order', () => {
    const draft = draftFromDescriptor({
      kind: 'table-query',
      connectionId: 'conn_1',
      source: { name: 'shifts', type: 'table' },
      shape: 'calendar-events',
      select: ['starts_at', 'title', 'role', 'ends_at'],
    });
    expect(draft.select).toEqual(['starts_at', 'title', 'role', 'ends_at']);
    const rebuilt = descriptorFromDraft(draft);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.descriptor.select).toEqual(['starts_at', 'title', 'role', 'ends_at']);
  });
});

describe('draftIsLossy — the rest of the form gaps', () => {
  const base: QueryDescriptor = {
    kind: 'table-query',
    connectionId: 'conn_1',
    source: { name: 'orders', type: 'table' },
    shape: 'record-list',
    select: ['id'],
  };

  it('flags a multi-key sort — the form authors one', () => {
    expect(
      draftIsLossy({
        ...base,
        orderBy: [
          { column: 'created_at', dir: 'desc' },
          { column: 'id', dir: 'asc' },
        ],
      }),
    ).toBe(true);
    expect(draftIsLossy({ ...base, orderBy: [{ column: 'created_at', dir: 'desc' }] })).toBe(false);
  });

  it('flags a cursor-paginated descriptor', () => {
    expect(draftIsLossy({ ...base, cursor: 'c_42' })).toBe(true);
  });
});
