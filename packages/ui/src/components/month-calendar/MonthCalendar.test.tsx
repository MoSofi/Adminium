// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MonthCalendar } from './MonthCalendar.js';

afterEach(cleanup);

const labels = {
  previous: 'Previous month',
  next: 'Next month',
  month: (month: string) => `Days in ${month}`,
};

function draw(props: Partial<React.ComponentProps<typeof MonthCalendar>> = {}) {
  const onChange = vi.fn();
  const onMonth = vi.fn();
  render(
    <MonthCalendar
      month="2026-09"
      onMonth={onMonth}
      value={null}
      onChange={onChange}
      locale="de-DE"
      labels={labels}
      {...props}
    />,
  );
  return { onChange, onMonth, user: userEvent.setup() };
}

describe('MonthCalendar', () => {
  it('puts the first of the month on the day it really falls on', () => {
    draw();
    // 1 September 2026 is a TUESDAY. The comp draws it on a Wednesday; copying
    // that would have shifted every day of every month by one.
    const first = screen.getByTestId('calendar-day-2026-09-01');
    const cells = screen.getByRole('group').children;
    // In a Monday-first locale, Tuesday is the second column.
    expect([...cells].indexOf(first)).toBe(1);
  });

  it('moves when the arrows are pressed — both of them', async () => {
    const { onMonth, user } = draw();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onMonth).toHaveBeenLastCalledWith('2026-10');
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onMonth).toHaveBeenLastCalledWith('2026-08');
  });

  it('crosses a year boundary without inventing month 13', async () => {
    const { onMonth, user } = draw({ month: '2026-12' });
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onMonth).toHaveBeenLastCalledWith('2027-01');
  });

  it('makes an unavailable day INERT, not merely decorated', async () => {
    const { onChange, user } = draw({ unavailable: ['2026-09-17'] });
    const day = screen.getByTestId('calendar-day-2026-09-17');
    expect((day as HTMLButtonElement).disabled).toBe(true);
    await user.click(day).catch(() => undefined);
    // A struck-through day that still books is a screen that takes a booking
    // it has already said it cannot take.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses a day before the minimum', async () => {
    const { onChange } = draw({ min: '2026-09-15' });
    expect(screen.getByTestId<HTMLButtonElement>('calendar-day-2026-09-14').disabled).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>('calendar-day-2026-09-15').disabled).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports the day a person picked, in their own zone', async () => {
    const { onChange, user } = draw();
    await user.click(screen.getByTestId('calendar-day-2026-09-17'));
    expect(onChange).toHaveBeenCalledWith('2026-09-17');
  });

  it('names every day for a screen reader', () => {
    draw();
    expect(screen.getByTestId('calendar-day-2026-09-17').getAttribute('aria-label')).toContain('17');
  });
});
