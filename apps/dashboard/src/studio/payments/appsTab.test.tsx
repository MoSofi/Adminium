// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Apps.
 *
 * Mounted bare, with the transport stubbed at `fetch`:
 *
 *  1. an app arrives off; switching it on asks first, says what customers will
 *     be asked, and sends one switch for the app;
 *  2. switching off needs no confirm;
 *  3. with no payment service connected, the switch waits and the row says
 *     to connect one first;
 *  4. someone who may only view sees the state and no switch;
 *  5. no app takes payments: the empty state.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';

import { AppsTab } from './AppsTab.js';
import type { PaymentAppView } from './paymentsApi.js';

interface Call {
  method: string;
  url: string;
  body: unknown;
}

const TICKETS: PaymentAppView = { connectionId: 'con_shop', appKey: 'events', name: 'Event Ticketing', enabled: false, tables: [{ tableName: 'public.events_orders', shape: false, valid: true }] };

let rehearsing: number | null = null;

function renderTab(apps: PaymentAppView[], opts: { canManage?: boolean; connected?: boolean } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) });
      if (url === '/api/v1/payments/apps' && method === 'GET') return Promise.resolve(jsonResponse(200, { data: { apps } }));
      if (url === '/api/v1/payments/apps/switch') return Promise.resolve(jsonResponse(200, { data: { changed: 1 } }));
      if (url === '/api/v1/payments/rehearsal') {
        if (method === 'PUT') rehearsing = (JSON.parse(String(init!.body)) as { on: boolean }).on ? Date.UTC(2026, 10, 15, 22, 0) : null;
        return Promise.resolve(jsonResponse(200, { data: { until: rehearsing } }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } }));
    }),
  );
  const onConnect = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AppToastProvider>
        <AppsTab canManage={opts.canManage ?? true} connected={opts.connected ?? true} onConnect={onConnect} />
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), calls, onConnect };
}

const switches = (calls: Call[]) => calls.filter((call) => call.url === '/api/v1/payments/apps/switch');

describe('AppsTab', () => {
  beforeAll(installTestI18n);
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('switches an app on only after saying what customers will be asked', async () => {
    const { user, calls } = renderTab([TICKETS]);
    const row = await screen.findByTestId('payments-app-events');
    expect(within(row).getByText('Customers pay for: events orders')).toBeTruthy();
    expect(within(row).getByText('Off')).toBeTruthy();
    const toggle = within(row).getByRole('switch', { name: 'Can take payments Event Ticketing' });
    await user.click(toggle);
    expect(await screen.findByText('Switch on payments for Event Ticketing?')).toBeTruthy();
    expect(screen.getByText(/Event Ticketing will ask its customers to pay online/)).toBeTruthy();
    expect(switches(calls)).toEqual([]);
    await user.click(screen.getByTestId('payments-app-switch-on-events'));
    await waitFor(() => expect(switches(calls)).toHaveLength(1));
    expect(switches(calls)[0]!.body).toEqual({ connectionId: 'con_shop', appKey: 'events', enabled: true });
  });

  it("opens the app's customer side to rehearse it, says so while it runs, and stops it", async () => {
    rehearsing = null;
    const opened = vi.fn();
    vi.stubGlobal('open', opened);
    const { user, calls } = renderTab([TICKETS]);
    const row = await screen.findByTestId('payments-app-events');
    await user.click(within(row).getByTestId('payments-app-try-events'));
    await waitFor(() => expect(opened).toHaveBeenCalledWith('/apps/events/customer/', '_blank', 'noopener'));
    expect(calls.filter((call) => call.url === '/api/v1/payments/rehearsal' && call.method === 'PUT').map((call) => call.body)).toEqual([{ on: true }]);
    const band = await screen.findByTestId('payments-rehearsal-band');
    expect(band.textContent).toContain('Rehearsal on until');
    await user.click(screen.getByTestId('payments-rehearsal-stop'));
    await waitFor(() => expect(screen.queryByTestId('payments-rehearsal-band')).toBeNull());
  });

  it('switches an app off with no confirm', async () => {
    const { user, calls } = renderTab([{ ...TICKETS, enabled: true }]);
    const row = await screen.findByTestId('payments-app-events');
    expect(within(row).getByText('On')).toBeTruthy();
    await user.click(within(row).getByRole('switch'));
    await waitFor(() => expect(switches(calls)).toHaveLength(1));
    expect(switches(calls)[0]!.body).toEqual({ connectionId: 'con_shop', appKey: 'events', enabled: false });
    expect(screen.queryByText('Switch on payments for Event Ticketing?')).toBeNull();
  });

  it('waits for a payment service, and says so', async () => {
    const { user, onConnect } = renderTab([TICKETS], { connected: false });
    const row = await screen.findByTestId('payments-app-events');
    const toggle = within(row).getByRole('switch');
    expect(toggle.hasAttribute('disabled') || toggle.getAttribute('aria-disabled') === 'true' || toggle.getAttribute('data-disabled') !== null).toBe(true);
    await user.click(within(row).getByRole('button', { name: 'Connect a payment service first' }));
    expect(onConnect).toHaveBeenCalled();
  });

  it('shows the state and no switch to someone who may only view', async () => {
    renderTab([{ ...TICKETS, enabled: true }], { canManage: false });
    const row = await screen.findByTestId('payments-app-events');
    expect(within(row).queryByRole('switch')).toBeNull();
    expect(within(row).getByText('On')).toBeTruthy();
    expect(screen.getByTestId('payments-apps-view-only')).toBeTruthy();
  });

  it('says when no app takes payments', async () => {
    renderTab([]);
    expect(await screen.findByTestId('payments-apps-empty')).toBeTruthy();
    expect(screen.getByText('No installed app takes payments yet.')).toBeTruthy();
  });
});
