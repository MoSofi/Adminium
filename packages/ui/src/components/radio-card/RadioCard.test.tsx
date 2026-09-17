// SPDX-License-Identifier: AGPL-3.0-only
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

describe('the comp card shapes', () => {
  it('keeps `row` as the default, so every existing caller is untouched', () => {
    render(
      <RadioGroup value="a" onValueChange={() => undefined}>
        <RadioCard value="a" title="Row" icon={<span data-testid="glyph" />} />
      </RadioGroup>,
    );
    const card = screen.getByRole('radio', { name: /Row/ });
    expect(card.className).toContain('p-3.5');
    expect(card.className).toContain('rounded-lg');
  });

  it('gives `tile` the comp geometry: 15px padding, a 13px radius, a 40px icon box', () => {
    render(
      <RadioGroup value="a" onValueChange={() => undefined}>
        <RadioCard layout="tile" value="a" title="Tile" description="Body" icon={<span data-testid="glyph" />} />
      </RadioGroup>,
    );
    const card = screen.getByRole('radio', { name: /Tile/ });
    expect(card.className).toContain('p-[15px]');
    expect(card.className).toContain('rounded-[13px]');
    expect(screen.getByTestId('glyph').parentElement?.className).toContain('size-10');
  });

  it('centres `stack` and puts the tile above the label', () => {
    render(
      <RadioGroup value="a" onValueChange={() => undefined}>
        <RadioCard layout="stack" value="a" title="Stack" icon={<span data-testid="glyph" />} />
      </RadioGroup>,
    );
    const card = screen.getByRole('radio', { name: /Stack/ });
    expect(card.className).toContain('flex-col');
    expect(card.className).toContain('text-center');
  });
});
