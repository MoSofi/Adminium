// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SlotGrid, slotsBetween } from './SlotGrid.js';

afterEach(cleanup);

describe('slotsBetween', () => {
  it('stops before the closing time, not at it', () => {
    // 17:00 is when the day CLOSES; offering it books a slot that runs past
    // the end of the day.
    expect(slotsBetween('16:00', '17:00', 30)).toEqual(['16:00', '16:30']);
  });

  it('answers nothing for a window that cannot hold a slot', () => {
    expect(slotsBetween('17:00', '09:00', 30)).toEqual([]);
    expect(slotsBetween('09:00', '17:00', 0)).toEqual([]);
    expect(slotsBetween('nope', '17:00', 30)).toEqual([]);
  });

  it('pads the hour and the minute, so the strings sort', () => {
    expect(slotsBetween('09:00', '10:00', 15)).toEqual(['09:00', '09:15', '09:30', '09:45']);
  });
});

describe('SlotGrid', () => {
  const draw = (props: Partial<React.ComponentProps<typeof SlotGrid>> = {}) => {
    const onChange = vi.fn();
    render(
      <SlotGrid
        slots={[{ value: '09:00' }, { value: '09:30', taken: true }]}
        value={null}
        onChange={onChange}
        label="Time"
        emptyLabel="No times on this day"
        {...props}
      />,
    );
    return { onChange, user: userEvent.setup() };
  };

  it('makes a taken slot inert', async () => {
    const { onChange, user } = draw();
    expect(screen.getByTestId<HTMLButtonElement>('slot-09:30').disabled).toBe(true);
    await user.click(screen.getByTestId('slot-09:30')).catch(() => undefined);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a free slot', async () => {
    const { onChange, user } = draw();
    await user.click(screen.getByTestId('slot-09:00'));
    expect(onChange).toHaveBeenCalledWith('09:00');
  });

  it('says so when a day has no times, rather than drawing an empty frame', () => {
    draw({ slots: [] });
    expect(screen.getByTestId('slot-grid-empty').textContent).toBe('No times on this day');
    expect(screen.queryByTestId('slot-grid')).toBeNull();
  });
});
