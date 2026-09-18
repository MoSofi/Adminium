// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '../../lib/cn.js';
import { dayKey, monthGrid, weekdayInitials } from '../../lib/week.js';
import { IconButton } from '../icon-button/IconButton.js';

export interface MonthCalendarProps {
  /** The month on screen, as `YYYY-MM`. Controlled: the arrows report, never set. */
  month: string;
  onMonth: (month: string) => void;
  /** The chosen day, `YYYY-MM-DD`, or null. */
  value: string | null;
  onChange: (day: string) => void;
  /** Days nothing can be put on — struck through and inert (comp 634–652). */
  unavailable?: readonly string[] | undefined;
  /** Nothing before this day may be chosen; `YYYY-MM-DD`. */
  min?: string | undefined;
  locale?: string | undefined;
  /** Accessible names — this package ships no copy. */
  labels: { previous: string; next: string; month: (month: string) => string };
  className?: string | undefined;
}

/**
 * MonthCalendar — the month grid (comp
 * 322–334, 634–652).
 *
 * ─── A real calendar, in the reader's own week ─────────────────────────────
 *
 * The comp's grid is a fixed 7 × 5 with a hardcoded offset, and it puts
 * 1 September 2026 on a Wednesday — it is a Tuesday. It also gives the month
 * arrows no handlers. Both are drawing conveniences in a mock-up and both are
 * defects in a product, so this computes the month from the calendar, starts
 * the week where the reader's locale starts it, and moves.
 *
 * ─── Unavailable is INERT, not just decorated ──────────────────────────────
 *
 * A struck-through day that still accepts a click is a screen that takes a
 * booking it has already said it cannot take. `disabled` carries that to the
 * keyboard and to a screen reader as well as to the eye.
 *
 * ─── Height is fixed by the grid, not by the month ─────────────────────────
 *
 * `monthGrid` pads to whole weeks, so February and August are the same height
 * and the legend under the calendar does not jump a line when the month
 * changes.
 */
export function MonthCalendar({
  month,
  onMonth,
  value,
  onChange,
  unavailable,
  min,
  locale,
  labels,
  className,
}: MonthCalendarProps) {
  const [year, monthIndex] = useMemo(() => {
    const [y, m] = month.split('-');
    return [Number(y), Number(m) - 1] as const;
  }, [month]);

  const cells = useMemo(() => monthGrid(year, monthIndex, locale), [year, monthIndex, locale]);
  const initials = useMemo(() => weekdayInitials(locale), [locale]);
  const blocked = useMemo(() => new Set(unavailable ?? []), [unavailable]);
  const title = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, monthIndex, 1)),
    [year, monthIndex, locale],
  );

  const shift = (by: -1 | 1): void => {
    const next = new Date(year, monthIndex + by, 1);
    onMonth(`${String(next.getFullYear()).padStart(4, '0')}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div className={cn('min-w-0', className)} data-testid="month-calendar">
      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-[13.5px] font-extrabold text-fg">{title}</span>
        <div className="flex gap-1.5">
          <IconButton variant="bordered" size="sm" label={labels.previous} onClick={() => shift(-1)}>
            <ChevronLeft className="size-3.5" />
          </IconButton>
          <IconButton variant="bordered" size="sm" label={labels.next} onClick={() => shift(1)}>
            <ChevronRight className="size-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="mb-1.5 grid grid-cols-7 gap-1" aria-hidden="true">
        {initials.map((initial, index) => (
          <span key={index} className="text-center text-[10.5px] font-bold text-fg-subtle">
            {initial}
          </span>
        ))}
      </div>

      {/*
        A GROUP of buttons, not an ARIA `grid`. A grid promises rows — axe's
        `aria-required-children` says so, and this markup has none: it is seven
        columns of buttons in one flow, which is what a date picker's days are.
        Each one carries the whole date as its name, so nobody has to infer the
        month from the column they are in.
      */}
      <div className="grid grid-cols-7 gap-1" role="group" aria-label={labels.month(title)}>
        {cells.map((day, index) => {
          if (day === null) return <span key={index} className="h-[34px]" />;
          const key = dayKey(day);
          const taken = blocked.has(key);
          const past = min !== undefined && key < min;
          const chosen = key === value;
          return (
            <button
              key={key}
              type="button"
              disabled={taken || past}
              aria-pressed={chosen}
              aria-label={new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(day)}
              data-testid={`calendar-day-${key}`}
              onClick={() => onChange(key)}
              className={cn(
                'h-[34px] rounded-[9px] border border-transparent font-mono text-[12.5px] font-semibold',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                chosen && 'bg-accent font-extrabold text-accent-fg',
                !chosen && taken && 'bg-surface-3 text-fg-subtle line-through',
                !chosen && past && 'text-fg-subtle',
                !chosen && !taken && !past && 'text-fg hover:bg-surface-2',
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
