// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How a person reaches Activity on the Payments page: the tab carries the
 * same count of rows that still need a look as the hub, and the hub's link
 * (`?tab=activity`) opens the page on it.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { PageActionsProvider } from '../../shell/PageActionsProvider.js';
import { jsonResponse } from '../../test/fixtures.js';

import { PaymentsPage } from './PaymentsPage.js';
import type { PaymentsSetup } from './paymentsApi.js';

const SETUP: PaymentsSetup = { reachability: { state: 'reachable', origin: 'https://admin.crumbandco.de', notPort443: false }, canManage: true, services: [] };

function stub(count: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url === '/api/v1/payments/setup') return Promise.resolve(jsonResponse(200, { data: SETUP }));
      if (url === '/api/v1/payments/activity/count') return Promise.resolve(jsonResponse(200, { data: { open: count } }));
      if (url.startsWith('/api/v1/payments/activity')) return Promise.resolve(jsonResponse(200, { data: { rows: [], more: false, next: null } }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } }));
    }),
  );
}

function show(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AppToastProvider>
        <PageActionsProvider>
          <PaymentsPage onOpenSettings={() => undefined} />
        </PageActionsProvider>
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

describe('the way into Activity', () => {
  beforeAll(installTestI18n);
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });
  afterAll(() => vi.unstubAllGlobals());

  it('counts on the Activity tab what still needs a look, and says it to a screen reader', async () => {
    stub(2);
    show();
    const count = await screen.findByTestId('payments-activity-count');
    expect(within(count).getByText('2')).toBeTruthy();
    expect(within(count).getByText('2 need a look')).toBeTruthy();
  });

  it('shows no count when nothing needs a look, and says one in the singular', async () => {
    stub(0);
    show();
    await screen.findByTestId('payments-tab-activity');
    expect(screen.queryByTestId('payments-activity-count')).toBeNull();
    cleanup();
    stub(1);
    show();
    expect(within(await screen.findByTestId('payments-activity-count')).getByText('1 needs a look')).toBeTruthy();
  });

  it('opens on Activity when the address asks for it', async () => {
    window.history.replaceState(null, '', '/studio/payments?tab=activity');
    stub(0);
    show();
    expect(await screen.findByTestId('payments-activity')).toBeTruthy();
  });
});
