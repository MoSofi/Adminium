// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A calendar opens on the month today falls in.
 *
 * The month grid used to fall back to a fixed demo month (July 2026) when it
 * was given no month, and the page passed none: a real page with no visits
 * yet opened on July 2026, and one with visits opened on whichever month held
 * most of them. The demo month is now a story's to pass explicitly.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendarMonth } from '../../families/calendar/CalendarMonth.js';
import { PageCalendar } from './PageCalendar.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const CAL_CONFIG = {
  title: 'Appointments',
  startColumn: 'starts_at',
  titleColumn: 'title',
  binding: {
    kind: 'table-query',
    connectionId: 'conn_1',
    source: { schema: 'public', name: 'appointments', type: 'table' },
    shape: 'calendar-events',
    limit: 500,
  },
};

const page = {
  templateVersion: 1,
  toolbar: [],
  overlays: [],
  layout: {
    version: 1,
    items: [
      { i: 'cal-1', widget: 'calendar-month', x: 0, y: 0, w: 8, h: 12, config: CAL_CONFIG },
      { i: 'agenda-1', widget: 'day-agenda', x: 8, y: 0, w: 4, h: 12, config: { ...CAL_CONFIG, title: 'Agenda' } },
    ],
  },
};

const recordList = (rows: Record<string, unknown>[]) => ({
  status: 'success' as const,
  data: { rows, columns: [], total: rows.length },
});

/** Most of the rows are in July; today is in September. */
const JULY_ROWS = [
  { id: 1, title: 'Knee check', starts_at: '2026-07-14T09:30:00Z' },
  { id: 2, title: 'Follow-up', starts_at: '2026-07-21T10:00:00Z' },
  { id: 3, title: 'Review', starts_at: '2026-09-25T11:00:00Z' },
];

describe('page-calendar opens on today', () => {
  it('shows the month today falls in, not the month most rows are in', () => {
    render(<PageCalendar config={page} states={{ 'cal-1': recordList(JULY_ROWS) }} referenceDate="2026-09-24" locale="en-US" timeZone="UTC" />);
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'July 2026' })).toBeNull();
    expect(screen.getByText('Review')).toBeDefined();
  });

  it('with no rows and no reference day, shows the wall clock’s month', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
    render(<PageCalendar config={page} states={{ 'cal-1': recordList([]) }} locale="en-US" timeZone="UTC" />);
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeDefined();
  });

  it('takes today in the calendar’s zone: late on the 31st in New York is still October there', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 02:00 UTC on 1 November is 22:00 on 31 October in New York.
    vi.setSystemTime(new Date('2026-11-01T02:00:00Z'));
    render(<PageCalendar config={page} states={{ 'cal-1': recordList([]) }} locale="en-US" timeZone="America/New_York" />);
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeDefined();
  });
});

describe('calendar-month with no month and no events', () => {
  it('shows the month of the `today` it is given', () => {
    render(<CalendarMonth events={[]} today="2027-02-10" locale="en-US" />);
    expect(screen.getByRole('heading', { name: 'February 2027' })).toBeDefined();
  });

  it('shows the wall clock’s month when it is given no `today` either', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
    render(<CalendarMonth events={[]} locale="en-US" />);
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeDefined();
  });

  it('still shows a month it is told to show (a story’s demo month)', () => {
    render(<CalendarMonth events={[]} year={2026} month={6} today="2026-09-24" locale="en-US" />);
    expect(screen.getByRole('heading', { name: 'July 2026' })).toBeDefined();
  });
});
