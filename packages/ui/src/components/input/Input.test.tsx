// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Input } from './Input.js';

describe('Input', () => {
  it('renders a textbox with the input chrome', () => {
    render(<Input placeholder="Name" />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('bg-surface-2');
    expect(input.className).toContain('border-border-strong');
    expect(input.className).toContain('rounded-md');
  });

  it('accepts typed text and fires onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'abc');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('abc');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('sets aria-invalid and data-invalid when error', () => {
    render(<Input error />);
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.hasAttribute('data-invalid')).toBe(true);
  });

  it('does not emit an aria-invalid key when error is false (Slot-injection safe)', () => {
    render(<Input />);
    expect(screen.getByRole('textbox').hasAttribute('aria-invalid')).toBe(false);
  });

  it('applies the mono variant', () => {
    render(<Input mono />);
    expect(screen.getByRole('textbox').className).toContain('font-mono');
  });

  it('is not editable when disabled', async () => {
    const user = userEvent.setup();
    render(<Input disabled defaultValue="x" />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    await user.type(input, 'y').catch(() => undefined);
    expect(input.value).toBe('x');
  });

  it('merges consumer className last', () => {
    render(<Input className="bg-surface" />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('bg-surface');
    expect(input.className).not.toContain('bg-surface-2');
  });
});
