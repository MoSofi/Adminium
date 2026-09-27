// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A `chart-bar` over a slot limit's counts draws the day's strip: a bar per
 * slot as tall as what is taken of the size, a dashed size line, paused slots
 * hatched, slots already over dimmed and a marker at now — on the venue's
 * clock the answer carries — and a closed day said in words.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { chartBarConfigSchema } from './charts-config.js';
import { ChartBarWidget } from './ChartWidgets.js';
import { asSlotStrip, placeSlots } from './SlotStrip.js';

afterEach(cleanup);

/** The kitchen at 12:40 on its clock: four slots from noon, a quarter of an hour each. */
function answer(overrides: Record<string, unknown> = {}, now = { day: '2026-07-28', minute: 12 * 60 + 40 }) {
  const rows = [
    { time: '12:00', size: 6, taken: 6, held: 0 },
    { time: '12:15', size: 6, taken: 2, held: 1 },
    { time: '12:30', size: 6, taken: 0, held: 0, paused: true },
    { time: '12:45', size: 6, taken: 3, held: 0 },
  ];
  return {
    shape: 'categorical',
    items: rows.map((row) => ({ key: row.time, label: row.time, value: row.taken })),
    total: 11,
    capacity: { kind: 'slot', date: '2026-07-28', days: 1, now, closed: false, rows, ...overrides },
  };
}

const draw = (data: unknown) => render(<ChartBarWidget instanceId="slots" config={chartBarConfigSchema.parse({ title: 'Pickups today' })} data={data} onEvent={() => undefined} />);
const bars = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-part="slot-bar"]')];
const cssVar = (element: Element | null, name: string) => (element as HTMLElement | null)?.style.getPropertyValue(name);

describe('the slot strip', () => {
  it('draws a bar per slot as tall as what is taken, with a dashed line at the size', () => {
    const { container } = draw(answer());
    expect(container.querySelector('[data-widget="slot-strip"]')?.getAttribute('aria-label')).toBe('Pickups today');
    expect(bars(container).map((bar) => bar.dataset['slot'])).toEqual(['12:00', '12:15', '12:30', '12:45']);
    expect(bars(container).map((bar) => cssVar(bar.querySelector('[data-part="slot-taken"]'), '--taken'))).toEqual(['100%', `${String((2 / 6) * 100)}%`, '0%', '50%']);
    // What holds keep sits on what is taken, lighter.
    expect(cssVar(bars(container)[1]!.querySelector('[data-part="slot-held"]'), '--held')).toBe(`${String((1 / 6) * 100)}%`);
    expect(cssVar(container.querySelector('[data-part="slot-size-line"]'), '--size-at')).toBe('100%');
    expect(container.querySelector('[data-part="slot-size-line"]')?.className).toContain('border-dashed');
    expect(screen.getByText('12:15: 2 of 6 taken · 1 held · Over')).toBeDefined();
    expect(screen.getByText('12:30: 0 of 6 taken · Paused')).toBeDefined();
    expect(container.querySelector('[data-part="slot-closed"]')).toBeNull();
  });

  it('hatches a paused slot, dims the slots already over and marks now', () => {
    const { container } = draw(answer());
    const [noon, quarter, half, threeQuarters] = bars(container);
    expect(half!.dataset['paused']).toBe('true');
    expect(half!.className).toContain('repeating-linear-gradient');
    expect(noon!.dataset['paused']).toBeUndefined();
    // At 12:40 the noon and quarter-past slots are over; half past is running; quarter to is to come.
    expect([noon, quarter, half, threeQuarters].map((bar) => bar!.dataset['past'] === 'true')).toEqual([true, true, false, false]);
    expect(noon!.className).toContain('opacity-50');
    expect(threeQuarters!.className).not.toContain('opacity-50');
    // Now: two thirds into the third of four slots.
    expect(cssVar(container.querySelector('[data-part="slot-now"]'), '--now')).toBe(`${String(((2 + 10 / 15) / 4) * 100)}%`);
    expect(screen.getByText('Now')).toBeDefined();
  });

  it('marks no now on another day: all over the day before, none the day after', () => {
    const before = draw(answer({}, { day: '2026-07-29', minute: 600 }));
    expect(before.container.querySelector('[data-part="slot-now"]')).toBeNull();
    expect(bars(before.container).every((bar) => bar.dataset['past'] === 'true')).toBe(true);
    cleanup();
    const after = draw(answer({}, { day: '2026-07-27', minute: 600 }));
    expect(after.container.querySelector('[data-part="slot-now"]')).toBeNull();
    expect(bars(after.container).some((bar) => bar.dataset['past'] === 'true')).toBe(false);
  });

  it('says a closed day in words', () => {
    const rows = answer().capacity.rows.map((row) => ({ ...row, closed: true }));
    draw(answer({ closed: true, rows }));
    expect(screen.getByRole('status').textContent).toBe('Closed this day: no one can take these slots.');
  });

  it('draws the week a day per bar, today marked, the days before it over', () => {
    const week = ['2026-07-27', '2026-07-28', '2026-07-29'].map((date, i) => ({ date, size: 216, taken: [10, 20, 0][i]!, held: 0 }));
    const { container } = draw({ shape: 'categorical', items: [], total: 30, capacity: { kind: 'slot', date: '2026-07-27', days: 7, now: { day: '2026-07-28', minute: 720 }, closed: false, rows: week } });
    expect(bars(container).map((bar) => bar.dataset['past'] === 'true')).toEqual([true, false, false]);
    expect(cssVar(container.querySelector('[data-part="slot-now"]'), '--now')).toBe(`${String(((1 + 0.5) / 3) * 100)}%`);
  });

  it('leaves any other payload to the plain bars, and places slots past midnight after the evening', () => {
    expect(asSlotStrip({ shape: 'categorical', items: [{ key: 'a', label: 'A', value: 1 }], total: 1 })).toBeNull();
    const { container } = draw({ shape: 'categorical', items: [{ key: 'a', label: 'A', value: 1 }], total: 1 });
    expect(container.querySelector('[data-widget="chart-bar"]')).not.toBeNull();
    // Friday's kitchen runs 23:30 to 00:30: at 00:10 the next day, 23:30 and 23:45 are over.
    const late = asSlotStrip({
      capacity: {
        kind: 'slot',
        date: '2026-07-31',
        days: 1,
        now: { day: '2026-08-01', minute: 10 },
        closed: false,
        rows: ['23:30', '23:45', '00:00', '00:15'].map((time) => ({ time, size: 6, taken: 0, held: 0 })),
      },
    })!;
    const placed = placeSlots(late);
    expect(placed.placed.map((slot) => slot.past)).toEqual([true, true, false, false]);
    expect(placed.now).toBeCloseTo((2 + 10 / 15) / 4);
  });
});

describe('a chart of the hours of the day', () => {
  it('labels each bar by the venue hour the server folded it into, whatever this device’s zone', () => {
    const data = { shape: 'timeseries', points: [11, 12, 20].map((hour) => ({ t: `1970-01-01T${String(hour)}:00:00.000Z`, v: 7 })) };
    const config = chartBarConfigSchema.parse({
      title: 'Pickups by hour',
      format: { locale: 'en-US' },
      binding: { connectionId: 'c', source: { name: 'orders' }, shape: 'timeseries', aggregations: [{ fn: 'count', alias: 'n' }], bucket: { column: 'pickup_at', unit: 'hour-of-day' } },
    });
    const { container } = render(<ChartBarWidget instanceId="hours" config={config} data={data} onEvent={() => undefined} />);
    for (const label of ['11 AM', '12 PM', '8 PM']) expect(container.textContent).toContain(label);
  });
});
