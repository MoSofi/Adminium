// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * page-calendar template tests: record-list rows map onto the month grid via
 * the stored `startColumn`/`titleColumn` vocabulary, day select drives the
 * agenda, agenda/upcoming rows emit record-open, the inline composer inserts
 * on the selected day, legend chips filter, the toolbar range picker
 * publishes `dateRange.*` params, and the invalid-layout branch never
 * crashes.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageCalendar, calendarEventsOf, calendarItemConfigOf } from './PageCalendar.js';
import {
  dayStartValue,
  planningDateKindOf,
  splitInstant,
  todayIso,
  zoneMidnightInstant,
} from '../planning/planning-lib.js';

afterEach(cleanup);

const CONN = 'conn_1';
const TODAY = '2026-07-15';

const BINDING = {
  kind: 'table-query',
  connectionId: CONN,
  source: { schema: 'public', name: 'releases', type: 'table' },
  shape: 'calendar-events',
  limit: 500,
};

const CAL_CONFIG = {
  title: 'Releases',
  startColumn: 'released_at',
  titleColumn: 'title',
  binding: BINDING,
};

const ROWS = [
  { id: 'R-1', title: 'Billing service', released_at: '2026-07-15T10:00:00Z', category: 'release' },
  { id: 'R-2', title: 'Search reindex', released_at: '2026-07-16T22:00:00Z', category: 'maintenance' },
  { id: 'R-3', title: 'Quarterly review', released_at: '2026-07-16', category: 'meeting' },
];

const recordList = (rows: Record<string, unknown>[]) => ({
  status: 'success' as const,
  data: { rows, columns: [], total: rows.length },
});

function calendarPage(extraItems: Record<string, unknown>[] = [], toolbar: string[] = []) {
  return {
    templateVersion: 1,
    toolbar,
    overlays: [],
    layout: {
      version: 1,
      items: [
        { i: 'cal-1', widget: 'calendar-month', x: 0, y: 3, w: 8, h: 12, config: CAL_CONFIG },
        { i: 'agenda-1', widget: 'day-agenda', x: 8, y: 3, w: 4, h: 12, config: { ...CAL_CONFIG, title: 'Agenda' } },
        ...extraItems,
      ],
    },
  };
}

describe('calendarEventsOf', () => {
  it('maps record-list rows through the stored column vocabulary', () => {
    const cfg = calendarItemConfigOf(CAL_CONFIG);
    const events = calendarEventsOf({ rows: ROWS, total: 3 }, cfg, 'UTC');
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ id: 'R-1', date: '2026-07-15', time: '10:00', title: 'Billing service' });
    expect(events[2]?.time).toBeUndefined(); // date-only column
  });

  it('passes a true calendar-events envelope through unchanged', () => {
    const cfg = calendarItemConfigOf(CAL_CONFIG);
    const events = calendarEventsOf({ events: [{ date: '2026-07-01', title: 'Direct' }] }, cfg);
    expect(events).toEqual([{ date: '2026-07-01', title: 'Direct' }]);
  });
});

describe('PageCalendar', () => {
  it('renders mapped events as chips on the month grid', () => {
    render(
      <PageCalendar config={calendarPage()} states={{ 'cal-1': recordList(ROWS) }} referenceDate={TODAY} timeZone="UTC" />,
    );
    const day = screen.getByRole('gridcell', { name: '2026-07-15' });
    expect(within(day).getByText('Billing service')).toBeDefined();
  });

  it('day select drives the agenda pane; agenda rows emit record-open', () => {
    const onEvent = vi.fn();
    render(
      <PageCalendar
        config={calendarPage()}
        states={{ 'cal-1': recordList(ROWS) }}
        referenceDate={TODAY}
        timeZone="UTC"
        onEvent={onEvent}
      />,
    );
    // Today is preselected: its event is on the agenda.
    expect(screen.getByRole('button', { name: /Billing service/ })).toBeDefined();
    fireEvent.click(screen.getByRole('gridcell', { name: '2026-07-16' }));
    fireEvent.click(screen.getByRole('button', { name: /Search reindex/ }));
    expect(onEvent).toHaveBeenCalledWith('cal-1', {
      type: 'record-open',
      connectionId: CONN,
      table: 'public.releases',
      recordId: 'R-2',
    });
  });

  it('the agenda composer inserts on the selected day', () => {
    const onEvent = vi.fn();
    render(
      <PageCalendar
        config={calendarPage()}
        states={{ 'cal-1': recordList(ROWS) }}
        referenceDate={TODAY}
        timeZone="UTC"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByRole('gridcell', { name: '2026-07-17' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hotfix rollout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onEvent).toHaveBeenCalledWith('cal-1', {
      type: 'mutate',
      intent: 'insert',
      connectionId: CONN,
      table: 'public.releases',
      values: { title: 'Hotfix rollout', released_at: '2026-07-17' },
    });
  });

  it('legend chips double as filters', () => {
    render(
      <PageCalendar
        config={calendarPage([
          { i: 'legend-1', widget: 'calendar-legend-filter', x: 8, y: 15, w: 4, h: 4, config: {} },
        ])}
        states={{ 'cal-1': recordList(ROWS) }}
        referenceDate={TODAY}
        timeZone="UTC"
      />,
    );
    const day15 = () => screen.getByRole('gridcell', { name: '2026-07-15' });
    expect(within(day15()).getByText('Billing service')).toBeDefined();
    // Uncheck the 'release' category in the legend.
    fireEvent.click(within(screen.getByTestId('legend-slot-legend-1')).getByRole('checkbox', { name: 'release' }));
    expect(within(day15()).queryByText('Billing service')).toBeNull();
  });

  it('upcoming rows emit record-open', () => {
    const onEvent = vi.fn();
    render(
      <PageCalendar
        config={calendarPage([
          { i: 'up-1', widget: 'upcoming-events-list', x: 0, y: 15, w: 8, h: 6, config: {} },
        ])}
        states={{ 'cal-1': recordList(ROWS) }}
        referenceDate={TODAY}
        timeZone="UTC"
        onEvent={onEvent}
      />,
    );
    const upcoming = screen.getByTestId('upcoming-slot-up-1');
    fireEvent.click(within(upcoming).getByText('Search reindex'));
    expect(onEvent).toHaveBeenCalledWith('up-1', expect.objectContaining({ type: 'record-open', recordId: 'R-2' }));
  });

  it('the toolbar range picker publishes dateRange.* params and filters panes', async () => {
    const onParamsChange = vi.fn();
    render(
      <PageCalendar
        config={calendarPage([], ['date-range-picker'])}
        states={{ 'cal-1': recordList(ROWS) }}
        referenceDate={TODAY}
        timeZone="UTC"
        onParamsChange={onParamsChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
    await waitFor(() => {
      expect(screen.getByTestId('calendar-range-picker')).toBeDefined();
    });
    const picker = screen.getByTestId('calendar-range-picker');
    fireEvent.click(within(picker).getByRole('gridcell', { name: '2026-07-16' }));
    fireEvent.click(within(picker).getByRole('gridcell', { name: '2026-07-17' }));
    expect(onParamsChange).toHaveBeenCalledWith({
      'dateRange.start': '2026-07-16',
      'dateRange.end': '2026-07-17',
    });
  });

  it('renders the invalid-layout notice for a corrupt stored config', () => {
    render(<PageCalendar config={{ templateVersion: 1, layout: 'nope' }} />);
    expect(screen.getByTestId('page-calendar-invalid')).toBeDefined();
  });

  it('kpi-row items resolve through WidgetHost demo mode', async () => {
    render(
      <PageCalendar
        config={calendarPage([
          { i: 'kpi-1', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: { title: 'Releases this month' } },
        ])}
        states={{ 'cal-1': recordList(ROWS) }}
        referenceDate={TODAY}
        timeZone="UTC"
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-widget="kpi-stat-card"]')).not.toBeNull();
    });
  });
});

describe('page-calendar chrome localization (ui:templates.calendar.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui' ? { templates: { calendar: { addEvent: 'Termin hinzufügen' } } } : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <PageCalendar config={calendarPage()} states={{ 'cal-1': recordList(ROWS) }} referenceDate={TODAY} timeZone="UTC" />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Termin hinzufügen' })).toBeDefined();

    cleanup();
    render(
      <PageCalendar config={calendarPage()} states={{ 'cal-1': recordList(ROWS) }} referenceDate={TODAY} timeZone="UTC" />,
    );
    expect(screen.getByRole('button', { name: 'Add event' })).toBeDefined();
  });
});

/**
 * Title through a related table: `visits` carries no title of its own, so each
 * event shows the patient's name (a lookup the server projects under the
 * alias), and "Add event" offers the patients instead of a text box — typing a
 * name cannot create a patient, and writing it into the alias would write a
 * column that does not exist.
 */
describe('PageCalendar — title through a related table', () => {
  const LOOKUP = { column: 'patient_id', table: 'public.patients', keyColumn: 'id', labelColumn: 'full_name' };
  const VISIT_CONFIG = {
    title: 'Visits',
    startColumn: 'starts_at',
    titleColumn: 'patient_id__display',
    titleLookup: LOOKUP,
    binding: { ...BINDING, source: { schema: 'public', name: 'visits', type: 'table' } },
  };
  const page = {
    templateVersion: 1,
    toolbar: [],
    overlays: [],
    layout: {
      version: 1,
      items: [
        { i: 'cal-1', widget: 'calendar-month', x: 0, y: 0, w: 8, h: 12, config: VISIT_CONFIG },
        { i: 'agenda-1', widget: 'day-agenda', x: 8, y: 0, w: 4, h: 12, config: VISIT_CONFIG },
      ],
    },
  };
  const VISITS = [{ id: 1, patient_id: 7, patient_id__display: 'Ada Lovelace', starts_at: TODAY }];
  const PATIENTS = [
    { id: 7, full_name: 'Ada Lovelace' },
    { id: 9, full_name: 'Grace Hopper' },
  ];

  it('titles each event with the looked-up name', () => {
    render(
      <PageCalendar config={page} states={{ 'cal-1': recordList(VISITS) }} referenceDate={TODAY} timeZone="UTC" />,
    );
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
  });

  it('adds an event by choosing the related row, writing its KEY with its type', () => {
    const onEvent = vi.fn();
    render(
      <PageCalendar
        config={page}
        states={{ 'cal-1': recordList(VISITS), 'cal-1:choices': recordList(PATIENTS) }}
        referenceDate={TODAY}
        timeZone="UTC"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByRole('gridcell', { name: '2026-07-17' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'What this event is for' }), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onEvent).toHaveBeenCalledWith('cal-1', {
      type: 'mutate',
      intent: 'insert',
      connectionId: CONN,
      table: 'public.visits',
      values: { patient_id: 9, starts_at: '2026-07-17' },
    });
  });

  it('offers no composer until the choices have loaded', () => {
    render(
      <PageCalendar
        config={page}
        states={{ 'cal-1': recordList(VISITS), 'cal-1:choices': { status: 'loading' } }}
        referenceDate={TODAY}
        timeZone="UTC"
        onEvent={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
  });
});

/**
 * The empty-page hint (D2). A date column just added to a populated table
 * leaves every row undated, and the page must say so rather than look broken.
 * Paired with the controls: dated rows, a partly-dated table, and no rows at
 * all stay quiet.
 */
describe('PageCalendar — rows with no date', () => {
  const UNDATED = [
    { id: 'R-1', title: 'Billing service', released_at: null },
    { id: 'R-2', title: 'Search reindex', released_at: null },
  ];

  it('says none of the rows has a date when every row lacks one', () => {
    render(<PageCalendar config={calendarPage()} states={{ 'cal-1': recordList(UNDATED) }} referenceDate={TODAY} timeZone="UTC" />);
    expect(screen.getByTestId('calendar-unplaced-rows').textContent).toMatch(/has a date yet/);
  });

  it('stays quiet when some rows are dated', () => {
    render(
      <PageCalendar
        config={calendarPage()}
        states={{ 'cal-1': recordList([...UNDATED, ROWS[0] as Record<string, unknown>]) }}
        referenceDate={TODAY}
        timeZone="UTC"
      />,
    );
    expect(screen.queryByTestId('calendar-unplaced-rows')).toBeNull();
  });

  it('stays quiet for an empty table, and while loading', () => {
    const { unmount } = render(
      <PageCalendar config={calendarPage()} states={{ 'cal-1': recordList([]) }} referenceDate={TODAY} timeZone="UTC" />,
    );
    expect(screen.queryByTestId('calendar-unplaced-rows')).toBeNull();
    unmount();
    render(<PageCalendar config={calendarPage()} states={{ 'cal-1': { status: 'loading' } }} referenceDate={TODAY} timeZone="UTC" />);
    expect(screen.queryByTestId('calendar-unplaced-rows')).toBeNull();
  });
});

/**
 * The day an event is filed on is its day IN THE RENDERING ZONE. A timestamp
 * crosses the wire as a UTC instant, whose string prefix is the UTC day: an
 * event at 00:30 in Berlin reads `…T22:30:00Z` the day before, and used to
 * land there. And "Add event" into a timestamp column writes the zone's
 * midnight as an instant — a bare date there is midnight in the DATABASE's
 * zone, which came back as the previous day at 10 PM (e2e, postgres, CEST).
 */
describe('PageCalendar — time zones', () => {
  const BERLIN = 'Europe/Berlin';
  const SEP_21 = '2026-09-21';
  const cfg = calendarItemConfigOf(CAL_CONFIG);
  /** A record-list payload whose `released_at` has the given logical type. */
  const payload = (rows: Record<string, unknown>[], logicalType: string) => ({
    rows,
    columns: [
      { name: 'id', logicalType: 'text', nullable: false, isPrimaryKey: true },
      { name: 'title', logicalType: 'text', nullable: true, isPrimaryKey: false },
      { name: 'released_at', logicalType, nullable: true, isPrimaryKey: false },
    ],
    total: rows.length,
  });
  /** One event stored at `releasedAt`. */
  const one = (releasedAt: unknown, logicalType: string) =>
    payload([{ id: 'E-1', title: 'Early standup', released_at: releasedAt }], logicalType);
  const eventIn = (data: unknown, zone: string) => calendarEventsOf(data, cfg, zone)[0];

  it('files a UTC instant just before midnight on the rendering zone’s day', () => {
    const data = one('2026-09-20T22:30:00.000Z', 'timestamptz');
    expect(eventIn(data, BERLIN)).toMatchObject({ date: SEP_21, time: '00:30' });
    // The same instant west of UTC is still the 20th — later in the evening.
    expect(eventIn(data, 'America/New_York')).toMatchObject({ date: '2026-09-20', time: '18:30' });
    expect(eventIn(data, 'UTC')).toMatchObject({ date: '2026-09-20', time: '22:30' });
  });

  it('converts an offset instant too, not only a Z one', () => {
    const data = { rows: [{ id: 'E-1', title: 'Late call', released_at: '2026-09-21T01:15:00+05:30' }] };
    expect(eventIn(data, BERLIN)).toMatchObject({ date: '2026-09-20', time: '21:45' });
  });

  it('reads a zone-less wall clock as written (SQLite text)', () => {
    const data = one('2026-09-21 23:30:00', 'timestamp');
    expect(eventIn(data, 'America/New_York')).toMatchObject({ date: SEP_21, time: '23:30' });
  });

  it('never moves a date column by the viewer’s zone', () => {
    // postgres DATE '2026-09-21' read on a UTC+2 server: its local midnight, as UTC.
    const data = one('2026-09-20T22:00:00.000Z', 'date');
    for (const zone of [BERLIN, 'UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
      const event = eventIn(data, zone);
      expect(event).toMatchObject({ date: SEP_21 });
      expect(event?.time).toBeUndefined();
    }
  });

  it('shows the near-midnight event on today’s grid cell and agenda, not yesterday’s', () => {
    render(
      <PageCalendar
        config={calendarPage()}
        states={{
          'cal-1': { status: 'success', data: one('2026-09-20T22:30:00.000Z', 'timestamptz') },
        }}
        referenceDate={SEP_21}
        timeZone={BERLIN}
      />,
    );
    const today = screen.getByRole('gridcell', { name: SEP_21 });
    const yesterday = screen.getByRole('gridcell', { name: '2026-09-20' });
    expect(within(today).getByText('Early standup')).toBeDefined();
    expect(within(yesterday).queryByText('Early standup')).toBeNull();
    // Today is preselected, so the agenda lists it.
    expect(screen.getByRole('button', { name: /Early standup/ })).toBeDefined();
  });

  /** "Add event" on today (Sep 21, Berlin); returns what it wrote to `released_at`. */
  const composeOnToday = (logicalType: string): unknown => {
    const onEvent = vi.fn();
    render(
      <PageCalendar
        config={calendarPage()}
        states={{ 'cal-1': { status: 'success', data: payload([], logicalType) } }}
        referenceDate={SEP_21}
        timeZone={BERLIN}
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First visit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const event = onEvent.mock.calls[0]?.[1] as { values: Record<string, unknown> };
    return event.values['released_at'];
  };

  it('"Add event" writes the zone’s midnight as an instant into a timestamp column', () => {
    const written = composeOnToday('timestamptz');
    expect(written).toBe('2026-09-20T22:00:00.000Z');
    // …which reads back on the day it was added.
    expect(eventIn(one(written, 'timestamptz'), BERLIN)).toMatchObject({ date: SEP_21 });
  });

  it('"Add event" writes the plain day into a date column', () => {
    expect(composeOnToday('date')).toBe(SEP_21);
  });
});

describe('planning date helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('todayIso is today in the rendering zone', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-20T22:30:00Z'));
    expect(todayIso('Europe/Berlin')).toBe('2026-09-21');
    expect(todayIso('UTC')).toBe('2026-09-20');
    expect(todayIso('America/Los_Angeles')).toBe('2026-09-20');
  });

  it('zoneMidnightInstant follows DST on both change days', () => {
    expect(zoneMidnightInstant('2026-09-21', 'Europe/Berlin')).toBe('2026-09-20T22:00:00.000Z');
    expect(zoneMidnightInstant('2026-03-29', 'Europe/Berlin')).toBe('2026-03-28T23:00:00.000Z');
    expect(zoneMidnightInstant('2026-10-25', 'Europe/Berlin')).toBe('2026-10-24T22:00:00.000Z');
    expect(zoneMidnightInstant('2026-09-21', 'America/New_York')).toBe('2026-09-21T04:00:00.000Z');
    expect(zoneMidnightInstant('2026-09-21', 'UTC')).toBe('2026-09-21T00:00:00.000Z');
  });

  it('a day whose midnight DST skips still starts on that day', () => {
    // Chile springs forward AT midnight in early September.
    const zone = 'America/Santiago';
    for (const day of ['2026-09-05', '2026-09-06', '2026-09-07']) {
      const instant = zoneMidnightInstant(day, zone);
      expect(splitInstant(instant, { timeZone: zone, kind: 'instant' })?.day).toBe(day);
    }
  });

  it('dayStartValue keeps the plain day unless the column is a timestamp', () => {
    const zone = 'Europe/Berlin';
    expect(dayStartValue('2026-09-21', { timeZone: zone })).toBe('2026-09-21');
    expect(dayStartValue('2026-09-21', { timeZone: zone, kind: 'date' })).toBe('2026-09-21');
    expect(dayStartValue('2026-09-21', { timeZone: zone, kind: 'instant' })).toBe(
      '2026-09-20T22:00:00.000Z',
    );
  });

  it('planningDateKindOf reads the payload’s column metadata', () => {
    const data = {
      rows: [],
      columns: [
        { name: 'a', logicalType: 'date' },
        { name: 'b', logicalType: 'timestamp' },
        { name: 'c', logicalType: 'text' },
      ],
    };
    expect(planningDateKindOf(data, 'a')).toBe('date');
    expect(planningDateKindOf(data, 'b')).toBe('instant');
    expect(planningDateKindOf(data, 'c')).toBeUndefined();
    expect(planningDateKindOf({ rows: [] }, 'a')).toBeUndefined();
  });
});

/**
 * The answer names a category's and a status's words, read in the reader's
 * language: the legend, the agenda-side lists and the status pill say
 * "Freigabe", not `release`. The raw value stays the key the colours and the
 * legend's filter go by.
 */
describe('PageCalendar — the answer’s words for a category and a status', () => {
  const ROWS_WITH_STATUS = ROWS.map((row, index) => ({ ...row, status: index === 1 ? 'at_risk' : 'scheduled' }));
  const served = {
    'cal-1': {
      status: 'success' as const,
      data: {
        rows: ROWS_WITH_STATUS,
        total: ROWS_WITH_STATUS.length,
        columns: [
          { name: 'category', logicalType: 'enum', nullable: true, isPrimaryKey: false, enumLabels: { release: 'Freigabe', maintenance: 'Wartung' } },
          { name: 'status', logicalType: 'enum', nullable: true, isPrimaryKey: false, enumLabels: { at_risk: 'Gefährdet' }, enumTones: { at_risk: 'danger' } },
        ],
      },
    },
  };

  it('carries the words beside the raw values', () => {
    const events = calendarEventsOf(served['cal-1'].data, calendarItemConfigOf(CAL_CONFIG), 'UTC');
    expect(events[0]).toMatchObject({ category: 'release', categoryLabel: 'Freigabe', status: 'scheduled' });
    expect(events[0]?.statusLabel).toBeUndefined();
    expect(events[1]).toMatchObject({ category: 'maintenance', categoryLabel: 'Wartung', status: 'at_risk', statusLabel: 'Gefährdet', statusTone: 'danger' });
    expect(events[2]?.categoryLabel).toBeUndefined();
  });

  it('the legend names a category in the reader’s words and still filters by its value', () => {
    render(
      <PageCalendar
        config={calendarPage([{ i: 'legend-1', widget: 'calendar-legend-filter', x: 8, y: 15, w: 4, h: 4, config: {} }])}
        states={served}
        referenceDate={TODAY}
        timeZone="UTC"
      />,
    );
    const legend = screen.getByTestId('legend-slot-legend-1');
    expect(within(legend).getByText('Freigabe')).toBeDefined();
    expect(within(legend).getByText('meeting')).toBeDefined();
    const day15 = () => screen.getByRole('gridcell', { name: '2026-07-15' });
    fireEvent.click(within(legend).getByRole('checkbox', { name: 'Freigabe' }));
    expect(within(day15()).queryByText('Billing service')).toBeNull();
  });

  it('an upcoming row names its category and its status in the reader’s words', () => {
    render(
      <PageCalendar
        config={calendarPage([{ i: 'up-1', widget: 'upcoming-events-list', x: 0, y: 15, w: 8, h: 6, config: {} }])}
        states={served}
        referenceDate={TODAY}
        timeZone="UTC"
      />,
    );
    const upcoming = screen.getByTestId('upcoming-slot-up-1');
    expect(within(upcoming).getByText('Wartung')).toBeDefined();
    expect(within(upcoming).getByText('Gefährdet').closest('[data-tone]')?.getAttribute('data-tone')).toBe('danger');
    expect(within(upcoming).queryByText('at_risk')).toBeNull();
  });
});
