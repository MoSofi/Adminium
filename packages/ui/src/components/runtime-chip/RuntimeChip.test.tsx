// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RuntimeChip, type RuntimeChipState } from './RuntimeChip.js';
import { toneSoftClasses, type Tone } from '../../lib/tones.js';

/**
 * 11-electron.md §8.1's table, as data — every row is asserted below.
 *
 * The tone column is §8.1's own ("muted" → neutral, "accent-soft" → accent, "warn" → warn); the
 * utilities behind it come from the shared chip recipe rather than being spelled out here, which
 * is the point of the recipe. The previous version hardcoded `bg-accent-soft` and matched it with
 * `className.toContain` — a substring test that went on passing after the chip tints became
 * `bg-accent-soft-solid`, so it asserted the tone's NAME and nothing about the tint.
 */
const ROWS: ReadonlyArray<{ state: RuntimeChipState; tone: Tone }> = [
  { state: 'local', tone: 'neutral' },
  { state: 'lan-share', tone: 'accent' },
  { state: 'remote-db', tone: 'neutral' },
  { state: 'remote-db-offline', tone: 'warn' },
];

describe('RuntimeChip', () => {
  it.each(ROWS)('renders the §8.1 tone for $state', ({ state, tone }) => {
    render(<RuntimeChip state={state} label="Chip" />);
    const chip = screen.getByText('Chip');
    for (const cls of toneSoftClasses[tone].split(' ')) {
      expect(chip.classList.contains(cls), cls).toBe(true);
    }
    expect(chip.getAttribute('data-state')).toBe(state);
  });

  /**
   * The two remote states differ by more than colour — §8.1 gives them
   * different labels, and this asserts the icon differs too, so the "your data
   * is not reachable" state is not a hue away from "your data is fine".
   */
  it('gives every state a distinct icon', () => {
    const paths = ROWS.map(({ state }) => {
      const { container, unmount } = render(<RuntimeChip state={state} label="Chip" />);
      const svg = container.querySelector('svg');
      const markup = svg?.innerHTML ?? '';
      unmount();
      return markup;
    });
    expect(new Set(paths).size).toBe(ROWS.length);
    expect(paths.every((markup) => markup.length > 0)).toBe(true);
  });

  it('renders inert presentation when there is nowhere to click', () => {
    render(<RuntimeChip state="local" label="Local" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Local').tagName).toBe('SPAN');
  });

  /**
   * §8.1: "accent-soft; click → LAN panel". A clickable chip must be a real
   * button — keyboard-reachable and announced as actionable — not a span with
   * an onClick.
   */
  it('renders a real, keyboard-operable button when clickable', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<RuntimeChip state="lan-share" label="Local · Sharing on LAN" onClick={onClick} />);

    const button = screen.getByRole('button', { name: 'Local · Sharing on LAN' });
    expect(button.getAttribute('type')).toBe('button');

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('hides the icon from assistive tech so the label is the whole name', () => {
    render(<RuntimeChip state="remote-db-offline" label="Remote DB offline" onClick={() => {}} />);
    expect(screen.getByRole('button').textContent).toBe('Remote DB offline');
    expect(screen.getByRole('button').querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes the description as a title when supplied', () => {
    render(<RuntimeChip state="remote-db-offline" label="Remote DB offline" description="prod-db is unreachable" />);
    expect(screen.getByText('Remote DB offline').getAttribute('title')).toBe('prod-db is unreachable');
  });
});
