// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CALENDAR CONTROL — a month grid, and the times of the chosen day.
 *
 * ─── One control, one column ───────────────────────────────────────────────
 *
 * The comp draws a day grid and a time grid as two panes of one dialog
 * (comp 318–360). They are ONE value: the instant
 * the row holds. Two fields over one column is how a form ends up holding half
 * a booking — a day with no time, or a time on a day nobody picked — so this is
 * a single control whose two halves edit two ends of the same string.
 *
 * ─── What "taken" means, and what it costs to say it ───────────────────────
 *
 * Nothing is struck through unless the field declares an availability rule. A
 * calendar that greys out days it has not checked is worse than one that greys
 * out nothing: the first is a claim, the second is an absence of one. With a
 * rule, one read per visible month asks the server for the DISTINCT instants
 * already held (see `crud/availability.ts`), and a **capped** reply strikes out
 * NOTHING — a prefix drawn as the whole would mark free everything the cap cut.
 *
 * ─── The value's shape is the column's, not the calendar's ─────────────────
 *
 * A `date` column gets `YYYY-MM-DD`; a timestamp gets `YYYY-MM-DDTHH:MM`, the
 * same text the `datetime-local` control already sends. Nothing here converts a
 * zone: the write path owns that (`crud/write-values.ts`), and a second
 * conversion in a browser is how a slot grid comes to disagree with the row it
 * just wrote.
 */
import { useEffect, useMemo, useState } from 'react';
import { MonthCalendar, SlotGrid, slotsBetween } from '@adminium/ui';

import { useMaybeT } from '@adminium/i18n/react';
import type { ControlProps } from './types.js';

/** The day and the time held in a stored value, as text. */
export function splitInstant(value: unknown): { day: string; time: string } {
  const raw = typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : '';
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(raw);
  if (match === null) return { day: '', time: '' };
  return {
    day: match[1] as string,
    time: match[2] === undefined ? '' : `${match[2]}:${match[3] as string}`,
  };
}

/** The `YYYY-MM` a day belongs to, or this month when there is no day yet. */
function monthOf(day: string): string {
  if (/^\d{4}-\d{2}/.test(day)) return day.slice(0, 7);
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function CalendarControl(props: ControlProps) {
  const t = useMaybeT();
  const { day, time } = splitInstant(props.value);
  const [month, setMonth] = useState(() => monthOf(day));
  const [taken, setTaken] = useState<{ instants: Set<string>; capped: boolean }>(() => ({
    instants: new Set(),
    capped: false,
  }));

  const slots = useMemo(() => {
    const spec = props.field?.slots;
    return spec === undefined ? null : slotsBetween(spec.start, spec.end, spec.minutes);
  }, [props.field?.slots]);

  const rule = props.field?.availability;
  const resource = rule?.resource;
  // The value of the column the rule scopes by, read off the form's OWN values
  // — a room picked in the field above changes which slots are free.
  const resourceValue =
    resource === undefined ? undefined : props.siblings?.[resource];
  const read = props.availability;

  useEffect(() => {
    if (rule === undefined || read === undefined) return;
    let live = true;
    const [year, index] = month.split('-').map(Number);
    const next = new Date(year as number, (index as number) - 1 + 1, 1);
    void read({
      column: props.column.name,
      from: `${month}-01T00:00`,
      to: `${String(next.getFullYear())}-${String(next.getMonth() + 1).padStart(2, '0')}-01T00:00`,
      ...(resource === undefined ? {} : { resource }),
      ...(resourceValue === undefined || resourceValue === null
        ? {}
        : { resourceValue: String(resourceValue) }),
      // On an edit, this record's own instant is not taken (C2).
      ...(props.recordId === undefined ? {} : { exclude: props.recordId }),
    })
      .then((reply) => {
        if (!live) return;
        setTaken({ instants: new Set(reply.capped ? [] : reply.taken), capped: reply.capped });
      })
      .catch(() => {
        // A failed read is an UNKNOWN availability, not an empty one: the grid
        // goes back to striking nothing out rather than inviting a booking it
        // has not checked.
        if (live) setTaken({ instants: new Set(), capped: true });
      });
    return () => {
      live = false;
    };
  }, [rule, read, month, props.column.name, props.recordId, resource, resourceValue]);

  /**
   * A day is unavailable when every one of its slots is taken — or, with no
   * slots, when the day itself is.
   */
  const unavailableDays = useMemo(() => {
    if (taken.capped) return [];
    if (slots === null) {
      return [...taken.instants].map((instant) => instant.slice(0, 10));
    }
    const byDay = new Map<string, Set<string>>();
    for (const instant of taken.instants) {
      const { day: d, time: at } = splitInstant(instant);
      if (d === '') continue;
      const set = byDay.get(d) ?? new Set<string>();
      set.add(at);
      byDay.set(d, set);
    }
    return [...byDay.entries()]
      .filter(([, times]) => slots.every((slot: string) => times.has(slot)))
      .map(([d]) => d);
  }, [taken, slots]);

  const emit = (nextDay: string, nextTime: string): void => {
    if (slots === null) {
      props.onChange(nextDay);
      return;
    }
    props.onChange(nextTime === '' ? nextDay : `${nextDay}T${nextTime}`);
  };

  const dayLabel =
    day === ''
      ? ''
      : new Intl.DateTimeFormat(props.locale, { month: 'short', day: 'numeric' }).format(
          new Date(`${day}T00:00`),
        );

  return (
    <div
      className={slots === null ? 'min-w-0' : 'grid min-w-0 gap-5 sm:grid-cols-[1.1fr_1fr]'}
      data-testid="calendar-control"
    >
      <MonthCalendar
        month={month}
        onMonth={setMonth}
        value={day === '' ? null : day}
        onChange={(next: string) => emit(next, time)}
        unavailable={unavailableDays}
        {...(props.locale === undefined ? {} : { locale: props.locale })}
        labels={{
          previous: t('ui:formDialog.calendar.previous', 'Previous month'),
          next: t('ui:formDialog.calendar.next', 'Next month'),
          month: (name: string) => t('ui:formDialog.calendar.days', 'Days in {month}', { month: name }),
        }}
      />
      {slots === null ? null : (
        <div className="min-w-0">
          <p className="mb-2 text-[12px] font-semibold text-fg">
            {props.field?.label ?? props.column.label ?? props.column.name}
            {dayLabel === '' ? null : (
              <span className="font-semibold text-fg-subtle"> · {dayLabel}</span>
            )}
          </p>
          <SlotGrid
            slots={slots.map((slot: string) => ({
              value: slot,
              taken: day !== '' && taken.instants.has(`${day}T${slot}`),
            }))}
            value={time === '' ? null : time}
            onChange={(next: string) => emit(day === '' ? todayKey() : day, next)}
            label={t('ui:formDialog.calendar.times', 'Times')}
            emptyLabel={t('ui:formDialog.calendar.noTimes', 'No times on this day')}
          />
          {/* A capped month says so rather than drawing a grid that quietly
              means "checked" when nothing was checked. */}
          {taken.capped && rule !== undefined ? (
            <p className="mt-2 text-caption text-fg-subtle" data-testid="calendar-uncapped">
              {t(
                'ui:formDialog.calendar.unchecked',
                'This month has too many bookings to check here.',
              )}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function todayKey(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
