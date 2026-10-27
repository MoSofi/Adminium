// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The board, as an app's own screen mounts it: plain data in, a handle out.
 *
 * Worth proving: the cards stand in their columns under the kit's wrapper; a
 * move by keyboard reaches the app as (card, to, from), is said aloud, and
 * stays when the save holds, whether or not the app hands new cards back; a
 * save the app answers `{ refused }` (or rejects) puts the card back with the
 * reason on the board; a card that may not be moved is not picked up and
 * still opens; an add that is refused keeps the typed title; `update` leaves
 * the focus and a card in the hand where they were; right to left turns the
 * arrows; and the board asks for no word outside its set, in any language.
 *
 * A pointer drag needs a real layout, so it is a browser's to prove
 * (apps/e2e/tests/kit-parts.spec.ts). The keyboard goes through the same
 * move, save and put-back.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardCard, BoardColumn, BoardProps, KitMounted, KitRefused } from './contract.js';
import { mount } from './index.js';
import { clearOutsideWords, outsideWords } from './words.js';

const COLUMNS: BoardColumn[] = [
  { id: 'new', label: 'New', tone: 'info' },
  { id: 'won', label: 'Won', tone: 'pos', count: 12, total: '€9,400' },
  { id: 'lost', label: 'Lost', limit: 1 },
];
const CARDS: BoardCard[] = [
  { id: '1', columnId: 'new', title: 'Harbour Cafe', subtitle: 'Harbour Ltd', amount: '€1,200', meta: ['3 days in stage'], lines: [{ label: 'Close', value: '12 Mar' }], owner: 'Dana Reyes', due: 'Fri', tag: 'Hot', tagTone: 'danger', progress: 40, reference: 'D-1' },
  { id: '2', columnId: 'new', title: 'Second Wind' },
  { id: '3', columnId: 'won', title: 'Third Coast' },
  { id: '4', columnId: 'lost', title: 'Fourth Wall' },
  { id: '5', columnId: 'lost', title: 'Fifth Season' },
];

let host: HTMLElement;
let mounted: KitMounted<BoardProps> | null = null;

beforeEach(() => {
  clearOutsideWords();
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  host.remove();
  // The gate: nothing drawn in this file asked for a word the board does not carry.
  expect(outsideWords()).toEqual([]);
});

async function board(props: Partial<BoardProps> = {}): Promise<void> {
  await act(async () => {
    mounted = await mount('board', host, { columns: COLUMNS, cards: CARDS, locale: 'en-US', dir: 'ltr', ...props });
  });
}

const card = (title: string): HTMLElement => screen.getByRole('button', { name: title });
const column = (id: string): HTMLElement => host.querySelector<HTMLElement>(`[data-board-column="${id}"]`)!;
const titlesIn = (id: string): string[] => [...column(id).querySelectorAll('[data-board-card]')].map((el) => el.getAttribute('aria-label') ?? '');
const said = (): string => host.querySelector('[data-board-liveregion]')?.textContent?.replace('​', '') ?? '';

/** Picks a card up, steps it sideways and drops it; back once the save's answer has been heard. */
async function moveByKeys(title: string, steps: ('ArrowRight' | 'ArrowLeft')[]): Promise<void> {
  const el = card(title);
  act(() => el.focus());
  fireEvent.keyDown(el, { key: ' ' });
  for (const key of steps) fireEvent.keyDown(card(title), { key });
  await act(async () => {
    fireEvent.keyDown(card(title), { key: 'Enter' });
  });
}

describe('the board, mounted', () => {
  it('stands under the kit’s wrapper with each card in its column and all a card can show', async () => {
    await board({ ariaLabel: 'Pipeline' });
    const wrapper = host.querySelector('.adm-kit');
    expect(wrapper?.getAttribute('data-kit-part')).toBe('board');
    expect(wrapper?.getAttribute('dir')).toBe('ltr');
    expect(screen.getByRole('group', { name: 'Pipeline' })).toBeTruthy();
    expect(titlesIn('new')).toEqual(['Harbour Cafe', 'Second Wind']);
    expect(titlesIn('won')).toEqual(['Third Coast']);
    expect(titlesIn('lost')).toEqual(['Fourth Wall', 'Fifth Season']);
    const first = card('Harbour Cafe');
    for (const text of ['Hot', 'Harbour Ltd', '€1,200', '3 days in stage', 'Close', '12 Mar', 'Fri', 'D-1', 'DR', '40%']) expect(first.textContent, text).toContain(text);
    // A card with no reference prints nothing at its foot: the row's key is the app's business.
    expect(card('Second Wind').textContent).toBe('Second Wind');
    // The app's count and total head the column; a limit reads "held/limit".
    expect(within(column('won')).getByText('12')).toBeTruthy();
    expect(column('won').querySelector('[data-part="column-total"]')?.textContent).toBe('€9,400');
    expect(column('lost').querySelector('[data-part="column-count"]')?.textContent).toBe('2/1');
    // No way to add was given, so none is drawn.
    expect(host.querySelector('[data-part="compose-open"]')).toBeNull();
  });

  it('a card whose column is not among the columns is not drawn', async () => {
    await board({ cards: [...CARDS, { id: '9', columnId: 'archived', title: 'Nowhere' }] });
    expect(screen.queryByRole('button', { name: 'Nowhere' })).toBeNull();
  });

  it('hands a keyboard move to the app as (card, to, from), says it aloud, and keeps the card there', async () => {
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(async () => undefined);
    await board({ onMove });
    const el = card('Second Wind');
    act(() => el.focus());
    fireEvent.keyDown(el, { key: ' ' });
    expect(said()).toContain('Grabbed Second Wind');
    expect(el.getAttribute('aria-grabbed')).toBe('true');
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(said()).toBe('Second Wind is over Won.');
    // The whole column is the drop target (the comp's dashed column), and it shows it.
    expect(column('won').hasAttribute('data-drop-target')).toBe(true);
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });
    expect(onMove).toHaveBeenCalledExactlyOnceWith('2', 'won', 'new');
    expect(said()).toBe('Moved Second Wind to Won.');
    // Within a column the cards stand in the order the app gave them.
    expect(titlesIn('won')).toEqual(['Second Wind', 'Third Coast']);
    // The focus followed the card to where it was dropped.
    await waitFor(() => expect(document.activeElement).toBe(card('Second Wind')));
    // The app hands nothing back, and the card is still there after the board has let go of the move.
    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(titlesIn('won')).toEqual(['Second Wind', 'Third Coast']);
    expect(titlesIn('new')).toEqual(['Harbour Cafe']);
  });

  it('Escape puts a card in the hand back where it was, and nothing is saved', async () => {
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>();
    await board({ onMove });
    const el = card('Harbour Cafe');
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(onMove).not.toHaveBeenCalled();
    expect(said()).toBe('Harbour Cafe returned to its original position.');
    expect(titlesIn('new')).toEqual(['Harbour Cafe', 'Second Wind']);
  });

  it.each([
    ['answers { refused }', async (): Promise<KitRefused> => ({ refused: 'A lost deal cannot be reopened.' })],
    ['rejects', async (): Promise<void> => Promise.reject(new Error('A lost deal cannot be reopened.'))],
    ['throws', (): void => { throw new Error('A lost deal cannot be reopened.'); }],
  ])('a save that %s puts the card back and says why on the board and aloud', async (_how, save) => {
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(save);
    await board({ onMove });
    await moveByKeys('Fourth Wall', ['ArrowLeft']);
    expect(onMove).toHaveBeenCalledExactlyOnceWith('4', 'won', 'lost');
    await waitFor(() => expect(titlesIn('lost')).toEqual(['Fourth Wall', 'Fifth Season']));
    expect(titlesIn('won')).toEqual(['Third Coast']);
    const notice = host.querySelector('[data-part="board-move-refused"]')!;
    expect(notice.textContent).toContain('Fourth Wall was not moved.');
    expect(notice.querySelector('[data-part="board-move-refused-reason"]')?.textContent?.trim()).toBe('A lost deal cannot be reopened.');
    expect(said()).toBe('Could not move Fourth Wall; it was returned to its original position. A lost deal cannot be reopened.');
    // The focus went back with the card.
    await waitFor(() => expect(document.activeElement).toBe(card('Fourth Wall')));
    // The line is put away by its button.
    await userEvent.click(within(notice as HTMLElement).getByRole('button', { name: 'Dismiss' }));
    expect(host.querySelector('[data-part="board-move-refused"]')).toBeNull();
  });

  it('a save that answers nothing is taken at its word', async () => {
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(() => undefined);
    await board({ onMove });
    await moveByKeys('Third Coast', ['ArrowRight']);
    expect(titlesIn('lost')).toEqual(['Third Coast', 'Fourth Wall', 'Fifth Season']);
    expect(host.querySelector('[data-part="board-move-refused"]')).toBeNull();
  });

  it('new cards from the app after a move are what the board then shows', async () => {
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(async () => undefined);
    await board({ onMove });
    await moveByKeys('Second Wind', ['ArrowRight']);
    // The server kept another column than the one it was dropped in (a rule of its own).
    act(() => mounted!.update({ cards: CARDS.map((one) => (one.id === '2' ? { ...one, columnId: 'lost' } : one)) }));
    expect(titlesIn('lost')).toEqual(['Second Wind', 'Fourth Wall', 'Fifth Season']);
    expect(titlesIn('won')).toEqual(['Third Coast']);
  });

  it('with no onMove no card is picked up; with onOpen a card still opens, by a click and by Enter', async () => {
    const onOpen = vi.fn<(cardId: string) => void>();
    await board({ onOpen });
    const el = card('Harbour Cafe');
    expect(el.tabIndex).toBe(0);
    expect(el.hasAttribute('aria-roledescription')).toBe(false);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(el.hasAttribute('aria-grabbed')).toBe(false);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('1');
    fireEvent.click(card('Third Coast'));
    expect(onOpen).toHaveBeenLastCalledWith('3');
    // With neither, a card is not a stop for Tab at all.
    act(() => mounted!.update({ onOpen: undefined }));
    expect(card('Harbour Cafe').tabIndex).toBe(-1);
  });

  it('canMove says which cards may be moved, and a busy board moves none', async () => {
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(async () => undefined);
    await board({ onMove, canMove: (cardId) => cardId !== '4' });
    fireEvent.keyDown(card('Fourth Wall'), { key: ' ' });
    expect(card('Fourth Wall').hasAttribute('aria-grabbed')).toBe(false);
    fireEvent.keyDown(card('Fifth Season'), { key: ' ' });
    expect(card('Fifth Season').getAttribute('aria-grabbed')).toBe('true');
    fireEvent.keyDown(card('Fifth Season'), { key: 'Escape' });

    act(() => mounted!.update({ canMove: false }));
    fireEvent.keyDown(card('Fifth Season'), { key: ' ' });
    expect(card('Fifth Season').hasAttribute('aria-grabbed')).toBe(false);

    act(() => mounted!.update({ canMove: true, busy: true }));
    expect(host.querySelector('.adm-kit-board')?.getAttribute('aria-busy')).toBe('true');
    fireEvent.keyDown(card('Fifth Season'), { key: ' ' });
    expect(card('Fifth Season').hasAttribute('aria-grabbed')).toBe(false);
    act(() => mounted!.update({ busy: false }));
    expect(host.querySelector('.adm-kit-board')?.hasAttribute('aria-busy')).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('an update keeps the focus and the card in the hand, and the move goes on', async () => {
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(async () => undefined);
    await board({ onMove });
    const el = card('Harbour Cafe');
    act(() => el.focus());
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    // A colleague's change arrives while the card is held: new arrays, a new card, new counts.
    act(() => mounted!.update({ cards: [...CARDS, { id: '6', columnId: 'won', title: 'Sixth Sense' }], columns: COLUMNS.map((one) => (one.id === 'won' ? { ...one, count: 13 } : one)) }));
    expect(card('Harbour Cafe')).toBe(el);
    expect(document.activeElement).toBe(el);
    expect(el.getAttribute('aria-grabbed')).toBe('true');
    expect(titlesIn('won')).toEqual(['Third Coast', 'Sixth Sense']);
    expect(within(column('won')).getByText('13')).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });
    expect(onMove).toHaveBeenCalledExactlyOnceWith('1', 'won', 'new');
    expect(titlesIn('won')).toEqual(['Harbour Cafe', 'Third Coast', 'Sixth Sense']);
  });

  it('right to left, the left arrow goes on to the next column', async () => {
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(async () => undefined);
    await board({ onMove, locale: 'ar-EG', dir: 'rtl' });
    expect(host.querySelector('.adm-kit')?.getAttribute('dir')).toBe('rtl');
    expect(host.querySelector('[data-widget="kanban-board"]')?.getAttribute('dir')).toBe('rtl');
    await moveByKeys('Second Wind', ['ArrowLeft']);
    expect(onMove).toHaveBeenCalledExactlyOnceWith('2', 'won', 'new');
    // Said in Arabic, from the kit's own words.
    expect(said()).not.toContain('Moved');
    expect(said()).toContain('Second Wind');
  });

  it('adds a card typed at a column’s foot, and keeps the typed title when the add is refused', async () => {
    const answers: (void | KitRefused)[] = [{ refused: 'You may not add deals here.' }, undefined];
    const onAdd = vi.fn<NonNullable<BoardProps['onAdd']>>(async () => answers.shift());
    await board({ onAdd });
    const user = userEvent.setup();
    await user.click(within(column('won')).getByRole('button', { name: 'Add card' }));
    const box = within(column('won')).getByRole<HTMLInputElement>('textbox', { name: 'Card title…' });
    await user.type(box, 'Seventh Heaven{Enter}');
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('won', 'Seventh Heaven');
    const notice = await waitFor(() => {
      const found = host.querySelector('[data-part="board-add-refused"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(notice.textContent).toContain('Seventh Heaven was not added.');
    expect(notice.textContent).toContain('You may not add deals here.');
    expect(said()).toBe('Seventh Heaven was not added. You may not add deals here.');
    // The title is still in the box, to be sent again.
    expect(box.value).toBe('Seventh Heaven');
    await user.click(within(column('won')).getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(box.value).toBe(''));
    expect(host.querySelector('[data-part="board-add-refused"]')).toBeNull();
  });

  it('says the app’s own line while there is no card, and in place of the board while there is no column', async () => {
    await board({ cards: [], emptyLabel: 'No deals yet.' });
    expect(host.querySelector('[data-part="board-empty"]')?.textContent).toBe('No deals yet.');
    expect(column('new')).not.toBeNull();
    act(() => mounted!.update({ cards: CARDS }));
    expect(host.querySelector('[data-part="board-empty"]')).toBeNull();
    act(() => mounted!.update({ columns: [] }));
    expect(screen.getByRole('heading', { name: 'No deals yet.' })).toBeTruthy();
    expect(host.querySelector('[data-board-column]')).toBeNull();
  });

  it.each(['en-US', 'ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'fr-FR', 'zh-CN', 'zh-TW'])('speaks %s for every word it shows, a refusal and an empty board included', async (locale) => {
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(async () => ({ refused: 'No.' }));
    const onAdd = vi.fn<NonNullable<BoardProps['onAdd']>>(async () => ({ refused: 'No.' }));
    await board({ locale, dir: locale === 'ar-EG' ? 'rtl' : 'ltr', onMove, onAdd, onOpen: () => undefined });
    expect(host.querySelector('.adm-kit')?.getAttribute('lang')).toBe(locale);
    await moveByKeys('Third Coast', [locale === 'ar-EG' ? 'ArrowLeft' : 'ArrowRight']);
    await waitFor(() => expect(host.querySelector('[data-part="board-move-refused"]')).not.toBeNull());
    const user = userEvent.setup();
    await user.click(column('new').querySelector<HTMLElement>('[data-part="compose-open"]')!);
    await user.type(within(column('new')).getByRole('textbox'), 'Eighth Day{Enter}');
    await waitFor(() => expect(host.querySelector('[data-part="board-add-refused"]')).not.toBeNull());
    act(() => mounted!.update({ columns: [] }));
    // afterEach holds the gate: no word outside the board's set was asked for.
  });

  it('a card’s own actions open from a button after the card, and the app hears the card and the action', async () => {
    const onAction = vi.fn<(cardId: string, actionId: string) => void>();
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(async () => undefined);
    const actions = [{ id: 'close', label: 'Close: won or lost…' }, { id: 'hand', label: 'Hand it over…', disabled: true }, { id: 'drop', label: 'Delete', tone: 'danger' as const }];
    await board({ onAction, onMove, cards: CARDS.map((one) => (one.id === '1' ? { ...one, actions } : one)) });
    const button = screen.getByRole('button', { name: 'Actions for Harbour Cafe' });
    expect(card('Harbour Cafe').contains(button)).toBe(false);
    expect(host.querySelectorAll('[data-part="board-card-actions"]')).toHaveLength(1);
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Close: won or lost…', 'Hand it over…', 'Delete']);
    expect(document.activeElement).toBe(items[0]);
    // The menu is in the kit's own wrapper, where the kit's styles reach it.
    expect(screen.getByRole('menu').closest('.adm-kit')).not.toBeNull();
    fireEvent.click(items[1]!);
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.keyDown(items[0]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.click(screen.getAllByRole('menuitem')[2]!);
    expect(onAction).toHaveBeenCalledExactlyOnceWith('1', 'drop');
    expect(document.activeElement).toBe(button);
    // Nothing of it was a move, and the card is still moved by keyboard.
    expect(onMove).not.toHaveBeenCalled();
    await moveByKeys('Harbour Cafe', ['ArrowRight']);
    expect(onMove).toHaveBeenCalledExactlyOnceWith('1', 'won', 'new');
    // The app's own function may change with an update; the newest is the one called.
    const later = vi.fn<(cardId: string, actionId: string) => void>();
    act(() => mounted!.update({ onAction: later }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Harbour Cafe' }));
    fireEvent.click(screen.getAllByRole('menuitem')[0]!);
    expect(later).toHaveBeenCalledExactlyOnceWith('1', 'close');
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('with no onAction no card has a menu, whatever actions it carries', async () => {
    await board({ cards: CARDS.map((one) => ({ ...one, actions: [{ id: 'a', label: 'A' }] })) });
    expect(host.querySelector('[data-part="board-card-actions"]')).toBeNull();
    expect(host.querySelector('[data-part="board-card-shell"]')).toBeNull();
  });

  it('with onOpen, Shift+Enter opens a card that Enter picks up, and each such card says so', async () => {
    const onOpen = vi.fn<(cardId: string) => void>();
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(async () => undefined);
    await board({ onOpen, onMove, canMove: (id) => id !== '3' });
    const el = card('Harbour Cafe');
    const hint = host.querySelector('[data-part="board-open-hint"]')!;
    expect(hint.textContent).toBe('Enter picks this card up to move it. Shift+Enter opens it.');
    expect(el.getAttribute('aria-describedby')).toBe(hint.id);
    expect(card('Third Coast').hasAttribute('aria-describedby')).toBe(false);
    fireEvent.keyDown(el, { key: 'Enter', shiftKey: true });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('1');
    expect(el.hasAttribute('aria-grabbed')).toBe(false);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(el.getAttribute('aria-grabbed')).toBe('true');
    fireEvent.keyDown(el, { key: 'Escape' });
    // A board whose cards open by a click only (no onOpen) has no such line.
    act(() => mounted!.update({ onOpen: undefined }));
    expect(host.querySelector('[data-part="board-open-hint"]')).toBeNull();
  });

  it('writes a column’s badge after its heading', async () => {
    await board({ columns: COLUMNS.map((one) => (one.id === 'new' ? { ...one, badge: '10%' } : one)) });
    expect([...host.querySelectorAll('[data-part="column-badge"]')].map((el) => el.textContent)).toEqual(['10%']);
    expect(column('new').querySelector('[data-part="column-badge"]')?.previousElementSibling?.textContent).toBe('New');
  });

  it('in Arabic the card is called a draggable card in Arabic, and its button and hint speak Arabic too', async () => {
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(async () => undefined);
    await board({ locale: 'ar-EG', dir: 'rtl', onMove, onOpen: () => undefined, onAction: () => undefined, cards: CARDS.map((one) => (one.id === '1' ? { ...one, actions: [{ id: 'a', label: 'إغلاق' }] } : one)) });
    const el = card('Harbour Cafe');
    expect(el.getAttribute('aria-roledescription')).toBe('بطاقة قابلة للسحب');
    expect(screen.getByRole('button', { name: 'إجراءات Harbour Cafe' })).toBeTruthy();
    expect(host.querySelector('[data-part="board-open-hint"]')?.textContent).toBe('اضغط Enter لالتقاط هذه البطاقة وتحريكها، وShift+Enter لفتحها.');
    expect(host.querySelector('[data-part="board-card-grip"]')?.getAttribute('title')).toBe('اسحب لتحريك البطاقة');
    fireEvent.keyDown(el, { key: ' ' });
    expect(said()).toBe('تم التقاط Harbour Cafe. استخدم مفاتيح الأسهم للتحريك، وEnter للإفلات، وEscape للإلغاء.');
    fireEvent.keyDown(el, { key: 'Escape' });
  });

  it('is gone after unmount, and an answer that arrives later moves nothing', async () => {
    let answer: (value: void) => void = () => undefined;
    const onMove = vi.fn<NonNullable<BoardProps['onMove']>>(() => new Promise<void>((resolve) => (answer = resolve)));
    await board({ onMove });
    await moveByKeys('Second Wind', ['ArrowRight']);
    const handle = mounted!;
    act(() => handle.unmount());
    expect(host.childElementCount).toBe(0);
    await act(async () => {
      answer();
      await Promise.resolve();
    });
    expect(() => handle.update({ cards: [] })).not.toThrow();
    expect(host.childElementCount).toBe(0);
  });
});
