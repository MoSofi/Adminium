// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Ways to pay.
 *
 * Mounted bare, with the transport stubbed at `fetch`:
 *
 *  1. the customer preview says, in one sentence, which ways a customer sees;
 *  2. with no way and no service, the tab says what to do first;
 *  3. a Stripe way that follows cards says so and offers no rules of its own;
 *  4. the bank drawer saves one account per currency;
 *  5. someone who may only view sees each way's state and no control.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';

import { NO_RULES, type ServiceView, type WayOffer, type WayView } from './paymentsApi.js';
import { WaysTab } from './WaysTab.js';

function way(over: Partial<WayView> & Pick<WayView, 'source' | 'method'>): WayView {
  return { label: null, enabled: true, rules: NO_RULES, details: null, position: 1, ...over };
}

const STRIPE = { key: 'payments-stripe', name: 'Card payments', liveOn: false } as ServiceView;

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stub(ways: WayView[], offered: WayOffer[] = []): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) });
      if (url === '/api/v1/payments/ways' && method === 'GET') return Promise.resolve(jsonResponse(200, { data: { ways, manualMethods: ['bank-transfer', 'cash-on-delivery', 'other'] } }));
      if (url === '/api/v1/payments/ways/preview') return Promise.resolve(jsonResponse(200, { data: offered }));
      if (url === '/api/v1/payments/payables') return Promise.resolve(jsonResponse(200, { data: { profiles: [], shapes: [] } }));
      if (url === '/api/v1/payments/pay-page') return Promise.resolve(jsonResponse(200, { data: { shopName: 'Crumb & Co', logoFileId: null, contactEmail: null, contactPhone: null, shopCountry: 'DE', showLines: true } }));
      if (method === 'PUT') return Promise.resolve(jsonResponse(200, { data: JSON.parse(String(init?.body)) as unknown }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } }));
    }),
  );
  return calls;
}

function renderTab(ways: WayView[], opts: { services?: ServiceView[]; canManage?: boolean; offered?: WayOffer[] } = {}) {
  const calls = stub(ways, opts.offered);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <WaysTab services={opts.services ?? [STRIPE]} canManage={opts.canManage ?? true} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), calls };
}

const textOf = (element: Element | null): string => element?.textContent ?? '';

describe('WaysTab', () => {
  beforeAll(installTestI18n);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => vi.unstubAllGlobals());

  it('says in one sentence what a customer sees, asking for an invoice-format payable', async () => {
    const ways = [way({ source: 'payments-stripe', method: 'card' }), way({ source: 'manual', method: 'bank-transfer', position: 2 })];
    const { calls } = renderTab(ways, { offered: ways.map(({ source, method, label, details }) => ({ source, method, label, details })) });
    const line = await screen.findByTestId('payments-ways-preview-line');
    await waitFor(() => expect(textOf(line)).toBe('A customer in Germany paying €120.00 for an invoice sees: Cards, Bank transfer.'));
    expect(calls.find((call) => call.url === '/api/v1/payments/ways/preview')?.body).toEqual({ country: 'DE', currency: 'EUR', amount: '120.00', kind: 'shape', profileId: null });
  });

  it('says when a customer would see no way to pay', async () => {
    renderTab([way({ source: 'manual', method: 'cash-on-delivery' })]);
    const line = await screen.findByTestId('payments-ways-preview-line');
    await waitFor(() => expect(textOf(line)).toBe('A customer in Germany paying €120.00 for an invoice sees: no way to pay.'));
  });

  it('says what to do first when there is no way and no service', async () => {
    renderTab([], { services: [] });
    expect(textOf(await screen.findByTestId('payments-ways-empty'))).toContain('Connect Stripe or PayPal on Setup, or add a way to pay by hand.');
  });

  it('says a way that follows cards is switched off in Stripe, and offers no rules for it', async () => {
    renderTab([way({ source: 'payments-stripe', method: 'card' }), way({ source: 'payments-stripe', method: 'apple_pay', position: 2 })]);
    const row = await screen.findByTestId('payments-way-payments-stripe-apple_pay');
    expect(textOf(within(row).getByTestId('payments-way-payments-stripe-apple_pay-rules'))).toContain('It follows cards');
    expect(within(row).queryByRole('button', { name: 'Edit the rules of Apple Pay' })).toBeNull();
    expect(within(screen.getByTestId('payments-way-payments-stripe-card')).getByRole('button', { name: 'Edit the rules of Cards' })).toBeTruthy();
  });

  it('warns that a bank transfer without an account shows nothing, and saves one account per currency', async () => {
    const { user, calls } = renderTab([way({ source: 'manual', method: 'bank-transfer', details: { accounts: [], note: null } })]);
    const row = await screen.findByTestId('payments-way-manual-bank-transfer');
    expect(textOf(row)).toContain('No bank account yet: customers are shown nothing to pay into.');
    await user.click(within(row).getByRole('button', { name: 'Edit details' }));
    await user.type(await screen.findByTestId('payments-ways-bank-add-currency'), 'eur');
    await user.click(screen.getByRole('button', { name: 'Add the account' }));
    const account = screen.getByTestId('payments-ways-bank-EUR');
    expect(textOf(account)).toContain('Customers paying in EUR see these details on the pay page.');
    expect(screen.getByText('Each account needs a holder and an IBAN or an account number.')).toBeTruthy();
    await user.type(within(account).getByLabelText(/Account holder/), 'Crumb & Co GmbH');
    await user.type(within(account).getByLabelText('IBAN'), 'DE89370400440532013000');
    await user.click(screen.getByTestId('payments-ways-bank-save'));
    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT' && call.url === '/api/v1/payments/ways/manual/bank-transfer');
      expect((put?.body as { details: unknown } | undefined)?.details).toEqual({
        accounts: [{ currency: 'EUR', holder: 'Crumb & Co GmbH', iban: 'DE89370400440532013000', accountNumber: null, bic: null, sortCode: null, bank: null }],
        note: null,
      });
    });
  });

  it('shows each way as on or off and no control to someone who may only view', async () => {
    renderTab([way({ source: 'payments-stripe', method: 'card' }), way({ source: 'manual', method: 'cash-on-delivery', enabled: false, position: 2 })], { canManage: false });
    const row = await screen.findByTestId('payments-way-manual-cash-on-delivery');
    expect(within(row).getByText('Off')).toBeTruthy();
    expect(within(screen.getByTestId('payments-way-payments-stripe-card')).getByText('On')).toBeTruthy();
    expect(screen.queryAllByRole('switch')).toEqual([]);
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    expect(screen.queryByTestId('payments-ways-add-manual')).toBeNull();
    expect(screen.queryByRole('button', { name: /Add the ways/ })).toBeNull();
  });
});
