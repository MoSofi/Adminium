import { render, screen, waitFor } from '@testing-library/react';
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

  it('renders the description as muted secondary text', () => {
    renderGroup();
    expect(screen.getByText('First of the month')).toBeDefined();
  });
});