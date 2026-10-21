// SPDX-License-Identifier: AGPL-3.0-only
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { StepRow } from '../build/turns.js';
import { KeepSpotCard, NeedsCard, PictureLines, PictureNote, PicturesButton, PicturesChip, PersonMessage, SavedChip, SpotsCard, StepsBlock, StyleChip } from './chat.js';

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a person’s own message', () => {
  it('copies the whole message, says so for a moment, and is the button again after', async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: (text: string) => (written.push(text), Promise.resolve()) } });
    render(<PersonMessage text={'A fried-chicken shop.\nTwo lines.'} />);
    const button = screen.getByRole('button', { name: 'Copy this message' });
    expect(button.textContent).toBe('');
    fireEvent.click(button);
    expect(written).toEqual(['A fried-chicken shop.\nTwo lines.']);
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Copied' }).textContent).toBe('Copied');
    // Shown while it says so, whatever the pointer is doing.
    expect(button.className).toContain('opacity-100');
    act(() => vi.advanceTimersByTime(1799));
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeNull();
    act(() => vi.advanceTimersByTime(2));
    expect(screen.getByRole('button', { name: 'Copy this message' }).textContent).toBe('');
  });

  it('does not say it copied where the page may not write to the clipboard, or the write was refused', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const first = render(<PersonMessage text="Hello" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy this message' }));
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    first.unmount();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) } });
    render(<PersonMessage text="Hello" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy this message' }));
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it('is out of sight until the message is pointed at or reached, always there for the keyboard, and always shown where nothing can hover', () => {
    render(<PersonMessage text="Hello" />);
    const button = screen.getByRole('button', { name: 'Copy this message' });
    const shown = button.className.split(' ');
    expect(shown).toContain('opacity-0');
    expect(shown).toEqual(expect.arrayContaining(['group-hover/message:opacity-100', 'group-focus-within/message:opacity-100', 'focus-visible:opacity-100', '[@media(hover:none)]:opacity-100']));
    // A real button in the tab order, never `hidden` or inert.
    expect(button.tabIndex).toBe(0);
    expect(button.closest('[inert], [hidden], [aria-hidden="true"]')).toBeNull();
  });

  it('keeps its text plain text a person can select: one paragraph, nothing that forbids it', () => {
    render(<PersonMessage text="Customers order on the website." />);
    const text = screen.getByText('Customers order on the website.');
    expect(text.tagName).toBe('P');
    expect(text.className).toContain('select-text');
    expect(text.className).not.toContain('select-none');
    expect(text.closest('button')).toBeNull();
    // A page that may not write to the clipboard: the press does not throw.
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Copy this message' }))).not.toThrow();
  });
});

describe('what stands under a reply', () => {
  it('says a version in the person’s words where the server named it by itself', () => {
    render(<SavedChip name="v14 · Your edit to Menu.tsx" />);
    expect(screen.getByText('v14 · Your edit to Menu.tsx').className).toContain('font-mono');
  });

  it('draws "Style changed to" in the accent, apart from the grey chips', () => {
    render(<StyleChip title="Warm table" fontsLater={false} />);
    const chip = screen.getByText('Style changed to Warm table');
    expect(chip.className).toContain('bg-accent-soft');
    expect(chip.className).toContain('text-accent');
  });

  it('draws the look the Designer took as a line with a camera, and no tick', () => {
    const rows: StepRow[] = [
      { id: 's1', tool: 'check_app', label: 'Checked', state: 'done', ms: 4000, detail: null, folded: 1, count: 0 },
      { id: 'sight-9', tool: 'sight', label: 'Looked at the page', state: 'done', ms: null, detail: null, folded: 1, subject: '/menu/spicy-wings' },
    ];
    render(<StepsBlock rows={rows} stepCount={1} live={false} ms={5000} open onToggle={() => undefined} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Checked the app — no errors4.0 s', 'Looked at /menu/spicy-wings after it built']);
    expect(items[1]?.querySelector('svg')?.getAttribute('class')).toContain('lucide-camera');
    expect(items[0]?.querySelector('svg')?.getAttribute('class')).toContain('lucide-check');
    // The summary counts the Designer's own steps: the look is not one.
    expect(screen.getByRole('button').textContent).toContain('1 step');
  });
});

describe('the needs card’s pictures section', () => {
  const card = { id: 'n1', type: 'needs' as const, items: [{ id: 'font:Playfair Display', kind: 'font' as const, family: 'Playfair Display', use: 'headings' as const, version: '5.0.0' }], pictures: { preselect: 'placeholders' as const } };
  it('is its own choice: the radio never changes the Send label, and Select all never touches it', () => {
    const sent: unknown[] = [];
    render(<NeedsCard card={card as never} answered={false} busy={false} onSend={(ids, pictures) => sent.push([ids, pictures])} />);
    const group = screen.getByRole('radiogroup', { name: 'Pictures on the pages' });
    const [placeholders, choose] = screen.getAllByRole('radio') as HTMLInputElement[];
    expect([placeholders?.checked, choose?.checked]).toEqual([true, false]);
    expect(group).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(screen.getByRole('button', { name: 'Send — add nothing' })).toBeTruthy();
    fireEvent.click(choose as HTMLInputElement);
    // Ticks are counted, not the choice: nothing is added, whatever is chosen for the pictures.
    expect(screen.getByRole('button', { name: 'Send — add nothing' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect((screen.getAllByRole('radio')[1] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sent).toEqual([[['font:Playfair Display'], 'choose']]);
  });

  it('answered, says the choice on a third line', () => {
    render(<NeedsCard card={card as never} answered accepted={[]} answeredPictures="choose" busy={false} onSend={() => undefined} />);
    expect(screen.getByText('Pictures: you choose.')).toBeTruthy();
    cleanup();
    render(<NeedsCard card={card as never} answered accepted={['font:Playfair Display']} answeredPictures="placeholders" busy={false} onSend={() => undefined} />);
    expect(screen.getByText('Pictures: placeholders.')).toBeTruthy();
  });
});

describe('the spots card, the keep-it card and the lines', () => {
  const spots = { id: 'spots-2', type: 'spots' as const, spots: [{ id: 'hero', label: 'Hero', shape: 'wide' as const }, { id: 'team', label: 'Team', shape: 'wide' as const }, { id: 'kitchen', label: 'Kitchen', shape: 'square' as const }], rows: { table: 'Dishes', count: 8 } };
  it('asks for the spots and the table’s rows, opens the dialog, and once pictures are chosen says which are still placeholders', () => {
    const opened: number[] = [];
    render(<SpotsCard card={spots} chosen={[]} onChoose={() => opened.push(1)} />);
    expect(screen.getByRole('group', { name: 'Choose the pictures' }).textContent).toContain('3 spots on the page and 8 dishes are waiting for pictures.');
    expect(screen.getByRole('list', { name: 'Spots on the page' }).querySelectorAll('li')).toHaveLength(3);
    const button = screen.getByRole('button', { name: 'Choose pictures…' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(button);
    expect(opened).toEqual([1]);
    cleanup();
    render(<SpotsCard card={spots} chosen={['Hero', 'Team']} onChoose={() => opened.push(2)} />);
    expect(screen.getByRole('group', { name: 'Choose the pictures' }).textContent).toContain('Pictures chosen: Hero and Team. Kitchen is still a placeholder.');
    // A spot and the rows still wait: the way to the dialog stays on the card.
    fireEvent.click(screen.getByRole('button', { name: 'Choose pictures…' }));
    expect(opened).toEqual([1, 2]);
    cleanup();
    render(<SpotsCard card={{ ...spots, spots: [{ id: 'hero', label: 'Hero', shape: 'wide' }] }} chosen={['Hero']} onChoose={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Choose pictures…' })).toBeTruthy();
    cleanup();
    const { rows: _rows, ...noRows } = spots;
    render(<SpotsCard card={{ ...noRows, spots: [{ id: 'hero', label: 'Hero', shape: 'wide' }] }} chosen={['Hero']} onChoose={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the top bar’s picture button with what is left to fill, and keeps it at none', () => {
    const opened: number[] = [];
    render(<PicturesButton toFill={6} onOpen={() => opened.push(1)} />);
    const button = screen.getByRole('button', { name: 'Pictures: 6 to fill' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(button);
    expect(opened).toEqual([1]);
    cleanup();
    render(<PicturesButton toFill={0} onOpen={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Pictures' }).textContent).toBe('Pictures');
  });

  it('keeps a picture on its screen or lets it go, and says which', () => {
    const card = { id: 'k1', type: 'keep-spot' as const, spot: 'hero', label: 'Hero', screen: 'Home' };
    const said: string[] = [];
    render(<KeepSpotCard card={card} answered={false} busy={false} onKeep={() => said.push('keep')} onLetGo={() => said.push('go')} />);
    expect(screen.getByRole('group').textContent).toContain('The Designer took your picture Hero off Home. Keep it there?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep it on Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Let it go' }));
    expect(said).toEqual(['keep', 'go']);
    cleanup();
    render(<KeepSpotCard card={card} answered kept busy={false} onKeep={() => undefined} onLetGo={() => undefined} />);
    expect(screen.getByText('Kept Hero on Home.')).toBeTruthy();
    cleanup();
    render(<KeepSpotCard card={card} answered kept={false} busy={false} onKeep={() => undefined} onLetGo={() => undefined} />);
    expect(screen.getByText('Hero is off Home.')).toBeTruthy();
  });

  it('counts what is left to fill on the chip, and says an Apply, its Undo and the placeholders note', () => {
    render(<PicturesChip toFill={3} onOpen={() => undefined} />);
    expect(screen.getByRole('button').textContent).toBe('Pictures· 3 to fill');
    cleanup();
    render(<PicturesChip toFill={0} onOpen={() => undefined} />);
    expect(screen.getByRole('button').textContent).toBe('Pictures');
    cleanup();
    render(<PictureLines lines={[{ kind: 'applied', names: ['Hero', 'Team'], version: { n: 14, name: 'v14 · Pictures: Hero, Team' } }, { kind: 'undone', to: 13 }, { kind: 'note', note: 'still-empty', count: 3 }]} />);
    expect([...document.querySelectorAll('[data-part="pictures-line"]')].map((line) => line.textContent)).toEqual(['You changed 2 pictures: Hero and Team. Saved as v14.', 'Undone: back to v13.']);
    cleanup();
    render(<PictureNote lines={[{ kind: 'note', note: 'still-empty', count: 3 }]} />);
    expect(screen.getByText(/pictures are still placeholders/).textContent).toBe('3 pictures are still placeholders. Visitors see empty frames until you fill them.');
    cleanup();
    render(<PictureNote lines={[{ kind: 'note', note: 'placeholders', count: 3 }]} />);
    expect(screen.getByText(/placeholders/).textContent).toBe('The pictures are placeholders. Choose pictures from Pictures under this message.');
  });
});
