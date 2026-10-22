// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/payments`, Setup.
 *
 * Mounted bare (no router), with the transport stubbed at `fetch`, so the
 * claims are about what reaches the wire and what the person reads:
 *
 *  1. each reachability state says its own sentence, and while customers
 *     cannot reach the server the services stay folded ("Set this up first.");
 *  2. a refused paste shows the sentence for its reason, and nothing else;
 *  3. a saved key shows its hint, never a value, and the checklist counts;
 *  4. a Check that finds missing permissions names them; a refused key raises
 *     the alarm;
 *  5. someone who may only view sees all of it and no control;
 *  6. "Send a test payment" opens the pay page in a new tab and shows the
 *     round trip once the payment is kept.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { PageActionsProvider, PageActionsSlot } from '../../shell/PageActionsProvider.js';
import { jsonResponse } from '../../test/fixtures.js';

import { PaymentsPage } from './PaymentsPage.js';
import { REACHABILITY_STATES, type ModeView, type PaymentsSetup, type ReachabilityState, type ServiceView } from './paymentsApi.js';

function mode(over: Partial<ModeView> = {}): ModeView {
  return {
    fields: [
      { key: 'secret_key', label: { key: 'k', fallback: 'Restricted key' }, help: null, webhook: false, set: false, hint: null, setAt: null },
      { key: 'webhook_secret', label: { key: 'w', fallback: 'Webhook signing secret' }, help: null, webhook: true, set: false, hint: null, setAt: null },
    ],
    check: null,
    accountId: null,
    webhookUrl: 'https://admin.crumbandco.de/api/v1/payments/webhook/payments-stripe/test',
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
    hasPaths: true,
    webhookEvents: ['checkout.session.completed', 'refund.failed'],
    path: null,
    stopped: false,
    liveOn: false,
    test: mode(),
    live: mode({ webhookUrl: 'https://admin.crumbandco.de/api/v1/payments/webhook/payments-stripe/live' }),
    checklist: [
      { step: 'path', done: false },
      { step: 'test-key', done: false },
      { step: 'test-webhook', done: false },
      { step: 'test-payment', done: false },
      { step: 'live-key', done: false },
      { step: 'live-webhook', done: false },
      { step: 'live-payment', done: false },
    ],
    ...over,
  };
}

function setup(over: Partial<PaymentsSetup> = {}): PaymentsSetup {
  return {
    reachability: { state: 'reachable', origin: 'https://admin.crumbandco.de', notPort443: false },
    canManage: true,
    services: [stripe()],
    ...over,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stub(data: PaymentsSetup, save?: { status: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) });
      if (url === '/api/v1/payments/setup') return Promise.resolve(jsonResponse(200, { data }));
      if (save !== undefined) return Promise.resolve(jsonResponse(save.status, save.body));
      return Promise.resolve(jsonResponse(200, { data: data.services[0] }));
    }),
  );
  return calls;
}

function renderPage(data: PaymentsSetup, save?: { status: number; body: unknown }) {
  const calls = stub(data, save);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PageActionsProvider>
        <PageActionsSlot />
        <PaymentsPage onOpenSettings={() => undefined} />
      </PageActionsProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), calls };
}

const textOf = (element: Element | null): string => element?.textContent ?? '';
const isDisabled = (element: Element): boolean => element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('data-disabled');

const SENTENCES: Record<Exclude<ReachabilityState, 'reachable'>, string> = {
  'network-off': 'This server is set to work without the internet, so it cannot take online payments.',
  desktop: 'This server runs on this computer only. Customers cannot reach it.',
  'not-set': 'This server has no public address yet.',
  'this-computer': 'This server runs on this computer only. Customers cannot reach it.',
  'private-network': 'Only people on your own network can reach this address.',
  'dot-local': 'Only people on your own network can reach this address.',
  'not-https': 'Pay pages need https. Put this server behind HTTPS first.',
  'proxy-hidden': "This server is behind a proxy that hides your customers' addresses. Turn on ADMINIUM_TRUST_PROXY.",
};

describe('PaymentsPage', () => {
  beforeAll(installTestI18n);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => vi.unstubAllGlobals());

  it.each(REACHABILITY_STATES.filter((state) => state !== 'reachable'))('says what %s means and folds the services', async (state) => {
    renderPage(setup({ reachability: { state, origin: state === 'not-set' ? null : 'http://192.168.1.20:4600', notPort443: false } }));
    expect(textOf(await screen.findByTestId('payments-reach-problem'))).toContain(SENTENCES[state as Exclude<ReachabilityState, 'reachable'>]);
    expect(textOf(screen.getByTestId('payments-service-payments-stripe-first'))).toContain('Set this up first.');
    expect(screen.queryByTestId('payments-payments-stripe-test')).toBeNull();
  });

  it('names the variable the operator sets, for network features and the proxy', async () => {
    renderPage(setup({ reachability: { state: 'network-off', origin: null, notPort443: false } }));
    expect(await screen.findByText(/ADMINIUM_NETWORK_FEATURES=on/)).toBeTruthy();
  });

  it('warns about a port before a PayPal webhook never arrives', async () => {
    renderPage(setup({ reachability: { state: 'reachable', origin: 'https://admin.crumbandco.de:8443', notPort443: true } }));
    expect(textOf(await screen.findByTestId('payments-reach-port'))).toContain('PayPal only sends webhooks to port 443.');
  });

  it('shows the card as named for what it does, with what it connects to', async () => {
    renderPage(setup());
    const card = await screen.findByTestId('payments-service-payments-stripe');
    expect(within(card).getByRole('heading', { name: 'Card payments' })).toBeTruthy();
    expect(within(card).getByText('Connects to Stripe')).toBeTruthy();
    expect(textOf(within(card).getByTestId('payments-service-payments-stripe-progress'))).toContain('0 of 7 done · your progress is kept');
  });

  it.each([
    ['SECRET_KEY', 'This is a secret key (sk_). Stripe asks plugins not to use them. Make a restricted key instead.'],
    ['PUBLISHABLE_KEY', 'This is a publishable key (pk_). Paste the restricted key (rk_) instead.'],
    ['WEBHOOK_SECRET_IN_KEY_FIELD', 'This is a webhook secret (whsec_). It goes in the webhook card below.'],
    ['LIVE_KEY_IN_TEST_FIELD', 'This is a live key. This field is for the test key.'],
    ['NOT_A_RESTRICTED_KEY', 'This is not a restricted key. It starts with rk_test_ or rk_live_.'],
    ['network-off', 'This server is set to work without the internet, so no payment service can be connected.'],
  ])('refuses a %s paste with its own sentence', async (reason, sentence) => {
    const { user, calls } = renderPage(setup(), { status: 422, body: { error: { code: 'VALIDATION_FAILED', message: 'x', details: { reason, field: 'secret_key' } } } });
    const field = await screen.findByLabelText('Test key');
    await user.type(field, 'sk_test_51abcdefghijklmnop');
    await user.click(within(screen.getByTestId('payments-payments-stripe-test-secret_key')).getByRole('button', { name: 'Check and save' }));
    expect(textOf(await screen.findByTestId('payments-payments-stripe-test-secret_key-error'))).toContain(sentence);
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toBe('/api/v1/payments/services/payments-stripe/modes/test/fields/secret_key');
    expect(put?.body).toEqual({ value: 'sk_test_51abcdefghijklmnop' });
  });

  it('shows a saved key as its hint, with Replace, and never a value', async () => {
    const saved = mode({
      fields: [
        { key: 'secret_key', label: null, help: null, webhook: false, set: true, hint: 'rk_test_…a1B2', setAt: Date.now() - 60_000 },
        { key: 'webhook_secret', label: null, help: null, webhook: true, set: false, hint: null, setAt: null },
      ],
      check: { at: Date.now() - 60_000, ok: true, code: null, message: null, missing: [] },
      accountId: 'acct_1Q2w3E4r',
    });
    renderPage(setup({ services: [stripe({ test: saved, checklist: stripe().checklist.map((one) => (one.step === 'test-key' ? { ...one, done: true } : one)) })] }));
    expect(textOf(await screen.findByTestId('payments-payments-stripe-test-secret_key-hint'))).toContain('rk_test_…a1B2');
    expect(screen.getByText('acct_1Q2w3E4r')).toBeTruthy();
    expect(textOf(screen.getByTestId('payments-service-payments-stripe-progress'))).toContain('1 of 7 done');
    expect(textOf(screen.getByTestId('payments-payments-stripe-test-checked'))).toContain('Stripe accepted this key.');
    expect(within(screen.getByTestId('payments-payments-stripe-test-secret_key')).getByRole('button', { name: 'Replace' })).toBeTruthy();
  });

  it('names the permissions a key is missing', async () => {
    renderPage(setup({ services: [stripe({ test: mode({ check: { at: 1, ok: true, code: null, message: null, missing: ['Events: read', 'Disputes: read'] } }) })] }));
    expect(textOf(await screen.findByTestId('payments-payments-stripe-test-missing'))).toContain(
      'Stripe says this key is missing: Events: read, Disputes: read. Edit the key in Stripe and paste it again.',
    );
  });

  it('raises the alarm when Stripe refused the key', async () => {
    renderPage(setup({ services: [stripe({ live: mode({ check: { at: 1, ok: false, code: 'CREDENTIALS_REFUSED', message: 'Invalid API Key provided', missing: [] } }) })] }));
    expect(textOf(await screen.findByTestId('payments-payments-stripe-alarm'))).toContain('Stripe refused the key. It may have been revoked, or the app uninstalled.');
  });

  it('lists the events to tick, the webhook address and what the log knows', async () => {
    renderPage(setup());
    const hook = await screen.findByTestId('payments-payments-stripe-test-webhook');
    expect(within(hook).getByText('checkout.session.completed')).toBeTruthy();
    expect(within(hook).getByText('https://admin.crumbandco.de/api/v1/payments/webhook/payments-stripe/test')).toBeTruthy();
    expect(within(hook).getByText('Choose the Snapshot payload.')).toBeTruthy();
    expect(textOf(screen.getByTestId('payments-payments-stripe-test-log'))).toContain('Nothing has reached this address yet.');
    expect(textOf(screen.getByTestId('payments-payments-stripe-live-log'))).toContain('No live event has arrived yet.');
  });

  it('chooses how the key is made with real radio inputs, and shows the access it needs', async () => {
    const { user, calls } = renderPage(setup());
    const path = await screen.findByTestId('payments-payments-stripe-path');
    expect(within(path).getByText('Accounts: read')).toBeTruthy();
    await user.click(within(path).getByRole('radio', { name: /By hand in the Stripe dashboard/ }));
    await waitFor(() => expect(calls.find((call) => call.method === 'PUT' && call.url.endsWith('/path'))?.body).toEqual({ path: 'by-hand' }));
  });

  it('asks before stopping new payments', async () => {
    const { user, calls } = renderPage(setup());
    await user.click(await screen.findByRole('switch', { name: 'Stop new payments' }));
    expect(await screen.findByText(/Customers cannot start a payment with Card payments/)).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith('/stopped'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Stop new payments' }));
    await waitFor(() => expect(calls.find((call) => call.url.endsWith('/stopped'))?.body).toEqual({ stopped: true }));
  });

  it('shows everything and no control to someone who may only view', async () => {
    renderPage(setup({ canManage: false }));
    expect(await screen.findByTestId('payments-view-only')).toBeTruthy();
    const card = screen.getByTestId('payments-service-payments-stripe');
    expect(within(card).queryAllByRole('textbox')).toEqual([]);
    expect(card.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(within(card).queryByRole('button', { name: 'Check and save' })).toBeNull();
    for (const radio of within(card).getAllByRole('radio')) expect(isDisabled(radio)).toBe(true);
    expect(isDisabled(within(card).getByRole('switch', { name: 'Stop new payments' }))).toBe(true);
  });

  it('says where the money now goes, and that every manager was emailed', async () => {
    const at = Date.now() - 3_600_000;
    renderPage(
      setup({
        alarms: [
          { what: 'account', service: 'payments-stripe', from: 'acct_1Old', to: 'acct_1New', by: 'Ava Reyes', at },
          { what: 'pay-address', service: null, from: 'https://old.crumbandco.de', to: 'https://pay.crumbandco.de', by: 'Ava Reyes', at },
        ],
      }),
    );
    const account = await screen.findByTestId('payments-alarm-account');
    expect(textOf(account)).toContain('acct_1Old');
    expect(textOf(account)).toContain('acct_1New');
    expect(textOf(account)).toContain('Ava Reyes');
    expect(textOf(account)).toContain('Everyone who manages payments was emailed.');
    expect(textOf(screen.getByTestId('payments-alarm-pay-address'))).toContain('Update the webhook address at Stripe and PayPal.');
  });

  it('lets a person say "Got it" to an alarm, which hides it for them', async () => {
    const at = Date.now() - 3_600_000;
    const { user, calls } = renderPage(
      setup({
        alarms: [
          { id: 'aud_bank1', what: 'bank', service: null, from: null, to: null, by: 'Ava Reyes', at },
          // From a server one step behind: no id, so nothing to dismiss it by.
          { what: 'account', service: 'payments-stripe', from: 'acct_1Old', to: 'acct_1New', by: 'Ava Reyes', at },
        ],
      }),
    );
    const bank = await screen.findByTestId('payments-alarm-bank');
    expect(within(screen.getByTestId('payments-alarm-account')).queryByRole('button', { name: 'Got it' })).toBeNull();
    await user.click(within(bank).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/payments/alarms/aud_bank1/dismiss')).toBe(true));
  });

  it('reads the webhook health: bad signatures, a payment no webhook announced, and slowed checks', async () => {
    const health = { lastEventAt: Date.now() - 120_000, lastBadAt: Date.now() - 60_000, badThisHour: 3, caughtAt: Date.now() - 600_000, slowed: true };
    renderPage(setup({ services: [stripe({ live: mode({ health }) })] }));
    const log = await screen.findByTestId('payments-payments-stripe-live-log');
    expect(textOf(log)).toContain('checked.');
    expect(textOf(log)).toContain('3 events arrived in the last hour but the signature did not match. Is this the secret from the endpoint page, for live mode?');
    expect(textOf(log)).toContain('that no webhook had announced. The webhook is not reaching this server.');
    expect(textOf(log)).toContain('Adminium checks Stripe less often this month');
  });

  it('says one bad signature in the singular', async () => {
    renderPage(setup({ services: [stripe({ test: mode({ health: { lastEventAt: null, lastBadAt: 1, badThisHour: 1, caughtAt: null, slowed: false } }) })] }));
    expect(textOf(await screen.findByTestId('payments-payments-stripe-test-log'))).toContain('1 event arrived in the last hour');
  });

  it('says a key answering for the other mode is in the wrong field', async () => {
    renderPage(setup({ services: [stripe({ test: mode({ check: { at: 1, ok: false, code: 'MODE_MISMATCH', message: 'x', missing: [] } }) })] }));
    expect(textOf(await screen.findByTestId('payments-payments-stripe-test-mode-mismatch'))).toBe('This key is for live payments, and this field is for the test key.');
  });

  it('names the choice of how the key is made, and says when choosing it was refused', async () => {
    const { user } = renderPage(setup(), { status: 409, body: { error: { code: 'CONFLICT', message: 'The path could not be saved.' } } });
    const group = await screen.findByRole('radiogroup', { name: /Stripe key/ });
    await user.click(within(group).getByRole('radio', { name: /By hand in the Stripe dashboard/ }));
    expect(textOf(await screen.findByTestId('payments-payments-stripe-path-error'))).toContain('The path could not be saved.');
  });

  it('says in the dialog when stopping new payments was refused', async () => {
    const { user } = renderPage(setup(), { status: 409, body: { error: { code: 'CONFLICT', message: 'Payments could not be stopped.' } } });
    await user.click(await screen.findByRole('switch', { name: 'Stop new payments' }));
    await user.click(screen.getByRole('button', { name: 'Stop new payments' }));
    expect(within(await screen.findByRole('dialog')).getByRole('alert').textContent).toContain('Payments could not be stopped.');
  });

  it('says on the card when taking payments again was refused', async () => {
    const { user } = renderPage(setup({ services: [stripe({ stopped: true })] }), { status: 409, body: { error: { code: 'CONFLICT', message: 'Payments could not be started again.' } } });
    await user.click(await screen.findByRole('switch', { name: 'Stop new payments' }));
    expect(textOf(await screen.findByTestId('payments-payments-stripe-stop-error'))).toContain('Payments could not be started again.');
  });

  it('says on every tab when the setup could not be read', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(500, { error: { code: 'INTERNAL', message: 'The database is not answering.' } }))));
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PageActionsProvider>
          <PaymentsPage onOpenSettings={() => undefined} />
        </PageActionsProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('payments-load-error')).toBeTruthy();
    const user = userEvent.setup();
    for (const [tab, id] of [['Ways to pay', 'ways'], ['What can be paid', 'payables'], ['Pay page', 'page']] as const) {
      await user.click(screen.getByRole('tab', { name: tab }));
      expect(textOf(await screen.findByTestId(`payments-load-error-${id}`))).toContain('The database is not answering.');
    }
  });

  it('says when no payment service is installed', async () => {
    renderPage(setup({ services: [] }));
    expect(textOf(await screen.findByTestId('payments-no-services'))).toContain('No payment service is installed.');
  });

  it('sends a test payment once the test key is checked, and shows the round trip', async () => {
    const checked = mode({ check: { at: 1, ok: true, code: null, message: null, missing: [] } });
    const data = setup({ services: [stripe({ test: checked })] });
    let trip = { label: 'TEST-ABCD', service: 'payments-stripe', amount: '1.00', currency: 'EUR', state: 'open', taken: null as null | { amount: string; currency: string }, paidWith: null as string | null, webhookArrived: false, recorded: false };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/payments/setup') return Promise.resolve(jsonResponse(200, { data }));
        if (url === '/api/v1/payments/test-payments' && init?.method === 'POST') {
          return Promise.resolve(jsonResponse(200, { data: { rowKey: 'paytest_abc', label: 'TEST-ABCD', url: 'https://admin.example.test/pay/AAAAAAAAAAAAAAAAAAAAAA', amount: '1.00', currency: 'EUR' } }));
        }
        if (url === '/api/v1/payments/test-payments/paytest_abc') return Promise.resolve(jsonResponse(200, { data: trip }));
        return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } }));
      }),
    );
    const opened = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PageActionsProvider>
          <PaymentsPage onOpenSettings={() => undefined} />
        </PageActionsProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('payments-payments-stripe-test-send'));
    await waitFor(() => expect(opened.location.href).toBe('https://admin.example.test/pay/AAAAAAAAAAAAAAAAAAAAAA'));
    expect(await screen.findByText(/Use the Stripe test card 4242 4242 4242 4242\./)).toBeTruthy();
    trip = { ...trip, state: 'recorded', taken: { amount: '1.00', currency: 'EUR' }, paidWith: 'Visa ••4242', webhookArrived: true, recorded: true };
    const shown = await screen.findByTestId('payments-payments-stripe-test-trip', {}, { timeout: 6000 });
    expect(textOf(shown)).toContain('took €1.00 (Test)');
    expect(textOf(shown)).toContain('the webhook arrived');
    expect(textOf(shown)).toContain('this is what would be recorded: one payment of €1.00, Visa ••4242.');
    expect(textOf(shown)).toContain('Nothing was written to your tables.');
    open.mockRestore();
  }, 15_000);
});
