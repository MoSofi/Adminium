// @vitest-environment happy-dom
/**
 * page-calendar template tests (09-generated-app.md §7.6): record-list rows
 * map onto the month grid via the stored `startColumn`/`titleColumn`
 * vocabulary, day select drives the agenda, agenda/upcoming rows emit
 * record-open, the inline composer inserts on the selected day, legend chips
 * filter, the toolbar range picker publishes `dateRange.*` params, and the
 * invalid-layout branch never crashes.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageCalendar, calendarEventsOf, calendarItemConfigOf } from './PageCalendar.js';

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
    const events = calendarEventsOf({ rows: ROWS, total: 3 }, cfg);
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
      <PageCalendar config={calendarPage()} states={{ 'cal-1': recordList(ROWS) }} referenceDate={TODAY} />,
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
        <PageCalendar config={calendarPage()} states={{ 'cal-1': recordList(ROWS) }} referenceDate={TODAY} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Termin hinzufügen' })).toBeDefined();

    cleanup();
    render(
      <PageCalendar config={calendarPage()} states={{ 'cal-1': recordList(ROWS) }} referenceDate={TODAY} />,
    );
    expect(screen.getByRole('button', { name: 'Add event' })).toBeDefined();
  });
});
