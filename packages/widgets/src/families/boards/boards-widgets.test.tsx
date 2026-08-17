// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `boards` family (annex §6, Track BOARDS): render + interaction tests for
 * kanban-board and kanban-swimlane-grid. dnd-kit's pointer sensor needs real
 * layout rects (unavailable in happy-dom), so the drag-move behaviour is
 * exercised through the widget's own logical keyboard path — which funnels
 * through the exact same optimistic-move machinery a pointer drop uses
 * (`requestMove`) — plus the four WidgetFrame states through WidgetHost and
 * deterministic demoData.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardCard } from './BoardCard.js';
import {
  KanbanBoard,
  kanbanBoardConfigSchema,
  kanbanBoardDemoData,
} from './KanbanBoard.js';
import {
  KanbanSwimlaneGrid,
  decodeCell,
  encodeCell,
  kanbanSwimlaneGridConfigSchema,
  kanbanSwimlaneGridDemoData,
} from './KanbanSwimlaneGrid.js';
import { announcementsFromTemplates } from './board-dnd.js';
import { kanbanBoardDefinition, kanbanSwimlaneGridDefinition } from './boards-track.definitions.js';
import { humanizeEnum, resolveColumns, sumPoints, toBoardCard } from './board-lib.js';
import type { BoardCardData, ColumnDef, LaneDef } from './board-lib.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';

afterEach(cleanup);

const COLUMNS: ColumnDef[] = [
  { id: 'todo', label: 'To do', tone: 'neutral' },
  { id: 'in_progress', label: 'In progress', tone: 'accent' },
  { id: 'done', label: 'Done', tone: 'pos' },
];

function card(id: string, column: string, extra: Partial<BoardCardData> = {}): BoardCardData {
  return { id, title: `Card ${id}`, column, ...extra };
}

function grabCardEl(title: string): HTMLElement {
  return screen.getByRole('button', { name: title });
}

describe('board-lib helpers', () => {
  it('humanizes enum values', () => {
    expect(humanizeEnum('in_progress')).toBe('In progress');
    expect(humanizeEnum('review')).toBe('Review');
  });

  it('derives columns from distinct status values in first-seen order', () => {
    const cards = [card('1', 'open'), card('2', 'closed'), card('3', 'open')];
    expect(resolveColumns(cards).map((c) => c.id)).toEqual(['open', 'closed']);
  });

  it('sums points across cards', () => {
    expect(sumPoints([card('1', 'a', { points: 3 }), card('2', 'a', { points: 5 }), card('3', 'a')])).toBe(8);
  });

  it('maps record-list rows to board cards via the configured fields', () => {
    const row = { id: 7, name: 'Ship it', state: 'done', lane: 'growth', pct: 42, owner: 'Ava Reyes' };
    const c = toBoardCard(row, 0, { columnField: 'state', laneField: 'lane', titleField: 'name' });
    expect(c).toMatchObject({ id: '7', title: 'Ship it', column: 'done', lane: 'growth', pct: 42, owner: 'Ava Reyes' });
  });
});

describe('BoardCard', () => {
  it('renders the title, tag, percent, and mono id', () => {
    render(<BoardCard card={card('PRJ-1', 'todo', { title: 'Billing retries', tag: 'Bug', pct: 60 })} />);
    expect(screen.getByText('Billing retries')).toBeTruthy();
    expect(screen.getByText('Bug')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('PRJ-1')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('60');
  });
});

describe('kanban-board render', () => {
  it('renders a column per status with the card count and cards in place', () => {
    render(
      <KanbanBoard
        cards={[card('1', 'todo'), card('2', 'todo'), card('3', 'done')]}
        columns={COLUMNS}
      />,
    );
    expect(screen.getByText('To do')).toBeTruthy();
    const todo = screen.getByTestId('column-drop-todo');
    expect(within(todo).getAllByRole('button')).toHaveLength(2);
    const done = screen.getByTestId('column-drop-done');
    expect(within(done).getAllByRole('button')).toHaveLength(1);
  });

  it('shows the empty state when there are no columns', () => {
    render(<KanbanBoard cards={[]} columns={[]} labels={{ emptyTitle: 'Nothing here' }} />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  it('opens a card on click', () => {
    const onOpen = vi.fn();
    render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardOpen={onOpen} />);
    fireEvent.click(grabCardEl('Card 1'));
    expect(onOpen).toHaveBeenCalledWith('1');
  });
});

describe('kanban-board keyboard move (drives the same optimistic path as a pointer drop)', () => {
  it('grab → arrow → commit moves the card and fires onCardMove(cardId, from, to)', () => {
    const onMove = vi.fn();
    render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardMove={onMove} />);
    const el = grabCardEl('Card 1');
    el.focus();
    fireEvent.keyDown(el, { key: ' ' }); // grab
    fireEvent.keyDown(el, { key: 'ArrowRight' }); // preview → in_progress
    fireEvent.keyDown(el, { key: 'ArrowRight' }); // preview → done
    fireEvent.keyDown(el, { key: 'Enter' }); // commit
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('1', 'todo', 'done');
    // The card now lives in the Done column.
    expect(within(screen.getByTestId('column-drop-done')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
    expect(within(screen.getByTestId('column-drop-todo')).queryByRole('button')).toBeNull();
  });

  it('Escape cancels the grab and leaves the card in place', () => {
    const onMove = vi.fn();
    render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardMove={onMove} />);
    const el = grabCardEl('Card 1');
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(onMove).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('column-drop-todo')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
  });

  it('announces the move through the aria-live region', () => {
    const { container } = render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardMove={() => {}} />);
    const live = container.querySelector('[data-board-liveregion]')!;
    const el = grabCardEl('Card 1');
    fireEvent.keyDown(el, { key: ' ' });
    expect(live.textContent).toContain('Grabbed');
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(live.textContent).toContain('Moved');
  });

  it('rolls back the optimistic move and announces failure when the mutation rejects', async () => {
    const onMove = vi.fn().mockRejectedValue(new Error('DENIED'));
    const { container } = render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardMove={onMove} />);
    const el = grabCardEl('Card 1');
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' }); // commit → rejected promise
      await Promise.resolve();
    });
    await waitFor(() => {
      // Card is back in its original column.
      expect(within(screen.getByTestId('column-drop-todo')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
    });
    expect(container.querySelector('[data-board-liveregion]')!.textContent).toContain('Could not move');
  });
});

describe('kanban-board RTL', () => {
  it('applies dir=rtl and maps ArrowRight to the previous (logical) column', () => {
    const onMove = vi.fn();
    const { container } = render(
      <KanbanBoard cards={[card('1', 'in_progress')]} columns={COLUMNS} dir="rtl" onCardMove={onMove} />,
    );
    expect(container.querySelector('[data-widget="kanban-board"]')!.getAttribute('dir')).toBe('rtl');
    const el = grabCardEl('Card 1');
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' }); // RTL: reading-forward → previous column (todo)
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith('1', 'in_progress', 'todo');
  });

  it('LTR ArrowRight advances to the next column (mirror of the RTL case)', () => {
    const onMove = vi.fn();
    render(<KanbanBoard cards={[card('1', 'in_progress')]} columns={COLUMNS} dir="ltr" onCardMove={onMove} />);
    const el = grabCardEl('Card 1');
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith('1', 'in_progress', 'done');
  });

  it('keeps columns in source DOM order under RTL (visual mirroring is the flex direction)', () => {
    const { container } = render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} dir="rtl" />);
    const ids = [...container.querySelectorAll('[data-board-column]')].map((el) => el.getAttribute('data-board-column'));
    expect(ids).toEqual(['todo', 'in_progress', 'done']);
  });
});

describe('kanban-swimlane-grid', () => {
  const LANES: LaneDef[] = [
    { id: 'growth', name: 'Growth', tone: 'accent' },
    { id: 'platform', name: 'Platform', tone: 'info' },
  ];

  it('renders a cell per lane × column and places cards by both fields', () => {
    render(
      <KanbanSwimlaneGrid
        cards={[card('1', 'todo', { lane: 'growth' }), card('2', 'done', { lane: 'platform' })]}
        columns={COLUMNS}
        lanes={LANES}
      />,
    );
    expect(within(screen.getByTestId('cell-drop-growth-todo')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
    expect(within(screen.getByTestId('cell-drop-platform-done')).getByRole('button', { name: 'Card 2' })).toBeTruthy();
  });

  it('encode/decode round-trips a cell key', () => {
    expect(decodeCell(encodeCell('growth', 'todo'))).toEqual({ laneId: 'growth', columnId: 'todo' });
  });

  it('keyboard move across both axes reassigns lane AND column', () => {
    const onMove = vi.fn();
    render(
      <KanbanSwimlaneGrid
        cards={[card('1', 'todo', { lane: 'growth' })]}
        columns={COLUMNS}
        lanes={LANES}
        onCardMove={onMove}
      />,
    );
    const el = grabCardEl('Card 1');
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' }); // column → in_progress
    fireEvent.keyDown(el, { key: 'ArrowDown' }); // lane → platform
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith(
      '1',
      { lane: 'growth', column: 'todo' },
      { lane: 'platform', column: 'in_progress' },
    );
    expect(within(screen.getByTestId('cell-drop-platform-in_progress')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
  });

  it('insets the column header row (px-2) to line up with each lane’s p-2 cell columns', () => {
    const { container } = render(
      <KanbanSwimlaneGrid cards={[card('1', 'todo', { lane: 'growth' })]} columns={COLUMNS} lanes={LANES} />,
    );
    const header = container.querySelector('[data-part="column-header-row"]')!;
    expect(header.className).toContain('px-2');
  });

  it('shows a lane summary of Σpoints · count', () => {
    render(
      <KanbanSwimlaneGrid
        cards={[card('1', 'todo', { lane: 'growth', points: 3 }), card('2', 'done', { lane: 'growth', points: 5 })]}
        columns={COLUMNS}
        lanes={LANES}
      />,
    );
    expect(screen.getByText('Σ8 pts · 2')).toBeTruthy();
  });
});

describe('announcementsFromTemplates (localized dnd aria-live)', () => {
  it('substitutes {title} and {cell} and leaves omitted keys to the defaults', () => {
    const a = announcementsFromTemplates({ grabbed: 'Saisi {title}.', moved: '{title} → {cell}' });
    expect(a.grabbed!('Carte')).toBe('Saisi Carte.');
    expect(a.moved!('Carte', 'Fait')).toBe('Carte → Fait');
    expect(a.failed).toBeUndefined(); // falls back to defaultBoardAnnouncements
  });
});

describe('kanban-board WidgetProps wrapper (registered widget path)', () => {
  const twoColData = {
    status: 'success' as const,
    data: {
      data: [
        { id: 'PRJ-101', title: 'Ship it', status: 'todo' },
        { id: 'PRJ-102', title: 'Other', status: 'done' },
      ],
      total: 2,
    },
  };

  it('rolls back the optimistic move when the host mutate promise rejects', async () => {
    const registry = buildRegistry([kanbanBoardDefinition]);
    const onEvent = vi.fn(() => Promise.reject(new Error('DENIED')));
    const { container } = render(
      <WidgetHost
        widgetId="kanban-board"
        instanceId="kb-rollback"
        config={{}}
        data={twoColData}
        onEvent={onEvent}
        registry={registry}
      />,
    );
    const el = await screen.findByRole('button', { name: 'Ship it' }); // await lazy dnd chunk
    el.focus();
    fireEvent.keyDown(el, { key: ' ' }); // grab
    fireEvent.keyDown(el, { key: 'ArrowRight' }); // preview → done
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' }); // commit → rejected promise
      await Promise.resolve();
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mutate', intent: 'update', recordId: 'PRJ-101' }),
    );
    await waitFor(() => {
      // Rolled back to the original column, not stuck in Done.
      expect(within(screen.getByTestId('column-drop-todo')).getByRole('button', { name: 'Ship it' })).toBeTruthy();
    });
    expect(container.querySelector('[data-board-liveregion]')!.textContent).toContain('Could not move');
  });

  it('localizes dnd announcements from config.announcements', async () => {
    const registry = buildRegistry([kanbanBoardDefinition]);
    const { container } = render(
      <WidgetHost
        widgetId="kanban-board"
        instanceId="kb-i18n"
        config={{ announcements: { grabbed: 'Attrapé {title}.' } }}
        data={twoColData}
        onEvent={() => {}}
        registry={registry}
      />,
    );
    const el = await screen.findByRole('button', { name: 'Ship it' }); // await lazy dnd chunk
    fireEvent.keyDown(el, { key: ' ' }); // grab
    expect(container.querySelector('[data-board-liveregion]')!.textContent).toContain('Attrapé Ship it.');
  });
});

describe('demoData determinism', () => {
  it('kanban-board demoData is stable per seed and non-empty', () => {
    expect(kanbanBoardDemoData(7)).toEqual(kanbanBoardDemoData(7));
    expect(kanbanBoardDemoData(7)).not.toEqual(kanbanBoardDemoData(8));
    const demo = kanbanBoardDemoData(1);
    expect(demo.total).toBe(demo.data.length);
    expect(demo.data.length).toBeGreaterThan(0);
  });

  it('kanban-swimlane-grid demoData is stable per seed and carries a lane field', () => {
    expect(kanbanSwimlaneGridDemoData(3)).toEqual(kanbanSwimlaneGridDemoData(3));
    expect(kanbanSwimlaneGridDemoData(3)).not.toEqual(kanbanSwimlaneGridDemoData(4));
    expect(kanbanSwimlaneGridDemoData(3).data.every((row) => typeof row.lane === 'string')).toBe(true);
  });

  it('configs parse to valid defaults', () => {
    expect(kanbanBoardConfigSchema.parse({}).columnField).toBe('status');
    expect(kanbanSwimlaneGridConfigSchema.parse({}).laneField).toBe('lane');
  });
});

describe('four WidgetFrame states through WidgetHost', () => {
  for (const definition of [kanbanBoardDefinition, kanbanSwimlaneGridDefinition]) {
    const registry = buildRegistry([definition]);
    it(`${definition.id}: skeleton, empty, and error states route correctly`, () => {
      const skeleton = render(
        <WidgetHost widgetId={definition.id} instanceId={`${definition.id}-l`} data={{ status: 'loading' }} registry={registry} />,
      );
      expect(document.querySelector(`[data-skeleton-variant="${definition.skeleton}"]`)).not.toBeNull();
      skeleton.unmount();

      const empty = render(
        <WidgetHost
          widgetId={definition.id}
          instanceId={`${definition.id}-e`}
          config={{ emptyState: { titleKey: `empty-${definition.id}` } }}
          data={{ status: 'success', data: { data: [], total: 0 } }}
          registry={registry}
        />,
      );
      expect(screen.getByText(`empty-${definition.id}`)).toBeTruthy();
      empty.unmount();

      const refetch = vi.fn();
      render(
        <WidgetHost
          widgetId={definition.id}
          instanceId={`${definition.id}-err`}
          data={{ status: 'error', error: new Error('BOARD_FORBIDDEN'), refetch }}
          registry={registry}
        />,
      );
      expect(screen.getByRole('alert')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  }
});

describe('board chrome localization (ui:widgets.boards.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? { widgets: { boards: { kanbanBoard: { emptyTitle: 'Keine Spalten', emptyBody: 'Statusfeld wählen.' } } } }
          : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <KanbanBoard cards={[]} columns={[]} />
      </I18nProvider>,
    );
    expect(screen.getByText('Keine Spalten')).toBeTruthy();

    cleanup();
    render(<KanbanBoard cards={[]} columns={[]} />);
    expect(screen.getByText('No board columns')).toBeTruthy();
  });
});
