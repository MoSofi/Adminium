// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChoiceChips } from './ChoiceChips.js';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('ChoiceChips (single)', () => {
  it('renders a radiogroup with one checked radio', () => {
    render(<ChoiceChips options={OPTIONS} defaultValue="b" />);
    expect(screen.getByRole('radiogroup')).toBeDefined();
    const beta = screen.getByRole('radio', { name: 'Beta' });
    expect(beta.getAttribute('aria-checked')).toBe('true');
    expect(beta.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByRole('radio', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('false');
  });

  it('selects on click and fires onValueChange', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChoiceChips options={OPTIONS} defaultValue="a" onValueChange={onValueChange} />);
    await user.click(screen.getByRole('radio', { name: 'Gamma' }));
    expect(onValueChange).toHaveBeenLastCalledWith('c');
    expect(screen.getByRole('radio', { name: 'Gamma' }).getAttribute('aria-checked')).toBe('true');
  });

  it('roves with arrow keys: selection follows focus', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChoiceChips options={OPTIONS} defaultValue="a" onValueChange={onValueChange} />);
    screen.getByRole('radio', { name: 'Alpha' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith('b');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Beta' }));
    await user.keyboard('{ArrowLeft}');
    expect(onValueChange).toHaveBeenLastCalledWith('a');
  });

  it('wraps around and skips disabled options', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <ChoiceChips
        options={[...OPTIONS, { value: 'd', label: 'Delta', disabled: true }]}
        defaultValue="c"
        onValueChange={onValueChange}
      />,
    );
    screen.getByRole('radio', { name: 'Gamma' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith('a');
  });

  it('keeps a single tab stop (selected chip)', () => {
    render(<ChoiceChips options={OPTIONS} defaultValue="b" />);
    expect(screen.getByRole('radio', { name: 'Beta' }).tabIndex).toBe(0);
    expect(screen.getByRole('radio', { name: 'Alpha' }).tabIndex).toBe(-1);
    expect(screen.getByRole('radio', { name: 'Gamma' }).tabIndex).toBe(-1);
  });
});

describe('ChoiceChips (multiple)', () => {
  it('renders aria-pressed toggle chips in a group', () => {
    render(<ChoiceChips multiple options={OPTIONS} defaultValue={['a', 'c']} />);
    expect(screen.getByRole('group')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Alpha' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Beta' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles values on and off', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChoiceChips multiple options={OPTIONS} defaultValue={['a']} onValueChange={onValueChange} />);
    await user.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['a', 'b']);
    await user.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['b']);
  });

  it('supports controlled value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChoiceChips multiple options={OPTIONS} value={['c']} onValueChange={onValueChange} />);
    await user.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['c', 'a']);
    expect(screen.getByRole('button', { name: 'Alpha' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('disables all chips when the group is disabled', () => {
    render(<ChoiceChips multiple options={OPTIONS} disabled />);
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
