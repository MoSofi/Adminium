// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK CAL `calendar` family stories (annex §5): each widget's loaded variant,
 * the four WidgetFrame states through WidgetHost (acceptance #4), and light/dark
 * × LTR/RTL matrices (acceptance #9). The 7-column month grid and the
 * resource×day schedule grid are logical CSS grids, so a `dir="rtl"` wrapper
 * genuinely reverses the column order (real mirroring, not a bare attribute).
 * Widgets resolve through a LOCAL registry override so stories work before the
 * green loop merges the definitions into the global map. Payloads are the same
 * seeded generators `demoData` uses.
 */
import type { ReactNode } from 'react';

import { calendarMonthDemoData } from './CalendarMonth.js';
import { capacityBoardDemoData } from './CapacityBoard.js';
import {
  calendarMonthDefinition,
  capacityBoardDefinition,
  dayAgendaDefinition,
  scheduleMatrixDefinition,
} from './calendar-track.definitions.js';
import { dayAgendaDemoData } from './DayAgenda.js';
import { scheduleMatrixDemoData } from './ScheduleMatrix.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const definitions: WidgetDefinition[] = [
  calendarMonthDefinition,
  dayAgendaDefinition,
  scheduleMatrixDefinition,
  capacityBoardDefinition,
];
const registry = buildRegistry(definitions);

const meta = { title: 'Widgets/Calendar' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
  width = 'w-[30rem]',
) {
  return (
    <div className={width}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('TABLE_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="flex flex-wrap items-start gap-4 bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

const monthConfig = { title: 'Team calendar', year: 2026, month: 6 };
const agendaConfig = { title: 'Today', date: '2026-07-15' };
const agendaAr = { title: 'اليوم', date: '2026-07-15', format: { locale: 'ar-EG' } };
const scheduleConfig = { title: 'Shift schedule' };
const capacityConfig = { title: 'Team workload', capacity: 40 };

export const CalendarMonthStory = {
  name: 'calendar-month',
  render: () => host('calendar-month', 's-month', monthConfig, calendarMonthDemoData(7), 'success', 'w-[40rem]'),
};

export const DayAgendaStory = {
  name: 'day-agenda',
  render: () => host('day-agenda', 's-agenda', agendaConfig, dayAgendaDemoData(4), 'success', 'w-[22rem]'),
};

export const ScheduleMatrixStory = {
  name: 'schedule-matrix',
  render: () => host('schedule-matrix', 's-sched', scheduleConfig, scheduleMatrixDemoData(7), 'success', 'w-[52rem]'),
};

export const CapacityBoardStory = {
  name: 'capacity-board',
  render: () => host('capacity-board', 's-cap', capacityConfig, capacityBoardDemoData(3), 'success', 'w-[40rem]'),
};

/** All four WidgetFrame states side by side (loaded · skeleton · empty · error). */
export const States = {
  render: () => (
    <Frame>
      {host('calendar-month', 'st-loaded', monthConfig, calendarMonthDemoData(7), 'success', 'w-[34rem]')}
      {host('calendar-month', 'st-skeleton', monthConfig, undefined, 'loading', 'w-[34rem]')}
      {host('calendar-month', 'st-empty', { ...monthConfig, emptyState: { titleKey: 'Nothing scheduled' } }, { events: [] }, 'success', 'w-[34rem]')}
      {host('calendar-month', 'st-error', monthConfig, undefined, 'error', 'w-[34rem]')}
    </Frame>
  ),
};

/** Day-agenda four states (list skeleton silhouette). */
export const AgendaStates = {
  render: () => (
    <Frame>
      {host('day-agenda', 'ast-loaded', agendaConfig, dayAgendaDemoData(4), 'success', 'w-[22rem]')}
      {host('day-agenda', 'ast-skeleton', agendaConfig, undefined, 'loading', 'w-[22rem]')}
      {host('day-agenda', 'ast-empty', { ...agendaConfig, emptyState: { titleKey: 'Nothing scheduled' } }, { events: [] }, 'success', 'w-[22rem]')}
      {host('day-agenda', 'ast-error', agendaConfig, undefined, 'error', 'w-[22rem]')}
    </Frame>
  ),
};

/** calendar-month light/dark × LTR/RTL — the 7-col grid mirrors under rtl. */
export const CalendarThemeMatrix = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Frame dir="ltr">{host('calendar-month', 'm-l-ltr', monthConfig, calendarMonthDemoData(7), 'success', 'w-[34rem]')}</Frame>
      <Frame dir="rtl">{host('calendar-month', 'm-l-rtl', { ...monthConfig, title: 'تقويم الفريق', format: { locale: 'ar-EG' } }, calendarMonthDemoData(7), 'success', 'w-[34rem]')}</Frame>
      <Frame dark dir="ltr">{host('calendar-month', 'm-d-ltr', monthConfig, calendarMonthDemoData(7), 'success', 'w-[34rem]')}</Frame>
      <Frame dark dir="rtl">{host('calendar-month', 'm-d-rtl', { ...monthConfig, title: 'تقويم الفريق', format: { locale: 'ar-EG' } }, calendarMonthDemoData(7), 'success', 'w-[34rem]')}</Frame>
    </div>
  ),
};

/** schedule-matrix light/dark × LTR/RTL — resource + day columns mirror. */
export const ScheduleThemeMatrix = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Frame dir="ltr">{host('schedule-matrix', 'sm-l-ltr', scheduleConfig, scheduleMatrixDemoData(7), 'success', 'w-[52rem]')}</Frame>
      <Frame dir="rtl">{host('schedule-matrix', 'sm-l-rtl', { ...scheduleConfig, title: 'جدول الورديات', format: { locale: 'ar-EG' } }, scheduleMatrixDemoData(7), 'success', 'w-[52rem]')}</Frame>
      <Frame dark dir="ltr">{host('schedule-matrix', 'sm-d-ltr', scheduleConfig, scheduleMatrixDemoData(7), 'success', 'w-[52rem]')}</Frame>
      <Frame dark dir="rtl">{host('schedule-matrix', 'sm-d-rtl', { ...scheduleConfig, title: 'جدول الورديات', format: { locale: 'ar-EG' } }, scheduleMatrixDemoData(7), 'success', 'w-[52rem]')}</Frame>
    </div>
  ),
};

/** capacity-board + RTL day-agenda light/dark matrix. */
export const CapacityThemeMatrix = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Frame dir="ltr">{host('capacity-board', 'cb-l-ltr', capacityConfig, capacityBoardDemoData(3), 'success', 'w-[40rem]')}</Frame>
      <Frame dir="rtl">{host('capacity-board', 'cb-l-rtl', { ...capacityConfig, title: 'عبء عمل الفريق' }, capacityBoardDemoData(3), 'success', 'w-[40rem]')}</Frame>
      <Frame dark dir="ltr">{host('day-agenda', 'cb-d-ltr', agendaConfig, dayAgendaDemoData(4), 'success', 'w-[22rem]')}</Frame>
      <Frame dark dir="rtl">{host('day-agenda', 'cb-d-rtl', agendaAr, dayAgendaDemoData(4), 'success', 'w-[22rem]')}</Frame>
    </div>
  ),
};
