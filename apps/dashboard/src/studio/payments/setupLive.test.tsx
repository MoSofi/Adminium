// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Setup: going live, disconnecting, and the warnings.
 *
 *  1. the live card says how live stands, and "Turn on live payments" sends
 *     the switch;
 *  2. Disconnect offers Stop or Remove keys, counts what is waiting, and keeps
 *     Remove shut until waiting payments are owned up to;
 *  3. a moved webhook address and a clock a minute off are warned about.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { PageActionsProvider } from '../../shell/PageActionsProvider.js';
import { jsonResponse } from '../../test/fixtures.js';

import { PaymentsPage } from './PaymentsPage.js';
import type { ModeView, PaymentsSetup, ServiceView } from './paymentsApi.js';

const CHECKED = { at: 1, ok: true, code: null, message: null, missing: [] };

function mode(over: Partial<ModeView> = {}): ModeView {
  return {
    fields: [
      { key: 'secret_key', label: null, help: null, webhook: false, set: true, hint: 'rk_live_…9xQ4', setAt: 1 },
      { key: 'webhook_secret', label: null, help: null, webhook: true, set: true, hint: 'whsec_…a1B2', setAt: 1 },
    ],
    check: null,
    accountId: 'acct_1Q2w3E4r',
    webhookUrl: 'https://pay.crumbandco.de/api/v1/payments/webhook/payments-stripe/live',
    firstEventAt: null,
    firstPaymentAt: null,
    ...over,
  };
}

function stripe(over: Partial<ServiceView> = {}): ServiceView {
  return {
    key: 'payments-stripe',
    name: 'Card payments',
    description: { key: 'addon.payments-stripe.line', fallback: 'Connects to Stripe.' },
    status: 'installed',
    loaded: true,
    hasPaths: false,
    webhookEvents: [],
    path: null,
    stopped: false,
    liveOn: false,
    test: mode({ webhookUrl: 'https://pay.crumbandco.de/api/v1/payments/webhook/payments-stripe/test' }),
    live: mode({ check: CHECKED }),
    checklist: [],
    waiting: 0,
    refundable: 0,
    clockSkewMs: null,
    ...over,
  };
}

function show(service: ServiceView): { calls: { method: string; url: string; body: unknown }[] } {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const data: PaymentsSetup = { reachability: { state: 'reachable', origin: 'https://pay.crumbandco.de', notPort443: false }, canManage: true, services: [service] };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) });
      if (url === '/api/v1/payments/setup') return Promise.resolve(jsonResponse(200, { data }));
      if (url.includes('/activity')) return Promise.resolve(jsonResponse(200, { data: { open: 0, rows: [], more: false, next: null } }));
      return Promise.resolve(jsonResponse(200, { data: service }));
    }),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PageActionsProvider>
        <PaymentsPage onOpenSettings={() => undefined} />
      </PageActionsProvider>
    </QueryClientProvider>,
  );
  return { calls };
}

describe('Setup: going live, disconnecting, warnings', () => {
  beforeAll(installTestI18n);
  afterEach(() => vi.unstubAllGlobals());

  it('offers live once the live key works, and sends the switch', async () => {
    const user = userEvent.setup();
    const { calls } = show(stripe());
    expect((await screen.findByTestId('payments-payments-stripe-live-ready')).textContent).toContain('The live key works');
    await user.click(screen.getByTestId('payments-payments-stripe-live-turn-on'));
    await waitFor(() => expect(calls.find((call) => call.url.endsWith('/live'))).toMatchObject({ method: 'PUT', body: { on: true } }));
  });

  it('says live is not proven until a live event arrives, and names the first live payment after', async () => {
    show(stripe({ liveOn: true }));
    expect((await screen.findByTestId('payments-payments-stripe-live-unproven')).textContent).toContain('Live is on, but the webhook is not proven yet.');
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    show(stripe({ liveOn: true, live: mode({ check: CHECKED, firstEventAt: 1, firstPaymentAt: Date.now() - 60_000 }) }));
    expect((await screen.findByTestId('payments-payments-stripe-live-on')).textContent).toMatch(/Live is on.*First live payment arrived/);
  });

  it('keeps Remove keys shut while payments wait, until they are owned up to, and says to roll the key', async () => {
    const user = userEvent.setup();
    const { calls } = show(stripe({ waiting: 2, refundable: 14 }));
    await user.click(await screen.findByTestId('payments-payments-stripe-menu'));
    await user.click(await screen.findByTestId('payments-payments-stripe-disconnect'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 payments are still waiting for the bank')).toBeTruthy();
    expect(within(dialog).getByText('14 payments can still be refunded')).toBeTruthy();
    await user.click(within(dialog).getByRole('radio', { name: /Remove keys/ }));
    expect(within(dialog).getByText(/roll the key in your Stripe dashboard/)).toBeTruthy();
    const confirm = within(dialog).getByTestId('payments-payments-stripe-disconnect-confirm');
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await user.click(within(dialog).getByRole('checkbox'));
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await user.click(confirm);
    await waitFor(() => expect(calls.find((call) => call.url.endsWith('/disconnect'))).toMatchObject({ method: 'POST', body: { action: 'remove', settleByHand: true } }));
  });

  it('warns when the webhook address moved, and when the clock is a minute off', async () => {
    show(stripe({ clockSkewMs: 95_000, live: mode({ check: CHECKED, health: { lastEventAt: 1, lastBadAt: null, badThisHour: 0, caughtAt: null, slowed: false, eventOrigin: 'https://admin.crumbandco.de' } }) }));
    expect((await screen.findByTestId('payments-payments-stripe-live-moved')).textContent).toContain('The webhook address changed. Update it at Stripe:');
    expect(screen.getByTestId('payments-payments-stripe-clock').textContent).toContain("This server's clock is 95 seconds off the Stripe clock.");
  });
});
