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
});
