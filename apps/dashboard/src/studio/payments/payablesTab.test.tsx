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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';

import { ApiError } from '../../app/api.js';
import { PAYABLE_ISSUES, payableIssuesOf, type PayableCheck, type PayablesList } from './paymentsApi.js';
import { issueSentence, PayablesTab, statusValuesOf } from './PayablesTab.js';

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
    // A SQLite CHECK list: `text`, with the enum it names.
    { name: 'state', logicalType: 'text', enumRef: 'main.invoices.state' },
    { name: 'memo', logicalType: 'text' },
  ],
};
const ENUMS = [{ id: 'main.invoices.state', values: ['sent', 'paid', 'refunded'] }];
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

function stub(list: PayablesList, check: PayableCheck | { status: number; body: unknown } = CLEAN): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) });
      if (url === '/api/v1/payments/payables' && method === 'GET') return Promise.resolve(jsonResponse(200, { data: list }));
      if (url === '/api/v1/payments/payables/check') return Promise.resolve('status' in check ? jsonResponse(check.status, check.body) : jsonResponse(200, { data: check }));
      if (url === '/api/v1/connections') return Promise.resolve(jsonResponse(200, { connections: [{ id: 'con_shop', name: 'Shop' }] }));
      if (url === '/api/v1/connections/con_shop/schema') return Promise.resolve(jsonResponse(200, { connectionId: 'con_shop', snapshotId: 's1', model: { tables: [INVOICES, PAYMENTS], enums: ENUMS } }));
      if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } }));
    }),
  );
  return calls;
}

function renderTab(list: PayablesList, opts: { canManage?: boolean; check?: PayableCheck | { status: number; body: unknown } } = {}) {
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

  it('reads only its own issue codes out of a refusal, so a schema refusal reads as its message', () => {
    const schemaRefusal = new ApiError(422, 'VALIDATION_FAILED', 'Body is not valid: mapping.amount.column is too short.', null, { issues: [{ path: 'mapping.amount.column', message: 'Too small', code: 'too_small' }] });
    expect(payableIssuesOf(schemaRefusal)).toBeNull();
    const mixed = new ApiError(422, 'VALIDATION_FAILED', 'x', null, { issues: [{ code: 'too_small', path: 'a', message: 'm' }, { code: 'NEEDS_UNIT', path: 'amount.unit', column: 'total_cents' }] });
    expect(payableIssuesOf(mixed)).toEqual([{ code: 'NEEDS_UNIT', path: 'amount.unit', column: 'total_cents' }]);
  });

  it('labels every select of the wizard, and names its choice of where payments land', async () => {
    const { user } = renderTab(EMPTY);
    await openOnInvoices(user);
    expect(screen.getByLabelText('Amount')).toBe(screen.getByTestId('payments-wizard-amount'));
    expect(screen.getByLabelText('The number the customer knows it by').tagName).toBe('SELECT');
    await user.click(within(await screen.findByTestId('payments-wizard-unit')).getByRole('radio', { name: /Cents/ }));
    await waitFor(() => expect(isBlocked(screen.getByTestId('payments-wizard-next'))).toBe(false));
    await user.click(screen.getByTestId('payments-wizard-next'));
    expect(screen.getByRole('radiogroup', { name: 'How payments land' })).toBeTruthy();
  });

  it('goes no further while the check itself failed', async () => {
    const { user } = renderTab(EMPTY, { check: { status: 500, body: { error: { code: 'INTERNAL', message: 'The schema could not be read.' } } } });
    await openOnInvoices(user);
    await user.click(within(await screen.findByTestId('payments-wizard-unit')).getByRole('radio', { name: /Cents/ }));
    expect(await screen.findByText('The schema could not be read.')).toBeTruthy();
    expect(isBlocked(screen.getByTestId('payments-wizard-next'))).toBe(true);
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

  it('reads a status column\'s values by the server\'s rule: yes/no, else its enum whatever its type', () => {
    expect(statusValuesOf({ name: 'done', logicalType: 'boolean' }, ENUMS)).toEqual(['true', 'false']);
    expect(statusValuesOf({ name: 'state', logicalType: 'text', enumRef: 'main.invoices.state' }, ENUMS)).toEqual(['sent', 'paid', 'refunded']);
    expect(statusValuesOf({ name: 'state', logicalType: 'enum', enumRef: 'main.invoices.state' }, ENUMS)).toEqual(['sent', 'paid', 'refunded']);
    expect(statusValuesOf({ name: 'memo', logicalType: 'text' }, ENUMS)).toBeNull();
    expect(statusValuesOf(undefined, ENUMS)).toBeNull();
  });

  /** Opens step 2 with the status switched on. */
  async function statusStep(user: ReturnType<typeof userEvent.setup>) {
    await openOnInvoices(user);
    await user.click(within(await screen.findByTestId('payments-wizard-unit')).getByRole('radio', { name: /Cents/ }));
    await waitFor(() => expect(isBlocked(screen.getByTestId('payments-wizard-next'))).toBe(false));
    await user.click(screen.getByTestId('payments-wizard-next'));
    await user.click(screen.getByLabelText('When it is paid in full, set Status to'));
  }

  it('offers the paid and refunded values of a CHECK-list status, and checks nothing of the status until its pair is chosen', async () => {
    const { user, calls } = renderTab(EMPTY);
    await statusStep(user);
    await user.selectOptions(screen.getByLabelText('Status column'), 'state');
    const paid = await screen.findByLabelText('Value when paid in full');
    expect(within(paid).getAllByRole('option').map((one) => one.textContent)).toEqual(['Choose…', 'sent', 'paid', 'refunded']);
    expect(within(screen.getByLabelText('When it is refunded in full, set Status to')).getAllByRole('option').map((one) => one.textContent)).toEqual(['Leave it as it is', 'sent', 'paid', 'refunded']);
    // Incomplete: the check goes without the status, naming the column so its values come back; Next waits.
    await waitFor(() => expect(calls.filter((call) => call.url === '/api/v1/payments/payables/check').at(-1)?.body).toMatchObject({ mapping: { status: null }, statusColumn: 'state' }));
    expect(isBlocked(screen.getByTestId('payments-wizard-next'))).toBe(true);
    await user.selectOptions(paid, 'paid');
    await waitFor(() => expect(calls.filter((call) => call.url === '/api/v1/payments/payables/check').at(-1)?.body).toMatchObject({ mapping: { status: { column: 'state', paid: 'paid', refunded: null } } }));
    await waitFor(() => expect(isBlocked(screen.getByTestId('payments-wizard-next'))).toBe(false));
  });

  it('takes the server\'s list for a column it sees values for, and offers no free text for a column with none', async () => {
    const { user } = renderTab(EMPTY, { check: { ...CLEAN, statusValues: ['new', 'done'] } });
    await statusStep(user);
    await user.selectOptions(screen.getByLabelText('Status column'), 'memo');
    await waitFor(() => expect(within(screen.getByLabelText('Value when paid in full')).getAllByRole('option').map((one) => one.textContent)).toEqual(['Choose…', 'new', 'done']));
    cleanup();
    const second = renderTab(EMPTY, { check: { ...CLEAN, statusValues: null } });
    await statusStep(second.user);
    await second.user.selectOptions(screen.getByLabelText('Status column'), 'memo');
    expect(textOf(await screen.findByTestId('payments-wizard-status-no-values'))).toBe("Give this column a list of values (in the table's schema) to use it as a status.");
    expect(screen.queryByLabelText('Value when paid in full')).toBeNull();
    expect(isBlocked(screen.getByTestId('payments-wizard-next'))).toBe(true);
  });

  it('never shows a refused request\'s raw words in the preview', async () => {
    const { user } = renderTab(EMPTY, { check: { status: 400, body: { error: { code: 'VALIDATION_FAILED', message: 'Request body failed validation.', details: { issues: [{ path: 'mapping.status.paid', message: 'Too small', code: 'too_small' }] } } } } });
    await openOnInvoices(user);
    expect(await screen.findByText('Finish the choices above to see three rows.')).toBeTruthy();
    expect(screen.queryByText('Request body failed validation.')).toBeNull();
  });

  it('gives someone who may only view no control', async () => {
    renderTab({ profiles: [PROFILE], shapes: [] }, { canManage: false });
    await screen.findByTestId('payments-payable-pay_1');
    expect(screen.queryByTestId('payments-payables-set-up')).toBeNull();
    expect(screen.queryAllByRole('switch')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});
