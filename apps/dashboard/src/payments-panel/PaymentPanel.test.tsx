// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record page's Payment panel and its Record-a-payment dialog, state by
 * state against a pretend server: what each state says, which actions each
 * person gets, the card fields and their refusals, and what is sent.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppToastProvider } from '../pages/toasts.js';
import type { PanelPayment, PanelRefund, PaymentPanelView } from './paymentPanelApi.js';
import PaymentPanel from './PaymentPanel.js';
import { holdsCardNumber, moreThan, typedAmount } from './paymentText.js';

const RECORD = { connectionId: 'conn_1', table: 'main.invoices', recordId: '42' };

function viewOf(patch: Partial<PaymentPanelView> = {}): PaymentPanelView {
  return {
    payable: { kind: 'shape', connectionId: 'conn_1', tableName: 'main.invoices', rowKey: '42' },
    label: 'INV-0042',
    currency: 'EUR',
    total: '120.00',
    due: '120.00',
    paid: '0.00',
    refusal: null,
    links: { on: true, reason: null },
    mayChange: true,
    mayRecord: true,
    mayRefund: false,
    waiting: [],
    payments: [],
    ...patch,
  };
}

/** A payment as the server lists it: by hand unless the patch names its online payment. */
function paymentOf(patch: Partial<PanelPayment> = {}): PanelPayment {
  return { id: 'kept:1', number: 'REC-0012', amount: '120.00', currency: 'EUR', refunded: '0', way: 'card', wayLabel: 'Visa ••4242', provider: 'payments-stripe', test: false, paidOn: '2026-10-20', recordedBy: null, cardLast4: null, attemptId: null, refundable: '0', refundRefusal: null, refunds: [], dispute: null, ...patch };
}

let calls: { url: string; body: unknown }[];
let answers: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  answers = { '/api/v1/payments/links/current': { data: null } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
      const found = Object.entries(answers).find(([path]) => String(url).endsWith(path));
      if (found === undefined) return new Response('{}', { status: 404 });
      if (found[1] instanceof Response) return found[1];
      return new Response(JSON.stringify(found[1]), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function show(view: PaymentPanelView): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <AppToastProvider>{node}</AppToastProvider>
    </QueryClientProvider>
  );
  await act(async () => {
    render(wrap(<PaymentPanel record={RECORD} view={view} />));
  });
}

describe('the Payment panel', () => {
  it('shows what is due and offers a pay link and a payment by hand to whoever may change the record', async () => {
    await show(viewOf());
    expect(screen.getByText('Balance due')).toBeTruthy();
    expect(screen.getByText('€120.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy pay link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record a payment' })).toBeTruthy();
  });

  it('gives a reader the figures and no action', async () => {
    await show(viewOf({ mayChange: false, mayRecord: false }));
    expect(screen.getByText('€120.00')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    // No link is asked for on their behalf.
    expect(calls.some((call) => call.url.endsWith('/links/current'))).toBe(false);
  });

  it('says to send a draft first, with nothing to press', async () => {
    await show(viewOf({ refusal: { code: 'NOT_SENT', message: 'Send the invoice first.' }, mayRecord: false }));
    expect(screen.getByText('Send the invoice first. A payment can only be recorded against a sent invoice.')).toBeTruthy();
    expect(screen.queryByText('Balance due')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('turns pay links off where customers cannot reach the server, and still records by hand', async () => {
    await show(viewOf({ links: { on: false, reason: 'private-network' } }));
    expect(screen.getByText('Customers cannot reach this server, so pay links are off. You can still record payments.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy pay link' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Record a payment' })).toBeTruthy();
  });

  it('says a table needs its app’s update for online payments, and offers only a payment by hand', async () => {
    await show(viewOf({ refusal: { code: 'NEEDS_UPDATE', message: '' } }));
    expect(screen.getByText("This invoice table needs its app's update to take online payments.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy pay link' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Record a payment' })).toBeTruthy();
  });

  it('shows a payment waiting for the bank, hides the pay link, and warns in the dialog', async () => {
    const user = userEvent.setup();
    await show(viewOf({ waiting: [{ id: 'att_1', provider: 'payments-stripe', wayLabel: 'SEPA Direct Debit', startedAt: Date.UTC(2026, 9, 20), test: false }] }));
    expect(screen.getByText(/^Payment by SEPA Direct Debit started (20 Oct|Oct 20) · waiting for the bank$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy pay link' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Record a payment' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('An online payment is waiting for the bank. Recording another one may take the money twice.')).toBeTruthy();
  });

  it('lists each payment as one line: an online one with its service and a test badge, one by hand with who recorded it', async () => {
    await show(
      viewOf({
        due: '0.00',
        paid: '120.00',
        mayRecord: false,
        payments: [
          paymentOf({ id: 'kept:1', number: 'REC-0012', amount: '70.00', refunded: '0', way: 'card', wayLabel: 'Visa ••4242', provider: 'payments-stripe', test: true, paidOn: '2026-10-20', recordedBy: null, cardLast4: null }),
          paymentOf({ id: 'row:2', number: 'REC-0013', amount: '50.00', refunded: '0', way: 'card', wayLabel: null, provider: null, test: false, paidOn: '2026-10-21', recordedBy: 'Tom Becker', cardLast4: '4242' }),
        ],
      }),
    );
    const list = screen.getByRole('list', { name: 'Payments on this record' });
    const [online, byHand] = within(list).getAllByRole('listitem');
    expect(online!.textContent).toContain('Visa ••4242');
    expect(online!.textContent).toContain('Stripe');
    expect(online!.textContent).toContain('recorded by Online payment (Stripe)');
    expect(within(online!).getByText('Test')).toBeTruthy();
    expect(byHand!.textContent).toContain('by card on our own terminal ••4242');
    expect(byHand!.textContent).toContain('recorded by Tom Becker');
    expect(byHand!.textContent).toMatch(/REC-0013 · (21 Oct|Oct 21)/);
    expect(screen.getByText('Paid in full')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy pay link' })).toBeNull();
  });

  it('reopens the balance after a refund: the refunded part is said, and both actions come back', async () => {
    await show(
      viewOf({
        due: '40.00',
        paid: '80.00',
        payments: [paymentOf({ id: 'kept:1', number: 'REC-0012', amount: '120.00', refunded: '40.00', way: 'card', wayLabel: 'Visa ••4242', provider: 'payments-stripe', test: false, paidOn: '2026-10-20', recordedBy: null, cardLast4: null })],
      }),
    );
    expect(screen.getByText('€40.00', { selector: 'bdi.text-\\[20px\\]' })).toBeTruthy();
    expect(screen.getByText('refunded €40.00')).toBeTruthy();
    expect(screen.queryByText('Paid in full')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy pay link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record a payment' })).toBeTruthy();
  });

  it('copies a new pay link and says when it replaced the last one; revokes one', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    answers['/api/v1/payments/links/current'] = { data: { id: 'pl_1', url: 'https://pay.example/pay/AAA', mode: 'live', expiresAt: Date.UTC(2026, 10, 18), createdAt: Date.UTC(2026, 9, 19) } };
    answers['/api/v1/payments/links'] = { data: { link: { id: 'pl_2', url: 'https://pay.example/pay/BBB', mode: 'live', expiresAt: Date.UTC(2026, 10, 20), createdAt: Date.UTC(2026, 9, 21) }, replaced: true } };
    answers['/api/v1/payments/links/pl_1/revoke'] = new Response(null, { status: 204 });
    await show(viewOf());
    expect(await screen.findByText(/^Pay link made (19 Oct|Oct 19) · works until (18 Nov|Nov 18)$/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy pay link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://pay.example/pay/BBB'));
    expect(await screen.findByText(/^A new pay link replaces the one made on (19 Oct|Oct 19)\.$/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Pay link revoked. The old address no longer works.')).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith('/links/pl_1/revoke'))).toBe(true);
  });
});

describe('refunds and disputes on the Payment panel', () => {
  const ONLINE = { attemptId: 'pat_1', refundable: '120.00' };

  it('offers Refund… only to whoever may refund, and says why when it cannot be now', async () => {
    const user = userEvent.setup();
    await show(viewOf({ due: '0.00', paid: '120.00', mayRecord: false, payments: [paymentOf(ONLINE)] }));
    expect(screen.queryByRole('button', { name: 'More for REC-0012' })).toBeNull();
    cleanup();
    await show(
      viewOf({
        due: '0.00',
        paid: '120.00',
        mayRecord: false,
        mayRefund: true,
        payments: [
          paymentOf({ ...ONLINE, refundable: '0', refundRefusal: { code: 'FULLY_REFUNDED', message: 'This payment is fully refunded.' }, refunded: '120.00' }),
          paymentOf({ id: 'row:2', number: 'REC-0013', provider: null, wayLabel: null, recordedBy: 'Tom Becker' }),
        ],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'More for REC-0012' }));
    const item = await screen.findByRole('menuitem', { name: 'Refund…' });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(item.getAttribute('aria-describedby')!)?.textContent).toBe('This payment is fully refunded.');
    await user.click(item);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'More for REC-0013' }));
    const byHand = await screen.findByRole('menuitem', { name: 'Refund…' });
    expect(document.getElementById(byHand.getAttribute('aria-describedby')!)?.textContent).toBe('This way to pay cannot be refunded online. Refund the customer by hand.');
  });

  it('refunds in two steps: Full or Part under the most that is left, then the question with focus on Back, with one key', async () => {
    const user = userEvent.setup();
    answers['/api/v1/payments/attempts/pat_1/refund'] = { data: { label: 'INV-0042', provider: 'payments-stripe', test: false, taken: '120.00', currency: 'EUR', refundable: '120.00', paidWith: 'Visa ••4242', refusal: null } };
    answers['/api/v1/payments/refunds'] = { data: { refund: { id: 'rf_1', attemptId: 'pat_1', amount: '40.00', currency: 'EUR', state: 'pending', source: 'staff', failureMessage: null, createdAt: Date.now(), settledAt: null }, fresh: true } };
    await show(viewOf({ due: '0.00', paid: '120.00', mayRecord: false, mayRefund: true, payments: [paymentOf(ONLINE)] }));
    await user.click(screen.getByRole('button', { name: 'More for REC-0012' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Refund…' }));
    const dialog = await screen.findByRole('dialog', { name: /Refund a payment/ });
    expect(await within(dialog).findByText('Up to €120.00 can be refunded')).toBeTruthy();
    expect(within(dialog).getByText('REC-0012 · €120.00 · Visa ••4242')).toBeTruthy();
    const amount = within(dialog).getByLabelText('Amount', { selector: 'input' }) as HTMLInputElement;
    expect(amount.value).toBe('120.00');
    expect(amount.readOnly).toBe(true);
    await user.click(within(dialog).getByRole('radio', { name: 'Part' }));
    expect(amount.readOnly).toBe(false);
    const go = within(dialog).getByRole('button', { name: 'Continue' });
    await user.type(amount, '120.01');
    expect(go.getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getByText('Up to €120.00 can be refunded').className).toContain('text-danger');
    await user.clear(amount);
    await user.type(amount, '40');
    await user.click(within(dialog).getByRole('radio', { name: 'Duplicate' }));
    expect(within(dialog).getByText('Goes back to Visa ••4242. Usually 5–10 days.')).toBeTruthy();
    await user.click(go);
    const confirm = await screen.findByRole('dialog', { name: /Refund €40\.00 to Visa ••4242\?/ });
    expect(within(confirm).getByText("This can't be undone.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Back' })));
    await user.click(within(confirm).getByRole('button', { name: 'Refund' }));
    expect(await screen.findByText('Refund of €40.00 requested.')).toBeTruthy();
    const sent = calls.filter((call) => call.url.endsWith('/api/v1/payments/refunds'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ attemptId: 'pat_1', amount: '40', reason: 'duplicate', note: null });
    expect(String((sent[0]!.body as { key: string }).key)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('says each refund under its payment: asked, failed in the service’s words, made in its dashboard; a done one inline', async () => {
    const at = Date.UTC(2026, 9, 22);
    const refund = (patch: Partial<PanelRefund> & { id: string }): PanelRefund => ({ attemptId: 'pat_1', amount: '40.00', currency: 'EUR', state: 'succeeded', source: 'staff', failureMessage: null, createdAt: at, settledAt: at, ...patch, id: `rf_${patch.id}` });
    await show(
      viewOf({
        due: '60.00',
        paid: '60.00',
        payments: [
          paymentOf({
            ...ONLINE,
            refunded: '60.00',
            refundable: '20.00',
            refunds: [refund({ id: 'a' }), refund({ id: 'b', amount: '10.00', state: 'pending', settledAt: null }), refund({ id: 'c', amount: '30.00', state: 'failed', failureMessage: 'The card was closed.' }), refund({ id: 'd', amount: '20.00', source: 'provider' })],
          }),
        ],
      }),
    );
    expect(screen.getByText(/^refunded €40\.00 on (22 Oct|Oct 22)$/)).toBeTruthy();
    expect(screen.getByText('Refund of €10.00 requested')).toBeTruthy();
    expect(screen.getByText('The refund of €30.00 failed: The card was closed. Contact the customer and record what you agree.')).toBeTruthy();
    expect(screen.getByText(/^Refund of €20\.00 made in the Stripe dashboard on (22 Oct|Oct 22) · recorded$/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Needs a look' }).getAttribute('href')).toBe('/studio/payments?tab=activity');
  });

  it('shows an open dispute as a danger notice and a badge, and a closed one as where to read its outcome', async () => {
    await show(viewOf({ due: '0.00', paid: '120.00', mayRecord: false, payments: [paymentOf({ ...ONLINE, dispute: { state: 'open', at: Date.now(), closedAt: null } })] }));
    expect(screen.getByText('Disputed — answer it in the Stripe dashboard')).toBeTruthy();
    expect(screen.getByText('If the dispute is lost, the money goes back to the customer. The invoice is not changed by itself.')).toBeTruthy();
    expect(screen.getByText('Disputed')).toBeTruthy();
    cleanup();
    await show(viewOf({ due: '0.00', paid: '120.00', mayRecord: false, payments: [paymentOf({ ...ONLINE, dispute: { state: 'closed', at: 1, closedAt: 2 } })] }));
    expect(screen.getByText('The dispute was closed. Its outcome is in the Stripe dashboard.')).toBeTruthy();
    expect(screen.queryByText('Disputed')).toBeNull();
  });
});

describe('the Record-a-payment dialog', () => {
  it('emails a new live pay link to the record’s customer, and says it is on its way', async () => {
    const user = userEvent.setup();
    answers['/api/v1/payments/links'] = { data: { link: { id: 'plk_1', url: 'https://pay.crumbandco.de/pay/AAAAAAAAAAAAAAAAAAAAAA', mode: 'live', expiresAt: Date.now() + 86_400_000, createdAt: Date.now() }, replaced: false } };
    answers['/api/v1/payments/links/plk_1/email'] = { data: { queued: true, to: 'lena@example.com' } };
    await show(viewOf());
    await user.click(screen.getByRole('button', { name: 'Email pay link' }));
    expect(await screen.findByText('The pay link is on its way to lena@example.com.')).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith('/api/v1/payments/links/plk_1/email'))).toBe(true);
  });

  it('starts on the amount due, asks for the card slip’s fields only for a card, and refuses what it must', async () => {
    const user = userEvent.setup();
    await show(viewOf());
    await user.click(screen.getByRole('button', { name: 'Record a payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a payment' });
    const amount = within(dialog).getByLabelText('Amount');
    await waitFor(() => expect(document.activeElement).toBe(amount));
    expect((amount as HTMLInputElement).value).toBe('120.00');
    const submit = within(dialog).getByRole('button', { name: 'Record payment' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).queryByLabelText('Approval code')).toBeNull();

    await user.selectOptions(within(dialog).getByLabelText('Way to pay'), 'card');
    const approval = within(dialog).getByLabelText('Approval code');
    const last4 = within(dialog).getByLabelText('Last four digits');
    await user.type(approval, 'A7K29Q');
    await user.type(last4, '4242 1881');
    await user.tab();
    expect(within(dialog).getByText('Enter the last four digits only.')).toBeTruthy();
    expect(last4.getAttribute('aria-invalid')).toBe('true');
    await user.clear(last4);
    await user.type(last4, '4242');

    const note = within(dialog).getByLabelText('Note');
    await user.type(note, 'Paid with card 4242 4242 4242 4242');
    await user.tab();
    expect(within(dialog).getByText('This looks like a full card number. Never write card numbers here.')).toBeTruthy();
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await user.clear(note);

    await user.clear(amount);
    await user.type(amount, '130');
    await user.tab();
    expect(within(dialog).getByText('That is more than the €120.00 that is due.')).toBeTruthy();
  });

  it('sends one payment with its key, says it was recorded, and closes', async () => {
    const user = userEvent.setup();
    answers['/api/v1/payments/record-payment'] = { data: { key: 'k', already: false, due: '70.00' } };
    await show(viewOf());
    await user.click(screen.getByRole('button', { name: 'Record a payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a payment' });
    const amount = within(dialog).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '50');
    await user.selectOptions(within(dialog).getByLabelText('Way to pay'), 'cash');
    await user.type(within(dialog).getByLabelText('Note'), 'At the counter');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText('Payment of €50.00 recorded.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sent = calls.find((call) => call.url.endsWith('/record-payment'))!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ connectionId: 'conn_1', table: 'main.invoices', recordId: '42', amount: '50', way: 'cash', note: 'At the counter', approvalCode: null, last4: null });
    expect(String(sent['key'])).toMatch(/^[0-9a-f]{32}$/);
    expect(String(sent['paidOn'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows the server’s refusal under the field it names', async () => {
    const user = userEvent.setup();
    answers['/api/v1/payments/record-payment'] = new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'More than the 70.00 EUR that is due.', details: { field: 'amount', reason: 'BALANCE_EXCEEDED' } } }), { status: 422 });
    await show(viewOf());
    await user.click(screen.getByRole('button', { name: 'Record a payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a payment' });
    await user.selectOptions(within(dialog).getByLabelText('Way to pay'), 'bank-transfer');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await within(dialog).findByText('More than the 70.00 EUR that is due.')).toBeTruthy();
    expect(within(dialog).getByLabelText('Amount').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('the panel’s small rules', () => {
  it('finds a card number only where it passes the check', () => {
    expect(holdsCardNumber('4242 4242 4242 4242')).toBe(true);
    expect(holdsCardNumber('DE89 3704 0044 0532 0130 00')).toBe(false);
    expect(holdsCardNumber('4242')).toBe(false);
  });

  it('reads a typed amount and compares amounts exactly', () => {
    expect(typedAmount(' 12,50 ')).toBe('12.50');
    expect(typedAmount('12.5.0')).toBeNull();
    expect(moreThan('120.01', '120.00')).toBe(true);
    expect(moreThan('120', '120.00')).toBe(false);
    expect(moreThan('0.1', '0.09')).toBe(true);
  });
});
