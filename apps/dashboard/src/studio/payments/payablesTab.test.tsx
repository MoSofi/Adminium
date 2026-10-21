// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → What can be paid.
 *
 * Mounted bare, with the transport stubbed at `fetch`:
 *
 *  1. every issue the check can raise has its own sentence;
 *  2. invoice-format tables are listed as ready, an old one with what it lacks;
 *  3. Stop asks first, and says what stops working;
 *  4. a whole-number amount asks its unit with nothing chosen, and Next waits;
 *  5. a person the server will not let mark the table is told why, and sees
 *     no rows;
 *  6. a table with its own payments table must name the unique column and its
 *     balance;
 *  7. someone who may only view gets no control.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';

import { PAYABLE_ISSUES, type PayableCheck, type PayablesList } from './paymentsApi.js';
import { issueSentence, PayablesTab } from './PayablesTab.js';

const INVOICES = {
  id: 'public.invoices',
  schema: 'public',
  name: 'invoices',
  rowCountEstimate: 12,
  columns: [
    { name: 'id', logicalType: 'integer', isPrimaryKey: true },
    { name: 'number', logicalType: 'text' },
    { name: 'total_cents', logicalType: 'integer' },
    { name: 'balance_cents', logicalType: 'integer' },
    { name: 'customer_email', logicalType: 'text', semantics: { flags: { pii: 'email' } } },
  ],
};
const PAYMENTS = {
  id: 'public.invoice_payments',
  schema: 'public',
  name: 'invoice_payments',
  rowCountEstimate: 30,
  columns: [
    { name: 'id', logicalType: 'integer', isPrimaryKey: true },
    { name: 'invoice_id', logicalType: 'integer' },
    { name: 'amount', logicalType: 'decimal' },
    { name: 'paid_at', logicalType: 'timestamp' },
    { name: 'method', logicalType: 'text' },
    { name: 'provider_ref', logicalType: 'text' },
  ],
};

const CLEAN: PayableCheck = { issues: [], mayMark: { ok: true, reason: null }, preview: [] };

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stub(list: PayablesList, check: PayableCheck = CLEAN): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) });
      if (url === '/api/v1/payments/payables' && method === 'GET') return Promise.resolve(jsonResponse(200, { data: list }));
      if (url === '/api/v1/payments/payables/check') return Promise.resolve(jsonResponse(200, { data: check }));
      if (url === '/api/v1/connections') return Promise.resolve(jsonResponse(200, { connections: [{ id: 'con_shop', name: 'Shop' }] }));
      if (url === '/api/v1/connections/con_shop/schema') return Promise.resolve(jsonResponse(200, { connectionId: 'con_shop', snapshotId: 's1', model: { tables: [INVOICES, PAYMENTS], enums: [] } }));
      if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } }));
    }),
  );
  return calls;
}

function renderTab(list: PayablesList, opts: { canManage?: boolean; check?: PayableCheck } = {}) {
  const calls = stub(list, opts.check);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PayablesTab canManage={opts.canManage ?? true} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), calls };
}

const EMPTY: PayablesList = { profiles: [], shapes: [] };
const PROFILE = { id: 'pay_1', connectionId: 'con_shop', tableName: 'public.invoices', enabled: true, valid: true, payments: 'kept' as const, updatedAt: 1 };

const textOf = (element: Element | null): string => element?.textContent ?? '';
const isBlocked = (element: Element): boolean => element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
const isChecked = (element: Element): boolean => (element as HTMLInputElement).checked === true || element.getAttribute('aria-checked') === 'true';

/** Opens the wizard on the invoices table and picks its amount column. */
async function openOnInvoices(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('payments-payables-set-up'));
  const connection = screen.getByTestId('payments-wizard-connection');
  await waitFor(() => expect(within(connection).getByRole('option', { name: 'Shop' })).toBeTruthy());
  await user.selectOptions(connection, 'con_shop');
  const table = screen.getByTestId('payments-wizard-table');
  await waitFor(() => expect(within(table).getByRole('option', { name: 'invoices' })).toBeTruthy());
  await user.selectOptions(table, 'public.invoices');
  await user.selectOptions(await screen.findByTestId('payments-wizard-amount'), 'total_cents');
}

describe('PayablesTab', () => {
  beforeAll(installTestI18n);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => vi.unstubAllGlobals());

  it.each(PAYABLE_ISSUES)('words the %s issue in its own sentence', (code) => {
    const sentence = issueSentence({ code, path: 'amount', column: 'total_cents' });
    expect(sentence).not.toBe('');
    expect(sentence).not.toContain(code);
    if (!['TABLE_UNAVAILABLE', 'NO_CURRENCY', 'REFERENCE_NOT_UNIQUE'].includes(code)) expect(sentence).toContain('total_cents');
  });

  it('asks for the unique column, and an unknown way-to-pay value, in plain words', () => {
    expect(issueSentence({ code: 'REFERENCE_NOT_UNIQUE', path: 'payments.reference', column: 'provider_ref' })).toBe('Choose the column that is unique for each payment.');
    expect(issueSentence({ code: 'METHOD_VALUE_UNKNOWN', path: 'payments.method.values', column: 'method' })).toBe('method has no such value. Choose one from its list for each way to pay.');
  });

  it('lists invoice-format tables as ready, and says what an old one lacks', async () => {
    renderTab({ profiles: [], shapes: [{ connectionId: 'con_shop', tableName: 'public.invoices', version: 2 }, { connectionId: 'con_old', tableName: 'public.bills', version: 1 }] });
    const ready = await screen.findByTestId('payments-shape-public.invoices');
    expect(within(ready).getByText('Ready')).toBeTruthy();
    expect(textOf(ready)).toContain('Built on the invoice format');
    expect(textOf(screen.getByTestId('payments-shape-public.bills'))).toContain('Online payments need the app’s update; payments by hand work.');
  });

  it('says when no table can be paid yet', async () => {
    renderTab(EMPTY);
    expect(textOf(await screen.findByTestId('payments-payables-empty'))).toContain('No table can be paid yet.');
  });

  it('asks before stopping a table, and says the pay links stop working', async () => {
    const { user, calls } = renderTab({ profiles: [PROFILE], shapes: [] });
    const row = await screen.findByTestId('payments-payable-pay_1');
    expect(within(row).getByText('Can be paid')).toBeTruthy();
    await user.click(within(row).getByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Stop payments for invoices?')).toBeTruthy();
    expect(screen.getByText(/pay links already sent for them stop working/)).toBeTruthy();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await user.click(screen.getByTestId('payments-payable-stop-confirm'));
    await waitFor(() => expect(calls.find((call) => call.method === 'DELETE')?.url).toBe('/api/v1/payments/payables/pay_1'));
  });

  it('asks the unit of a whole-number amount with nothing chosen, and waits for it', async () => {
    const { user, calls } = renderTab(EMPTY);
    await openOnInvoices(user);
    const unit = await screen.findByTestId('payments-wizard-unit');
    expect(textOf(unit)).toContain('Is 12000 “twelve thousand” or “120.00”?');
    for (const radio of within(unit).getAllByRole('radio')) expect(isChecked(radio)).toBe(false);
    await waitFor(() => expect(calls.some((call) => call.url === '/api/v1/payments/payables/check')).toBe(true));
    expect(isBlocked(screen.getByTestId('payments-wizard-next'))).toBe(true);
    await user.click(within(unit).getByRole('radio', { name: /Cents/ }));
    await waitFor(() => expect(isBlocked(screen.getByTestId('payments-wizard-next'))).toBe(false));
    const last = calls.filter((call) => call.url === '/api/v1/payments/payables/check').at(-1);
    expect(last?.body).toMatchObject({ connectionId: 'con_shop', tableId: 'public.invoices', mapping: { amount: { column: 'total_cents', unit: 'minor' } } });
  });

  it('tells someone with only some columns why they cannot set it up, and shows no rows', async () => {
    const { user } = renderTab(EMPTY, { check: { issues: [], mayMark: { ok: false, reason: 'column-limit' }, preview: [] } });
    await openOnInvoices(user);
    expect(textOf(await screen.findByTestId('payments-wizard-refusal'))).toBe('You may read or change only some columns of invoices, so you cannot set it up.');
    expect(textOf(screen.getByTestId('payments-wizard-preview-hidden'))).toBe('Rows are shown only to someone who may set this table up.');
  });

  it('makes a table with its own payments table name the unique column and its balance', async () => {
    const { user } = renderTab(EMPTY);
    await openOnInvoices(user);
    await user.click(within(await screen.findByTestId('payments-wizard-unit')).getByRole('radio', { name: /Cents/ }));
    await waitFor(() => expect(isBlocked(screen.getByTestId('payments-wizard-next'))).toBe(false));
    await user.click(screen.getByTestId('payments-wizard-next'));
    await user.click(screen.getByRole('radio', { name: /This table has its own payments table/ }));
    await user.selectOptions(await screen.findByTestId('payments-wizard-own-table'), 'public.invoice_payments');
    const own = screen.getByTestId('payments-wizard-own');
    expect(textOf(own)).toContain('Choose the column that is unique for each payment.');
    expect(screen.getByText('A table that keeps its own payments names its balance, or a paid record would read as still owed.')).toBeTruthy();
    expect(isBlocked(screen.getByTestId('payments-wizard-next'))).toBe(true);
  });

  it('gives someone who may only view no control', async () => {
    renderTab({ profiles: [PROFILE], shapes: [] }, { canManage: false });
    await screen.findByTestId('payments-payable-pay_1');
    expect(screen.queryByTestId('payments-payables-set-up')).toBeNull();
    expect(screen.queryAllByRole('switch')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});
