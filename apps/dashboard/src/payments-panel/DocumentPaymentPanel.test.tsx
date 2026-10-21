// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A designer invoice's Payment panel, as the add-on host publishes it: the
 * record page's panel read for the document, its code fetched the first time
 * it mounts, nothing for a document that takes no payments, and no "Email pay
 * link" (Adminium holds no customer address for such an invoice).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAddOnHost, type AddOnDocumentPaymentPanelProps } from '@adminium/add-on-contracts/runtime';

import { ensureAddOnRuntime, resetAddOnRuntime } from '../add-ons/runtime.js';
import { AppToastProvider } from '../pages/toasts.js';
import type { PaymentPanelView } from './paymentPanelApi.js';

const VIEW: PaymentPanelView = {
  payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'inv_1' },
  label: 'INV-0042',
  currency: 'EUR',
  total: '120.00',
  due: '70.00',
  paid: '50.00',
  refusal: null,
  links: { on: true, reason: null },
  mayChange: true,
  mayRecord: true,
  mayRefund: false,
  waiting: [],
  payments: [
    { id: 'kept:1', number: null, amount: '50.00', currency: 'EUR', refunded: '0', way: 'bank-transfer', wayLabel: null, provider: null, test: false, paidOn: '2026-10-20', recordedBy: 'Tom Becker', cardLast4: null, attemptId: null, refundable: '0', refundRefusal: null, refunds: [], dispute: null },
  ],
};

let calls: { url: string; body: unknown }[];
let panel: unknown;

beforeEach(() => {
  calls = [];
  panel = { data: VIEW };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body === undefined ? null : JSON.parse(String(init.body));
      calls.push({ url: String(url), body });
      const reply = String(url).endsWith('/payments/panel') ? panel : String(url).endsWith('/payments/links/current') ? { data: null } : String(url).endsWith('/payments/record-payment') ? { data: { key: 'k', already: false, due: '0' } } : null;
      if (reply === null) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetAddOnRuntime();
});

async function mount(props: AddOnDocumentPaymentPanelProps): Promise<void> {
  await ensureAddOnRuntime();
  const Panel = requireAddOnHost().app['DocumentPaymentPanel'] as ComponentType<AddOnDocumentPaymentPanelProps>;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <AppToastProvider>{node}</AppToastProvider>
    </QueryClientProvider>
  );
  await act(async () => {
    render(wrap(<Panel {...props} />));
  });
}

describe('the designer invoice Payment panel the host publishes', () => {
  it('reads the panel for the document and shows its balance, payments and actions, with no email action', async () => {
    await mount({ documentId: 'inv_1' });
    await waitFor(() => expect(screen.getByTestId('payment-panel')).toBeTruthy());
    expect(calls.find((call) => call.url.endsWith('/payments/panel'))?.body).toEqual({ documentId: 'inv_1' });
    expect(screen.getByText('Balance due')).toBeTruthy();
    expect(screen.getByText('€70.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy pay link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record a payment' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Email pay link' })).toBeNull();
  });

  it('records a payment against the document and tells the page', async () => {
    const changed = vi.fn();
    await mount({ documentId: 'inv_1', onChanged: changed });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record a payment' })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'bank-transfer');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(calls.find((call) => call.url.endsWith('/payments/record-payment'))?.body).toMatchObject({ documentId: 'inv_1', amount: '70.00', way: 'bank-transfer' });
  });

  it('renders nothing for a document that takes no payments', async () => {
    panel = { data: null };
    await mount({ documentId: 'tpl_1' });
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/payments/panel'))).toBe(true));
    expect(screen.queryByTestId('payment-panel')).toBeNull();
  });
});
