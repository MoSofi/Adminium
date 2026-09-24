// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * "Add event" opens the page's own form.
 *
 * On a page whose form was designed (an app's appointments: patient, visit
 * type, clinician, time), the calendar's title composer could only write a
 * title and a date — into whatever column the calendar titles by — and the
 * write was refused. With `onCreate`, the host's form opens instead, with the
 * day filled in: from "Add event", and from a click on a day with nothing on it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageCalendar } from './PageCalendar.js';

afterEach(cleanup);

const CAL_CONFIG = {
  title: 'Appointments',
  startColumn: 'starts_at',
  titleColumn: 'patient_id__display',
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

const states = {
  'cal-1': {
    status: 'success' as const,
    data: {
      rows: [{ id: 7, patient_id__display: 'Grace Hopper', starts_at: '2026-09-25T09:30:00Z' }],
      // A timestamp: a new visit starts at the day's midnight in the calendar's zone.
      columns: [{ name: 'starts_at', logicalType: 'timestamptz' }],
      total: 1,
    },
  },
};

function renderPage(onCreate?: (values: Record<string, unknown>) => void) {
  const onEvent = vi.fn();
  render(
    <PageCalendar
      config={page}
      states={states}
      referenceDate="2026-09-24"
      timeZone="UTC"
      locale="en-US"
      onEvent={onEvent}
      {...(onCreate === undefined ? {} : { onCreate })}
    />,
  );
  return { onEvent };
}

describe('page-calendar with the page’s own form', () => {
  it('opens the form from "Add event", with the selected day as its start', () => {
    const onCreate = vi.fn();
    const { onEvent } = renderPage(onCreate);
    fireEvent.click(screen.getByTestId('agenda-compose-open'));
    expect(onCreate).toHaveBeenCalledWith({ starts_at: '2026-09-24T00:00:00.000Z' });
    // No title box, and nothing written behind the form's back.
    expect(screen.queryByPlaceholderText('Event title…')).toBeNull();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('opens it from a click on an empty day, and not from a day that has visits', () => {
    const onCreate = vi.fn();
    renderPage(onCreate);
    fireEvent.click(screen.getByRole('gridcell', { name: '2026-09-28' }));
    expect(onCreate).toHaveBeenCalledWith({ starts_at: '2026-09-28T00:00:00.000Z' });
    onCreate.mockClear();
    fireEvent.click(screen.getByRole('gridcell', { name: '2026-09-25' }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0);
  });

  it('keeps the title composer on a page with no form', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    expect(screen.getByPlaceholderText('Event title…')).toBeDefined();
  });
});
