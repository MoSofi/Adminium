// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `PageBoardBinding` over a board whose columns are the rows of a table,
 * through the real router and the real query client.
 *
 * Worth proving: the columns are read ONCE, from the table the page names,
 * in its order, with a count and a total of the page's own table as measures;
 * each header shows the server's count and the total in the column's own
 * currency, else the connection's; the page SUBSCRIBES to the cards' table
 * and the columns' table, a frame of either reads the cards and the columns
 * again — one request each for a burst, never a storm — and leaving the page
 * unsubscribes; and a move the server refuses puts the card back and shows
 * the server's words.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { appStreamTransport, resetAppStreamTransport } from './lmc/stream.js';
import { BOARD_COLUMNS_LIMIT, boardCompute, boardReadOf, boardColumnsKey } from './planning/boardColumns.js';
import { BOARD_LIVE_WAIT_MS, boardLiveChannels } from './planning/boardLive.js';

/** Every socket the render opened (the shell's, and the shared stream's), with what each was sent. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: { op: string; channel: string }[] = [];
  constructor() {
    FakeWebSocket.instances.push(this);
  }
  send(frame: string): void {
    this.sent.push(JSON.parse(frame) as { op: string; channel: string });
  }
  close(): void {}
}

/** The server accepts every socket: each then asks for its channels. */
function openSockets(): void {
  for (const socket of FakeWebSocket.instances) {
    if (socket.readyState === 1) continue;
    socket.readyState = 1;
    socket.onopen?.();
  }
}

/** What the sockets were asked for, in order: `subscribe widget-data:…`. */
const asked = (): string[] => FakeWebSocket.instances.flatMap((socket) => socket.sent.map((frame) => `${frame.op} ${frame.channel}`));

/**
 * One server frame, as the server sends it: to the sockets that asked for its
 * channel and to no other. (The shell's own socket follows `config-changed`
 * and its notifications; handed a table's frame it would read every widget
 * again at once, which is not something that happens.)
 */
function deliver(channel: string, type = 'record.update', data: unknown = { type, pk: { id: 1 }, row: { id: 1 } }): void {
  for (const socket of FakeWebSocket.instances) {
    const last = socket.sent.filter((frame) => frame.channel === channel).at(-1);
    if (last?.op === 'subscribe') socket.onmessage?.({ data: JSON.stringify({ channel, type, data, ts: '2026-10-13T00:00:00.000Z' }) });
  }
}

const DEALS_CHANNEL = 'widget-data:conn_1:public.deals';
const STAGES_CHANNEL = 'widget-data:conn_1:public.stages';

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
  /** What the column facts say of `amount`, beside its name and its being money. */
  amount?: Record<string, unknown>;
  /** What the read of the stages answers, when not the stages. */
  stagesReply?: () => Response;
  /** The person's language is written right to left. */
  rtl?: boolean;
}

let columnReads: URL[];
let batches: { instanceId: string }[][];
let patches: { url: string; body: unknown }[];

function stub(fixture: Fixture) {
  columnReads = [];
  batches = [];
  patches = [];
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/bootstrap')) {
        const bootstrap = makeBootstrap();
        if (fixture.rtl === true) bootstrap.prefs = { ...bootstrap.prefs, locale: 'ar_EG', dir: 'rtl' };
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
              { spec: { name: 'amount', label: 'Amount', logicalType: 'decimal', semantic: 'money', ...fixture.amount }, filledBy: null, required: false, writable: true },
            ],
          },
        });
      }
      if (url === '/api/v1/widget-data/batch' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { requests: { instanceId: string; descriptor: { shape: string; groupBy?: string[]; filters?: { column: string; op: string; value?: unknown }[]; aggregations?: { fn: string }[] } }[] };
        batches.push(body.requests);
        // One person's cards, where the toolbar narrowed the board to them.
        const dana = (request: (typeof body.requests)[number]) => (request.descriptor.filters ?? []).some((filter) => filter.column === 'owner_id' && filter.op === 'eq' && filter.value === 'usr_dana');
        return jsonResponse(200, {
          results: Object.fromEntries(
            body.requests.map((request) => [
              request.instanceId,
              request.descriptor.shape === 'single-metric'
                ? { ok: true, result: { shape: 'single-metric', value: request.descriptor.aggregations?.[0]?.fn === 'count' ? (dana(request) ? 41 : 342) : dana(request) ? 2500.5 : 1450000 }, cached: false }
                : request.descriptor.shape === 'categorical' && request.descriptor.groupBy?.[0] === 'owner_id'
                  ? { ok: true, result: { shape: 'categorical', items: [{ key: 'usr_omar', label: 'Omar Haddad', value: 301 }, { key: 'usr_dana', label: 'Dana Ruiz', value: 41 }], total: 342 }, cached: false }
                  : request.descriptor.shape === 'categorical'
                    ? { ok: true, result: { shape: 'categorical', items: [{ key: 'todo', label: 'todo', value: 41, values: { cards: 41, total0: 1250.5 } }], total: 41 }, cached: false }
                    : { ok: true, result: { shape: 'record-list', rows: DEALS, columns: [], key: 'id' }, cached: false },
            ]),
          ),
        });
      }
      if (url.startsWith('/api/v1/data/conn_1/public.stages') && method === 'GET') {
        columnReads.push(new URL(url, 'http://dashboard.test'));
        if (fixture.stagesReply !== undefined) return fixture.stagesReply();
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

/** Let a burst's wait end, and the reads it starts come back. */
const afterTheWait = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, BOARD_LIVE_WAIT_MS + 150));
  });
};

afterEach(() => {
  cleanup();
  // The stream transport lives as long as the app: a live one would carry this test's sockets into the next.
  resetAppStreamTransport();
  vi.unstubAllGlobals();
});

describe('a board on a page read right to left', () => {
  it('is laid right to left too: the first column is at the start side, and the arrows go where they point', async () => {
    await renderBoard({ stages: STAGES, rtl: true });
    await screen.findByText('Qualified');
    await settle();
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    // The board's own direction is what lays its columns out and what its arrow keys read.
    expect(document.querySelector('[data-widget="kanban-board"]')!.getAttribute('dir')).toBe('rtl');
    // The columns keep the order they were read in: the direction puts the first one at the start side.
    expect(columnIds()).toEqual(['2', '1', '3']);
    // Harbour Hotels is in Lead, the middle column. Under RTL the column to its LEFT is the next one: Proposal.
    const card = document.querySelector<HTMLElement>('[data-board-card="1"]')!;
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.keyDown(card, { key: 'ArrowLeft' });
    expect(document.querySelector('[data-drop-target]')!.getAttribute('data-board-cell')).toBe('3');
    fireEvent.keyDown(card, { key: 'Escape' });
  });

  it('stays left to right on a page read left to right', async () => {
    await renderBoard({ stages: STAGES });
    await screen.findByText('Qualified');
    expect(document.querySelector('[data-widget="kanban-board"]')!.getAttribute('dir')).toBe('ltr');
  });
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

  it('subscribes to its cards’ table and to the table its columns are the rows of, and leaves both when the page is left', async () => {
    await renderBoard({ stages: STAGES });
    await screen.findByText('Qualified');
    await settle();
    act(() => openSockets());
    expect(boardLiveChannels(PIPELINE)).toEqual([DEALS_CHANNEL, STAGES_CHANNEL]);
    expect(asked()).toEqual(expect.arrayContaining([`subscribe ${DEALS_CHANNEL}`, `subscribe ${STAGES_CHANNEL}`]));
    expect(appStreamTransport().channelCount).toBe(2);
    cleanup();
    expect(asked()).toEqual(expect.arrayContaining([`unsubscribe ${DEALS_CHANNEL}`, `unsubscribe ${STAGES_CHANNEL}`]));
    expect(appStreamTransport().channelCount).toBe(0);
    // A frame already on its way when the page was left reads nothing.
    for (const socket of FakeWebSocket.instances) socket.onmessage?.({ data: JSON.stringify({ channel: STAGES_CHANNEL, type: 'record.create', data: { type: 'record.create', pk: { id: 9 }, row: { id: 9 } }, ts: '2026-10-13T00:00:00.000Z' }) });
    await afterTheWait();
    expect(columnReads).toHaveLength(1);
    expect(batches).toHaveLength(1);
  });

  it('a frame of the columns’ table reads them again, once, and the new row is a column with no reload', async () => {
    const fixture: Fixture = { stages: STAGES };
    await renderBoard(fixture);
    await screen.findByText('Qualified');
    await settle();
    act(() => openSockets());
    fixture.stages = [{ id: 9, name: 'Negotiation', board_count: 0, board_total_0: '0' }, ...STAGES.map((stage) => (stage.id === 1 ? { ...stage, name: 'New lead' } : stage))];
    // A colleague added a stage: the server's own frame, on the one channel of that table a browser may follow.
    act(() => deliver(STAGES_CHANNEL, 'record.create', { type: 'record.create', pk: { id: 9 }, row: { id: 9, name: 'Negotiation' } }));
    // Not before the wait is over: a burst is gathered first.
    expect(columnReads).toHaveLength(1);
    await screen.findByText('Negotiation', undefined, { timeout: BOARD_LIVE_WAIT_MS + 1_000 });
    expect(columnIds()).toEqual(['9', '2', '1', '3']);
    expect(screen.getByText('New lead')).toBeDefined();
    await afterTheWait();
    // One frame, one more read: identical requests are not repeated.
    expect(columnReads).toHaveLength(2);
    expect(columnReads[1]!.search).toBe(columnReads[0]!.search);
  });

  it('ten frames in a burst, of either table, make one request for the cards and one for the columns', async () => {
    const fixture: Fixture = { stages: STAGES };
    await renderBoard(fixture);
    await screen.findByText('Qualified');
    await settle();
    act(() => openSockets());
    fixture.stages = STAGES.map((stage) => (stage.id === 1 ? { ...stage, board_count: 341, board_total_0: '12900.00' } : stage));
    act(() => {
      for (let index = 0; index < 10; index += 1) deliver(index % 3 === 0 ? STAGES_CHANNEL : DEALS_CHANNEL, index % 2 === 0 ? 'record.update' : 'record.create');
    });
    await waitFor(() => expect(part('1', 'column-count')).toBe('341'), { timeout: BOARD_LIVE_WAIT_MS + 1_000 });
    expect(part('1', 'column-total')).toBe('€12,900');
    await afterTheWait();
    expect(columnReads).toHaveLength(2);
    expect(batches).toHaveLength(2);
    // A frame that says only "this table changed" (a reader held to some rows) is a burst like any other.
    act(() => {
      for (let index = 0; index < 3; index += 1) deliver(DEALS_CHANNEL, 'record.update', { type: 'record.update', pk: null, row: null, changed: true });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2 * BOARD_LIVE_WAIT_MS + 300));
    });
    expect(columnReads).toHaveLength(3);
    expect(batches).toHaveLength(3);
    // A file hung on a deal changes no card and no count.
    act(() => deliver(DEALS_CHANNEL, 'record.attachments', { type: 'record.attachments', pk: { id: 1 }, row: null }));
    await afterTheWait();
    expect(columnReads).toHaveLength(3);
  });

  it('totals in the column’s own currency when it names one, whatever the connection’s is', async () => {
    // The connection is kept in euros (the bootstrap says so); this column is priced in dollars.
    await renderBoard({ stages: STAGES, amount: { display: { kind: 'currency', currency: 'USD' } } });
    await screen.findByText('Qualified');
    expect(part('1', 'column-total')).toBe('$12,400');
    expect(part('2', 'column-total')).toBe('$0');
  });

  it('asks for one row more than it draws, and says so when the table has more', async () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `Stage ${String(index + 1)}`, board_count: 0, board_total_0: '0' }));
    await renderBoard({ stages: many(BOARD_COLUMNS_LIMIT + 1) });
    await screen.findByText('Stage 1');
    expect(columnReads[0]!.searchParams.get('limit')).toBe(String(BOARD_COLUMNS_LIMIT + 1));
    expect(columnIds()).toHaveLength(BOARD_COLUMNS_LIMIT);
    expect(screen.queryByText(`Stage ${String(BOARD_COLUMNS_LIMIT + 1)}`)).toBeNull();
    expect(screen.getByTestId('board-columns-cut').textContent).toBe(`Showing the first ${String(BOARD_COLUMNS_LIMIT)} columns: the table this board takes its columns from has more rows.`);
    cleanup();
    resetAppStreamTransport();
    // Exactly as many as a board draws: all of them, and nothing to say.
    await renderBoard({ stages: many(BOARD_COLUMNS_LIMIT) });
    await screen.findByText('Stage 1');
    expect(columnIds()).toHaveLength(BOARD_COLUMNS_LIMIT);
    expect(screen.queryByTestId('board-columns-cut')).toBeNull();
  });

  it('says which table could not be read when the columns’ read is refused', async () => {
    await renderBoard({
      stages: STAGES,
      stagesReply: () => jsonResponse(403, { error: { code: 'COLUMN_FORBIDDEN', message: 'Column "name" is not shown to your role.', requestId: 'r', details: { table: 'public.stages', column: 'name', reason: 'read-limit' } } }),
    });
    expect(await screen.findByText('This board’s columns could not be read from public.stages. Column "name" is not shown to your role.')).toBeDefined();
    expect(columnIds()).toEqual([]);
  });

  it('draws no board, and reads no columns, when the stored only cannot be trusted', async () => {
    const page = boardPage({ title: 'Deals', statusColumn: 'stage_id', titleColumn: 'name', columnsFrom: { table: 'public.stages', key: 'id', label: 'name', order: 'position' }, only: [{ column: 'state' }], binding: CARDS });
    await renderBoard({ stages: STAGES, page });
    expect((await screen.findByTestId('page-board-invalid-only')).textContent).toContain('cannot be read');
    await settle();
    expect(columnIds()).toEqual([]);
    expect(columnReads).toHaveLength(0);
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

describe('a board whose headings and cards say more', () => {
  const page = boardPage({
    title: 'Deals',
    statusColumn: 'stage_id',
    titleColumn: 'name',
    columnsFrom: { table: 'public.stages', key: 'id', label: 'name', order: 'position', badge: { column: 'odds', as: 'percent' } },
    totals: [
      { column: 'amount', fn: 'sum' },
      { column: 'weighted_value', fn: 'sum' },
    ],
    card: { amount: 'amount' },
    note: { text: 'Columns come from Stages', href: '/p/stages' },
    binding: CARDS,
  });
  const WITH_ODDS = [
    { id: 2, name: 'Qualified', odds: '0.25', board_count: 0, board_total_0: '0', board_total_1: '0' },
    { id: 1, name: 'Lead', odds: '0.10', board_count: 340, board_total_0: '12400.00', board_total_1: '1240.00' },
    { id: 3, name: 'Proposal', odds: 0.125, board_count: 1, board_total_0: '300.00', board_total_1: '37.50' },
  ];

  it('asks for the badge’s column with the columns, and a measure for each total', async () => {
    await renderBoard({ stages: WITH_ODDS, page });
    await screen.findByText('Qualified');
    await settle();
    expect(columnReads).toHaveLength(1);
    expect(columnReads[0]!.searchParams.get('select')).toBe('id,name,odds');
    expect((JSON.parse(columnReads[0]!.searchParams.get('compute')!) as { measures: { id: string }[] }).measures.map((measure) => measure.id)).toEqual(['board_count', 'board_total_0', 'board_total_1']);
  });

  it('heads each column with the stage’s odds and both of the server’s totals, each named', async () => {
    await renderBoard({ stages: WITH_ODDS, page });
    await screen.findByText('Qualified');
    expect(part('1', 'column-badge')).toBe('10%');
    expect(part('2', 'column-badge')).toBe('25%');
    expect(part('3', 'column-badge')).toBe('12.5%');
    expect(part('1', 'column-total')).toBe('Amount €12,400 · weighted_value 1,240');
  });

  it('draws a card’s amount as its column is kept, and the page’s note', async () => {
    await renderBoard({ stages: WITH_ODDS, page });
    await screen.findByText('Qualified');
    expect(within(screen.getByTestId('column-drop-1')).getByText('€100')).toBeDefined();
    expect(screen.getByTestId('board-note').textContent).toBe('Columns come from Stages');
  });

  it('reads the columns again without the badge when the reader’s role does not show its column, and draws the board', async () => {
    let asked = 0;
    await renderBoard({
      stages: WITH_ODDS,
      page,
      stagesReply: () => {
        asked += 1;
        return asked === 1
          ? jsonResponse(403, { error: { code: 'COLUMN_FORBIDDEN', message: 'Column "odds" is not shown to your role.', requestId: 'r' } })
          : jsonResponse(200, { data: WITH_ODDS.map(({ odds: _odds, ...rest }) => rest), page: { limit: 100, offset: 0, total: 3 } });
      },
    });
    await screen.findByText('Qualified');
    expect(columnReads.map((read) => read.searchParams.get('select'))).toEqual(['id,name,odds', 'id,name']);
    expect(part('1', 'column-badge')).toBeUndefined();
    expect(part('1', 'column-count')).toBe('340');
  });

  it('keeps any other refusal a refusal', async () => {
    await renderBoard({ stages: WITH_ODDS, page, stagesReply: () => jsonResponse(403, { error: { code: 'TABLE_FORBIDDEN', message: 'You do not have access to this table.', requestId: 'r' } }) });
    await screen.findByText(/could not be read/);
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

describe('a board with a toolbar', () => {
  const figure = (aggregations: unknown[]) => ({ ...CARDS, shape: 'single-metric', select: undefined, limit: undefined, aggregations });
  const TOOLBAR = boardPage({
    title: 'Deals',
    statusColumn: 'stage_id',
    titleColumn: 'name',
    columnsFrom: { table: 'public.stages', key: 'id', label: 'name', order: 'position' },
    totals: [{ column: 'amount', fn: 'sum' }],
    toolbar: { total: true, person: 'owner_id' },
    toolbarBindings: [figure([{ fn: 'count', alias: 'cards' }]), figure([{ fn: 'sum', column: 'amount', alias: 'total' }])],
    personBinding: { ...CARDS, shape: 'categorical', select: undefined, limit: 30, groupBy: ['owner_id'], aggregations: [{ fn: 'count', alias: 'cards' }], filters: [{ column: 'owner_id', op: 'not_null' }] },
    binding: CARDS,
  });
  const owner = (request: { descriptor?: { filters?: { column: string; op: string; value?: unknown }[] } }) => (request.descriptor?.filters ?? []).find((filter) => filter.column === 'owner_id' && filter.op === 'eq')?.value;

  it("reads the server's total and the people in the page's one batch, and says the total in the table's own words", async () => {
    await renderBoard({ stages: STAGES, page: TOOLBAR });
    await waitFor(() => expect(screen.getByTestId('board-total').textContent).toBe('342 Deals · €1,450,000.00'));
    await settle();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((request) => request.instanceId).sort()).toEqual(['board-1', 'board-1:people', 'board-1:toolbar:0', 'board-1:toolbar:1']);
    const group = screen.getByRole('group', { name: 'Person' });
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['Everyone', 'Omar', 'Dana']);
  });

  it("narrowed to one person, asks the cards, the columns' figures and the total again of their cards, and never the people", async () => {
    await renderBoard({ stages: STAGES, page: TOOLBAR });
    const group = await screen.findByRole('group', { name: 'Person' });
    await settle();
    fireEvent.click(within(group).getByRole('button', { name: 'Dana Ruiz' }));
    await waitFor(() => expect(screen.getByTestId('board-total').textContent).toBe('41 Deals · €2,500.50'));
    const narrowed = batches.at(-1)!;
    expect(narrowed.filter((request) => owner(request as never) === 'usr_dana').map((request) => request.instanceId).sort()).toEqual(['board-1', 'board-1:toolbar:0', 'board-1:toolbar:1']);
    expect(owner(narrowed.find((request) => request.instanceId === 'board-1:people') as never)).toBeUndefined();
    // Each column's count and total: the measures ask of her cards alone.
    const compute = JSON.parse(columnReads.at(-1)!.searchParams.get('compute')!) as { measures: { where?: unknown }[] };
    for (const measure of compute.measures) expect(measure.where).toEqual([{ column: 'owner_id', in: ['usr_dana'] }]);
    expect(within(group).getByRole('button', { name: 'Dana Ruiz' }).getAttribute('aria-pressed')).toBe('true');
    // Everyone again: the whole board.
    fireEvent.click(within(group).getByRole('button', { name: 'Everyone' }));
    await waitFor(() => expect(screen.getByTestId('board-total').textContent).toBe('342 Deals · €1,450,000.00'));
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
    // Still under the page's own prefix, which a frame of either table and a save here both invalidate.
    expect(boardColumnsKey('page_pipeline', read, undefined).slice(0, 2)).toEqual(['widget-data', 'page_pipeline']);
  });


  it('is read off the stored item: nothing for a board that names none', () => {
    expect(boardReadOf(boardPage({ statusColumn: 'status', columns: ['todo'], binding: CARDS }))).toBeNull();
    const read = boardReadOf(PIPELINE)!;
    expect(read).toMatchObject({ instanceId: 'board-1', connectionId: 'conn_1', cardsTable: 'public.deals', column: 'stage_id', from: { table: 'public.stages', key: 'id', label: 'name', order: 'position' } });
    expect(JSON.parse(boardCompute({ ...read, totals: [] }))).toEqual({ measures: [{ id: 'board_count', table: 'public.deals', fkColumn: 'stage_id', fn: 'count' }] });
    expect(read.only).toEqual([]);
    // `only` is read off the item too, beside the cards' own query that asks the same.
    const only = [{ column: 'state', in: ['open', 'won'] }, { column: 'hot', in: [true] }];
    const cards = { ...CARDS, filters: only.map((test) => ({ column: test.column, op: 'in', value: test.in })) };
    const from = { statusColumn: 'stage_id', columnsFrom: { table: 'public.stages', label: 'name' } };
    expect(boardReadOf(boardPage({ ...from, only, binding: cards }))!.only).toEqual(only);
    // Whole or not at all: an entry that is no test, or a test the cards are not asked, and there is no board to read
    // for — reading what could be read of it would head the columns with a count of cards the board does not list.
    expect(boardReadOf(boardPage({ ...from, only: [...only, { column: 'kind' }, 'x'], binding: cards }))).toBeNull();
    expect(boardReadOf(boardPage({ ...from, only, binding: CARDS }))).toBeNull();
  });
});
