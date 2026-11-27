// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Radio, RadioGroup } from './Radio.js';

function renderGroup(props: { onValueChange?: (value: string) => void } = {}) {
  return render(
    <RadioGroup defaultValue="weekly" aria-label="Frequency" {...props}>
      <Radio value="daily" label="Daily" />
      <Radio value="weekly" label="Weekly" />
      <Radio value="monthly" label="Monthly" description="First of the month" />
    </RadioGroup>,
  );
}

describe('Radio', () => {
  it('renders a radiogroup with the default value checked', () => {
    renderGroup();
    expect(screen.getByRole('radiogroup', { name: 'Frequency' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Weekly' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Daily' }).getAttribute('aria-checked')).toBe('false');
  });

  it('selects on click and reports the value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderGroup({ onValueChange });
    await user.click(screen.getByRole('radio', { name: 'Daily' }));
    expect(onValueChange).toHaveBeenCalledWith('daily');
    expect(screen.getByRole('radio', { name: 'Daily' }).getAttribute('aria-checked')).toBe('true');
  });

  it('clicking the label text selects its radio', async () => {
    const user = userEvent.setup();
    renderGroup();
    await user.click(screen.getByText('Monthly'));
    expect(screen.getByRole('radio', { name: 'Monthly' }).getAttribute('aria-checked')).toBe('true');
  });

  it('moves selection with arrow keys (single tab stop)', async () => {
    // Radix defers roving focus into a setTimeout and resets its select-on-arrow
    // flag on keyup, so arrows must be HELD across the deferred focus (a released
    // '{ArrowDown}' fires keydown+keyup back-to-back and never selects). Real
    // keyboards always have that gap; press-and-hold mirrors them faithfully.
    const user = userEvent.setup();
    renderGroup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Weekly' }));
    await user.keyboard('{ArrowDown>}');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Monthly' }).getAttribute('aria-checked')).toBe('true'),
    );
    await user.keyboard('{/ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Monthly' }));
    await user.keyboard('{ArrowUp>}');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Weekly' }).getAttribute('aria-checked')).toBe('true'),
    );
    await user.keyboard('{/ArrowUp}{ArrowUp>}');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Daily' }).getAttribute('aria-checked')).toBe('true'),
    );
    await user.keyboard('{/ArrowUp}');
  });

  it('selects on an arrow pressed and released with nothing between, as a switch device or automation sends it', async () => {
    // Radix alone moved focus and chose nothing: the key was up before its deferred focus landed (seen 2026-11-26 on
    // the template plan's choices: "arrows move focus but do not choose").
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderGroup({ onValueChange });
    await user.tab();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Monthly' }).getAttribute('aria-checked')).toBe('true'));
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Monthly' }));
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Weekly' }).getAttribute('aria-checked')).toBe('true'));
    // Once each: never a second call for the same move.
    expect(onValueChange.mock.calls).toEqual([['monthly'], ['weekly']]);
  });

  it('reports a move once when the key is held, as a keyboard sends it', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderGroup({ onValueChange });
    await user.tab();
    await user.keyboard('{ArrowDown>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Monthly' }).getAttribute('aria-checked')).toBe('true'));
    await user.keyboard('{/ArrowDown}');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onValueChange.mock.calls).toEqual([['monthly']]);
  });

  it('never leaves the focus on one item and the choice on another, when two arrows land before the focus has moved', async () => {
    // A tab in the background runs its timers late: two presses then arrive before Radix has moved the focus once.
    renderGroup();
    const weekly = screen.getByRole('radio', { name: 'Weekly' });
    act(() => weekly.focus());
    act(() => {
      fireEvent.keyDown(weekly, { key: 'ArrowDown' });
      fireEvent.keyUp(weekly, { key: 'ArrowDown' });
      fireEvent.keyDown(weekly, { key: 'ArrowUp' });
      fireEvent.keyUp(weekly, { key: 'ArrowUp' });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('role')).toBe('radio');
    expect(focused).not.toBe(weekly);
    expect(focused.getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('radio').filter((radio) => radio.getAttribute('aria-checked') === 'true')).toEqual([focused]);
  });

  it('chooses nothing for an arrow typed in a field inside the group, or for focus that comes by Tab', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RadioGroup defaultValue="a" aria-label="With a note" onValueChange={onValueChange}>
        <Radio value="a" label="A" />
        <Radio value="b" label="B" />
        <input aria-label="Note" />
      </RadioGroup>,
    );
    screen.getByRole('textbox', { name: 'Note' }).focus();
    await user.keyboard('{ArrowUp}{ArrowDown}');
    screen.getByRole('radio', { name: 'B' }).focus();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'A' }).getAttribute('aria-checked')).toBe('true');
  });

  it('renders the description as muted secondary text', () => {
    renderGroup();
    expect(screen.getByText('First of the month')).toBeDefined();
  });
});