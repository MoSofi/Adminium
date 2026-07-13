import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChipInput } from './ChipInput.js';

const removeLabel = (chip: string) => `Remove ${chip}`;

describe('ChipInput', () => {
  it('renders initial chips with remove buttons', () => {
    render(<ChipInput defaultValue={['a@x.io', 'b@x.io']} removeLabel={removeLabel} />);
    expect(screen.getByText('a@x.io')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove b@x.io' })).toBeDefined();
  });

  it('commits a chip on Enter and clears the input', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChipInput removeLabel={removeLabel} onValueChange={onValueChange} />);
    await user.type(screen.getByRole('textbox'), 'ava@acme.io{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith(['ava@acme.io']);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('ava@acme.io')).toBeDefined();
  });

  it('commits on comma and ignores duplicates', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChipInput defaultValue={['a@x.io']} removeLabel={removeLabel} onValueChange={onValueChange} />);
    await user.type(screen.getByRole('textbox'), 'b@x.io,');
    expect(onValueChange).toHaveBeenLastCalledWith(['a@x.io', 'b@x.io']);
    await user.type(screen.getByRole('textbox'), 'a@x.io{Enter}');
    // duplicate: not re-added
    expect(screen.getAllByText('a@x.io')).toHaveLength(1);
  });

  it('removes a chip via its ✕ button', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChipInput defaultValue={['a@x.io', 'b@x.io']} removeLabel={removeLabel} onValueChange={onValueChange} />);
    await user.click(screen.getByRole('button', { name: 'Remove a@x.io' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['b@x.io']);
  });

  it('removes the last chip with Backspace on an empty input', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChipInput defaultValue={['a@x.io', 'b@x.io']} removeLabel={removeLabel} onValueChange={onValueChange} />);
    screen.getByRole('textbox').focus();
    await user.keyboard('{Backspace}');
    expect(onValueChange).toHaveBeenLastCalledWith(['a@x.io']);
  });

  it('splits pasted text on commas and whitespace', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChipInput removeLabel={removeLabel} onValueChange={onValueChange} />);
    screen.getByRole('textbox').focus();
    await user.paste('a@x.io, b@x.io\nc@x.io');
    expect(onValueChange).toHaveBeenLastCalledWith(['a@x.io', 'b@x.io', 'c@x.io']);
  });

  it('rejects invalid tokens, keeps them in the input, and flags aria-invalid until edited', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <ChipInput removeLabel={removeLabel} onValueChange={onValueChange} validate={(chip) => chip.includes('@')} />,
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.type(input, 'nope{Enter}');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(input.value).toBe('nope');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await user.type(input, 'x');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('commits pending text on blur', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChipInput removeLabel={removeLabel} onValueChange={onValueChange} />);
    await user.type(screen.getByRole('textbox'), 'a@x.io');
    await user.tab();
    expect(onValueChange).toHaveBeenLastCalledWith(['a@x.io']);
  });

  it('supports controlled value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChipInput value={['fixed@x.io']} removeLabel={removeLabel} onValueChange={onValueChange} />);
    await user.type(screen.getByRole('textbox'), 'new@x.io{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith(['fixed@x.io', 'new@x.io']);
    // still renders only the controlled chip
    expect(screen.queryByText('new@x.io')).toBeNull();
  });
});
