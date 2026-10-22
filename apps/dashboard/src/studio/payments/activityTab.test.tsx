// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Activity, against a pretend server:
 *
 *  1. "Needs a look" says each flag's sentence and offers "Mark as checked",
 *     which needs a note where money may be owed back, sends it, and leaves
 *     the row in place with who checked it;
 *  2. someone who may only see payments reads it all, exports it, and is
 *     offered nothing to act on;
 *  3. the list filters on the server, opens a row's story in a drawer, and
 *     says when there is nothing, nothing that matches, or an error;
 *  4. a webhook that went quiet while the sweep found a payment sends the
 *     person to Setup.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';

import { ActivityTab } from './ActivityTab.js';
import type { ActivityRow } from './activityApi.js';
import type { ModeView, ServiceView } from './paymentsApi.js';

const NOW = Date.UTC(2026, 9, 20, 10, 2);

function row(patch: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 'pat_1',
    kind: 'attempt',
    at: NOW,
    service: 'payments-stripe',
    mode: 'live',
    payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_42', label: 'INV-0042' },
    amount: '120.00',
    currency: 'EUR',
    state: 'recorded',
    paidWith: 'Visa ••4242',
    way: 'card',
    group: 'paid',
    asked: { amount: '120.00', currency: 'EUR' },
    times: { started: NOW, settled: NOW + 60_000, recorded: NOW + 61_000, updated: NOW + 61_000 },
    refs: { attempt: 'pat_1', checkout: 'cs_live_a1', payment: 'pi_3Q8f', refund: null },
    refundSource: null,
    flag: null,
    check: null,
    refund: null,
    dispute: null,
    ...patch,
  };
}

const NOT_RECORDED = row({ id: 'pat_51', payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_51', label: 'INV-0051' }, amount: '80.00', asked: { amount: '80.00', currency: 'EUR' }, state: 'record_refused', flag: { code: 'paid-not-recorded', reason: 'ALREADY_PAID', message: 'This invoice is paid.' } });
const DIFFERS = row({ id: 'pat_50', payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_50', label: 'INV-0050' }, amount: '100.00', state: 'record_refused', flag: { code: 'amount-differs', reason: 'AMOUNT_DIFFERS', message: 'x' } });
const AT_STRIPE = row({ id: 'prf_1', kind: 'refund', amount: '20.00', asked: { amount: '20.00', currency: 'EUR' }, state: 'succeeded', group: 'refunded', refundSource: 'provider', flag: { code: 'refunded-at-provider', reason: null, message: null } });

function mode(over: Partial<ModeView> = {}): ModeView {
  return { fields: [], check: null, accountId: null, webhookUrl: null, firstEventAt: null, firstPaymentAt: null, ...over };
}

const STRIPE: ServiceView = { key: 'payments-stripe', name: 'Card payments', description: { key: 'x', fallback: 'x' }, status: 'enabled', loaded: true, hasPaths: true, path: null, stopped: false, liveOn: true, test: mode(), live: mode(), checklist: [] } as unknown as ServiceView;

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stub(answers: { open?: ActivityRow[]; list?: ActivityRow[] | 'error'; count?: number; mayRefund?: boolean; more?: Record<string, unknown> } = {}): Call[] {
  const calls: Call[] = [];
  let open = answers.open ?? [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) });
      if (url === '/api/v1/bootstrap' && answers.mayRefund === true) return Promise.resolve(jsonResponse(200, { data: { roles: [], systemActions: ['payments.view', 'payments.manage', 'payments.refund'] } }));
      const extra = Object.entries(answers.more ?? {}).find(([path]) => url === path);
      if (extra !== undefined) return Promise.resolve(jsonResponse(200, extra[1]));
      if (url === '/api/v1/payments/activity/count') return Promise.resolve(jsonResponse(200, { data: { open: answers.count ?? open.length } }));
      if (url === '/api/v1/payments/activity?open=1') return Promise.resolve(jsonResponse(200, { data: { rows: open, more: false, next: null } }));
      if (url.startsWith('/api/v1/payments/activity/attempts/') && method === 'POST') {
        open = open.filter((one) => !url.includes(one.id));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.startsWith('/api/v1/payments/activity.csv')) return Promise.resolve(new Response('when\r\n', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="payments-activity.csv"' } }));
      if (url.startsWith('/api/v1/payments/activity')) {
        if (answers.list === 'error') return Promise.resolve(jsonResponse(500, { error: { code: 'INTERNAL', message: 'down' } }));
        const filtered = url.includes('state=failed') ? [] : (answers.list ?? []);
        return Promise.resolve(jsonResponse(200, { data: { rows: filtered, more: false, next: null } }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } }));
    }),
  );
  return calls;
}

function show(props: { canManage?: boolean; services?: ServiceView[]; onOpenSetup?: () => void } = {}) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AppToastProvider>
        <ActivityTab services={props.services ?? [STRIPE]} canManage={props.canManage ?? true} onOpenSetup={props.onOpenSetup ?? (() => undefined)} />
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const textOf = (element: Element | null): string => element?.textContent ?? '';

describe('ActivityTab', () => {
  beforeAll(installTestI18n);
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('says each flag in its own words, with the count', async () => {
    stub({ open: [NOT_RECORDED, DIFFERS, { ...AT_STRIPE, payable: null }], list: [row()] });
    show();
    const card = await screen.findByTestId('activity-needs-look');
    await waitFor(() => expect(textOf(screen.getByTestId('activity-needs-look-count'))).toBe('3'));
    expect(textOf(card)).toContain('Paid at Stripe, not recorded: INV-0051 · €80.00. The invoice was already paid in full.');
    expect(textOf(card)).toContain('Paid, but the amount differs: Stripe took €100.00, the invoice was for €120.00.');
    expect(textOf(card)).toContain('Refunded in the Stripe dashboard: €20.00. Recorded.');
    expect(within(card).getAllByRole('button', { name: 'Mark as checked' })).toHaveLength(3);
  });

  it('says why the record did not follow a refund, by what went wrong', async () => {
    const refund = (id: string, reason: string) => ({ ...AT_STRIPE, id, refundSource: 'staff' as const, flag: { code: 'refund-record' as const, reason, message: null } });
    stub({ open: [refund('rfd_1', 'NOT_WRITTEN'), refund('rfd_2', 'RECORD_GONE'), refund('rfd_3', 'MORE_THAN_PAID'), refund('rfd_4', 'CURRENCY_DIFFERS')], list: [] });
    show();
    const card = await screen.findByTestId('activity-needs-look');
    await waitFor(() => expect(textOf(screen.getByTestId('activity-needs-look-count'))).toBe('4'));
    expect(textOf(card)).toContain('Refunded €20.00, but it could not be written to INV-0042 yet. It is tried again by itself.');
    expect(textOf(card)).toContain('Refunded €20.00, but the payment it refunds is no longer in INV-0042. Nothing was written.');
    expect(textOf(card)).toContain('Refunds on INV-0042 now stand above what was paid. The record shows what was paid as refunded, and no more.');
    expect(textOf(card)).toContain('Refunded €20.00 at Stripe, in another currency than INV-0042 was paid in. Nothing was written to the record.');
  });

  it('asks for a note before marking money that may be owed back as checked, then keeps the row with who checked it', async () => {
    const calls = stub({ open: [NOT_RECORDED], list: [] });
    const user = show();
    await user.click(await screen.findByRole('button', { name: 'Mark as checked' }));
    const dialog = await screen.findByRole('dialog');
    expect(textOf(dialog)).toContain('Paid at Stripe, not recorded: INV-0051');
    expect(within(dialog).getByText('Note (required)')).toBeTruthy();
    await user.click(screen.getByTestId('activity-check-save'));
    expect(await within(dialog).findByText('Say what you checked.')).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await user.type(screen.getByTestId('activity-check-note'), 'Refunded by bank transfer.');
    await user.click(screen.getByTestId('activity-check-save'));
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.url).toBe('/api/v1/payments/activity/attempts/pat_51/check'));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ note: 'Refunded by bank transfer.' });
    const checked = await screen.findByTestId('activity-checked-pat_51');
    expect(textOf(checked)).toBe('Checked by you · Refunded by bank transfer.');
    await waitFor(() => expect(document.activeElement).toBe(checked));
    expect(await screen.findByText('Marked as checked')).toBeTruthy();
  });

  it('shows who checked a flag before, by name', async () => {
    stub({ open: [], list: [] });
    show();
    expect(await screen.findByTestId('activity-nothing-needs-look')).toBeTruthy();
    cleanup();
    stub({ open: [{ ...AT_STRIPE, check: { at: NOW, by: 'usr_1', byName: 'Mara Lind', note: 'Matches the refund Lena asked for by email.' } }] });
    show();
    expect(textOf(await screen.findByTestId('activity-checked-prf_1'))).toBe('Checked by Mara Lind · Matches the refund Lena asked for by email.');
  });

  it('offers a refund on a flag where money may be owed back, only to whoever may refund, through the two-step refund', async () => {
    const refundable = { ...NOT_RECORDED, refund: { refundable: '80.00', refusal: null } };
    stub({ open: [refundable, { ...DIFFERS, refund: { refundable: '100.00', refusal: null } }], list: [] });
    show();
    await screen.findByText(/Paid at Stripe, not recorded/);
    expect(screen.queryByRole('button', { name: /^Refund/ })).toBeNull();
    cleanup();
    const calls = stub({
      open: [refundable, { ...DIFFERS, refund: { refundable: '100.00', refusal: null } }, { ...AT_STRIPE }],
      list: [],
      mayRefund: true,
      more: {
        '/api/v1/payments/attempts/pat_51/refund': { data: { label: 'INV-0051', provider: 'payments-stripe', test: false, taken: '80.00', currency: 'EUR', refundable: '80.00', paidWith: 'Visa ••4242', refusal: null } },
        '/api/v1/payments/refunds': { data: { refund: { id: 'rf_9', attemptId: 'pat_51', amount: '80.00', currency: 'EUR', state: 'pending', source: 'staff', failureMessage: null, createdAt: NOW, settledAt: null }, fresh: true } },
      },
    });
    const user = show();
    await user.click(await screen.findByRole('button', { name: 'Refund €80.00' }));
    expect(screen.getAllByRole('button', { name: 'Refund' })).toHaveLength(1);
    const dialog = await screen.findByRole('dialog', { name: /Refund a payment/ });
    expect(await within(dialog).findByText('Up to €80.00 can be refunded')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const confirm = await screen.findByRole('dialog', { name: /Refund €80\.00 to Visa ••4242\?/ });
    await user.click(within(confirm).getByRole('button', { name: 'Refund' }));
    expect(await screen.findByText('Refund of €80.00 requested.')).toBeTruthy();
    expect(calls.find((call) => call.url === '/api/v1/payments/refunds')?.body).toMatchObject({ attemptId: 'pat_51', amount: '80.00', reason: 'requested_by_customer' });
  });

  it('says a disputed payment needs answering in the service, in the list, the flag and its story', async () => {
    const disputed = row({ id: 'pat_33', group: 'disputed', flag: { code: 'disputed', reason: null, message: null }, refund: { refundable: '120.00', refusal: { code: 'DISPUTED', message: 'x' } }, dispute: { state: 'open', at: NOW + 3_600_000, closedAt: null } });
    stub({ open: [disputed], list: [disputed], mayRefund: true });
    const user = show();
    const card = await screen.findByTestId('activity-needs-look');
    await waitFor(() => expect(textOf(card)).toContain('Disputed: INV-0042 · €120.00. Answer it in the Stripe dashboard.'));
    // Refunds wait for the dispute: no refund here, and "Mark as checked" needs no note.
    expect(within(card).queryByRole('button', { name: /^Refund/ })).toBeNull();
    const table = await screen.findByTestId('activity-table');
    expect(textOf(table)).toContain('Disputed');
    await user.click(within(table).getByRole('button', { name: /INV-0042/ }));
    const drawer = await screen.findByTestId('activity-drawer');
    expect(textOf(drawer)).toContain('Dispute opened by the card holder');
    expect(textOf(drawer)).toContain('Answer it in the Stripe dashboard');
  });

  it('dates a dispute by when it opened, and says a lost one went back to the customer', async () => {
    const opened = NOW + 18 * 60_000;
    const stampOf = (at: number) => new Intl.DateTimeFormat('en-US-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
    const disputed = row({ id: 'pat_34', group: 'disputed', lookAt: opened, flag: { code: 'disputed', reason: null, message: null }, dispute: { state: 'open', at: opened, closedAt: null, outcome: null } });
    const lost = row({ id: 'prf_9', kind: 'refund', at: opened + 60_000, lookAt: opened + 60_000, state: 'succeeded', group: 'refunded', refundSource: 'dispute', flag: { code: 'dispute-lost', reason: null, message: null } });
    stub({ open: [disputed, lost], list: [lost, row({ id: 'pat_35', dispute: { state: 'closed', at: opened, closedAt: opened + 60_000, outcome: 'lost' } })] });
    const user = show();
    const card = await screen.findByTestId('activity-needs-look');
    await waitFor(() => expect(textOf(card)).toContain('Dispute lost: €120.00 went back to the customer on INV-0042. Recorded as a refund.'));
    expect(textOf(screen.getByTestId('activity-flag-pat_34'))).toContain(stampOf(opened));
    expect(textOf(screen.getByTestId('activity-flag-pat_34'))).not.toContain(stampOf(NOW));
    const table = await screen.findByTestId('activity-table');
    await user.click(within(table).getAllByRole('button', { name: /INV-0042/ })[1]!);
    expect(textOf(await screen.findByTestId('activity-drawer'))).toContain('The dispute was lost: the money went back to the customer.');
  });

  it('lets someone who may only see payments read and export, with nothing to act on', async () => {
    const calls = stub({ open: [NOT_RECORDED], list: [row()] });
    const user = show({ canManage: false });
    expect(textOf(await screen.findByTestId('activity-view-only'))).toBe('You can view payments. Ask someone who manages payments to act.');
    await screen.findByText(/Paid at Stripe, not recorded/);
    expect(screen.queryByRole('button', { name: 'Mark as checked' })).toBeNull();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    await user.click(screen.getByTestId('activity-export'));
    expect(await screen.findByText('Downloaded payments-activity.csv')).toBeTruthy();
    expect(calls.some((call) => call.url === '/api/v1/payments/activity.csv')).toBe(true);
  });

  it('lists every payment, filters on the server, and opens one row’s story', async () => {
    const calls = stub({ open: [], list: [row()] });
    const user = show();
    const table = await screen.findByTestId('activity-table');
    expect(textOf(table)).toContain('INV-0042');
    expect(textOf(table)).toContain('Visa ••4242 · Stripe');
    expect(textOf(table)).toContain('€120.00');
    expect(textOf(table)).toContain('Paid');
    await user.click(within(table).getByRole('button', { name: /INV-0042/ }));
    const drawer = await screen.findByTestId('activity-drawer');
    expect(textOf(drawer)).toContain('Started');
    expect(textOf(drawer)).toContain('Stripe says paid');
    expect(textOf(drawer)).toContain('Recorded');
    expect(textOf(drawer)).toContain('pi_3Q8f');
    expect(within(drawer).getByRole('button', { name: 'Copy Stripe payment id' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.selectOptions(screen.getByTestId('activity-filter-state'), 'failed');
    await waitFor(() => expect(calls.some((call) => call.url === '/api/v1/payments/activity?state=failed')).toBe(true));
    expect(await screen.findByText('No payments match these filters.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByTestId('activity-table')).toBeTruthy();
  });

  it('says when there are no payments yet, and when they could not be loaded', async () => {
    stub({ open: [], list: [] });
    show();
    expect(textOf(await screen.findByTestId('activity-empty'))).toContain('No payments yet.');
    cleanup();
    stub({ open: [], list: 'error' });
    show();
    const failed = await screen.findByTestId('activity-load-error');
    expect(textOf(failed)).toContain('Could not load payments');
    expect(within(failed).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('sends the person to Setup when a webhook went quiet and the sweep found a payment', async () => {
    stub({ open: [], list: [] });
    const onOpenSetup = vi.fn();
    const quiet = { ...STRIPE, live: mode({ health: { lastEventAt: Date.now() - 6 * 3_600_000, lastBadAt: null, badThisHour: 0, caughtAt: Date.now() - 60_000, slowed: false } }) };
    const user = show({ services: [quiet], onOpenSetup });
    const item = await screen.findByTestId('activity-silent-payments-stripe:live');
    expect(textOf(item)).toContain('No webhook from Stripe for 6 hours. Adminium found a payment by checking Stripe.');
    await user.click(within(item).getByRole('button', { name: 'Open setup' }));
    expect(onOpenSetup).toHaveBeenCalled();
  });
});
