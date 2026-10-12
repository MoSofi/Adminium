// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Notification settings › "Quiet hours and summaries": when a person is told.
 *
 * No design draws this card. It is built to the account pages' own patterns
 * (a card, a labelled row a setting, saved as it is changed), and where it
 * departs it says so:
 *
 *  1. Quiet hours are a row a weekday, each with its own switch and times,
 *     because a person's Friday is not their Sunday. The first weekday
 *     switched on takes 19:00 to 08:00, and "Copy to every day" writes one
 *     day's hours to all seven.
 *  2. Nothing here is on until the person switches it on: with no row set,
 *     every notice arrives at once and a summary when its rule runs.
 *
 * A notice that arrives in quiet hours still shows in the bell, without a
 * sound or a pop-up; its email waits for the hours to end. A notice marked
 * urgent by its rule, and a kind the person ticked under "Always tell me",
 * arrives at once.
 */
import { useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Input, Select, Switch } from '@adminium/ui';
import { MoonStar } from 'lucide-react';

import { notificationPrefsQuery, notificationScheduleQuery, notificationsApi, type NotificationPrefsDto, type NotificationScheduleDto } from '../api/notifications.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';

type Day = '0' | '1' | '2' | '3' | '4' | '5' | '6';
/** Monday first, as a working week is read; the stored key is JavaScript's (0 = Sunday). */
const DAYS: readonly Day[] = ['1', '2', '3', '4', '5', '6', '0'];
const DEFAULT_WINDOW = { from: '19:00', to: '08:00' };

function dayName(day: Day, locale: string | undefined): string {
  // 2026-02-01 is a Sunday.
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 1, 1 + Number(day))));
}

function zones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  try {
    return supported === undefined ? [] : supported('timeZone');
  } catch {
    return [];
  }
}

const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function QuietHoursCard({ eventLabel }: { eventLabel: (key: string) => string }): ReactNode {
  // Its words are not in the first load: the card waits for them, behind its own boundary.
  useCommonWords();
  const queryClient = useQueryClient();
  const schedule = useQuery(notificationScheduleQuery());
  const prefs = useQuery(notificationPrefsQuery());
  const allZones = useMemo(zones, []);
  const locale = typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined;

  const save = useMutation({
    mutationFn: (next: Omit<NotificationScheduleDto, 'fallbackTimezone'>) => notificationsApi.putSchedule(next),
    onMutate: (next) => {
      const previous = queryClient.getQueryData<NotificationScheduleDto>(notificationScheduleQuery().queryKey);
      if (previous !== undefined) queryClient.setQueryData(notificationScheduleQuery().queryKey, { ...previous, ...next });
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(notificationScheduleQuery().queryKey, context.previous);
    },
    onSuccess: (reply) => queryClient.setQueryData(notificationScheduleQuery().queryKey, reply),
  });
  const always = useMutation({
    mutationFn: (input: { key: string; on: boolean }) => {
      const event = prefs.data?.events.find((candidate) => candidate.key === input.key);
      if (event === undefined) throw new Error('unknown event');
      return notificationsApi.putPrefs([{ key: input.key, channels: { ...event.channels, always: input.on } }]);
    },
    onSuccess: (reply: NotificationPrefsDto) => queryClient.setQueryData(notificationPrefsQuery().queryKey, reply),
  });

  const data = schedule.data;
  if (data === undefined) return null;
  const quiet = data.quiet ?? {};
  const anyQuiet = Object.keys(quiet).length > 0;
  const write = (change: Partial<Omit<NotificationScheduleDto, 'fallbackTimezone'>>): void => {
    const next = { timezone: data.timezone, quiet: data.quiet, digestDay: data.digestDay, digestTime: data.digestTime, ...change };
    // The first thing switched on takes the reader's own zone: quiet hours on the business's clock would be the wrong hours for somebody abroad.
    const needsZone = next.timezone === null && ((next.quiet !== null && Object.keys(next.quiet).length > 0) || next.digestTime !== null);
    save.mutate({ ...next, timezone: needsZone ? browserZone() : next.timezone, quiet: next.quiet !== null && Object.keys(next.quiet).length === 0 ? null : next.quiet });
  };
  const setDay = (day: Day, window: { from: string; to: string } | null): void => {
    const next = { ...quiet };
    if (window === null) delete next[day];
    else next[day] = window;
    write({ quiet: next });
  };
  const firstOn = DAYS.find((day) => quiet[day] !== undefined);

  return (
    <section className="mt-4 rounded-[14px] border border-border bg-surface px-[19px] py-[18px] shadow-sm" data-testid="quiet-hours">
      <h2 className="mb-1 flex items-center gap-[9px]">
        <MoonStar aria-hidden className="size-4 text-accent" />
        <span className="text-sm font-extrabold tracking-[-0.01em]">{t('quietHours.title', 'Quiet hours and summaries')}</span>
      </h2>
      <p className="mb-3 text-[12.5px] leading-[1.5] text-fg-muted">
        {t(
          'quietHours.help',
          'In your quiet hours a notice still shows in the bell, without a sound or a pop-up, and its email waits until the hours end. Something marked urgent reaches you at once.',
        )}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
          <span className="text-[11.5px] font-bold">{t('quietHours.zone', 'Your time zone')}</span>
          <Select
            value={data.timezone ?? ''}
            onChange={(event) => write({ timezone: event.target.value === '' ? null : event.target.value })}
            data-testid="quiet-zone"
          >
            <option value="">{t('quietHours.zoneDefault', 'The business’s ({zone})', { zone: data.fallbackTimezone })}</option>
            {data.timezone !== null && !allZones.includes(data.timezone) ? <option value={data.timezone}>{data.timezone}</option> : null}
            {allZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <ul className="flex flex-col gap-1.5" data-part="days">
        {DAYS.map((day) => {
          const window = quiet[day];
          const name = dayName(day, locale);
          return (
            <li key={day} className="flex flex-wrap items-center gap-3 rounded-[11px] border border-border px-3 py-2" data-day={day}>
              <span className="min-w-[110px] flex-1 text-[12.5px] font-semibold">{name}</span>
              {window === undefined ? (
                <span className="text-xs text-fg-subtle">{t('quietHours.none', 'No quiet hours')}</span>
              ) : (
                <span className="flex items-center gap-2">
                  <Input
                    type="time"
                    className="w-[112px]"
                    value={window.from}
                    aria-label={t('quietHours.from', 'Quiet from, {day}', { day: name })}
                    onChange={(event) => event.target.value !== '' && setDay(day, { ...window, from: event.target.value })}
                  />
                  <span className="text-xs text-fg-subtle">{t('quietHours.until', 'until')}</span>
                  <Input
                    type="time"
                    className="w-[112px]"
                    value={window.to}
                    aria-label={t('quietHours.to', 'Quiet until, {day}', { day: name })}
                    onChange={(event) => event.target.value !== '' && setDay(day, { ...window, to: event.target.value })}
                  />
                  {window.to <= window.from ? <span className="text-xs text-fg-subtle">{t('quietHours.nextDay', 'the next day')}</span> : null}
                </span>
              )}
              <Switch
                checked={window !== undefined}
                aria-label={t('quietHours.daySwitch', 'Quiet hours on {day}', { day: name })}
                onCheckedChange={(next) => setDay(day, next ? (firstOn === undefined ? DEFAULT_WINDOW : quiet[firstOn]!) : null)}
                data-testid={`quiet-day-${day}`}
              />
            </li>
          );
        })}
      </ul>
      {firstOn === undefined ? null : (
        <div className="mt-2">
          <Button variant="ghost" size="sm" onClick={() => write({ quiet: Object.fromEntries(DAYS.map((day) => [day, quiet[firstOn]!])) })} data-testid="quiet-copy">
            {t('quietHours.copy', 'Copy {day}’s hours to every day', { day: dayName(firstOn, locale) })}
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <span className="text-[11.5px] font-bold">{t('quietHours.digestDay', 'Send my summaries on')}</span>
          <Select
            value={data.digestDay === null ? '' : String(data.digestDay)}
            onChange={(event) => write(event.target.value === '' ? { digestDay: null, digestTime: null } : { digestDay: Number(event.target.value), digestTime: data.digestTime ?? '08:00' })}
            data-testid="digest-day"
          >
            <option value="">{t('quietHours.digestWhenRun', 'The day each one is made')}</option>
            {DAYS.map((day) => (
              <option key={day} value={day}>
                {dayName(day, locale)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold">{t('quietHours.digestTime', 'At')}</span>
          <Input
            type="time"
            className="w-[124px]"
            value={data.digestTime ?? ''}
            onChange={(event) => write({ digestTime: event.target.value === '' ? null : event.target.value })}
            data-testid="digest-time"
          />
        </label>
      </div>

      {!anyQuiet || prefs.data === undefined || prefs.data.events.length === 0 ? null : (
        <div className="mt-4" data-part="always">
          <p className="mb-1.5 text-[11.5px] font-bold">{t('quietHours.always', 'Always tell me, also in quiet hours')}</p>
          <ul className="flex flex-col gap-1.5">
            {prefs.data.events.map((event) => (
              <li key={event.key}>
                <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px]">
                  <Checkbox checked={event.channels.always === true} onCheckedChange={(next) => always.mutate({ key: event.key, on: next === true })} />
                  <span>{eventLabel(event.key)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {save.error === null && always.error === null ? null : (
        <p role="alert" className="mt-2.5 text-[12.5px] text-danger">
          {(save.error ?? always.error)?.message}
        </p>
      )}
    </section>
  );
}
