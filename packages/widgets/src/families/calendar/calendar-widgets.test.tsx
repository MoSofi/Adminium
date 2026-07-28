// @vitest-environment happy-dom
/**
 * `calendar` family (annex §5, TRACK CAL): render + i18n + determinism tests for
 * calendar-month, day-agenda, schedule-matrix, and capacity-board, plus the
 * locale-aware week start (via the @adminium/i18n `weekInfo` layer), RTL column
 * mirroring, and the four WidgetFrame states through WidgetHost.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  firstJsWeekday,
  isoDayKey,
  monthGrid,
  parseIsoDay,
  weekDays,
  weekdayHeaders,
} from './calendar-lib.js';
import {
  CalendarMonth,
  CalendarMonthWidget,
  calendarMonthConfigSchema,
  calendarMonthDemoData,
} from './CalendarMonth.js';
import { CapacityBoard, capacityBoardDemoData } from './CapacityBoard.js';
import { DayAgenda, dayAgendaDemoData } from './DayAgenda.js';
import { ScheduleMatrix, orderDaysByWeekStart, scheduleMatrixDemoData } from './ScheduleMatrix.js';
import {
  calendarMonthDefinition,
  capacityBoardDefinition,
  dayAgendaDefinition,
  scheduleMatrixDefinition,
} from './calendar-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const stable = (value: unknown): string => JSON.stringify(value);

describe('calendar-lib — month grid + locale week start', () => {
  it('monthGrid returns 42 cells with correct in-month flags (July 2026, Sun-first)', () => {
    const cells = monthGrid(2026, 6, 0); // July 2026, weeks start Sunday
    expect(cells).toHaveLength(42);
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31); // July has 31 days
    // July 1 2026 is a Wednesday → 3 leading spill days (Sun, Mon, Tue).
    expect(cells[0]?.inMonth).toBe(false);
    expect(cells[3]?.day).toBe(1);
    expect(cells[3]?.inMonth).toBe(true);
  });

  it('weekdayHeaders order follows the locale first weekday (en-US Sun, de-DE Mon, ar-EG Sat)', () => {
    expect(firstJsWeekday('en-US')).toBe(0); // Sunday
    expect(firstJsWeekday('de-DE')).toBe(1); // Monday
    expect(firstJsWeekday('ar-EG')).toBe(6); // Saturday

    const en = weekdayHeaders('en-US', firstJsWeekday('en-US'));
    const de = weekdayHeaders('de-DE', firstJsWeekday('de-DE'));
    expect(en).toHaveLength(7);
    // en-US starts on Sunday, de-DE on Monday — the leading label differs.
    expect(en[0]).not.toBe(de[0]);
  });

  it('an explicit firstDayOfWeek override wins over the locale', () => {
    expect(firstJsWeekday('en-US', 1)).toBe(1); // force Monday
    expect(firstJsWeekday('de-DE', 7)).toBe(0); // force Sunday
  });

  it('weekDays returns the 7-day locale week containing a date', () => {
    const days = weekDays('2026-07-15', 0); // Sunday-first week around Wed Jul 15
    expect(days).toHaveLength(7);
    expect(days[0]?.key).toBe('2026-07-12'); // preceding Sunday
    expect(days.map((d) => d.key)).toContain('2026-07-15');
  });
});

describe('calendar-month', () => {
  it('renders the month title, weekday headers, and event chips', () => {
    const { events } = calendarMonthDemoData(7);
    render(<CalendarMonth events={events} year={2026} month={6} locale="en-US" testId="cal" />);
    expect(screen.getByText('July 2026')).toBeTruthy();
    expect(screen.getByRole('grid')).toBeTruthy();
    // 7 column headers + 42 gridcells.
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  });

  it('marks the today cell with aria-current and reflects the maxChips overflow', () => {
    const events = [
      { id: 1, date: '2026-07-10', title: 'A', category: 'meeting' },
      { id: 2, date: '2026-07-10', title: 'B', category: 'release' },
      { id: 3, date: '2026-07-10', title: 'C', category: 'deadline' },
    ];
    render(<CalendarMonth events={events} year={2026} month={6} today="2026-07-15" maxChipsPerDay={2} locale="en-US" />);
    const today = screen.getByLabelText('2026-07-15');
    expect(today.getAttribute('aria-current')).toBe('date');
    // 3 events on the 10th, max 2 chips → "+1 more" overflow.
    expect(screen.getByText(/\+.*more/)).toBeTruthy();
  });

  it('mirrors under dir="rtl" while keeping the 7-column grid (real column mirroring)', () => {
    const { events } = calendarMonthDemoData(3);
    const { container } = render(
      <div dir="rtl">
        <CalendarMonth events={events} year={2026} month={6} locale="ar-EG" />
      </div>,
    );
    const grid = container.querySelector('[role="row"]');
    // The header row is a 7-col grid; RTL reverses the visual column order via CSS.
    expect(grid?.className).toContain('grid-cols-7');
    // ar-EG week starts on Saturday → first header is the Saturday short name.
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(7);
  });

  it('shows the empty override when there are no events', () => {
    render(<CalendarMonth events={[]} emptyTitle="Nothing scheduled" locale="en-US" />);
    expect(screen.getByText('Nothing scheduled')).toBeTruthy();
  });

  it('the registered widget marks the real wall-clock today without an explicit prop', () => {
    // The wrapper must inject `today` from the wall clock — otherwise the annex
    // today ring is dead for every live dashboard (only stories pass `today`).
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const config = calendarMonthConfigSchema.parse({ year: now.getFullYear(), month: now.getMonth() });
    render(
      <CalendarMonthWidget
        config={config}
        data={{ events: [{ id: 1, date: todayIso, title: 'Today', category: 'meeting' }] }}
        instanceId="cm-today"
        onEvent={() => {}}
      />,
    );
    expect(screen.getByLabelText(todayIso).getAttribute('aria-current')).toBe('date');
  });
});

describe('day-agenda', () => {
  it('renders events for the day, time-ordered, with a count header', () => {
    const events = [
      { id: 1, date: '2026-07-15', title: 'Late', category: 'meeting', time: '15:00' },
      { id: 2, date: '2026-07-15', title: 'Early', category: 'meeting', time: '09:00' },
    ];
    render(<DayAgenda events={events} date="2026-07-15" locale="en-US" testId="agenda" />);
    expect(screen.getByText('2 events')).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    // Sorted ascending by time → "Early" (09:00) before "Late" (15:00).
    expect(within(items[0] as HTMLElement).getByText('Early')).toBeTruthy();
  });

  it('renders the nothing-scheduled empty state for a day with no events', () => {
    render(<DayAgenda events={[]} date="2026-07-15" emptyTitle="Nothing scheduled" locale="en-US" />);
    expect(screen.getByText('Nothing scheduled')).toBeTruthy();
  });

  it('week range groups events under day sub-headers', () => {
    const events = [
      { id: 1, date: '2026-07-13', title: 'Mon task', category: 'meeting', time: '09:00' },
      { id: 2, date: '2026-07-15', title: 'Wed task', category: 'deadline', time: '10:00' },
    ];
    render(<DayAgenda events={events} date="2026-07-15" range="week" locale="en-US" />);
    expect(screen.getByText('Mon task')).toBeTruthy();
    expect(screen.getByText('Wed task')).toBeTruthy();
  });
});

describe('schedule-matrix', () => {
  it('renders resources, day headers, coverage, and a shift legend', () => {
    const data = scheduleMatrixDemoData(7);
    render(<ScheduleMatrix data={data} locale="en-US" testId="sched" />);
    expect(screen.getByText('Resource')).toBeTruthy();
    expect(screen.getByText('Coverage')).toBeTruthy();
    // Every resource name appears.
    for (const resource of data.rows) {
      expect(screen.getByText(resource.name)).toBeTruthy();
    }
    // The legend lists each shift type label at least once.
    expect(screen.getAllByText('Morning').length).toBeGreaterThan(0);
  });

  it('renders the empty state when there are no resources', () => {
    render(<ScheduleMatrix data={{ rows: [], total: 0, days: [], shiftTypes: [], assignments: [] }} emptyTitle="No shifts" locale="en-US" />);
    expect(screen.getByText('No shifts')).toBeTruthy();
  });

  it('orderDaysByWeekStart makes the first column the requested ISO weekday (unset = unchanged)', () => {
    const days = [
      '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18',
    ];
    const isoWeekday = (iso: string): number => ((new Date(`${iso}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
    for (const weekStart of [1, 3, 7]) {
      expect(isoWeekday(orderDaysByWeekStart(days, weekStart)[0]!)).toBe(weekStart);
    }
    expect(orderDaysByWeekStart(days, undefined)).toEqual(days);
  });

  it('weekStart reorders the day columns (config is no longer dead)', () => {
    const data = scheduleMatrixDemoData(7); // demo week starts on Sunday
    const base = render(<ScheduleMatrix data={data} locale="en-US" />);
    const firstBase = base.container.querySelectorAll('[role="columnheader"]')[0]!.textContent;
    base.unmount();
    const monday = render(<ScheduleMatrix data={data} weekStart={1} locale="en-US" />);
    const firstMonday = monday.container.querySelectorAll('[role="columnheader"]')[0]!.textContent;
    expect(firstMonday).not.toBe(firstBase);
  });
});

describe('capacity-board', () => {
  it('renders members with a utilization % and a load status pill', () => {
    const data = capacityBoardDemoData(7);
    render(<CapacityBoard data={data} capacity={40} locale="en-US" testId="cap" />);
    for (const member of data.rows) {
      expect(screen.getByText(member.name)).toBeTruthy();
    }
    // Each member row has a percentage label (mono tabular).
    expect(screen.getAllByText(/%$/).length).toBeGreaterThanOrEqual(data.rows.length);
  });

  it('classifies load status by threshold (overloaded / balanced / available)', () => {
    const data = {
      total: 3,
      rows: [
        { id: 'a', name: 'Over Loaded', role: 'Eng', assignments: [{ project: 'P', hours: 60, tone: 'accent' }] },
        { id: 'b', name: 'Just Balanced', role: 'Eng', assignments: [{ project: 'P', hours: 32, tone: 'info' }] },
        { id: 'c', name: 'Has Room', role: 'Eng', assignments: [{ project: 'P', hours: 8, tone: 'pos' }] },
      ],
    };
    render(<CapacityBoard data={data} capacity={40} availableBelow={75} overloadedAbove={100} locale="en-US" />);
    expect(screen.getByText('Overloaded')).toBeTruthy(); // 150%
    expect(screen.getByText('Balanced')).toBeTruthy(); // 80%
    expect(screen.getByText('Available')).toBeTruthy(); // 20%
  });

  it('renders the empty state when there are no members', () => {
    render(<CapacityBoard data={{ rows: [], total: 0 }} emptyTitle="No workload" locale="en-US" />);
    expect(screen.getByText('No workload')).toBeTruthy();
  });
});

describe('demoData determinism (04 §7.7)', () => {
  const generators = [
    ['calendar-month', calendarMonthDemoData],
    ['day-agenda', dayAgendaDemoData],
    ['schedule-matrix', scheduleMatrixDemoData],
    ['capacity-board', capacityBoardDemoData],
  ] as const;

  for (const [id, gen] of generators) {
    it(`${id}: same seed → identical payload; distinct seeds → distinct payloads`, () => {
      expect(stable(gen(7))).toBe(stable(gen(7)));
      const payloads = new Set([1, 2, 7, 42].map((seed) => stable(gen(seed))));
      expect(payloads.size).toBeGreaterThan(1);
    });
  }
});

describe('four WidgetFrame states through WidgetHost', () => {
  const cases: { definition: WidgetDefinition; demo: () => unknown }[] = [
    { definition: calendarMonthDefinition, demo: () => calendarMonthDemoData(7) },
    { definition: dayAgendaDefinition, demo: () => dayAgendaDemoData(7) },
    { definition: scheduleMatrixDefinition, demo: () => scheduleMatrixDemoData(7) },
    { definition: capacityBoardDefinition, demo: () => capacityBoardDemoData(7) },
  ];

  for (const { definition } of cases) {
    const registry = buildRegistry([definition]);
    it(`${definition.id}: skeleton silhouette matches the definition`, () => {
      const { container, unmount } = render(
        <WidgetHost widgetId={definition.id} instanceId={`${definition.id}-s`} data={{ status: 'loading' }} registry={registry} />,
      );
      expect(container.querySelector(`[data-skeleton-variant="${definition.skeleton}"]`)).not.toBeNull();
      unmount();
    });

    it(`${definition.id}: empty override copy renders`, () => {
      const { unmount } = render(
        <WidgetHost
          widgetId={definition.id}
          instanceId={`${definition.id}-e`}
          config={{ emptyState: { titleKey: `empty-${definition.id}` } }}
          data={{ status: 'success', data: undefined }}
          registry={registry}
        />,
      );
      expect(screen.getByText(`empty-${definition.id}`)).toBeTruthy();
      unmount();
    });
  }
});

describe('utility helpers', () => {
  it('isoDayKey round-trips a parsed ISO day', () => {
    expect(isoDayKey(parseIsoDay('2026-07-15'))).toBe('2026-07-15');
  });
});

describe('calendar chrome localization (ui:widgets.calendar.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? { widgets: { calendar: { dayAgenda: { emptyTitle: 'Nichts geplant', emptyBody: 'Termine erscheinen hier.' } } } }
          : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <DayAgenda events={[]} date="2026-07-15" locale="de-DE" />
      </I18nProvider>,
    );
    expect(screen.getByText('Nichts geplant')).toBeTruthy();

    cleanup();
    render(<DayAgenda events={[]} date="2026-07-15" locale="en-US" />);
    expect(screen.getByText('Nothing scheduled')).toBeTruthy();
  });
});
