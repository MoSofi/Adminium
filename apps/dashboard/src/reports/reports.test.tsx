/**
 * Scheduled Reports surfaces (M7 reports track): cadence formatting, the
 * list rendering through `scheduled-jobs-list` with the honest CSV-snapshot
 * delivery badge, the enable toggle PATCHing the server, and the create
 * modal's §8.2 delivery copy.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapData } from '../app/bootstrap.js';
import { ScheduledReportsPage, cadenceLabel } from './ScheduledReportsPage.js';
import type { ScheduledReportDto } from './api.js';

const BOOT = {
  user: { id: 'usr_1', name: 'Ava', email: 'ava@adminium.test' },
  roles: ['admin'],
  prefs: {},
  nav: {
    groups: [
      {
        key: 'workspace',
        items: [
          {
            pageId: 'page_customers',
            slug: 'customers',
            labelKey: 'nav.customers',
            fallback: 'Customers',
            icon: 'users',
            order: 1,
          },
        ],
      },
    ],
  },
  version: '0.0.0-test',
  configVersion: 1,
  llm: { enabled: false },
} as unknown as BootstrapData;

const REPORT: ScheduledReportDto = {
  id: 'rep_1',
  pageId: 'page_customers',
  pageTitle: 'Customers',
  pageSlug: 'customers',
  name: 'Weekly customers',
  schedule: { frequency: 'weekly', dayOfWeek: 1, time: '09:00', timezone: 'UTC' },
  recipients: ['ava@adminium.test'],
  format: 'pdf',
  enabled: true,
  lastRunAt: null,
  nextRunAt: Date.UTC(2026, 6, 20, 9, 0),
  createdBy: 'usr_1',
  createdAt: 1,
  updatedAt: 1,
};

function renderWithClient(ui: ReactElement, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['bootstrap'], BOOT);
  seed?.(client);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cadenceLabel', () => {
  it('formats the §3.24 schedule fields per frequency', () => {
    expect(cadenceLabel({ frequency: 'daily', time: '07:30', timezone: 'UTC' })).toBe(
      'Daily at 07:30 (UTC)',
    );
    expect(
      cadenceLabel({ frequency: 'weekly', dayOfWeek: 5, time: '18:00', timezone: 'UTC' }),
    ).toBe('Weekly · Fri at 18:00 (UTC)');
    expect(
      cadenceLabel({ frequency: 'monthly', dayOfMonth: 15, time: '00:00', timezone: 'Asia/Tokyo' }),
    ).toBe('Monthly · day 15 at 00:00 (Asia/Tokyo)');
  });
});

describe('ScheduledReportsPage', () => {
  it('renders report rows with the honest delivery badge and toggles enable via PATCH', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/v1/scheduled-reports/rep_1') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ data: { ...REPORT, enabled: false } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [REPORT] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<ScheduledReportsPage />, (client) => {
      client.setQueryData(['scheduled-reports'], [REPORT]);
    });

    expect(screen.getByText('Weekly customers')).toBeTruthy();
    expect(screen.getByText('Weekly · Mon at 09:00 (UTC)')).toBeTruthy();
    // Delivery truth, not the stored pdf intent (§8.2).
    expect(screen.getByText('CSV snapshot')).toBeTruthy();

    const toggle = screen.getByRole('switch');
    await user.click(toggle);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (call) => String(call[0]).includes('/scheduled-reports/rep_1') && call[1]?.method === 'PATCH',
      );
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ enabled: false });
    });
  });

  it('opens the create modal with the data-snapshot delivery + recipients copy', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn());
    renderWithClient(<ScheduledReportsPage />, (client) => {
      client.setQueryData(['scheduled-reports'], []);
    });

    expect(screen.getByText('No scheduled reports yet')).toBeTruthy();
    await user.click(screen.getByTestId('new-report'));

    expect(screen.getByText('New scheduled report')).toBeTruthy();
    // The locked v1 delivery copy — pdf/png stays stored INTENT only.
    expect(
      screen.getByText(/Data snapshot \(PDF\/PNG rendering arrives in a later release\)/),
    ).toBeTruthy();
    // Recipients stored-not-emailed, explained inline (§8.2 / free-launch copy).
    expect(screen.getByText(/Email delivery arrives in a later release/)).toBeTruthy();
    // Save is gated on name + page.
    expect((screen.getByTestId('save-report') as HTMLButtonElement).disabled).toBe(true);
  });
});
