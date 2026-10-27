// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The table's e-mail sheet, as the send dialog opens it (through the lazy
 * wrapper), for the marketer:
 *
 *  - 7a: "Can be e-mailed from campaigns" on, the declared columns, the
 *    existing-customers switch off with its paragraph and guide link;
 *  - 7b: switched on, "Who counts as a customer" and the required tick; Save
 *    stays disabled until it is ticked, and then sends the tick;
 *  - a table whose app declares no opt-out mark never offers the switch;
 *  - switching campaigns off and picking another address column saves the
 *    owner's word;
 *  - a refusal (the person cannot reach the table) says so.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { TableEmailSheetData } from './marketingApi.js';
import { TableEmailSheetLazy } from './tableEmailSheetLazy.js';

function sheet(over: Partial<TableEmailSheetData> = {}): TableEmailSheetData {
  return {
    connectionId: 'conn_1',
    table: 'public.crm_contacts',
    label: 'Contacts',
    appName: 'Sales CRM',
    kind: 'people',
    canEmail: true,
    email: 'email',
    name: 'full_name',
    columns: [
      { name: 'full_name', label: 'Full name', address: true },
      { name: 'email', label: 'Email', address: true },
      { name: 'work_email', label: 'Work email', address: true },
      { name: 'secret_email', label: 'Masked email', address: false },
    ],
    customer: { column: 'won_deals', label: 'Has a won deal' },
    existingCustomers: { offered: true, on: false, at: null, by: null },
    ...over,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

let current: TableEmailSheetData;
let refuse = false;

function stub(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, url, body });
      const ok = (data: unknown) => Promise.resolve(jsonResponse(200, JSON.parse(JSON.stringify(data)) as unknown));
      if (url.startsWith('/api/v1/email-audience/table-settings') && method === 'GET') {
        if (refuse) return Promise.resolve(jsonResponse(403, { error: { code: 'AUDIENCE_REFUSED', message: 'no' } }));
        return ok({ sheet: current });
      }
      if (url === '/api/v1/email-audience/table-settings' && method === 'PUT') {
        current = { ...current, canEmail: body!['canEmail'] as boolean, email: body!['email'] as string, name: body!['name'] as string };
        return ok({ sheet: current });
      }
      if (url === '/api/v1/email-audience/existing-customers' && method === 'PUT') {
        current = { ...current, existingCustomers: { ...current.existingCustomers, on: body!['on'] as boolean } };
        return ok({ existingCustomers: current.existingCustomers });
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

function renderSheet(onOpenChange = vi.fn()) {
  const calls = stub();
  const queryClient = createQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <Suspense fallback={null}>
          <TableEmailSheetLazy open onOpenChange={onOpenChange} connectionId="conn_1" table="public.crm_contacts" />
        </Suspense>
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return { calls, onOpenChange };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refuse = false;
});

describe('the table\'s e-mail sheet', () => {
  it('7a: shows the switch on, the declared columns, and existing customers off with the guide', async () => {
    current = sheet();
    renderSheet();
    const dialog = await screen.findByRole('dialog', { name: 'E-mail settings for Contacts' });
    expect(within(dialog).getByText('Contacts — Sales CRM')).toBeDefined();
    expect(within(dialog).getByRole('switch', { name: 'Can be e-mailed from campaigns' }).getAttribute('aria-checked')).toBe('true');
    expect((within(dialog).getByTestId('sheet-email-column') as HTMLSelectElement).value).toBe('email');
    expect((within(dialog).getByTestId('sheet-name-column') as HTMLSelectElement).value).toBe('full_name');
    // An address column only among those seen in clear.
    expect(within(within(dialog).getByTestId('sheet-email-column')).queryByRole('option', { name: 'Masked email' })).toBeNull();
    expect(within(dialog).getByText('Existing customers')).toBeDefined();
    expect(within(dialog).getByRole('switch', { name: 'Existing customers may get marketing mail without ticking a box' }).getAttribute('aria-checked')).toBe('false');
    expect(within(dialog).getByRole('link', { name: 'check the guide' }).getAttribute('href')).toContain('docs.adminium.dev');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect((within(dialog).getByTestId('sheet-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('7b: on asks who counts and the tick, and Save waits for the tick', async () => {
    current = sheet();
    const user = userEvent.setup();
    const { calls, onOpenChange } = renderSheet();
    const dialog = await screen.findByRole('dialog', { name: 'E-mail settings for Contacts' });
    await user.click(within(dialog).getByRole('switch', { name: 'Existing customers may get marketing mail without ticking a box' }));
    expect(within(dialog).getByText('Who counts as a customer')).toBeDefined();
    expect(within(dialog).getByTestId('sheet-customer').textContent).toBe('Has a won deal');
    const tick = within(dialog).getByRole('checkbox', { name: 'I offered a way to say no when we took their address' });
    expect(tick.getAttribute('aria-required')).toBe('true');
    expect((within(dialog).getByTestId('sheet-save') as HTMLButtonElement).disabled).toBe(true);
    await user.click(tick);
    expect(tick.getAttribute('aria-checked')).toBe('true');
    await user.click(within(dialog).getByTestId('sheet-save'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(calls.find((call) => call.url === '/api/v1/email-audience/existing-customers')).toMatchObject({ method: 'PUT', body: { connectionId: 'conn_1', table: 'public.crm_contacts', on: true, optOutOffered: true } });
    expect(calls.some((call) => call.method === 'PUT' && call.url === '/api/v1/email-audience/table-settings')).toBe(false);
  });

  it('never offers existing customers on a table whose app declares no opt-out mark', async () => {
    current = sheet({ existingCustomers: { offered: false, on: false, at: null, by: null }, customer: null });
    renderSheet();
    const dialog = await screen.findByRole('dialog', { name: 'E-mail settings for Contacts' });
    expect(within(dialog).queryByText('Existing customers')).toBeNull();
    expect(within(dialog).queryByRole('switch', { name: 'Existing customers may get marketing mail without ticking a box' })).toBeNull();
  });

  it('switches campaigns off and names another address column', async () => {
    current = sheet();
    const user = userEvent.setup();
    const { calls } = renderSheet();
    const dialog = await screen.findByRole('dialog', { name: 'E-mail settings for Contacts' });
    await user.click(within(dialog).getByRole('switch', { name: 'Can be e-mailed from campaigns' }));
    await user.selectOptions(within(dialog).getByTestId('sheet-email-column'), 'work_email');
    // With campaigns off, existing customers cannot be switched.
    expect((within(dialog).getByRole('switch', { name: 'Existing customers may get marketing mail without ticking a box' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByTestId('sheet-save'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')).toMatchObject({ url: '/api/v1/email-audience/table-settings', body: { canEmail: false, email: 'work_email', name: 'full_name' } });
  });

  it('says so when the person cannot change the table', async () => {
    current = sheet();
    refuse = true;
    renderSheet();
    expect(await screen.findByText('You can’t change the e-mail settings of this table.')).toBeDefined();
  });
});
