// SPDX-License-Identifier: AGPL-3.0-only
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { StepRow } from '../build/turns.js';
import { PersonMessage, SavedChip, StepsBlock, StyleChip } from './chat.js';

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
  it('copies the whole message, says so for a moment, and is the button again after', () => {
    vi.useFakeTimers();
    const written: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: (text: string) => (written.push(text), Promise.resolve()) } });
    render(<PersonMessage text={'A fried-chicken shop.\nTwo lines.'} />);
    const button = screen.getByRole('button', { name: 'Copy this message' });
    expect(button.textContent).toBe('');
    fireEvent.click(button);
    expect(written).toEqual(['A fried-chicken shop.\nTwo lines.']);
    expect(screen.getByRole('button', { name: 'Copied' }).textContent).toBe('Copied');
    // Shown while it says so, whatever the pointer is doing.
    expect(button.className).toContain('opacity-100');
    act(() => vi.advanceTimersByTime(1799));
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeNull();
    act(() => vi.advanceTimersByTime(2));
    expect(screen.getByRole('button', { name: 'Copy this message' }).textContent).toBe('');
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
