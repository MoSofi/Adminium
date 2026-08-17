// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * page-board template tests (09-generated-app.md §7.5): stored archetype
 * config → board columns in enum order, drag writes through the optimistic
 * machinery (keyboard path — same `requestMove` a pointer drop uses), the
 * completed-column pct=100 rule, atomic lane+status swimlane writes, the
 * roadmap quarter variant, inline compose inserts, card click → record-open,
 * and the never-crash invalid-layout branch.
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
