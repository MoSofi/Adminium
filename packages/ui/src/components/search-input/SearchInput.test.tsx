// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SearchInput } from './SearchInput.js';

describe('SearchInput', () => {
  it('renders a searchbox inside the pill chrome', () => {
    const { container } = render(<SearchInput placeholder="Search" />);
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.className).toContain('rounded-full');
    expect(pill.className).toContain('bg-surface-2');
    expect(screen.getByRole('searchbox')).toBeDefined();
  });

  it('renders the optional kbd chip', () => {
    render(<SearchInput kbd="⌘K" />);
    expect(screen.getByText('⌘K').tagName).toBe('KBD');
  });

  it('shows the clear button only while there is a value', async () => {
    const user = userEvent.setup();
    render(<SearchInput onClear={() => {}} clearLabel="Clear" />);
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    await user.type(screen.getByRole('searchbox'), 'abc');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDefined();
  });

  it('clears the value, fires onClear and refocuses the input', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<SearchInput defaultValue="abc" onClear={onClear} clearLabel="Clear" />);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('supports controlled value + onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchInput value="fixed" onChange={onChange} onClear={() => {}} clearLabel="Clear" />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDefined();
    await user.type(screen.getByRole('searchbox'), 'x');
    expect(onChange).toHaveBeenCalled();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('fixed');
  });

  it('exposes the input via ref', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<SearchInput ref={ref} />);
    expect(ref.current?.type).toBe('search');
  });

  it('Enter submits what is typed; the field keeps the focus and its text is selected', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SearchInput onSubmit={onSubmit} aria-label="Code" />);
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    await user.type(input, 'GC-7K2M{Enter}');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('GC-7K2M');
    expect(document.activeElement).toBe(input);
    // Selected, so the next scan replaces it.
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 7]);
    await user.keyboard('VC-9QXA{Enter}');
    expect(onSubmit).toHaveBeenLastCalledWith('VC-9QXA');
    expect(input.value).toBe('VC-9QXA');
  });

  it('without onSubmit, Enter is the form\'s as it always was', async () => {
    const user = userEvent.setup();
    const submitted = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(
      <form onSubmit={submitted}>
        <SearchInput aria-label="Search" />
      </form>,
    );
    await user.type(screen.getByRole('searchbox'), 'abc{Enter}');
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it('options are a listbox: the arrows move through them, Enter submits the one they are on', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const options = [
      { value: 'flour', label: 'Flour' },
      { value: 'sugar', label: 'Sugar' },
      { value: 'salt', label: 'Salt' },
    ];
    render(<SearchInput onSubmit={onSubmit} options={options} aria-label="Item" />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Flour', 'Sugar', 'Salt']);
    // Nothing is chosen until an arrow is pressed.
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    await user.click(input);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = screen.getAllByRole('option')[1]!;
    expect(input.getAttribute('aria-activedescendant')).toBe(active.id);
    expect(active.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2]!.id);
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('salt');
    expect(input.value).toBe('salt');
    expect(document.activeElement).toBe(input);
    // Chosen: the list closes until somebody types again.
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('s');
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('a click on an option submits it without taking the focus from the field; Escape closes the list', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SearchInput onSubmit={onSubmit} options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} aria-label="Item" />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('b');
    expect(document.activeElement).toBe(input);
    await user.keyboard('x{Escape}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('option')).toEqual([]);
    // With no option under the arrows, Enter submits the text — which replaced the chosen one, selected as it was.
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenLastCalledWith('x');
  });

  it('an empty list draws no options and the field says it is not expanded', () => {
    render(<SearchInput options={[]} aria-label="Item" />);
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('option')).toEqual([]);
  });
});
