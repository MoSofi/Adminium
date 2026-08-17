// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DateInput, DateRangeInput } from './DateInput.js';

describe('DateInput', () => {
  it('renders a native date input with mono chrome', () => {
    render(<DateInput aria-label="Date" defaultValue="2026-07-13" />);
    const input = screen.getByLabelText('Date') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-07-13');
    expect(input.className).toContain('font-mono');
    expect(input.className).toContain('bg-surface-2');
  });

  it('supports time and datetime-local types', () => {
    render(
      <>
        <DateInput aria-label="Time" type="time" />
        <DateInput aria-label="Stamp" type="datetime-local" />
      </>,
    );
    expect((screen.getByLabelText('Time') as HTMLInputElement).type).toBe('time');
    expect((screen.getByLabelText('Stamp') as HTMLInputElement).type).toBe('datetime-local');
  });

  it('sets aria-invalid when error', () => {
    render(<DateInput aria-label="Date" error />);
    expect(screen.getByLabelText('Date').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('DateRangeInput', () => {
  it('renders a group with labelled start/end inputs', () => {
    render(
      <DateRangeInput
        aria-label="Billing period"
        startLabel="Start date"
        endLabel="End date"
        defaultValue={{ start: '2026-07-01', end: '2026-07-31' }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Billing period' })).toBeDefined();
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-07-01');
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-07-31');
  });

  it('emits the full range on either edit and clamps via min/max', () => {
    const onValueChange = vi.fn();
    render(
      <DateRangeInput
        startLabel="Start date"
        endLabel="End date"
        defaultValue={{ start: '2026-07-01', end: '2026-07-31' }}
        onValueChange={onValueChange}
      />,
    );
    const start = screen.getByLabelText('Start date') as HTMLInputElement;
    const end = screen.getByLabelText('End date') as HTMLInputElement;
    expect(start.max).toBe('2026-07-31');
    expect(end.min).toBe('2026-07-01');
    fireEvent.change(start, { target: { value: '2026-07-05' } });
    expect(onValueChange).toHaveBeenLastCalledWith({ start: '2026-07-05', end: '2026-07-31' });
    fireEvent.change(end, { target: { value: '2026-08-02' } });
    expect(onValueChange).toHaveBeenLastCalledWith({ start: '2026-07-05', end: '2026-08-02' });
  });

  it('applies a preset from the menu', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <DateRangeInput
        startLabel="Start date"
        endLabel="End date"
        onValueChange={onValueChange}
        presetsLabel="Preset ranges"
        presets={[{ label: 'This month', value: { start: '2026-07-01', end: '2026-07-31' } }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Preset ranges' }));
    await user.click(await screen.findByRole('menuitem', { name: 'This month' }));
    expect(onValueChange).toHaveBeenCalledWith({ start: '2026-07-01', end: '2026-07-31' });
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-07-01');
  });

  it('respects the controlled value', () => {
    render(
      <DateRangeInput
        startLabel="Start date"
        endLabel="End date"
        value={{ start: '2026-01-01', end: '2026-02-01' }}
      />,
    );
    const start = screen.getByLabelText('Start date') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-03-03' } });
    // parent did not re-render: value stays controlled
    expect(start.value).toBe('2026-01-01');
  });
});
