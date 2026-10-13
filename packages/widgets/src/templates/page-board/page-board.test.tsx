// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * page-board template tests: stored archetype config → board columns in enum
 * order, drag writes through the optimistic machinery (keyboard path — same
 * `requestMove` a pointer drop uses), the completed-column pct=100 rule,
 * atomic lane+status swimlane writes, the roadmap quarter variant, inline
 * compose inserts, card click → record-open, and the never-crash
 * invalid-layout branch.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageBoard, quarterColumnsOf } from './PageBoard.js';
import { quarterKeyOf, quarterStartIso } from '../planning/planning-lib.js';
import type { WidgetEvent } from '../../registry/types.js';

afterEach(cleanup);

const CONN = 'conn_1';

function binding(table: string) {
  return {
    kind: 'table-query',
    connectionId: CONN,
    source: { schema: 'public', name: table, type: 'table' },
    shape: 'record-list',
    limit: 200,
  };
}

const ROWS = [
  { id: 'T-1', title: 'Fix login', status: 'todo', pct: 10 },
  { id: 'T-2', title: 'Ship exports', status: 'in_progress', pct: 55 },
  { id: 'T-3', title: 'Close audit', status: 'done', pct: 100 },
];

function boardConfig(itemConfig: Record<string, unknown>, widget = 'kanban-board') {
  return {
    templateVersion: 1,
    toolbar: [],
    overlays: [],
    layout: {
      version: 1,
      items: [{ i: 'board-1', widget, x: 0, y: 0, w: 12, h: 16, config: itemConfig }],
    },
  };
}

const KANBAN_CONFIG = {
  title: 'Tasks',
  statusColumn: 'status',
  titleColumn: 'title',
  progressColumn: 'pct',
  columns: ['todo', 'in_progress', 'done'],
  binding: binding('tasks'),
};

const recordList = (rows: Record<string, unknown>[]) => ({
  status: 'success' as const,
  data: { rows, columns: [], total: rows.length },
});

/** Keyboard move: grab → ArrowRight ×n → commit (same machinery as a drop). */
function keyboardMove(cardTitle: string, steps: number) {
  const card = screen.getByRole('button', { name: cardTitle });
  fireEvent.keyDown(card, { key: 'Enter' });
  for (let i = 0; i < steps; i += 1) fireEvent.keyDown(card, { key: 'ArrowRight' });
  fireEvent.keyDown(card, { key: 'Enter' });
}

describe('PageBoard — kanban', () => {
  it('renders enum-ordered columns from the stored candidate config', () => {
    render(<PageBoard config={boardConfig(KANBAN_CONFIG)} states={{ 'board-1': recordList(ROWS) }} />);
    const columns = [...document.querySelectorAll('[data-board-column]')].map((el) =>
      el.getAttribute('data-board-column'),
    );
    expect(columns).toEqual(['todo', 'in_progress', 'done']);
    expect(within(screen.getByTestId('column-drop-todo')).getByText('Fix login')).toBeDefined();
  });

  it('a committed move issues ONE update intent on the status column', async () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    render(
      <PageBoard config={boardConfig(KANBAN_CONFIG)} states={{ 'board-1': recordList(ROWS) }} onEvent={onEvent} />,
    );
    keyboardMove('Fix login', 1);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith('board-1', {
      type: 'mutate',
      intent: 'update',
      connectionId: CONN,
      table: 'public.tasks',
      recordId: 'T-1',
      values: { status: 'in_progress' },
    });
    // Optimistic: the card is already rendered in the target column.
    expect(within(screen.getByTestId('column-drop-in_progress')).getByText('Fix login')).toBeDefined();
  });

  it('dropping into a completed-classified column forces pct = 100', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    render(
      <PageBoard config={boardConfig(KANBAN_CONFIG)} states={{ 'board-1': recordList(ROWS) }} onEvent={onEvent} />,
    );
    keyboardMove('Fix login', 2); // todo → done
    const event = (onEvent.mock.calls[0] as unknown[])[1] as WidgetEvent & { values: Record<string, unknown> };
    expect(event.values).toEqual({ status: 'done', pct: 100 });
  });

  it('a rejected mutate promise rolls the optimistic move back', async () => {
    const onEvent = vi.fn(() => Promise.reject(new Error('CONFLICT')));
    render(
      <PageBoard config={boardConfig(KANBAN_CONFIG)} states={{ 'board-1': recordList(ROWS) }} onEvent={onEvent} />,
    );
    keyboardMove('Fix login', 1);
    await waitFor(() => {
      expect(within(screen.getByTestId('column-drop-todo')).getByText('Fix login')).toBeDefined();
    });
    expect(within(screen.getByTestId('column-drop-in_progress')).queryByText('Fix login')).toBeNull();
  });

  it('card click emits record-open with the page source', () => {
    const onEvent = vi.fn();
    render(
      <PageBoard config={boardConfig(KANBAN_CONFIG)} states={{ 'board-1': recordList(ROWS) }} onEvent={onEvent} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ship exports' }));
    expect(onEvent).toHaveBeenCalledWith('board-1', {
      type: 'record-open',
      connectionId: CONN,
      table: 'public.tasks',
      recordId: 'T-2',
    });
  });
});

describe('PageBoard — columns that are the rows of a table', () => {
  const PIPELINE = {
    title: 'Deals',
    statusColumn: 'stage_id',
    titleColumn: 'name',
    columnsFrom: { table: 'public.stages', key: 'id', label: 'name', order: 'position' },
    totals: [{ column: 'amount', fn: 'sum' }],
    binding: binding('deals'),
  };
  // The link is a number in one row and a word in another, as engines answer it; one deal has no stage, one names a stage that is gone.
  const DEALS = [
    { id: 1, name: 'Harbour Hotels', stage_id: 1, amount: 100 },
    { id: 2, name: 'Northfield Dental', stage_id: '3', amount: 300 },
    { id: 3, name: 'No stage yet', stage_id: null, amount: 20 },
    { id: 4, name: 'Stage removed', stage_id: 99, amount: 5 },
  ];
  const STAGES = {
    status: 'success' as const,
    columns: [
      { id: '2', value: 2, label: 'Qualified', count: 0, total: '€0' },
      { id: '1', value: 1, label: 'Lead', count: 340, total: '€12,400' },
      { id: '3', value: 3, label: 'Proposal', count: 1, total: '€300' },
    ],
  };
  const columnIds = () => [...document.querySelectorAll('[data-board-column]')].map((el) => el.getAttribute('data-board-column'));
  const part = (column: string, name: string) => document.querySelector(`[data-board-column="${column}"] [data-part="${name}"]`)?.textContent;

  it('draws a column for each row, in the rows’ order, an empty one too, headed by the server’s count and total', () => {
    render(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList(DEALS) }} boardColumns={STAGES} />);
    expect(columnIds()).toEqual(['2', '1', '3']);
    expect(screen.getByText('Qualified')).toBeDefined();
    expect(part('2', 'column-count')).toBe('0');
    expect(part('1', 'column-count')).toBe('340');
    expect(part('1', 'column-total')).toBe('€12,400');
    expect(within(screen.getByTestId('column-drop-1')).getByText('Harbour Hotels')).toBeDefined();
    // A link answered as text lands in the same column as one answered as a number.
    expect(within(screen.getByTestId('column-drop-3')).getByText('Northfield Dental')).toBeDefined();
    // A deal with no stage, or with a stage that is no row, is on no column.
    expect(screen.queryByText('No stage yet')).toBeNull();
    expect(screen.queryByText('Stage removed')).toBeNull();
  });

  it('a drop writes the stage row’s own key, a number where the key is one', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    render(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList(DEALS) }} boardColumns={STAGES} onEvent={onEvent} />);
    keyboardMove('Harbour Hotels', 1); // Lead → Proposal
    expect(onEvent).toHaveBeenCalledWith('board-1', {
      type: 'mutate',
      intent: 'update',
      connectionId: CONN,
      table: 'public.deals',
      recordId: '1',
      values: { stage_id: 3 },
    });
  });

  it('a refused drop puts the card back and shows the server’s reason', async () => {
    const onEvent = vi.fn(() => Promise.reject(new Error('You can change this only while State is Open.')));
    const { container } = render(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList(DEALS) }} boardColumns={STAGES} onEvent={onEvent} />);
    keyboardMove('Harbour Hotels', 1);
    await waitFor(() => expect(within(screen.getByTestId('column-drop-1')).getByText('Harbour Hotels')).toBeDefined());
    expect(container.querySelector('[data-part="board-move-refused"]')!.textContent).toContain('You can change this only while State is Open.');
    expect(container.querySelector('[data-board-liveregion]')!.textContent).toContain('You can change this only while State is Open.');
  });

  it('waits for the columns, says when they could not be read, and says what an empty table needs', () => {
    const { rerender } = render(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList(DEALS) }} boardColumns={{ status: 'loading' }} />);
    expect(columnIds()).toEqual([]);
    expect(screen.queryByText('Harbour Hotels')).toBeNull();
    rerender(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList(DEALS) }} boardColumns={{ status: 'error', error: new Error('Stages could not be read.') }} />);
    expect(screen.getByText('Stages could not be read.')).toBeDefined();
    rerender(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList(DEALS) }} boardColumns={{ status: 'success', columns: [] }} />);
    expect(screen.getByText('No columns yet')).toBeDefined();
    // Not the sentence about a status: this board has none.
    expect(screen.queryByTestId('board-unplaced-rows')).toBeNull();
  });

  it('says so when rows arrived and none is in a column', () => {
    render(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList([DEALS[2]!, DEALS[3]!]) }} boardColumns={STAGES} />);
    expect(screen.getByTestId('board-unplaced-rows').textContent).toContain('is in one of the board’s columns');
    expect(columnIds()).toEqual(['2', '1', '3']);
  });

  it('keeps the rows’ order and the logical arrow keys under RTL', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    render(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList(DEALS) }} boardColumns={STAGES} onEvent={onEvent} dir="rtl" />);
    expect(columnIds()).toEqual(['2', '1', '3']);
    keyboardMove('Harbour Hotels', 1); // reading-forward under RTL is the previous column: Lead → Qualified
    const event = (onEvent.mock.calls[0] as unknown[])[1] as WidgetEvent & { values: Record<string, unknown> };
    expect(event.values).toEqual({ stage_id: 2 });
  });

  it('an enum board the page named takes each value’s count and total from the server too', () => {
    const config = boardConfig({ ...KANBAN_CONFIG, totals: [{ column: 'pct', fn: 'avg' }] });
    const counted = { status: 'success' as const, columns: [{ id: 'todo', count: 41, total: '12' }, { id: 'done', count: 7, total: '100' }] };
    render(<PageBoard config={config} states={{ 'board-1': recordList(ROWS) }} boardColumns={counted} />);
    expect(columnIds()).toEqual(['todo', 'in_progress', 'done']);
    expect(part('todo', 'column-count')).toBe('41');
    expect(part('todo', 'column-total')).toBe('12');
    // A value the server counted nothing under holds none.
    expect(part('in_progress', 'column-count')).toBe('0');
    expect(part('done', 'column-count')).toBe('7');
  });
});

describe('PageBoard — swimlanes', () => {
  it('a cross-cell move writes lane + status atomically in one intent', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    const config = boardConfig(
      {
        ...KANBAN_CONFIG,
        laneColumn: 'team',
        binding: binding('tasks'),
      },
      'kanban-swimlane-grid',
    );
    const rows = [
      { id: 'T-1', title: 'Fix login', status: 'todo', team: 'growth', pct: 10 },
      { id: 'T-2', title: 'Ship exports', status: 'todo', team: 'platform', pct: 0 },
    ];
    render(<PageBoard config={config} states={{ 'board-1': recordList(rows) }} onEvent={onEvent} />);
    keyboardMove('Fix login', 1);
    const event = (onEvent.mock.calls[0] as unknown[])[1] as WidgetEvent & { values: Record<string, unknown> };
    expect(event.type).toBe('mutate');
    expect(event.values['status']).toBe('in_progress');
    expect(event.values['team']).toBe('growth');
  });
});

describe('PageBoard — roadmap variant', () => {
  const roadmapConfig = boardConfig({
    title: 'Roadmap',
    statusColumn: 'status',
    titleColumn: 'title',
    bucketBy: 'quarter',
    dateColumn: 'due_date',
    binding: binding('tasks'),
  });
  const rows = [
    { id: 'T-1', title: 'Fix login', status: 'todo', due_date: '2026-07-20' },
    { id: 'T-2', title: 'Ship exports', status: 'todo', due_date: '2026-11-02' },
  ];

  it('buckets cards into chronological quarter columns', () => {
    render(<PageBoard config={roadmapConfig} states={{ 'board-1': recordList(rows) }} />);
    const columns = [...document.querySelectorAll('[data-board-column]')].map((el) =>
      el.getAttribute('data-board-column'),
    );
    expect(columns).toEqual(['2026-Q3', '2026-Q4']);
    expect(screen.getByText('Q3 2026')).toBeDefined();
    expect(within(screen.getByTestId('column-drop-2026-Q4')).getByText('Ship exports')).toBeDefined();
  });

  it('a cross-quarter drop reschedules the date column to the target quarter start', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    render(<PageBoard config={roadmapConfig} states={{ 'board-1': recordList(rows) }} onEvent={onEvent} />);
    keyboardMove('Fix login', 1); // Q3 → Q4
    const event = (onEvent.mock.calls[0] as unknown[])[1] as WidgetEvent & { values: Record<string, unknown> };
    expect(event.values).toEqual({ due_date: '2026-10-01' });
  });

  it('quarter helpers are deterministic', () => {
    expect(quarterKeyOf('2026-02-11')).toBe('2026-Q1');
    expect(quarterStartIso('2026-Q4')).toBe('2026-10-01');
    expect(quarterColumnsOf([{ id: 'a', title: 'a', column: '2026-Q2' }]).map((c) => c.label)).toEqual(['Q2 2026']);
  });
});

describe('PageBoard — compose + degradation', () => {
  it('inline compose inserts with the typed title, column default and stored defaults', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    const config = {
      templateVersion: 1,
      toolbar: [],
      overlays: [],
      layout: {
        version: 1,
        items: [
          { i: 'board-1', widget: 'kanban-board', x: 0, y: 0, w: 12, h: 16, config: KANBAN_CONFIG },
          {
            i: 'compose-1',
            widget: 'inline-compose-card',
            x: 0,
            y: 16,
            w: 4,
            h: 4,
            config: { defaults: { priority: 'Medium' } },
          },
        ],
      },
    };
    render(<PageBoard config={config} states={{ 'board-1': recordList(ROWS) }} onEvent={onEvent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onEvent).toHaveBeenCalledWith('compose-1', {
      type: 'mutate',
      intent: 'insert',
      connectionId: CONN,
      table: 'public.tasks',
      values: { status: 'todo', priority: 'Medium', title: 'New task' },
    });
  });

  it('renders the invalid-layout notice for a corrupt stored config', () => {
    render(<PageBoard config={{ templateVersion: 1, layout: { version: 99, items: 'nope' } }} />);
    expect(screen.getByTestId('page-board-invalid')).toBeDefined();
  });

  it('unbound board items fall back to deterministic demo data', async () => {
    const config = boardConfig({ title: 'Demo board', statusColumn: 'status', titleColumn: 'title' });
    render(<PageBoard config={config} />);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-board-card]').length).toBeGreaterThan(0);
    });
    // Demo mode has no binding — a move must not emit a mutation.
    expect(document.querySelector('[data-widget="kanban-board"]')).not.toBeNull();
  });
});

describe('PageBoard — rows with no status', () => {
  const NO_STATUS = [
    { id: 'T-1', title: 'Fix login', status: null },
    { id: 'T-2', title: 'Ship exports', status: null },
  ];

  it('says none of the rows has a status when no card lands on a column', () => {
    render(<PageBoard config={boardConfig(KANBAN_CONFIG)} states={{ 'board-1': recordList(NO_STATUS) }} />);
    expect(screen.getByTestId('board-unplaced-rows').textContent).toMatch(/has a status yet/);
  });

  it('stays quiet when any card is on a column', () => {
    render(
      <PageBoard
        config={boardConfig(KANBAN_CONFIG)}
        states={{ 'board-1': recordList([...NO_STATUS, ROWS[0] as Record<string, unknown>]) }}
      />,
    );
    expect(screen.queryByTestId('board-unplaced-rows')).toBeNull();
  });
});

/**
 * An EMPTY table is not a board missing its status field. The host's empty-state
 * text ("add a status field") used to show for both, and a freshly installed
 * app's board — status column and columns all declared — told its operator to
 * add a field it already had.
 */
describe('PageBoard — a table with no rows yet', () => {
  const HOST = { emptyTitle: 'No board columns', emptyBody: 'Add a status field to group cards into columns.' };
  const SWIMLANES = boardConfig(
    {
      title: 'Appointments',
      statusColumn: 'status',
      laneColumn: 'team',
      titleColumn: 'title',
      columns: ['todo', 'in_progress', 'done'],
      binding: binding('tasks'),
    },
    'kanban-swimlane-grid',
  );

  it('a swimlane board with nothing in it says there are no cards yet', () => {
    render(<PageBoard config={SWIMLANES} states={{ 'board-1': recordList([]) }} labels={HOST} />);
    expect(screen.getByText('No cards yet')).toBeTruthy();
    expect(screen.queryByText('No board columns')).toBeNull();
  });

  it('a board whose columns come from its rows says the same', () => {
    const { statusColumn, titleColumn, binding: b } = KANBAN_CONFIG;
    render(
      <PageBoard
        config={boardConfig({ title: 'Tasks', statusColumn, titleColumn, binding: b })}
        states={{ 'board-1': recordList([]) }}
        labels={HOST}
      />,
    );
    expect(screen.getByText('No cards yet')).toBeTruthy();
  });

  it('a board with its columns declared still shows them, empty', () => {
    render(<PageBoard config={boardConfig(KANBAN_CONFIG)} states={{ 'board-1': recordList([]) }} labels={HOST} />);
    expect(screen.queryByText('No cards yet')).toBeNull();
    expect(screen.queryByText('No board columns')).toBeNull();
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('keeps the host text while the query is still loading', () => {
    render(<PageBoard config={SWIMLANES} states={{ 'board-1': { status: 'loading' } }} labels={HOST} />);
    expect(screen.queryByText('No cards yet')).toBeNull();
  });
});

/**
 * The answer names the status column's words for its values, read in the
 * reader's language: a board's columns are headed "Offen", not "Todo". A
 * column the page labels itself keeps its label.
 */
describe('PageBoard — the answer’s words for a status', () => {
  const served = (words: Record<string, string>) => ({
    status: 'success' as const,
    data: {
      rows: ROWS,
      total: ROWS.length,
      columns: [{ name: 'status', logicalType: 'enum', nullable: false, isPrimaryKey: false, enumLabels: words }],
    },
  });
  const header = (id: string) => (document.querySelector(`[data-board-column="${id}"]`) as HTMLElement).textContent ?? '';

  it('heads each column with the answer’s word, else its humanized value', () => {
    render(<PageBoard config={boardConfig(KANBAN_CONFIG)} states={{ 'board-1': served({ todo: 'Offen', in_progress: 'In Arbeit' }) }} />);
    expect(header('todo')).toContain('Offen');
    expect(header('in_progress')).toContain('In Arbeit');
    expect(header('done')).toContain('Done');
  });

  it('a column the page labels keeps its label', () => {
    const config = boardConfig({ ...KANBAN_CONFIG, columns: [{ id: 'todo', label: 'Backlog' }, 'in_progress', 'done'] });
    render(<PageBoard config={config} states={{ 'board-1': served({ todo: 'Offen' }) }} />);
    expect(header('todo')).toContain('Backlog');
    expect(header('todo')).not.toContain('Offen');
  });
});

describe('PageBoard — a board over a table: adding a card, and cards on no column', () => {
  const PIPELINE = {
    title: 'Deals',
    statusColumn: 'stage_id',
    titleColumn: 'name',
    columnsFrom: { table: 'public.stages', key: 'id', label: 'name', order: 'position' },
    binding: binding('deals'),
  };
  const DEALS = [
    { id: 1, name: 'Harbour Hotels', stage_id: 1 },
    { id: 2, name: 'Northfield Dental', stage_id: '3' },
    { id: 3, name: 'No stage yet', stage_id: null },
    { id: 4, name: 'Stage removed', stage_id: 99 },
    { id: 5, name: 'Stage past the hundredth', stage_id: 250 },
  ];
  const STAGES = {
    status: 'success' as const,
    columns: [
      { id: '2', value: 2, label: 'Qualified' },
      { id: '1', value: 1, label: 'Lead' },
      { id: '3', value: 3, label: 'Proposal' },
    ],
  };
  const withComposer = (boardItem: Record<string, unknown>, compose: Record<string, unknown> = {}) => ({
    templateVersion: 1,
    toolbar: [],
    overlays: [],
    layout: {
      version: 1,
      items: [
        { i: 'board-1', widget: 'kanban-board', x: 0, y: 0, w: 12, h: 16, config: boardItem },
        { i: 'compose-1', widget: 'inline-compose-card', x: 0, y: 16, w: 4, h: 4, config: compose },
      ],
    },
  });
  const addCard = (title: string): void => {
    fireEvent.click(screen.getByTestId('compose-slot-compose-1'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: title } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  };

  it('"Add card" waits for the columns: no card is added with no column to be in', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    const states = { 'board-1': recordList(DEALS) };
    const { rerender } = render(<PageBoard config={withComposer(PIPELINE)} states={states} boardColumns={{ status: 'loading' }} onEvent={onEvent} />);
    const open = (): HTMLButtonElement => screen.getByTestId('compose-slot-compose-1') as HTMLButtonElement;
    expect(open().disabled).toBe(true);
    rerender(<PageBoard config={withComposer(PIPELINE)} states={states} boardColumns={{ status: 'error', error: new Error('no') }} onEvent={onEvent} />);
    expect(open().disabled).toBe(true);
    rerender(<PageBoard config={withComposer(PIPELINE)} states={states} boardColumns={{ status: 'success', columns: [] }} onEvent={onEvent} />);
    expect(open().disabled).toBe(true);
    rerender(<PageBoard config={withComposer(PIPELINE)} states={states} boardColumns={STAGES} onEvent={onEvent} />);
    expect(open().disabled).toBe(false);
    addCard('New deal');
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith('compose-1', expect.objectContaining({ intent: 'insert', values: { stage_id: 2, name: 'New deal' } }));
  });

  it('a composer left open while the columns are read again adds nothing until they are back', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    const states = { 'board-1': recordList(DEALS) };
    const { rerender } = render(<PageBoard config={withComposer(PIPELINE)} states={states} boardColumns={STAGES} onEvent={onEvent} />);
    fireEvent.click(screen.getByTestId('compose-slot-compose-1'));
    rerender(<PageBoard config={withComposer(PIPELINE)} states={states} boardColumns={{ status: 'error', error: new Error('no') }} onEvent={onEvent} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New deal' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('says how many cards are on no column when some are and some are not', () => {
    render(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList(DEALS) }} boardColumns={STAGES} />);
    // No stage, a stage whose row is gone, and a stage beyond the columns that were read.
    expect(screen.getByTestId('board-unplaced-rows').textContent).toBe('3 rows are in none of the board’s columns, so they are not shown here.');
    cleanup();
    render(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList(DEALS.slice(0, 3)) }} boardColumns={STAGES} />);
    expect(screen.getByTestId('board-unplaced-rows').textContent).toBe('1 row is in none of the board’s columns, so it is not shown here.');
    cleanup();
    render(<PageBoard config={boardConfig(PIPELINE)} states={{ 'board-1': recordList(DEALS.slice(0, 2)) }} boardColumns={STAGES} />);
    expect(screen.queryByTestId('board-unplaced-rows')).toBeNull();
  });

  it('a board of some of its rows puts a new card among them: each test with one value is the card’s value', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    const only = [
      { column: 'state', in: ['open'] },
      { column: 'kind', in: ['new', 'renewal'] },
    ];
    render(
      <PageBoard
        config={withComposer({ ...PIPELINE, only, allowAdd: true }, { defaults: { owner_id: 7 } })}
        states={{ 'board-1': recordList(DEALS) }}
        boardColumns={STAGES}
        onEvent={onEvent}
      />,
    );
    addCard('New deal');
    // `kind` lists two values: which one is the column's own default to say, not the board's.
    expect(onEvent).toHaveBeenLastCalledWith('compose-1', expect.objectContaining({ values: { state: 'open', stage_id: 2, owner_id: 7, name: 'New deal' } }));
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-board-column="1"] [data-part="column-add"]')!);
    expect(onEvent).toHaveBeenLastCalledWith('board-1', expect.objectContaining({ intent: 'insert', values: { state: 'open', stage_id: 1 } }));
  });

  it('what the composer itself sets wins over the board’s test', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    render(
      <PageBoard
        config={withComposer({ ...PIPELINE, only: [{ column: 'state', in: ['open'] }] }, { defaults: { state: 'draft' } })}
        states={{ 'board-1': recordList(DEALS) }}
        boardColumns={STAGES}
        onEvent={onEvent}
      />,
    );
    addCard('New deal');
    expect(onEvent).toHaveBeenLastCalledWith('compose-1', expect.objectContaining({ values: { state: 'draft', stage_id: 2, name: 'New deal' } }));
  });
});
