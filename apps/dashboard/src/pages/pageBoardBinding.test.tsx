// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `PageBoardBinding` over a board whose columns are the rows of a table,
 * through the real router and the real query client.
 *
 * Worth proving: the columns are read ONCE, from the table the page names,
 * in its order, with a count and a total of the page's own table as measures;
 * each header shows the server's count and the total in the connection's
 * currency; a realtime frame of the columns' table reads them again, and so
 * does a frame of the cards' table — one request each, never a storm; and a
 * move the server refuses puts the card back and shows the server's words.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';

import { invalidateForRealtimeEvent } from '../api/realtime.js';
import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { boardCompute, boardReadOf, boardColumnsKey } from './planning/boardColumns.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const CARDS = { kind: 'table-query', connectionId: 'conn_1', source: { name: 'deals', schema: 'public', type: 'table' }, shape: 'record-list', select: ['stage_id', 'name', 'amount'], limit: 200 };

function boardPage(config: Record<string, unknown>): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_pipeline',
    template: 'page-board',
    title: { key: 'nav.pipeline', fallback: 'Pipeline' },
    source: { connectionId: 'conn_1', table: 'public.deals' },
    nav: { group: 'workspace', icon: 'square-kanban', order: 10, slug: 'pipeline' },
    access: { minRole: 'viewer', permissions: [] },
    config: { templateVersion: 1, toolbar: [], overlays: [], layout: { version: 1, items: [{ i: 'board-1', widget: 'kanban-board', x: 0, y: 0, w: 12, h: 16, config }] } },
  } as unknown as PageEnvelope;
}

const PIPELINE = boardPage({
  title: 'Deals',
  statusColumn: 'stage_id',
  titleColumn: 'name',
  columnsFrom: { table: 'public.stages', key: 'id', label: 'name', order: 'position' },
  totals: [{ column: 'amount', fn: 'sum' }],
  binding: CARDS,
});

const DEALS = [
  { id: 1, name: 'Harbour Hotels', stage_id: 1, amount: '100.00' },
  { id: 2, name: 'Northfield Dental', stage_id: 3, amount: '300.00' },
];

interface Fixture {
  page?: PageEnvelope;
  /** The stages as the next read answers them. */
  stages: Record<string, unknown>[];
  /** What a save of a deal answers. */
  patch?: () => Response;
}

let columnReads: URL[];
let batches: { instanceId: string }[][];
let patches: { url: string; body: unknown }[];

function stub(fixture: Fixture) {
  columnReads = [];
  batches = [];
  patches = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/bootstrap')) {
        const bootstrap = makeBootstrap();
        bootstrap.nav.groups[0]?.items.push({ pageId: 'page_pipeline', slug: 'pipeline', labelKey: 'nav.pipeline', fallback: 'Pipeline', icon: 'square-kanban', order: 5, currency: 'EUR' });
        return jsonResponse(200, { data: bootstrap });
      }
      if (url.startsWith('/api/v1/pages/page_pipeline')) {
        return jsonResponse(200, {
          data: fixture.page ?? PIPELINE,
          columnFacts: {
            table: { labelSingular: 'Deal', labelPlural: 'Deals' },
            columns: [
              { spec: { name: 'name', label: 'Name', logicalType: 'varchar' }, filledBy: null, required: true, writable: true },
              { spec: { name: 'amount', label: 'Amount', logicalType: 'decimal', semantic: 'money' }, filledBy: null, required: false, writable: true },
            ],
          },
        });
      }
      if (url === '/api/v1/widget-data/batch' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { requests: { instanceId: string; descriptor: { shape: string } }[] };
        batches.push(body.requests);
        return jsonResponse(200, {
          results: Object.fromEntries(
            body.requests.map((request) => [
              request.instanceId,
              request.descriptor.shape === 'categorical'
                ? { ok: true, result: { shape: 'categorical', items: [{ key: 'todo', label: 'todo', value: 41, values: { cards: 41, total0: 1250.5 } }], total: 41 }, cached: false }
                : { ok: true, result: { shape: 'record-list', rows: DEALS, columns: [], key: 'id' }, cached: false },
            ]),
          ),
        });
      }
      if (url.startsWith('/api/v1/data/conn_1/public.stages') && method === 'GET') {
        columnReads.push(new URL(url, 'http://dashboard.test'));
        return jsonResponse(200, { data: fixture.stages, page: { limit: 100, offset: 0, total: fixture.stages.length } });
      }
      if (url.startsWith('/api/v1/data/conn_1/public.deals/') && method === 'PATCH') {
        patches.push({ url, body: JSON.parse(String(init?.body)) });
        return fixture.patch?.() ?? jsonResponse(200, { data: {}, undoToken: null });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } });
    }),
  );
}

async function renderBoard(fixture: Fixture): Promise<QueryClient> {
  stub(fixture);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/p/pipeline'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return queryClient;
}

const STAGES = [
  { id: 2, name: 'Qualified', board_count: 0, board_total_0: '0' },
  { id: 1, name: 'Lead', board_count: 340, board_total_0: '12400.00' },
  { id: 3, name: 'Proposal', board_count: 1, board_total_0: '300.00' },
];

const columnIds = () => [...document.querySelectorAll('[data-board-column]')].map((el) => el.getAttribute('data-board-column'));
const part = (column: string, name: string) => document.querySelector(`[data-board-column="${column}"] [data-part="${name}"]`)?.textContent;
/** Let every request a render started come back, and anything they start in turn. */
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a board that takes its columns from a table', () => {
  it('reads the columns once, in the table’s order, with a count and a total of its own table as measures', async () => {
    await renderBoard({ stages: STAGES });
    await screen.findByText('Qualified');
    await settle();
    expect(columnReads).toHaveLength(1);
    const asked = columnReads[0]!.searchParams;
    expect(asked.get('order')).toBe('position.asc');
    expect(asked.get('select')).toBe('id,name');
    expect(JSON.parse(asked.get('compute')!)).toEqual({
      measures: [
        { id: 'board_count', table: 'public.deals', fkColumn: 'stage_id', fn: 'count' },
        { id: 'board_total_0', table: 'public.deals', fkColumn: 'stage_id', fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['amount'] }] } },
      ],
    });
    // The cards, once too: one batch, the board's own query.
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((request) => request.instanceId)).toEqual(['board-1']);
  });

  it('a board of some of its rows asks each count and total of those rows, and lists those cards', async () => {
    const only = [{ column: 'state', in: ['open'] }];
    const cards = { ...CARDS, filters: [{ column: 'state', op: 'in', value: ['open'] }] };
    const page = boardPage({ title: 'Deals', statusColumn: 'stage_id', titleColumn: 'name', columnsFrom: { table: 'public.stages', key: 'id', label: 'name', order: 'position' }, totals: [{ column: 'amount', fn: 'sum' }], only, binding: cards });
    await renderBoard({ stages: STAGES, page });
    await screen.findByText('Qualified');
    await settle();
    expect(columnReads).toHaveLength(1);
    // The condition rides every measure: a count of every deal beside a sum of the open ones would be two boards in one header.
    expect(JSON.parse(columnReads[0]!.searchParams.get('compute')!)).toEqual({
      measures: [
        { id: 'board_count', table: 'public.deals', fkColumn: 'stage_id', fn: 'count', where: only },
        { id: 'board_total_0', table: 'public.deals', fkColumn: 'stage_id', fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['amount'] }] }, where: only },
      ],
    });
    // And the cards are asked for with the same condition, as the stored binding says it.
    expect(batches).toHaveLength(1);
    expect((batches[0]![0] as unknown as { descriptor: { filters: unknown } }).descriptor.filters).toEqual([{ column: 'state', op: 'in', value: ['open'] }]);
  });

  it('heads each column with the server’s count and the total in the connection’s currency, an empty one too', async () => {
    await renderBoard({ stages: STAGES });
    await screen.findByText('Qualified');
    expect(columnIds()).toEqual(['2', '1', '3']);
    // 340, though two cards are listed: the count is the server's.
    expect(part('1', 'column-count')).toBe('340');
    expect(part('1', 'column-total')).toBe('€12,400');
    expect(part('2', 'column-count')).toBe('0');
    expect(part('2', 'column-total')).toBe('€0');
    expect(within(screen.getByTestId('column-drop-1')).getByText('Harbour Hotels')).toBeDefined();
    expect(within(screen.getByTestId('column-drop-3')).getByText('Northfield Dental')).toBeDefined();
  });

  it('a frame of the columns’ table reads them again, and the new row is a column with no reload', async () => {
    const fixture: Fixture = { stages: STAGES };
    const queryClient = await renderBoard(fixture);
    await screen.findByText('Qualified');
    await settle();
    fixture.stages = [{ id: 9, name: 'Negotiation', board_count: 0, board_total_0: '0' }, ...STAGES.map((stage) => (stage.id === 1 ? { ...stage, name: 'New lead' } : stage))];
    act(() => invalidateForRealtimeEvent(queryClient, { channel: 'table:conn_1:public.stages', type: 'insert', data: {} } as never));
    await screen.findByText('Negotiation');
    expect(columnIds()).toEqual(['9', '2', '1', '3']);
    expect(screen.getByText('New lead')).toBeDefined();
    await settle();
    // One frame, one more read: identical requests are not repeated.
    expect(columnReads).toHaveLength(2);
    expect(columnReads[1]!.search).toBe(columnReads[0]!.search);
  });

  it('a frame of the cards’ table reads the counts again, once', async () => {
    const fixture: Fixture = { stages: STAGES };
    const queryClient = await renderBoard(fixture);
    await screen.findByText('Qualified');
    await settle();
    fixture.stages = STAGES.map((stage) => (stage.id === 1 ? { ...stage, board_count: 341, board_total_0: '12900.00' } : stage));
    act(() => invalidateForRealtimeEvent(queryClient, { channel: 'table:conn_1:public.deals', type: 'update', data: {} } as never));
    await waitFor(() => expect(part('1', 'column-count')).toBe('341'));
    expect(part('1', 'column-total')).toBe('€12,900');
    await settle();
    expect(columnReads).toHaveLength(2);
    expect(batches).toHaveLength(2);
  });

  it('a move saves the stage’s own key, and the columns are read again after it', async () => {
    await renderBoard({ stages: STAGES });
    const card = await screen.findByRole('button', { name: 'Harbour Hotels' });
    await settle();
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    fireEvent.keyDown(card, { key: 'Enter' });
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ url: '/api/v1/data/conn_1/public.deals/1', body: { values: { stage_id: 3 } } });
    await waitFor(() => expect(columnReads).toHaveLength(2));
    await settle();
    expect(columnReads).toHaveLength(2);
  });

  it('a move the server refuses puts the card back and shows the server’s words', async () => {
    const words = 'You can change this deal only while its state is Open.';
    await renderBoard({
      stages: STAGES,
      patch: () => jsonResponse(403, { error: { code: 'COLUMN_FORBIDDEN', message: words, requestId: 'r', details: { table: 'public.deals', column: 'state', reason: 'update-from', writableFrom: ['open'] } } }),
    });
    const card = await screen.findByRole('button', { name: 'Harbour Hotels' });
    await settle();
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    fireEvent.keyDown(card, { key: 'Enter' });
    await waitFor(() => expect(document.querySelector('[data-part="board-move-refused"]')).not.toBeNull());
    expect(document.querySelector('[data-part="board-move-refused"]')!.textContent).toContain(words);
    expect(document.querySelector('[data-board-liveregion]')!.textContent).toContain(words);
    // Back where it was.
    expect(within(screen.getByTestId('column-drop-1')).getByText('Harbour Hotels')).toBeDefined();
    expect(within(screen.getByTestId('column-drop-3')).queryByText('Harbour Hotels')).toBeNull();
    await settle();
    // A refused save changed nothing, so nothing is read again.
    expect(columnReads).toHaveLength(1);
  });
});

describe('a board over an enum the page named', () => {
  const TASKS = boardPage({
    title: 'Deals',
    statusColumn: 'state',
    titleColumn: 'name',
    columns: ['todo', 'done'],
    totals: [{ column: 'amount', fn: 'sum' }],
    columnsBinding: { ...CARDS, shape: 'categorical', select: undefined, aggregations: [{ fn: 'count', alias: 'cards' }, { fn: 'sum', column: 'amount', alias: 'total0' }], groupBy: ['state'], limit: 2 },
    binding: CARDS,
  });

  it('counts and totals each value in the page’s one batch, and reads no table for its columns', async () => {
    await renderBoard({ stages: [], page: TASKS });
    await waitFor(() => expect(part('todo', 'column-count')).toBe('41'));
    expect(part('todo', 'column-total')).toBe('€1,250.50');
    expect(part('done', 'column-count')).toBe('0');
    await settle();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((request) => request.instanceId).sort()).toEqual(['board-1', 'board-1:columns']);
    expect(columnReads).toHaveLength(0);
  });
});

describe('what a board says of its columns', () => {
  it('reads the columns again when the board takes another key or another label from the same table', () => {
    const read = boardReadOf(PIPELINE)!;
    const key = (from: Partial<NonNullable<typeof read.from>>): string =>
      JSON.stringify(boardColumnsKey('page_pipeline', { ...read, from: { ...read.from!, ...from } }, undefined));
    expect(key({})).toBe(key({}));
    expect(key({ key: 'code' })).not.toBe(key({}));
    expect(key({ label: 'title' })).not.toBe(key({}));
    // Still under the prefix a frame of either table, and a save here, invalidate.
    expect(boardColumnsKey('page_pipeline', read, undefined).slice(0, 2)).toEqual(['widget-data', 'page_pipeline']);
  });


  it('is read off the stored item: nothing for a board that names none', () => {
    expect(boardReadOf(boardPage({ statusColumn: 'status', columns: ['todo'], binding: CARDS }))).toBeNull();
    const read = boardReadOf(PIPELINE)!;
    expect(read).toMatchObject({ instanceId: 'board-1', connectionId: 'conn_1', cardsTable: 'public.deals', column: 'stage_id', from: { table: 'public.stages', key: 'id', label: 'name', order: 'position' } });
    expect(JSON.parse(boardCompute({ ...read, totals: [] }))).toEqual({ measures: [{ id: 'board_count', table: 'public.deals', fkColumn: 'stage_id', fn: 'count' }] });
    expect(read.only).toEqual([]);
    // `only` is read off the item too; an entry that is no test is not one.
    const narrowed = boardReadOf(boardPage({ statusColumn: 'stage_id', columnsFrom: { table: 'public.stages', label: 'name' }, only: [{ column: 'state', in: ['open', 'won'] }, { column: 'hot', in: [true] }, { column: 'kind' }, 'x'], binding: CARDS }))!;
    expect(narrowed.only).toEqual([{ column: 'state', in: ['open', 'won'] }, { column: 'hot', in: [true] }]);
  });
});
