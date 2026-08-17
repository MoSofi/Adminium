// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FormField } from '../form-field/index.js';
import { Combobox } from './Combobox.js';

const options = [
  { value: 'utc', label: 'UTC' },
  { value: 'cairo', label: 'Africa/Cairo' },
  { value: 'berlin', label: 'Europe/Berlin' },
  { value: 'tokyo', label: 'Asia/Tokyo', disabled: true },
];

function renderCombobox(
  props: {
    onValueChange?: (value: string | null) => void;
    defaultValue?: string;
    disabled?: boolean;
  } = {},
) {
  return render(
    <Combobox
      aria-label="Timezone"
      options={options}
      emptyText="No matches"
      {...(props.onValueChange ? { onValueChange: props.onValueChange } : {})}
      {...(props.defaultValue === undefined ? {} : { defaultValue: props.defaultValue })}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
    />,
  );
}

describe('Combobox', () => {
  it('renders a collapsed combobox with ARIA 1.2 wiring', () => {
    renderCombobox();
    const input = screen.getByRole('combobox', { name: 'Timezone' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens on ArrowDown and shows all options', async () => {
    const user = userEvent.setup();
    renderCombobox();
    const input = screen.getByRole('combobox');
    input.focus();
    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listbox = await screen.findByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('typing filters options; Enter selects the active one', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderCombobox({ onValueChange });
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('cai');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option', { name: /Africa\/Cairo/ })).toBeDefined();
    await user.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('cairo');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect((input as HTMLInputElement).value).toBe('Africa/Cairo');
  });

  it('arrow keys move aria-activedescendant over enabled options only', async () => {
    const user = userEvent.setup();
    renderCombobox();
    const input = screen.getByRole('combobox');
    input.focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    // first enabled option is active on open
    expect(document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent).toContain('UTC');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const activeId = input.getAttribute('aria-activedescendant') ?? '';
    expect(document.getElementById(activeId)?.textContent).toContain('Europe/Berlin');
    // Tokyo is disabled: next step wraps back to UTC
    await user.keyboard('{ArrowDown}');
    expect(document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent).toContain('UTC');
  });

  it('selects an option on click and marks it aria-selected on reopen', async () => {
    const user = userEvent.setup();
    renderCombobox();
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.click(await screen.findByRole('option', { name: /Europe\/Berlin/ }));
    expect((input as HTMLInputElement).value).toBe('Europe/Berlin');
    await user.keyboard('{ArrowDown}');
    const selected = await screen.findByRole('option', { name: /Europe\/Berlin/ });
    expect(selected.getAttribute('aria-selected')).toBe('true');
  });

  it('shows the empty state when nothing matches', async () => {
    const user = userEvent.setup();
    renderCombobox();
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('zzz');
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    expect(screen.getByText('No matches')).toBeDefined();
  });

  it('Escape closes the list and restores the selected label', async () => {
    const user = userEvent.setup();
    renderCombobox({ defaultValue: 'utc' });
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('ber');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect((input as HTMLInputElement).value).toBe('UTC');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('wires id/aria-describedby/aria-invalid from FormField onto the input', () => {
    render(
      <FormField label="Timezone" error="Required">
        <Combobox options={options} emptyText="No matches" />
      </FormField>,
    );
    const input = screen.getByRole('combobox', { name: 'Timezone' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Required');
  });

  it('is inert when disabled', async () => {
    const user = userEvent.setup();
    renderCombobox({ disabled: true });
    const input = screen.getByRole('combobox');
    expect((input as HTMLInputElement).disabled).toBe(true);
    await user.click(input).catch(() => undefined);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
