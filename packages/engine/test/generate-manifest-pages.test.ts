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

  it('judges a table that links to one the database already has, which the model leaves out', () => {
    // A loyalty app on a shop: `customers` is the shop's own table, not the app's.
    const loyalty: ManifestPagesInput = {
      requiredSchema: {
        tables: [
          {
            ref: 'accounts',
            columns: [
              { ref: 'id', type: 'int', role: 'pk' },
              { ref: 'customer_id', type: 'fk', references: 'customers' },
              { ref: 'points', type: 'int', default: 0 },
            ],
          },
        ],
      },
      pages: [page('accounts', 'page-crud', { rows: 'accounts' })],
    };
    expect(checkManifestPages(loyalty)).toEqual([]);
    const column = modelFromRequiredSchema(loyalty).tables[0]?.columns.find((c) => c.name === 'customer_id');
    expect(column).toMatchObject({ logicalType: 'integer', references: null });
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
        { ref: 'odds', type: 'decimal', nullable: true },
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
        { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true },
        { ref: 'entered_at', type: 'timestamptz', nullable: true },
        { ref: 'closes_on', type: 'date', nullable: true },
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
      // The enum's own values, and so no group for the rows with none: one more group than the limit cut the smallest real one.
      filters: [{ column: 'tier', op: 'in', value: ['bronze', 'silver', 'gold'] }],
      limit: 3,
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
    expect((tiers?.config['columnsBinding'] as { filters?: unknown }).filters).toEqual([
      { column: 'stage_id', op: 'in', value: [2] },
      { column: 'tier', op: 'in', value: ['bronze', 'silver', 'gold'] },
    ]);

    // A board that names no `only` carries none: every row, as before.
    const whole = composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board: { column: 'tier' } });
    const all = (whole.envelope?.['config'] as { layout: { items: { widget: string; config: Record<string, unknown> }[] } }).layout.items.find((candidate) => candidate.widget === 'kanban-board');
    expect((all?.config['binding'] as { filters?: unknown }).filters).toBeUndefined();
    expect((all?.config['columnsBinding'] as { filters?: unknown }).filters).toEqual([{ column: 'tier', op: 'in', value: ['bronze', 'silver', 'gold'] }]);
    expect(all?.config['only']).toBeUndefined();
  });

  it('carries a heading’s badge, a card’s facts and the note to the stored board, and asks the server for each fact', () => {
    const written = {
      ...BOARD,
      columnsFrom: { ...BOARD.columnsFrom, badge: { column: 'odds', as: 'percent' } },
      card: { link: 'stage_id.name', person: 'owner_id', amount: 'amount', daysSince: { column: 'entered_at', warnFrom: 14, alertFrom: 30 }, date: 'closes_on' },
      note: { text: 'Columns come from Stages', texts: { 'de-DE': 'Die Spalten kommen aus den Phasen' }, href: '/p/stages' },
    };
    const board = boardColumnsOf(written, (name) => `public.${name}`)!;
    expect(board).toMatchObject({ columnsFrom: { table: 'public.stages', badge: { column: 'odds', as: 'percent' } }, card: written.card, note: written.note });
    const model = modelFromRequiredSchema({ requiredSchema: SALES });
    const built = composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board });
    expect(built.reason).toBe('');
    const item = (built.envelope?.['config'] as { layout: { items: { widget: string; config: Record<string, unknown> }[] } }).layout.items.find((candidate) => candidate.widget === 'kanban-board');
    expect(item?.config).toMatchObject({ columnsFrom: { badge: { column: 'odds', as: 'percent' } }, card: written.card, note: written.note });
    const binding = item?.config['binding'] as { select: string[]; lookups: string[]; people: string[]; daysSince: string[]; orderBy: unknown };
    expect(binding).toMatchObject({ lookups: ['adm_card_link:stage_id.name'], people: ['owner_id'], daysSince: ['adm_card_days:entered_at'], orderBy: [{ column: 'entered_at', dir: 'asc' }] });
    expect(binding.select).toEqual(expect.arrayContaining(['stage_id', 'name', 'amount', 'owner_id', 'entered_at', 'closes_on']));
    // A board that names none of it is stored as it always was.
    const plain = composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board: boardColumnsOf(BOARD, (name) => `public.${name}`)! });
    const bare = (plain.envelope?.['config'] as { layout: { items: { widget: string; config: Record<string, unknown> }[] } }).layout.items.find((candidate) => candidate.widget === 'kanban-board');
    for (const key of ['card', 'note']) expect(bare?.config[key]).toBeUndefined();
    for (const key of ['lookups', 'people', 'daysSince', 'orderBy']) expect((bare?.config['binding'] as Record<string, unknown>)[key]).toBeUndefined();
  });

  it('carries a toolbar, a second money line and what the days are, and asks the server for the total and the people', () => {
    const written = {
      ...BOARD,
      totals: [{ column: 'amount', fn: 'sum' }],
      only: { tier: ['gold', 'silver'] },
      card: { amount: 'amount', secondAmount: { column: 'amount', label: 'w', labels: { 'de-DE': 'gew.' } }, daysSince: { column: 'entered_at', label: 'in stage', labels: { 'de-DE': 'in der Phase' } } },
      toolbar: { total: true, person: 'owner_id' },
    };
    const board = boardColumnsOf(written, (name) => `public.${name}`)!;
    expect(board).toMatchObject({ card: written.card, toolbar: { total: true, person: 'owner_id' } });
    const model = modelFromRequiredSchema({ requiredSchema: SALES });
    const built = composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board });
    expect(built.reason).toBe('');
    const item = (built.envelope?.['config'] as { layout: { items: { widget: string; config: Record<string, unknown> }[] } }).layout.items.find((candidate) => candidate.widget === 'kanban-board');
    expect(item?.config).toMatchObject({ card: written.card, toolbar: { total: true, person: 'owner_id' } });
    const only = [{ column: 'tier', op: 'in', value: ['gold', 'silver'] }];
    // The total: the server's count and each total over every card on the board, one figure a query.
    expect(item?.config['toolbarBindings']).toMatchObject([
      { shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'cards' }], filters: only },
      { shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }], filters: only },
    ]);
    // The people offered: those who hold a card on the board, counted.
    expect(item?.config['personBinding']).toMatchObject({ shape: 'categorical', groupBy: ['owner_id'], aggregations: [{ fn: 'count', alias: 'cards' }], filters: [...only, { column: 'owner_id', op: 'not_null' }] });
    // A toolbar that only filters asks no total; one that names nothing is none.
    const filterOnly = composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board: boardColumnsOf({ ...BOARD, toolbar: { person: 'owner_id' } }, (name) => `public.${name}`)! });
    const filtered = (filterOnly.envelope?.['config'] as { layout: { items: { widget: string; config: Record<string, unknown> }[] } }).layout.items.find((candidate) => candidate.widget === 'kanban-board');
    expect(filtered?.config['toolbarBindings']).toBeUndefined();
    expect(filtered?.config['personBinding']).toBeDefined();
    expect(boardColumnsOf({ ...BOARD, toolbar: {} }, () => undefined)?.toolbar).toBeUndefined();
  });

  it('says which of a card’s facts or which badge the real table cannot answer, and builds no other board', () => {
    const model = modelFromRequiredSchema({ requiredSchema: SALES });
    const from = { table: 'public.stages', label: 'name' };
    const reason = (more: Record<string, unknown>) => composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board: { column: 'stage_id', columnsFrom: from, ...more } as never }).reason;
    expect(reason({ columnsFrom: { ...from, badge: { column: 'chance' } } })).toBe("stages has no column chance for the board's columns");
    expect(reason({ card: { link: 'tier.name' } })).toBe('deals.tier is not a link, so a card has no row to read name from');
    expect(reason({ card: { link: 'stage_id.colour' } })).toBe('stages has no column colour for a card');
    expect(reason({ card: { person: 'nobody' } })).toBe("deals has no column nobody for a card's person");
    expect(reason({ card: { amount: 'name' } })).toBe('deals.name is not a number, so a card cannot show it as an amount');
    expect(reason({ card: { daysSince: { column: 'amount' } } })).toBe('deals.amount is not a date or a time, so a card cannot read a day from it');
    expect(reason({ card: { date: 'nope' } })).toBe("deals has no column nope for a card's date");
    expect(reason({ card: { secondAmount: { column: 'name' } } })).toBe('deals.name is not a number, so a card cannot show it as an amount');
    expect(reason({ toolbar: { person: 'nobody' } })).toBe("deals has no column nobody to choose the board's cards by person");
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

  it('refuses an only whose value the real column cannot be compared with, naming the column and what it takes', () => {
    const model = modelFromRequiredSchema({ requiredSchema: SALES });
    const reason = (only: { column: string; in: (string | number | boolean)[] }[]) => composeRequestedPage(model, 'public.deals', 'page-board', { ...CONTEXT, board: { column: 'tier', only } }).reason;
    // A link to a table keyed by a whole number: text installs, and then every read of the board's columns is refused.
    expect(reason([{ column: 'stage_id', in: ['7'] }])).toBe('deals.stage_id takes whole numbers, so "7" cannot choose the board\'s cards');
    expect(reason([{ column: 'stage_id', in: [2, 2.5] }])).toBe('deals.stage_id takes whole numbers, so 2.5 cannot choose the board\'s cards');
    expect(reason([{ column: 'name', in: [3] }])).toBe('deals.name takes text, so 3 cannot choose the board\'s cards');
    expect(reason([{ column: 'amount', in: ['much'] }])).toBe('deals.amount takes numbers, so "much" cannot choose the board\'s cards');
    expect(reason([{ column: 'stage_id', in: [7] }])).toBe('');
    // On Postgres a whole number is held to the column's own width.
    const postgres = { ...model, dialect: 'postgres' as const };
    expect(composeRequestedPage(postgres, 'public.deals', 'page-board', { ...CONTEXT, board: { column: 'tier', only: [{ column: 'stage_id', in: [3_000_000_000] }] } }).reason).toBe(
      'deals.stage_id takes whole numbers from -2147483648 to 2147483647, so 3000000000 cannot choose the board\'s cards',
    );
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
