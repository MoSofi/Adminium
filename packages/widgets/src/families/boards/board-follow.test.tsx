// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A keyboard move is followed. While a card is grabbed, the cell it is over is
 * scrolled into view inside the board's own scroller (on a phone the next
 * column is off-screen); after a drop, a cancel or a refused save, the focus
 * is on the moved card again — a card that changes column is a new element,
 * and without this the focus falls to the page's body.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KanbanBoard } from './KanbanBoard.js';
import { KanbanSwimlaneGrid, encodeCell } from './KanbanSwimlaneGrid.js';
import { scrollCellIntoView } from './board-dnd.js';
import type { BoardCardData, ColumnDef, LaneDef } from './board-lib.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const COLUMNS: ColumnDef[] = [
  { id: 'todo', label: 'To do', tone: 'neutral' },
  { id: 'in_progress', label: 'In progress', tone: 'accent' },
  { id: 'done', label: 'Done', tone: 'pos' },
];
const LANES: LaneDef[] = [
  { id: 'a', name: 'Lane A', tone: 'accent' },
  { id: 'b', name: 'Lane B', tone: 'info' },
];
const card = (id: string, column: string, extra: Partial<BoardCardData> = {}): BoardCardData => ({ id, title: `Card ${id}`, column, ...extra });
const cardEl = (title: string): HTMLElement => screen.getByRole('button', { name: title });

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/**
 * A phone's worth of layout: the scroller is 334 wide at x = 28, each column
 * 288 wide and 300 apart inside it, moved by the scroller's `scrollLeft`.
 */
function layOut(container: HTMLElement): HTMLElement {
  const scroller = container.querySelector<HTMLElement>('[data-board-scroller]')!;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === scroller) return rect(28, 100, 334, 600);
    const column = this.closest('[data-board-column]');
    if (column === null) return rect(0, 0, 0, 0);
    const index = [...container.querySelectorAll('[data-board-column]')].indexOf(column);
    return rect(28 + 12 + index * 300 - scroller.scrollLeft, 100, 288, 600);
  });
  return scroller;
}

describe('kanban-board: a keyboard move is followed', () => {
  it('scrolls the column the grabbed card is over into view, inside the board and nowhere else', () => {
    const page = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const { container } = render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} />);
    const scroller = layOut(container);
    const el = cardEl('Card 1');
    fireEvent.keyDown(el, { key: ' ' });
    expect(scroller.scrollLeft).toBe(0);

    fireEvent.keyDown(el, { key: 'ArrowRight' });
    const over = container.querySelector('[data-board-column="in_progress"]')!.getBoundingClientRect();
    expect(over.left).toBeGreaterThanOrEqual(28);
    expect(over.right).toBeLessThanOrEqual(28 + 334);
    expect(scroller.scrollLeft).toBeGreaterThan(0);

    fireEvent.keyDown(el, { key: 'ArrowRight' });
    const last = container.querySelector('[data-board-column="done"]')!.getBoundingClientRect();
    expect(last.left).toBeGreaterThanOrEqual(28);
    expect(last.right).toBeLessThanOrEqual(28 + 334);

    // And back the other way: the column that went off the start side returns.
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    const first = container.querySelector('[data-board-column="todo"]')!.getBoundingClientRect();
    expect(first.left).toBeGreaterThanOrEqual(28);
    expect(first.right).toBeLessThanOrEqual(28 + 334);
    expect(page).not.toHaveBeenCalled();
  });

  it('after a cancel the card’s own column is back in view: the focus is on a card that can be seen', () => {
    const { container } = render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} />);
    const scroller = layOut(container);
    const el = cardEl('Card 1');
    el.focus();
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(scroller.scrollLeft).toBeGreaterThan(288);
    fireEvent.keyDown(el, { key: 'Escape' });
    const own = container.querySelector('[data-board-column="todo"]')!.getBoundingClientRect();
    expect(own.left).toBeGreaterThanOrEqual(28);
    expect(own.right).toBeLessThanOrEqual(28 + 334);
    expect(document.activeElement).toBe(el);
  });

  it('leaves a column that is already in view where it is', () => {
    const scroller = document.createElement('div');
    const cell = document.createElement('div');
    scroller.append(cell);
    scroller.getBoundingClientRect = () => rect(0, 0, 1000, 500);
    cell.getBoundingClientRect = () => rect(300, 0, 288, 400);
    scroller.scrollLeft = 40;
    scrollCellIntoView(scroller, cell);
    expect(scroller.scrollLeft).toBe(40);
  });

  it('after a drop the focus is on the moved card, in its new column', async () => {
    const onMove = vi.fn().mockResolvedValue({});
    const { container } = render(<KanbanBoard cards={[card('1', 'todo'), card('2', 'todo')]} columns={COLUMNS} onCardMove={onMove} />);
    const el = cardEl('Card 1');
    el.focus();
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
      await Promise.resolve();
    });
    const moved = within(screen.getByTestId('column-drop-in_progress')).getByRole('button', { name: 'Card 1' });
    expect(moved).not.toBe(el);
    expect(document.activeElement).toBe(moved);
    expect(container.contains(document.activeElement)).toBe(true);
  });

  it('after a cancel the focus is still on the card', () => {
    render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} />);
    const el = cardEl('Card 1');
    el.focus();
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(document.activeElement).toBe(within(screen.getByTestId('column-drop-todo')).getByRole('button', { name: 'Card 1' }));
  });

  it('after a refused move the card is back in its column, and focused', async () => {
    const onMove = vi.fn().mockRejectedValue(new Error('A won deal cannot be moved.'));
    const { container } = render(<KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardMove={onMove} />);
    const el = cardEl('Card 1');
    el.focus();
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
      await Promise.resolve();
    });
    await waitFor(() => expect(container.querySelector('[data-part="board-move-refused"]')).not.toBeNull());
    const back = within(screen.getByTestId('column-drop-todo')).getByRole('button', { name: 'Card 1' });
    expect(document.activeElement).toBe(back);
  });

  it('a refusal does not take the focus from somebody who has gone on to something else', async () => {
    let refuse: (error: Error) => void = () => undefined;
    const onMove = vi.fn(() => new Promise((_resolve, reject) => (refuse = reject)));
    const { container } = render(
      <>
        <input aria-label="Elsewhere" />
        <KanbanBoard cards={[card('1', 'todo')]} columns={COLUMNS} onCardMove={onMove} />
      </>,
    );
    const el = cardEl('Card 1');
    el.focus();
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Enter' });
    const elsewhere = screen.getByLabelText('Elsewhere');
    elsewhere.focus();
    await act(async () => {
      refuse(new Error('No.'));
      await Promise.resolve();
    });
    await waitFor(() => expect(container.querySelector('[data-part="board-move-refused"]')).not.toBeNull());
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('kanban-swimlane-grid: a keyboard move is followed', () => {
  it('after a drop the focus is on the moved card, in its new cell', async () => {
    const onMove = vi.fn().mockResolvedValue({});
    render(<KanbanSwimlaneGrid cards={[card('1', 'todo', { lane: 'a' })]} columns={COLUMNS} lanes={LANES} onCardMove={onMove} />);
    const el = cardEl('Card 1');
    el.focus();
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
      await Promise.resolve();
    });
    const moved = within(screen.getByTestId('cell-drop-b-in_progress')).getByRole('button', { name: 'Card 1' });
    expect(document.activeElement).toBe(moved);
  });

  it('scrolls the cell the grabbed card is over into view inside the grid', () => {
    const { container } = render(<KanbanSwimlaneGrid cards={[card('1', 'todo', { lane: 'a' })]} columns={COLUMNS} lanes={LANES} />);
    const scroller = container.querySelector<HTMLElement>('[data-board-scroller]')!;
    const cells = [...container.querySelectorAll('[data-board-cell]')];
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === scroller) return rect(0, 0, 300, 400);
      const [lane, column] = [LANES.findIndex((l) => this.getAttribute('data-board-cell')?.startsWith(l.id) === true), cells.indexOf(this) % COLUMNS.length];
      return rect(column * 270 - scroller.scrollLeft, lane * 300 - scroller.scrollTop, 256, 280);
    });
    const el = cardEl('Card 1');
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    const over = cells.find((cell) => cell.getAttribute('data-board-cell') === encodeCell('b', 'in_progress'))!.getBoundingClientRect();
    expect(over.left).toBeGreaterThanOrEqual(0);
    expect(over.right).toBeLessThanOrEqual(300);
    expect(over.top).toBeGreaterThanOrEqual(0);
    expect(over.bottom).toBeLessThanOrEqual(400);
  });
});
