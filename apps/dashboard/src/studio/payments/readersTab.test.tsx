// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Payments → Card readers: pairing a reader by the code it shows, its row
 * (online, test), unpairing; someone who may only view sees no pairing.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { ReaderView } from './paymentsApi.js';
import { ReadersTab } from './ReadersTab.js';

const COUNTER: ReaderView = { id: 'prd_1', provider: 'demo-reader', mode: 'test', label: 'Counter', locationName: null, model: 'Demo reader', online: true, lastSeenAt: null };

function renderTab(canManage = true) {
  let readers: ReaderView[] = [];
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) });
      if (url === '/api/v1/payments/readers' && method === 'GET') return Promise.resolve(jsonResponse(200, { data: { readers, services: [{ key: 'demo-reader', name: 'Demo card reader' }] } }));
      if (url.startsWith('/api/v1/payments/readers/locations')) return Promise.resolve(jsonResponse(200, { data: [{ id: 'tml_berlin', name: 'Berlin shop' }, { id: 'tml_hamburg', name: 'Hamburg shop' }] }));
      if (url === '/api/v1/payments/readers/pairing') return Promise.resolve(jsonResponse(200, { data: { way: 'enter', code: null, pairing: 'pair_1', expiresAt: 1 } }));
      if (url === '/api/v1/payments/readers/pairing/finish') {
        readers = [COUNTER];
        return Promise.resolve(jsonResponse(200, { data: { state: 'paired', reader: COUNTER } }));
      }
      if (url === '/api/v1/payments/readers/prd_1' && method === 'DELETE') {
        readers = [];
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } }));
    }),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ReadersTab canManage={canManage} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), calls };
}

describe('ReadersTab', () => {
  beforeAll(installTestI18n);
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('pairs a reader by the code it shows, and unpairs it', async () => {
    const { user, calls } = renderTab();
    expect(await screen.findByTestId('payments-readers-empty')).toBeTruthy();
    await user.click(screen.getByTestId('readers-pair'));
    await user.type(screen.getByTestId('readers-pair-label'), 'Counter');
    // The service's locations in this mode: the reader is paired at the one chosen.
    await user.selectOptions(await screen.findByTestId('readers-pair-location'), 'tml_hamburg');
    await user.click(screen.getByTestId('readers-pair-next'));
    await user.type(await screen.findByTestId('readers-pair-code'), '123456');
    await user.click(screen.getByTestId('readers-pair-next'));
    const row = await screen.findByTestId('reader-prd_1');
    expect(within(row).getByText('Counter')).toBeTruthy();
    expect(within(row).getByText('Online')).toBeTruthy();
    expect(calls.some((call) => call.url === '/api/v1/payments/readers/locations?provider=demo-reader&mode=test')).toBe(true);
    expect(calls.find((call) => call.url === '/api/v1/payments/readers/pairing')?.body).toEqual({ provider: 'demo-reader', mode: 'test', label: 'Counter', locationId: 'tml_hamburg' });
    expect(calls.find((call) => call.url === '/api/v1/payments/readers/pairing/finish')?.body).toEqual({ provider: 'demo-reader', mode: 'test', label: 'Counter', pairing: 'pair_1', code: '123456' });
    await user.click(within(row).getByTestId('reader-unpair-prd_1'));
    await waitFor(() => expect(screen.queryByTestId('reader-prd_1')).toBeNull());
  });

  it('says pairing needs the payments right to someone who may only view', () => {
    renderTab(false);
    expect(screen.getByText('Pairing card readers needs the “Set up payments” permission.')).toBeTruthy();
  });
});
