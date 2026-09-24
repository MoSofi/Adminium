// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A calendar page with a form of its own opens that form for "Add event".
 *
 * An app's appointments calendar offered only a title box, which wrote the
 * typed text into the column the calendar titles by — and was refused. The
 * binding now opens the page's designed form (the same dialog a list page's
 * New row opens), started on the selected day, and saves through the data API
 * with the undo toast. A page with no form keeps the title composer.
 *
 * And its KPI strip reads money in the connection's currency, as the
 * dashboard's does: a clinic in pounds saw `$0.00` over its appointments.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { PageEnvelope } from '@adminium/engine/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoundCrudApi } from '../../api/crud.js';
import { bootstrapQuery } from '../../app/bootstrap.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { PageCalendarBinding } from '../PageCalendarBinding.js';
import { AppToastProvider } from '../toasts.js';
import type { PageTemplateProps } from '../template-types.js';

const CAL_CONFIG = {
  title: 'Appointments',
  startColumn: 'starts_at',
  titleColumn: 'reason',
  binding: {
    kind: 'table-query',
    connectionId: 'conn_1',
    source: { schema: 'public', name: 'appointments', type: 'table' },
    shape: 'calendar-events',
    limit: 500,
  },
};

const FORM = { v: 2, sections: [{ id: 's1', fields: [{ column: 'starts_at', control: 'datetime' }, { column: 'reason' }] }] };

function page(form: unknown): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_cal',
    template: 'page-calendar',
    title: { key: 'nav.appointments', fallback: 'Appointments' },
    source: { connectionId: 'conn_1', table: 'public.appointments' },
    nav: { group: 'planning', icon: 'calendar', order: 10, slug: 'appointments' },
    access: { minRole: 'viewer', permissions: [] },
    config: {
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
      ...(form === undefined ? {} : { form }),
    },
  } as unknown as PageEnvelope;
}

const FORM_COLUMNS = [
  { spec: { name: 'starts_at', label: 'Starts at', logicalType: 'timestamptz', nullable: false }, filledBy: null, required: true, writable: true },
  { spec: { name: 'reason', label: 'Reason', logicalType: 'varchar', nullable: true }, filledBy: null, required: false, writable: true },
];

function crud() {
  return {
    connectionId: 'conn_1',
    table: 'public.appointments',
    create: vi.fn().mockResolvedValue({ data: { id: 1 }, undoToken: 'undo_1' }),
  } as unknown as BoundCrudApi & { create: ReturnType<typeof vi.fn> };
}

function renderWith(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(bootstrapQuery().queryKey, makeBootstrap({ roles: ['admin'] }));
  return render(
    <QueryClientProvider client={client}>
      <AppToastProvider>{ui}</AppToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PageCalendarBinding with the page’s own form', () => {
  it('opens the form for "Add event", on the selected day, and saves it with an undo toast', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const api = crud();
    const notifyUndoable = vi.fn();
    const adapters: PageTemplateProps['adapters'] = { crud: api, dashboard: null, onEvent: () => undefined, openRecord: () => undefined, notifyUndoable };
    renderWith(<PageCalendarBinding page={page(FORM)} adapters={adapters} canCreate formColumns={FORM_COLUMNS} tableLabelSingular="Appointment" />);

    await userEvent.click(screen.getByTestId('agenda-compose-open'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('New Appointment');
    // No title box: the designed form, and nothing else.
    expect(screen.queryByPlaceholderText('Event title…')).toBeNull();

    await userEvent.type(screen.getByLabelText('Reason'), 'Knee check');
    await userEvent.click(screen.getByRole('button', { name: /Create Appointment/ }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const [values] = api.create.mock.calls[0] as [Record<string, unknown>];
    expect(values['reason']).toBe('Knee check');
    // Started on the day the agenda shows: today, on this browser's clock.
    const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(values['starts_at']).toBe(today);
    await waitFor(() => expect(notifyUndoable).toHaveBeenCalledWith(expect.objectContaining({ undoToken: 'undo_1' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the title composer on a page with no form, and for a caller who may not create', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const adapters: PageTemplateProps['adapters'] = { crud: crud(), dashboard: null, onEvent: () => undefined, openRecord: () => undefined, notifyUndoable: () => undefined };
    const { unmount } = renderWith(<PageCalendarBinding page={page(undefined)} adapters={adapters} canCreate formColumns={FORM_COLUMNS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }));
    expect(screen.getByPlaceholderText('Event title…')).toBeTruthy();
    unmount();

    renderWith(<PageCalendarBinding page={page(FORM)} adapters={adapters} canCreate={false} formColumns={FORM_COLUMNS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }));
    expect(screen.getByPlaceholderText('Event title…')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('PageCalendarBinding’s KPI cards', () => {
  it('read money in the connection’s currency', async () => {
    const kpi = {
      i: 'kpi-1',
      widget: 'kpi-stat-card',
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      config: {
        title: 'Total fee',
        metricFormat: 'currency',
        binding: { kind: 'table-query', connectionId: 'conn_1', source: { schema: 'public', name: 'appointments', type: 'table' }, shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'fee', alias: 'value' }] },
      },
    };
    const withKpi = page(undefined);
    const config = withKpi.config as { layout: { items: unknown[] } };
    config.layout.items = [...config.layout.items, kpi];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          results: { 'cal-1': { ok: true, result: [], cached: false }, 'kpi-1': { ok: true, result: { value: 45 }, cached: false } },
        }),
      ),
    );
    const adapters: PageTemplateProps['adapters'] = { crud: null, dashboard: null, onEvent: () => undefined, openRecord: () => undefined, notifyUndoable: () => undefined };
    renderWith(<PageCalendarBinding page={withKpi} adapters={adapters} currency="GBP" />);
    expect(await screen.findByText(/£45/)).toBeTruthy();
    expect(screen.queryByText(/\$45/)).toBeNull();
  });
});
