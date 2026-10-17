// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Notification settings › the two cards of when a person is told: "Quiet
 * hours" and "Summaries" (comp: Console Additions, section 3).
 *
 * Each card has a switch the server keeps beside what it switches
 * (`quietOn`, `summariesOn`), so switching off loses nothing: quiet hours
 * come back with the same hours, and summaries with the same day and time.
 *
 * What quiet hours hold is said as it is: a notice still shows in the bell
 * at once, without a sound; only its e-mail waits for the hours to end. A
 * notice a rule marks urgent, and a kind the person ticked under "Still tell
 * me at once about…", is not held.
 *
 * Where it departs from the comp:
 *  1. Every change is saved as it is made (no "Save" button), and put back
 *     with the server's words when it is refused, as the page above does.
 *  2. A day unticked forgets its times: the server keeps a window per day or
 *     none. Ticked again, it takes the times of the first day that is on.
 *  3. The worked example is read from the first day that is on, at the hour
 *     its window starts, not from Tuesday at 19:00.
 *  4. "Summaries", not "Weekly digest": the day and time move every summary
 *     a rule sends this person, and the default is the day each is made.
 *     No "next one goes…" line: when a summary is made is its rule's.
 *  5. The time zone is every zone the browser knows, the business's first.
 */
import { useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, IconTile, Input, Select, Switch } from '@adminium/ui';
import { Copy, Mail, MoonStar } from 'lucide-react';

import { notificationPrefsQuery, notificationScheduleQuery, notificationsApi, type NotificationPrefsDto, type NotificationScheduleDto } from '../api/notifications.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';

type Day = '0' | '1' | '2' | '3' | '4' | '5' | '6';
type Window = { from: string; to: string };
type ScheduleWrite = Omit<NotificationScheduleDto, 'fallbackTimezone'>;
/** Monday first, as a working week is read; the stored key is JavaScript's (0 = Sunday). */
const DAYS: readonly Day[] = ['1', '2', '3', '4', '5', '6', '0'];
/** Quiet hours switched on for the first time: every evening, as the ledger has them. */
const DEFAULT_WINDOW: Window = { from: '18:30', to: '08:00' };

function dayName(day: Day, locale: string | undefined): string {
  // 2026-02-01 is a Sunday.
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 1, 1 + Number(day))));
}

const nextDay = (day: Day): Day => String((Number(day) + 1) % 7) as Day;

function zones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  try {
    return supported === undefined ? [] : supported('timeZone');
  } catch {
    return [];
  }
}

const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const cardClass = 'mt-4 rounded-[14px] border border-border bg-surface px-[19px] py-[18px] shadow-sm';

/** The person's schedule and one way to write it: as each control changes, put back when refused. */
function useSchedule() {
  const queryClient = useQueryClient();
  const schedule = useQuery(notificationScheduleQuery());
  const save = useMutation({
    mutationFn: (next: ScheduleWrite) => notificationsApi.putSchedule(next),
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
  const data = schedule.data;
  const write = (change: Partial<ScheduleWrite>): void => {
    if (data === undefined) return;
    const next: ScheduleWrite = { timezone: data.timezone, quiet: data.quiet, digestDay: data.digestDay, digestTime: data.digestTime, quietOn: data.quietOn, summariesOn: data.summariesOn, ...change };
    // The first thing switched on takes the reader's own zone: quiet hours on the business's clock would be the wrong hours for somebody abroad.
    const needsZone = next.timezone === null && ((next.quiet !== null && Object.keys(next.quiet).length > 0) || next.digestTime !== null);
    save.mutate({ ...next, timezone: needsZone ? browserZone() : next.timezone, quiet: next.quiet !== null && Object.keys(next.quiet).length === 0 ? null : next.quiet });
  };
  return { data, write, error: save.error };
}

const pageLocale = (): string | undefined => (typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined);

function CardHead(props: { id: string; icon: ReactNode; title: string; lead: string; on: boolean; onSwitch: (on: boolean) => void; testId: string }): ReactNode {
  return (
    <div className="flex items-start gap-3">
      <IconTile size="sm" icon={props.icon} />
      <div className="min-w-0 flex-1">
        <h2 id={props.id} className="text-sm font-extrabold tracking-[-0.01em]">
          {props.title}
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-muted" data-testid={`${props.testId}-lead`}>
          {props.lead}
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        <Switch checked={props.on} aria-labelledby={props.id} onCheckedChange={props.onSwitch} data-testid={`${props.testId}-switch`} />
        <span className="w-8 text-[12px] font-semibold text-fg-muted" aria-hidden>
          {props.on ? t('quietHours.on', 'On') : t('quietHours.off', 'Off')}
        </span>
      </span>
    </div>
  );
}

export function QuietHoursCard({ eventLabel }: { eventLabel: (key: string) => string }): ReactNode {
  // Its words are not in the first load: the card waits for them, behind its own boundary.
  useCommonWords();
  const queryClient = useQueryClient();
  const { data, write, error } = useSchedule();
  const prefs = useQuery(notificationPrefsQuery());
  const allZones = useMemo(zones, []);
  const locale = pageLocale();

  const always = useMutation({
    mutationFn: (input: { key: string; on: boolean }) => {
      const event = prefs.data?.events.find((candidate) => candidate.key === input.key);
      if (event === undefined) throw new Error('unknown event');
      return notificationsApi.putPrefs([{ key: input.key, channels: { ...event.channels, always: input.on } }]);
    },
    onSuccess: (reply: NotificationPrefsDto) => queryClient.setQueryData(notificationPrefsQuery().queryKey, reply),
  });

  if (data === undefined) return null;
  const quiet = data.quiet ?? {};
  const on = data.quietOn && data.quiet !== null;
  const setDay = (day: Day, window: Window | null): void => {
    const next = { ...quiet };
    if (window === null) delete next[day];
    else next[day] = window;
    write({ quiet: next });
  };
  const firstOn = DAYS.find((day) => quiet[day] !== undefined);
  const example = firstOn === undefined ? null : quiet[firstOn]!;

  return (
    <section className={cardClass} aria-labelledby="quiet-title" data-testid="quiet-hours">
      <CardHead
        id="quiet-title"
        icon={<MoonStar />}
        title={t('quietHours.title', 'Quiet hours')}
        lead={
          on
            ? t('quietHours.leadOn', 'In these hours a notice still shows in the bell, without a sound. Only its e-mail waits, and goes when they end. Something a rule marks urgent is sent at once.')
            : t('quietHours.leadOff', 'Off. Notices and their e-mails arrive as they happen.')
        }
        on={on}
        // Switched on with no hours yet: every evening. Off keeps the hours for next time.
        onSwitch={(next) => write(next && data.quiet === null ? { quietOn: true, quiet: Object.fromEntries(DAYS.map((day) => [day, DEFAULT_WINDOW])) } : { quietOn: next })}
        testId="quiet"
      />

      {!on ? null : (
        <div className="mt-4 flex flex-col gap-4">
          <label className="flex max-w-[360px] flex-col gap-1.5">
            <span className="text-[11.5px] font-bold">{t('quietHours.zone', 'Your time zone')}</span>
            <Select value={data.timezone ?? ''} onChange={(event) => write({ timezone: event.target.value === '' ? null : event.target.value })} data-testid="quiet-zone">
              <option value="">{t('quietHours.zoneDefault', 'The business’s ({zone})', { zone: data.fallbackTimezone })}</option>
              {data.timezone !== null && !allZones.includes(data.timezone) ? <option value={data.timezone}>{data.timezone}</option> : null}
              {allZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </label>

          <fieldset>
            <legend className="mb-1.5 text-[11.5px] font-bold">{t('quietHours.days', 'Days and times')}</legend>
            <ul className="flex flex-col gap-1.5" data-part="days">
              {DAYS.map((day) => {
                const window = quiet[day];
                const name = dayName(day, locale);
                return (
                  <li key={day} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[11px] border border-border px-3 py-2" data-day={day}>
                    <label className="flex min-w-[130px] flex-1 cursor-pointer items-center gap-2.5 text-[12.5px] font-semibold">
                      <Checkbox
                        checked={window !== undefined}
                        onCheckedChange={(next) => setDay(day, next === true ? (example ?? DEFAULT_WINDOW) : null)}
                        data-testid={`quiet-day-${day}`}
                      />
                      {name}
                    </label>
                    {/* An unticked day's times are disabled inputs, which say so themselves: no dimming of the words around them, which would fall under the contrast the page keeps. */}
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-fg-subtle" aria-hidden>
                        {t('quietHours.fromShort', 'From')}
                      </span>
                      <Input
                        type="time"
                        className="w-[112px]"
                        value={window?.from ?? ''}
                        disabled={window === undefined}
                        aria-label={t('quietHours.from', 'Quiet from, {day}', { day: name })}
                        onChange={(event) => window !== undefined && event.target.value !== '' && setDay(day, { ...window, from: event.target.value })}
                      />
                      <span className="text-xs text-fg-subtle" aria-hidden>
                        {t('quietHours.toShort', 'to')}
                      </span>
                      <Input
                        type="time"
                        className="w-[112px]"
                        value={window?.to ?? ''}
                        disabled={window === undefined}
                        aria-label={t('quietHours.to', 'Quiet until, {day}', { day: name })}
                        onChange={(event) => window !== undefined && event.target.value !== '' && setDay(day, { ...window, to: event.target.value })}
                      />
                      {window !== undefined && window.to <= window.from ? (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted">{t('quietHours.endsOn', 'ends {day}', { day: dayName(nextDay(day), locale) })}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {firstOn === undefined ? null : (
              <div className="mt-2">
                <Button variant="ghost" size="sm" iconLeft={<Copy className="size-3.5" />} onClick={() => write({ quiet: Object.fromEntries(DAYS.map((day) => [day, quiet[firstOn]!])) })} data-testid="quiet-copy">
                  {t('quietHours.copy', 'Use {day}’s times every day', { day: dayName(firstOn, locale) })}
                </Button>
              </div>
            )}
          </fieldset>

          {firstOn === undefined || example === null ? null : (
            <p className="text-[12.5px] text-fg-muted" data-testid="quiet-example">
              {t('quietHours.example', 'An e-mail that comes at {from} on {day} is sent at {to} on {endDay}, unless its kind is ticked below.', {
                from: example.from,
                day: dayName(firstOn, locale),
                to: example.to,
                endDay: dayName(example.to <= example.from ? nextDay(firstOn) : firstOn, locale),
              })}
            </p>
          )}

          {prefs.data === undefined || prefs.data.events.length === 0 ? null : (
            <fieldset data-part="always">
              <legend className="mb-1.5 text-[11.5px] font-bold">{t('quietHours.always', 'Still tell me at once about…')}</legend>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {prefs.data.events.map((event) => (
                  <li key={event.key}>
                    <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px]">
                      <Checkbox checked={event.channels.always === true} onCheckedChange={(next) => always.mutate({ key: event.key, on: next === true })} />
                      <span>{eventLabel(event.key)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[12px] text-fg-subtle">{t('quietHours.alwaysNote', 'Summaries keep their own day and time, below.')}</p>
            </fieldset>
          )}
        </div>
      )}
      {error === null && always.error === null ? null : (
        <p role="alert" className="mt-2.5 text-[12.5px] text-danger">
          {(error ?? always.error)?.message}
        </p>
      )}
    </section>
  );
}

export function SummariesCard(): ReactNode {
  useCommonWords();
  const { data, write, error } = useSchedule();
  const locale = pageLocale();
  if (data === undefined) return null;
  const on = data.summariesOn;
  return (
    <section className={cardClass} aria-labelledby="summaries-title" data-testid="summaries">
      <CardHead
        id="summaries-title"
        icon={<Mail />}
        title={t('quietHours.summariesTitle', 'Summaries')}
        lead={
          on
            ? t('quietHours.summariesLead', 'E-mails a rule sends you with your own rows, such as a weekly digest. Each is an e-mail: in your quiet hours it waits like any other.')
            : t('quietHours.summariesOff', 'Off. No rule sends you a summary. Your day and time are kept for when you switch them on.')
        }
        on={on}
        onSwitch={(next) => write({ summariesOn: next })}
        testId="summaries"
      />
      {!on ? null : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <span className="text-[11.5px] font-bold">{t('quietHours.digestDay', 'Day')}</span>
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
            <span className="text-[11.5px] font-bold">{t('quietHours.digestTime', 'Time')}</span>
            <Input
              type="time"
              className="w-[124px]"
              value={data.digestTime ?? ''}
              onChange={(event) => write({ digestTime: event.target.value === '' ? null : event.target.value })}
              data-testid="digest-time"
            />
          </label>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="mt-2.5 text-[12.5px] text-danger">
          {error.message}
        </p>
      )}
    </section>
  );
}
