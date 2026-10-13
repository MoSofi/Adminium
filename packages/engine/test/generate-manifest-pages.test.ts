// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app manifest's pages, checked against the manifest's own tables — what
 * an app's CI runs before it publishes, and what the install preview reports.
 */
import { describe, expect, it } from 'vitest';

import { boardColumnsOf, checkManifestPages, composeRequestedPage, modelFromRequiredSchema, pageSourceTable, templateFit, type ManifestPagesInput } from '../src/generate/index.js';

const TABLES: ManifestPagesInput['requiredSchema'] = {
  tables: [
    {
      ref: 'patients',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text' },
      ],
    },
    {
      ref: 'appointments',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'reason', type: 'text' },
        { ref: 'patient_id', type: 'fk', references: 'patients' },
        { ref: 'starts_at', type: 'timestamptz' },
      ],
    },
  ],
};

const page = (ref: string, template: string, bindings?: Record<string, string>) => ({
  ref,
  template,
  ...(bindings === undefined ? {} : { bindings }),
});

describe('pageSourceTable', () => {
  it('reads both conventions in the fleet', () => {
    expect(pageSourceTable(page('a', 'page-crud', { orders: 'orders' }))).toBe('orders');
    expect(pageSourceTable(page('a', 'page-crud', { rows: 'rooms', types: 'room_types' }))).toBe('rooms');
    expect(pageSourceTable(page('a', 'page-crud', { a: 'x', b: 'y' }))).toBeNull();
    expect(pageSourceTable(page('a', 'page-crud'))).toBeNull();
  });
});

describe('checkManifestPages', () => {
  it('a bound calendar over a table with a date passes', () => {
    expect(
      checkManifestPages({
        requiredSchema: TABLES,
        pages: [page('day', 'page-calendar', { rows: 'appointments' })],
      }),
    ).toEqual([]);
  });

  it('an unbound table-bound page is reported; a dashboard is not', () => {
    const issues = checkManifestPages({
      requiredSchema: TABLES,
      pages: [page('day', 'page-calendar'), page('home', 'page-dashboard')],
    });
    expect(issues.map((i) => [i.page, i.code])).toEqual([['day', 'PAGE_UNBOUND']]);
  });

  it('a calendar bound to a table with no date is unfit, with the fit report', () => {
    const [issue] = checkManifestPages({
      requiredSchema: TABLES,
      pages: [page('people', 'page-calendar', { rows: 'patients' })],
    });
    expect(issue?.code).toBe('PAGE_UNFIT');
    expect(issue?.fit?.requirements.find((r) => r.role === 'event-date')?.satisfiedBy).toBeNull();
  });

  it('names an unknown template, an undeclared table and an ambiguous binding', () => {
    const issues = checkManifestPages({
      requiredSchema: TABLES,
      pages: [
        page('legacy', 'table', { orders: 'orders' }),
        page('ghost', 'page-crud', { rows: 'invoices' }),
        page('two', 'page-crud', { a: 'patients', b: 'appointments' }),
      ],
    });
    expect(issues.map((i) => i.code)).toEqual([
      'PAGE_TEMPLATE_UNKNOWN',
      'PAGE_BINDING_UNKNOWN',
      'PAGE_BINDING_AMBIGUOUS',
    ]);
  });
});

/** Deals that move through stages a sales team keeps in a table: no workflow enum anywhere. */
const SALES: ManifestPagesInput['requiredSchema'] = {
  tables: [
    {
      ref: 'stages',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'position', type: 'int' },
      ],
    },
    {
      ref: 'deals',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text', maxLength: 120 },
        { ref: 'stage_id', type: 'fk', references: 'stages', nullable: true },
        { ref: 'amount', type: 'money', nullable: true },
        { ref: 'tier', type: 'enum', enum: ['bronze', 'silver', 'gold'] },
      ],
    },
  ],
};

const BOARD = { column: 'stage_id', columnsFrom: { table: 'stages', label: 'name', order: 'position' }, title: 'name', totals: [{ column: 'amount', fn: 'sum' }] };
const CONTEXT = { connectionId: 'c1', slug: 'pipeline', id: 'page_1', navGroup: 'planning' as const, navIcon: 'square-kanban', navOrder: 1 };

describe('a board whose columns a page names', () => {
  const boardPage = (config?: Record<string, unknown>) => ({ ...page('pipeline', 'page-board', { rows: 'deals' }), ...(config === undefined ? {} : { config }) });

  it('is unfit on a table with no workflow enum, until the page names its columns', () => {
    expect(checkManifestPages({ requiredSchema: SALES, pages: [boardPage()] }).map((i) => i.code)).toEqual(['PAGE_UNFIT']);
    expect(checkManifestPages({ requiredSchema: SALES, pages: [boardPage({ board: BOARD })] })).toEqual([]);
    // An enum that reads as no workflow is a board once the page says so.
    expect(checkManifestPages({ requiredSchema: SALES, pages: [boardPage({ board: { column: 'tier' } })] })).toEqual([]);
  });

  it('stays unfit when the named column cannot carry the board, and the report says which column plays the part', () => {
    const model = modelFromRequiredSchema({ requiredSchema: SALES });
    const wrong = templateFit(model, 'public.deals', 'page-board', { board: { column: 'stage_id' } });
    expect(wrong.satisfied).toBe(false);
    const right = templateFit(model, 'public.deals', 'page-board', { board: { column: 'stage_id', columnsFrom: { table: 'public.stages', label: 'name' } } });
    expect(right.satisfied).toBe(true);
    expect(right.requirements.find((r) => r.role === 'status-workflow')?.satisfiedBy).toBe('stage_id');
  });

  it('composes a board that reads its columns from the table, the link among the columns it reads', () => {
    const model = modelFromRequiredSchema({ requiredSchema: SALES });
    const board = { ...BOARD, columnsFrom: { ...BOARD.columnsFrom, table: 'public.stages' }, totals: [{ column: 'amount', fn: 'sum' as const }] };
    const built = composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board });
    const items = (built.envelope?.['config'] as { layout: { items: { widget: string; config: Record<string, unknown> }[] } }).layout.items;
    const item = items.find((candidate) => candidate.widget === 'kanban-board');
    expect(item?.config).toMatchObject({
      statusColumn: 'stage_id',
      columnsFrom: { table: 'public.stages', key: 'id', label: 'name', order: 'position' },
      titleColumn: 'name',
      totals: [{ column: 'amount', fn: 'sum' }],
    });
    expect(item?.config['columns']).toBeUndefined();
    expect((item?.config['binding'] as { select: string[] }).select).toEqual(expect.arrayContaining(['stage_id', 'name', 'amount']));
    // No lane is guessed for a named board: it is the plain board.
    expect(items.some((candidate) => candidate.widget === 'kanban-swimlane-grid')).toBe(false);
  });

  it('composes an enum board with a second query that counts and totals each value', () => {
    const model = modelFromRequiredSchema({ requiredSchema: SALES });
    const built = composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board: { column: 'tier', totals: [{ column: 'amount', fn: 'avg' }] } });
    const items = (built.envelope?.['config'] as { layout: { items: { widget: string; config: Record<string, unknown> }[] } }).layout.items;
    const item = items.find((candidate) => candidate.widget === 'kanban-board');
    expect(item?.config).toMatchObject({ statusColumn: 'tier', columns: ['bronze', 'silver', 'gold'] });
    expect(item?.config['columnsBinding']).toMatchObject({
      shape: 'categorical',
      groupBy: ['tier'],
      aggregations: [
        { fn: 'count', alias: 'cards' },
        { fn: 'avg', column: 'amount', alias: 'total0' },
      ],
    });
  });

  it('composes a board of some of its rows: the cards listed, the stored tests and an enum board’s counts carry the condition', () => {
    const model = modelFromRequiredSchema({ requiredSchema: SALES });
    const filters = [{ column: 'tier', op: 'in', value: ['gold', 'silver'] }];
    const only = [{ column: 'tier', in: ['gold', 'silver'] }];
    const board = { ...BOARD, columnsFrom: { ...BOARD.columnsFrom, table: 'public.stages' }, totals: [{ column: 'amount', fn: 'sum' as const }], only };
    const built = composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board });
    const item = (built.envelope?.['config'] as { layout: { items: { widget: string; config: Record<string, unknown> }[] } }).layout.items.find((candidate) => candidate.widget === 'kanban-board');
    expect((item?.config['binding'] as { filters?: unknown }).filters).toEqual(filters);
    // What the host reads to ask each column's count and totals of the same cards.
    expect(item?.config['only']).toEqual(only);

    // An enum board: its counting query takes the same condition as its cards.
    const byTier = composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board: { column: 'tier', only: [{ column: 'stage_id', in: [2] }] } });
    const tiers = (byTier.envelope?.['config'] as { layout: { items: { widget: string; config: Record<string, unknown> }[] } }).layout.items.find((candidate) => candidate.widget === 'kanban-board');
    expect((tiers?.config['binding'] as { filters?: unknown }).filters).toEqual([{ column: 'stage_id', op: 'in', value: [2] }]);
    expect((tiers?.config['columnsBinding'] as { filters?: unknown }).filters).toEqual([{ column: 'stage_id', op: 'in', value: [2] }]);

    // A board that names no `only` carries none: every row, as before.
    const whole = composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board: { column: 'tier' } });
    const all = (whole.envelope?.['config'] as { layout: { items: { widget: string; config: Record<string, unknown> }[] } }).layout.items.find((candidate) => candidate.widget === 'kanban-board');
    expect((all?.config['binding'] as { filters?: unknown }).filters).toBeUndefined();
    expect((all?.config['columnsBinding'] as { filters?: unknown }).filters).toBeUndefined();
    expect(all?.config['only']).toBeUndefined();
  });

  it('reads only as the manifest writes it, and refuses a board whose only cannot be asked rather than draw every row', () => {
    expect(boardColumnsOf({ column: 'stage_id', only: { tier: 'gold', hot: [true, false], weight: [1, 2] } }, () => undefined)?.only).toEqual([
      { column: 'tier', in: ['gold'] },
      { column: 'hot', in: [true, false] },
      { column: 'weight', in: [1, 2] },
    ]);
    expect(boardColumnsOf({ column: 'stage_id' }, () => undefined)?.only).toBeUndefined();
    const model = modelFromRequiredSchema({ requiredSchema: SALES });
    const built = (board: Parameters<typeof composeRequestedPage>[3]['board']) => composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board });
    expect(built({ column: 'tier', only: [{ column: 'state', in: ['open'] }] }).reason).toBe("deals has no column state to choose the board's cards by");
    expect(built({ column: 'tier', only: [{ column: 'tier', in: ['gold'] }] }).reason).toBe("deals.tier is what the board's columns are, so it cannot also choose its cards");
    expect(built(boardColumnsOf({ column: 'tier', only: { stage_id: { eq: 2 } } }, () => undefined)!).reason).toBe("deals.stage_id is given no value to choose the board's cards by");
    expect(built({ column: 'tier', only: [{ column: 'state', in: ['open'] }] }).envelope).toBeNull();
  });

  it('says why a table cannot be the board it was asked for', () => {
    const model = modelFromRequiredSchema({ requiredSchema: SALES });
    const reason = (board: Parameters<typeof composeRequestedPage>[3]['board']) => composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board }).reason;
    expect(reason({ column: 'stage' })).toBe("deals has no column stage to place the board's cards by");
    expect(reason({ column: 'stage_id' })).toBe('deals.stage_id is not an enum, so the board has no columns to take from it');
    expect(reason({ column: 'tier', columnsFrom: { table: 'public.stages', label: 'name' } })).toBe('deals.tier is not a link to stages');
    expect(reason({ column: 'stage_id', columnsFrom: { table: 'public.stages', label: 'title' } })).toBe("stages has no column title for the board's columns");
    expect(reason({ column: 'tier', totals: [{ column: 'name', fn: 'sum' }] })).toBe('deals.name is not a number, so the board cannot total it');
  });
});
