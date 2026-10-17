// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `boards` family (annex, Track BOARDS): render + interaction tests for
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
import { SETTLED_OVERRIDE_WAIT_MS, announcementsFromTemplates } from './board-dnd.js';
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

  it('opens a card by the column the answer names as the row’s key, and by its place only when there is none', () => {
    // A table keyed `order_id` has no `id`: its place in the list is not a record.
    expect(toBoardCard({ order_id: 10248, name: 'Vins', state: 'done' }, 0, { columnField: 'state', titleField: 'name', keyField: 'order_id' }).id).toBe('10248');
    expect(toBoardCard({ name: 'Vins', state: 'done' }, 3, { columnField: 'state', titleField: 'name', keyField: 'order_id' }).id).toBe('3');
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

describe('kanban-board: what a host may add (each left out, the board is as it was)', () => {
  it('a card prints its extra lines, and its foot in place of its id', () => {
    render(<BoardCard card={card('7', 'todo', { lines: [{ label: 'Close', value: '12 Mar' }, { value: '3 days in stage' }], foot: 'D-7' })} />);
    const lines = document.querySelector('[data-part="board-card-lines"]')!;
    expect(lines.textContent).toBe('Close12 Mar3 days in stage');
    expect(screen.getByText('D-7')).toBeTruthy();
    expect(screen.queryByText('7')).toBeNull();
    cleanup();
    // An empty foot prints nothing; with none given the id is printed, as before.
    render(<BoardCard card={card('7', 'todo', { foot: '' })} />);
    expect(screen.queryByText('7')).toBeNull();
    expect(document.querySelector('[data-part="board-card-lines"]')).toBeNull();
    cleanup();
    render(<BoardCard card={card('7', 'todo')} />);
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('a card that may not be moved is not picked up; with a way to open it, Tab stops there and Enter opens it', () => {
    const onMove = vi.fn();
    const onOpen = vi.fn();
    const cards = [card('1', 'todo'), card('2', 'todo')];
    const { rerender } = render(<KanbanBoard cards={cards} columns={COLUMNS} onCardMove={onMove} onCardOpen={onOpen} canMoveCard={(id) => id !== '1'} />);
    const locked = grabCardEl('Card 1');
    expect(locked.tabIndex).toBe(0);
    expect(locked.hasAttribute('aria-roledescription')).toBe(false);
    fireEvent.keyDown(locked, { key: 'Enter' });
    expect(locked.hasAttribute('aria-grabbed')).toBe(false);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('1');
    fireEvent.keyDown(locked, { key: 'ArrowRight' });
    fireEvent.keyDown(locked, { key: 'Escape' });
    // The other card is moved as ever.
    const free = grabCardEl('Card 2');
    expect(free.getAttribute('aria-roledescription')).toBe('draggable card');
    fireEvent.keyDown(free, { key: ' ' });
    fireEvent.keyDown(free, { key: 'ArrowRight' });
    fireEvent.keyDown(free, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledExactlyOnceWith('2', 'todo', 'in_progress');
    expect(onOpen).toHaveBeenCalledTimes(1);
    // With nothing to open, a card that stays put is not a stop for Tab.
    rerender(<KanbanBoard cards={cards} columns={COLUMNS} onCardMove={onMove} canMoveCard={() => false} />);
    expect(grabCardEl('Card 1').tabIndex).toBe(-1);
    fireEvent.keyDown(grabCardEl('Card 1'), { key: 'Enter' });
    expect(grabCardEl('Card 1').hasAttribute('aria-grabbed')).toBe(false);
  });

  it('draws the host’s foot under each column’s cards, and none when it gives none', () => {
    const { rerender } = render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} columnFooter={(column) => <button type="button">{`Add to ${column.label}`}</button>} />);
    const feet = [...document.querySelectorAll('[data-part="column-footer"]')];
    expect(feet.map((foot) => foot.textContent)).toEqual(['Add to To do', 'Add to In progress', 'Add to Done']);
    expect(feet[0]!.closest('[data-board-column]')?.getAttribute('data-board-column')).toBe('todo');
    // A key typed in the foot is the foot's own: no card is picked up by it.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add to To do' }), { key: ' ' });
    expect(grabCardEl('Card 1').hasAttribute('aria-grabbed')).toBe(false);
    rerender(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} />);
    expect(document.querySelector('[data-part="column-footer"]')).toBeNull();
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

describe('kanban-board: a column whose cards somebody else counted', () => {
  const COUNTED: ColumnDef[] = [
    { id: '1', label: 'Lead', tone: 'neutral', count: 340, total: '€12,400' },
    { id: '2', label: 'Proposal', tone: 'accent', count: 0, total: '€0' },
    { id: '3', label: 'Closing', tone: 'pos' },
  ];
  const countOf = (column: string): string | null | undefined =>
    document.querySelector(`[data-board-column="${column}"] [data-part="column-count"]`)?.textContent;
  const totalOf = (column: string): string | null | undefined =>
    document.querySelector(`[data-board-column="${column}"] [data-part="column-total"]`)?.textContent;

  it('heads each column with the count and the total it was given, not the number of cards listed', () => {
    render(<KanbanBoard cards={[card('a', '1'), card('b', '1')]} columns={COUNTED} />);
    expect(countOf('1')).toBe('340');
    expect(totalOf('1')).toBe('€12,400');
    // A column with no card is drawn, with its own count and total.
    expect(countOf('2')).toBe('0');
    expect(totalOf('2')).toBe('€0');
    // No count given: the cards listed, as before, and no total.
    expect(countOf('3')).toBe('0');
    expect(totalOf('3')).toBeUndefined();
  });

  it('moves the count with a card that was just dropped, until the next count is in', () => {
    render(<KanbanBoard cards={[card('a', '1'), card('b', '1')]} columns={COUNTED} onCardMove={() => new Promise(() => undefined)} />);
    const el = grabCardEl('Card a');
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(countOf('1')).toBe('339');
    expect(countOf('2')).toBe('1');
  });

  it('reads a card’s column from a number as from a word, and from nothing else', () => {
    expect(toBoardCard({ id: 7, name: 'Harbour', stage_id: 3 }, 0, { columnField: 'stage_id', titleField: 'name' }).column).toBe('3');
    expect(toBoardCard({ id: 8, name: 'Dental', stage_id: '3' }, 0, { columnField: 'stage_id', titleField: 'name' }).column).toBe('3');
    expect(toBoardCard({ id: 9, name: 'Nobody', stage_id: null }, 0, { columnField: 'stage_id', titleField: 'name' }).column).toBe('');
    expect(toBoardCard({ id: 9, name: 'Odd', stage_id: { id: 3 } }, 0, { columnField: 'stage_id', titleField: 'name' }).column).toBe('');
  });
});

describe('kanban-board: a move whose save is refused', () => {
  const refuse = async (onMove: () => Promise<unknown>, dir: 'ltr' | 'rtl' = 'ltr') => {
    const view = render(<KanbanBoard cards={[card('1', dir === 'rtl' ? 'in_progress' : 'todo')]} columns={COLUMNS} dir={dir} onCardMove={onMove} />);
    const el = grabCardEl('Card 1');
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
      await Promise.resolve();
    });
    return view;
  };

  it('puts the card back, and says why on the board and aloud', async () => {
    const { container } = await refuse(() => Promise.reject(new Error('A won deal cannot be moved.')));
    await waitFor(() => expect(within(screen.getByTestId('column-drop-todo')).getByRole('button', { name: 'Card 1' })).toBeTruthy());
    const notice = container.querySelector('[data-part="board-move-refused"]')!;
    expect(notice.textContent).toContain('Card 1 was not moved.');
    expect(notice.textContent).toContain('A won deal cannot be moved.');
    const live = container.querySelector('[data-board-liveregion]')!.textContent ?? '';
    expect(live).toContain('Could not move Card 1');
    expect(live).toContain('A won deal cannot be moved.');
  });

  it('says only that it went back when the refusal gives no reason, and the line can be dismissed', async () => {
    const { container } = await refuse(() => Promise.reject(new Error('')));
    await waitFor(() => expect(container.querySelector('[data-part="board-move-refused"]')).not.toBeNull());
    expect(container.querySelector('[data-part="board-move-refused-reason"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container.querySelector('[data-part="board-move-refused"]')).toBeNull();
  });

  it('the next move clears the line', async () => {
    const onMove = vi.fn().mockRejectedValueOnce(new Error('Not yours.')).mockResolvedValue({});
    const { container } = await refuse(onMove);
    await waitFor(() => expect(container.querySelector('[data-part="board-move-refused"]')).not.toBeNull());
    const el = grabCardEl('Card 1');
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(container.querySelector('[data-part="board-move-refused"]')).toBeNull();
  });

  it('is the same under RTL: back in its column, the reason said', async () => {
    const { container } = await refuse(() => Promise.reject(new Error('Not yours.')), 'rtl');
    await waitFor(() => expect(within(screen.getByTestId('column-drop-in_progress')).getByRole('button', { name: 'Card 1' })).toBeTruthy());
    expect(container.querySelector('[data-part="board-move-refused"]')!.textContent).toContain('Not yours.');
  });
});

describe('kanban-board: answers that arrive late, and saves that have answered', () => {
  const COUNTED: ColumnDef[] = [
    { id: 'todo', label: 'To do', tone: 'neutral', count: 10 },
    { id: 'in_progress', label: 'In progress', tone: 'accent', count: 4 },
    { id: 'done', label: 'Done', tone: 'pos', count: 0 },
  ];
  const countOf = (column: string): string | null | undefined =>
    document.querySelector(`[data-board-column="${column}"] [data-part="column-count"]`)?.textContent;
  const step = (title: string): void => {
    const el = grabCardEl(title);
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Enter' });
  };
  /** A save whose answer the test gives when it chooses. */
  const deferred = () => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  };

  it('a refusal of an earlier move says nothing once the card has been moved again', async () => {
    const first = deferred();
    const second = deferred();
    const onMove = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { container } = render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardMove={onMove} />);
    step('Card 1'); // todo → in_progress
    step('Card 1'); // in_progress → done, before the first has answered
    expect(onMove).toHaveBeenNthCalledWith(2, '1', 'in_progress', 'done');
    await act(async () => {
      first.reject(new Error('Not yours.'));
      await Promise.resolve();
    });
    // The card is in Done: nothing says it "went back", on the board or aloud.
    expect(within(screen.getByTestId('column-drop-done')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
    expect(container.querySelector('[data-part="board-move-refused"]')).toBeNull();
    expect(container.querySelector('[data-board-liveregion]')!.textContent).not.toContain('Could not move');
    // The latest move's own refusal is still said.
    await act(async () => {
      second.reject(new Error('Closed.'));
      await Promise.resolve();
    });
    await waitFor(() => expect(container.querySelector('[data-part="board-move-refused"]')!.textContent).toContain('Closed.'));
    expect(within(screen.getByTestId('column-drop-todo')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
  });

  it('lets go of a saved move with the next cards to arrive, whatever they say', async () => {
    const save = deferred();
    const cards = [card('1', 'todo')];
    const { rerender } = render(<KanbanBoard cards={cards} columns={COLUMNS} onCardMove={() => save.promise} />);
    step('Card 1');
    // Cards that arrive BEFORE the save has answered do not undo the drop.
    rerender(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardMove={() => save.promise} />);
    expect(within(screen.getByTestId('column-drop-in_progress')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
    await act(async () => {
      save.resolve({});
      await Promise.resolve();
    });
    // Saved, and the server kept the card where it was (a rule of its own): the next cards are the truth.
    rerender(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardMove={() => save.promise} />);
    expect(within(screen.getByTestId('column-drop-todo')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
    expect(within(screen.getByTestId('column-drop-in_progress')).queryByRole('button')).toBeNull();
  });

  it('lets go of a saved move after a short wait when no new cards ever arrive', async () => {
    vi.useFakeTimers();
    try {
      const cards = [card('1', 'todo')];
      render(<KanbanBoard cards={cards} columns={COLUMNS} onCardMove={() => Promise.resolve({})} />);
      step('Card 1');
      await act(async () => {
        await Promise.resolve();
      });
      expect(within(screen.getByTestId('column-drop-in_progress')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(SETTLED_OVERRIDE_WAIT_MS);
      });
      expect(within(screen.getByTestId('column-drop-todo')).getByRole('button', { name: 'Card 1' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves a counted column by a dropped card only until its save has answered: the next count has the move in it', async () => {
    const save = deferred();
    const cards = [card('a', 'todo'), card('b', 'todo')];
    const { rerender } = render(<KanbanBoard cards={cards} columns={COUNTED} onCardMove={() => save.promise} />);
    step('Card a');
    expect([countOf('todo'), countOf('in_progress')]).toEqual(['9', '5']);
    await act(async () => {
      save.resolve({});
      await Promise.resolve();
    });
    // The columns are read again before the cards are: their counts already hold the move.
    const recounted = COUNTED.map((column) => (column.id === 'todo' ? { ...column, count: 9 } : column.id === 'in_progress' ? { ...column, count: 5 } : column));
    rerender(<KanbanBoard cards={cards} columns={recounted} onCardMove={() => save.promise} />);
    expect([countOf('todo'), countOf('in_progress')]).toEqual(['9', '5']);
    // And the card is still where it was dropped until its own read is in.
    expect(within(screen.getByTestId('column-drop-in_progress')).getByRole('button', { name: 'Card a' })).toBeTruthy();
  });

  it('says on the board and aloud when a column’s "add" is refused', async () => {
    const onAdd = vi.fn(() => Promise.reject(new Error('State must start as Open.')));
    const { container } = render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} allowAdd onAdd={onAdd} />);
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>('[data-board-column="done"] [data-part="column-add"]')!);
      await Promise.resolve();
    });
    await waitFor(() => expect(container.querySelector('[data-part="board-add-refused"]')).not.toBeNull());
    const notice = container.querySelector('[data-part="board-add-refused"]')!;
    expect(notice.textContent).toContain('The card was not added.');
    expect(notice.textContent).toContain('State must start as Open.');
    expect(container.querySelector('[data-board-liveregion]')!.textContent).toContain('The card was not added. State must start as Open.');
    fireEvent.click(within(notice as HTMLElement).getByRole('button', { name: 'Dismiss' }));
    expect(container.querySelector('[data-part="board-add-refused"]')).toBeNull();
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

describe('kanban-board — a card’s own actions, a column’s badge, and opening by key (all optional)', () => {
  const ACTIONS = [
    { id: 'close', label: 'Close: won or lost…' },
    { id: 'room', label: 'Open the deal room', disabled: true },
    { id: 'drop', label: 'Delete', tone: 'danger' as const },
  ];
  const menuOf = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="menu"]');
  const more = (title: string): HTMLElement => screen.getByRole('button', { name: `Actions for ${title}` });
  const itemsOf = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];

  it('draws nothing new when no actions are given, or when nobody listens for one', () => {
    const { container, rerender } = render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardAction={vi.fn()} />);
    expect(container.querySelector('[data-part="board-card-shell"]')).toBeNull();
    expect(container.querySelector('[data-part="board-card-actions"]')).toBeNull();
    expect(container.querySelector('[data-part="column-badge"]')).toBeNull();
    expect(container.querySelector('[data-part="board-open-hint"]')).toBeNull();
    // The card stands in its cell as it always did, with nothing round it.
    expect(grabCardEl('Card 1').parentElement?.hasAttribute('data-board-cell')).toBe(true);
    rerender(<KanbanBoard cards={[card('1', 'todo', { actions: ACTIONS })]} columns={COLUMNS} />);
    expect(container.querySelector('[data-part="board-card-actions"]')).toBeNull();
    rerender(<KanbanBoard cards={[card('1', 'todo', { actions: [] })]} columns={COLUMNS} onCardAction={vi.fn()} />);
    expect(container.querySelector('[data-part="board-card-actions"]')).toBeNull();
  });

  it('gives a card with actions a real button after the card, not in it, named for the card', () => {
    render(<KanbanBoard cards={[card('1', 'todo', { actions: ACTIONS }), card('2', 'todo')]} columns={COLUMNS} onCardAction={vi.fn()} onCardMove={vi.fn()} />);
    const button = more('Card 1');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const shell = grabCardEl('Card 1');
    expect(shell.contains(button)).toBe(false);
    // After the card in the page, so Tab reaches the card first and then its button.
    expect(shell.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shell.nextElementSibling).toBe(button);
    expect(button.tabIndex).toBe(0);
    // The card without actions has none.
    expect(screen.queryByRole('button', { name: 'Actions for Card 2' })).toBeNull();
    expect(menuOf()).toBeNull();
  });

  it('opens a menu the arrows go round, chooses with a press, and hands the card’s and the action’s ids over', () => {
    const onAction = vi.fn();
    render(<KanbanBoard cards={[card('1', 'todo', { actions: ACTIONS })]} columns={COLUMNS} onCardAction={onAction} onCardMove={vi.fn()} />);
    const button = more('Card 1');
    fireEvent.click(button);
    const menu = menuOf()!;
    expect(menu.getAttribute('aria-label')).toBe('Actions for Card 1');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    const [close, room, drop] = itemsOf();
    expect(itemsOf().map((item) => item.textContent)).toEqual(['Close: won or lost…', 'Open the deal room', 'Delete']);
    expect(itemsOf().every((item) => item.tabIndex === -1)).toBe(true);
    expect(document.activeElement).toBe(close);
    // Placed against the window, so the column's scroll box cannot cut it off.
    expect(menu.className.split(' ')).toContain('fixed');
    expect(menu.style.visibility).toBe('visible');
    fireEvent.keyDown(close!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(room);
    fireEvent.keyDown(room!, { key: 'End' });
    expect(document.activeElement).toBe(drop);
    fireEvent.keyDown(drop!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(drop);
    fireEvent.keyDown(drop!, { key: 'Home' });
    expect(document.activeElement).toBe(close);
    expect(drop!.className).toContain('text-danger');

    // One that is not to be had: said so, and a press does nothing and leaves the menu open.
    expect(room!.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(room!);
    expect(onAction).not.toHaveBeenCalled();
    expect(menuOf()).not.toBeNull();

    fireEvent.click(drop!);
    expect(onAction).toHaveBeenCalledExactlyOnceWith('1', 'drop');
    expect(menuOf()).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes the menu and gives the focus back to its button; a press elsewhere and Tab close it too', () => {
    const onAction = vi.fn();
    render(<KanbanBoard cards={[card('1', 'todo', { actions: ACTIONS })]} columns={COLUMNS} onCardAction={onAction} />);
    const button = more('Card 1');
    // The up arrow opens it on its last item, the down arrow on its first.
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(itemsOf()[2]);
    fireEvent.keyDown(itemsOf()[2]!, { key: 'Escape' });
    expect(menuOf()).toBeNull();
    expect(document.activeElement).toBe(button);

    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(itemsOf()[0]);
    // Inside the menu is not "elsewhere".
    fireEvent.pointerDown(itemsOf()[1]!);
    expect(menuOf()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(menuOf()).toBeNull();

    fireEvent.click(button);
    fireEvent.keyDown(itemsOf()[0]!, { key: 'Tab' });
    expect(menuOf()).toBeNull();
    expect(document.activeElement).toBe(button);

    // A second press of the button closes what the first opened.
    fireEvent.click(button);
    fireEvent.click(button);
    expect(menuOf()).toBeNull();
    // A scroll that leaves the button where it is leaves the menu; one that moves the button puts it away.
    fireEvent.click(button);
    fireEvent.scroll(document);
    expect(menuOf()).not.toBeNull();
    const rect = button.getBoundingClientRect();
    button.getBoundingClientRect = () => ({ ...rect, top: rect.top - 40, bottom: rect.bottom - 40, y: rect.y - 40, toJSON: () => ({}) });
    fireEvent.scroll(document);
    expect(menuOf()).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('the button and its menu never pick the card up, move it or open it', () => {
    const onMove = vi.fn();
    const onOpen = vi.fn();
    const onAction = vi.fn();
    render(<KanbanBoard cards={[card('1', 'todo', { actions: ACTIONS })]} columns={COLUMNS} onCardAction={onAction} onCardMove={onMove} onCardOpen={onOpen} keyboardOpen />);
    const shell = grabCardEl('Card 1');
    const button = more('Card 1');
    for (const key of ['Enter', ' ', 'ArrowRight']) fireEvent.keyDown(button, { key });
    fireEvent.pointerDown(button, { button: 0, isPrimary: true });
    fireEvent.click(button);
    fireEvent.keyDown(itemsOf()[0]!, { key: 'Enter' });
    fireEvent.keyDown(itemsOf()[0]!, { key: 'ArrowRight' });
    fireEvent.click(itemsOf()[0]!);
    expect(shell.hasAttribute('aria-grabbed')).toBe(false);
    expect(shell.hasAttribute('data-dragging')).toBe(false);
    expect(document.querySelector('[data-board-liveregion]')?.textContent).toBe('');
    expect(onMove).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('1', 'close');
    // And the card is moved by keyboard as ever.
    fireEvent.keyDown(shell, { key: ' ' });
    fireEvent.keyDown(shell, { key: 'ArrowRight' });
    fireEvent.keyDown(shell, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledExactlyOnceWith('1', 'todo', 'in_progress');
  });

  it('keyboardOpen: Shift+Enter opens a card that Enter picks up, and the card says so; off unless asked for', () => {
    const onOpen = vi.fn();
    const onMove = vi.fn();
    const { rerender } = render(<KanbanBoard cards={[card('1', 'todo'), card('2', 'todo')]} columns={COLUMNS} onCardMove={onMove} onCardOpen={onOpen} canMoveCard={(id) => id !== '2'} keyboardOpen />);
    const free = grabCardEl('Card 1');
    const hint = document.querySelector('[data-part="board-open-hint"]')!;
    expect(hint.textContent).toBe('Enter picks this card up to move it. Shift+Enter opens it.');
    expect(free.getAttribute('aria-describedby')).toBe(hint.id);
    // A card that cannot be moved opens with Enter alone, so the line is not its own.
    expect(grabCardEl('Card 2').hasAttribute('aria-describedby')).toBe(false);
    fireEvent.keyDown(free, { key: 'Enter', shiftKey: true });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('1');
    expect(free.hasAttribute('aria-grabbed')).toBe(false);
    // Enter alone still picks it up; while it is held, Shift+Enter is a drop like any Enter.
    fireEvent.keyDown(free, { key: 'Enter' });
    expect(free.getAttribute('aria-grabbed')).toBe('true');
    fireEvent.keyDown(free, { key: 'ArrowRight' });
    fireEvent.keyDown(free, { key: 'Enter', shiftKey: true });
    expect(onMove).toHaveBeenCalledExactlyOnceWith('1', 'todo', 'in_progress');
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Without the prop a board is as it was: no line, and Shift+Enter is an Enter.
    rerender(<KanbanBoard cards={[card('3', 'todo')]} columns={COLUMNS} onCardMove={onMove} onCardOpen={onOpen} />);
    expect(document.querySelector('[data-part="board-open-hint"]')).toBeNull();
    const plain = grabCardEl('Card 3');
    expect(plain.hasAttribute('aria-describedby')).toBe(false);
    fireEvent.keyDown(plain, { key: 'Enter', shiftKey: true });
    expect(plain.getAttribute('aria-grabbed')).toBe('true');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('writes a column’s badge right after its label', () => {
    const { container } = render(<KanbanBoard cards={[]} columns={[{ ...COLUMNS[0]!, badge: '10%' }, COLUMNS[1]!]} />);
    const badges = container.querySelectorAll('[data-part="column-badge"]');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.textContent).toBe('10%');
    expect(badges[0]!.previousElementSibling?.textContent).toBe('To do');
    expect(badges[0]!.nextElementSibling?.getAttribute('data-part')).toBe('column-count');
  });
});
