import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RadioGroup } from '../radio/index.js';
import { RadioCard } from './RadioCard.js';

function renderCards(props: { onValueChange?: (value: string) => void } = {}) {
  return render(
    <RadioGroup defaultValue="postgres" aria-label="Database" {...props}>
      <RadioCard value="sqlite" title="SQLite" description="Single file" />
      <RadioCard value="postgres" title="PostgreSQL" description="Production" />
      <RadioCard value="mysql" title="MySQL" disabled />
    </RadioGroup>,
  );
}

describe('RadioCard', () => {
  it('renders cards as radios inside the group, default selected', () => {
    renderCards();
    const selected = screen.getByRole('radio', { name: /PostgreSQL/ });
    expect(selected.getAttribute('aria-checked')).toBe('true');
    expect(selected.getAttribute('data-state')).toBe('checked');
  });

  it('selects a card on click anywhere in the card body', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderCards({ onValueChange });
    await user.click(screen.getByText('Single file'));
    expect(onValueChange).toHaveBeenCalledWith('sqlite');
    expect(screen.getByRole('radio', { name: /SQLite/ }).getAttribute('data-state')).toBe('checked');
  });

  it('skips disabled cards during arrow-key navigation', async () => {
    const user = userEvent.setup();
    renderCards();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /PostgreSQL/ }));
    // MySQL is disabled — ArrowDown wraps past it to SQLite. Hold the key across
    // Radix's deferred roving focus (see Radio.test.tsx for the mechanism).
    await user.keyboard('{ArrowDown>}');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /SQLite/ }).getAttribute('aria-checked')).toBe('true'),
    );
    await user.keyboard('{/ArrowDown}');
  });

  it('hides the check indicator when hideIndicator is set', () => {
    render(
      <RadioGroup defaultValue="a" aria-label="Bare">
        <RadioCard value="a" title="Alpha" hideIndicator />
      </RadioGroup>,
    );
    const card = screen.getByRole('radio', { name: 'Alpha' });
    expect(card.querySelector('svg')).toBeNull();
  });
});