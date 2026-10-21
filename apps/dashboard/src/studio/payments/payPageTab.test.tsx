// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Pay page.
 *
 * Mounted bare, with the transport stubbed at `fetch`:
 *
 *  1. an SVG logo is refused before anything is sent;
 *  2. a PNG goes to the pay page's own logo route as raw bytes, and Save then
 *     names the file it answered;
 *  3. the server's own logo-type refusal reads as the same sentence;
 *  4. someone who may only view sees the settings and no control.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';

import type { PayPageSettings } from './paymentsApi.js';
import { PayPageTab } from './PayPageTab.js';

const PAGE: PayPageSettings = { shopName: 'Crumb & Co', logoFileId: null, contactEmail: 'hello@crumbandco.de', contactPhone: null, shopCountry: 'DE', showLines: true };

interface Call {
  method: string;
  url: string;
  body: unknown;
  type: string | null;
}

function stub(logo: { status: number; body: unknown } = { status: 201, body: { data: { fileId: 'file_logo1' } } }): Call[] {
  const calls: Call[] = [];
  let current = PAGE;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const type = new Headers(init?.headers).get('content-type');
      const body = init?.body === undefined ? undefined : init.body instanceof Blob ? init.body : (JSON.parse(String(init.body)) as unknown);
      calls.push({ method, url, body, type });
      if (url === '/api/v1/payments/pay-page' && method === 'GET') return Promise.resolve(jsonResponse(200, { data: current }));
      if (url === '/api/v1/payments/pay-page' && method === 'PUT') {
        current = body as PayPageSettings;
        return Promise.resolve(jsonResponse(200, { data: body }));
      }
      if (url.startsWith('/api/v1/payments/pay-page/logo')) return Promise.resolve(jsonResponse(logo.status, logo.body));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } }));
    }),
  );
  return calls;
}

function renderTab(canManage = true, logo?: { status: number; body: unknown }) {
  const calls = stub(logo);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PayPageTab canManage={canManage} />
    </QueryClientProvider>,
  );
  // The file input lists its types; a person can still pick another one.
  return { user: userEvent.setup({ applyAccept: false }), calls };
}

const textOf = (element: Element | null): string => element?.textContent ?? '';
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'crumb.png', { type: 'image/png' });

describe('PayPageTab', () => {
  beforeAll(installTestI18n);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => vi.unstubAllGlobals());

  it('refuses an SVG logo before anything is sent', async () => {
    const { user, calls } = renderTab();
    await user.upload(await screen.findByTestId('payments-page-logo-input'), new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    expect(textOf(await screen.findByTestId('payments-page-logo-error'))).toBe('The logo must be a PNG, JPEG or WebP image.');
    expect(calls.some((call) => call.url.includes('/logo'))).toBe(false);
  });

  it('uploads a PNG to the pay page logo route, then saves the file it named', async () => {
    const { user, calls } = renderTab();
    await user.upload(await screen.findByTestId('payments-page-logo-input'), png());
    // Uploaded is not yet used: leaving the tab before Save would drop it.
    await waitFor(() => expect(textOf(screen.getByTestId('payments-page-logo-state'))).toBe('Logo uploaded. Save to use it on the pay page.'));
    const upload = calls.find((call) => call.url.includes('/logo'));
    expect(upload?.method).toBe('POST');
    expect(upload?.url).toBe('/api/v1/payments/pay-page/logo?filename=crumb.png');
    expect(upload?.type).toBe('image/png');
    expect(upload?.body).toBeInstanceOf(Blob);
    await user.click(screen.getByTestId('payments-page-save'));
    await waitFor(() => expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ ...PAGE, logoFileId: 'file_logo1' }));
    expect(textOf(await screen.findByTestId('payments-page-status'))).toBe('Pay page saved');
    await waitFor(() => expect(textOf(screen.getByTestId('payments-page-logo-state'))).toBe('Logo uploaded'));
  });

  it('keeps the spaces a person types, and trims only what is saved', async () => {
    const { user, calls } = renderTab();
    const name = await screen.findByTestId('payments-page-name');
    await user.clear(name);
    await user.type(name, 'Crumb & Co Bakery ');
    expect((name as HTMLInputElement).value).toBe('Crumb & Co Bakery ');
    const phone = screen.getByRole('textbox', { name: 'Contact phone' });
    await user.type(phone, '+49 30 1234 5678');
    expect((phone as HTMLInputElement).value).toBe('+49 30 1234 5678');
    await user.click(screen.getByTestId('payments-page-save'));
    await waitFor(() => expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ shopName: 'Crumb & Co Bakery', contactPhone: '+49 30 1234 5678' }));
  });

  it('stops saying "saved" once something changes again', async () => {
    const { user } = renderTab();
    await user.click(await screen.findByTestId('payments-page-save'));
    expect(textOf(await screen.findByTestId('payments-page-status'))).toBe('Pay page saved');
    await user.type(screen.getByTestId('payments-page-name'), '!');
    expect(textOf(screen.getByTestId('payments-page-status'))).toBe('');
  });

  it('words the server refusing what the bytes turned out to be', async () => {
    const { user } = renderTab(true, { status: 422, body: { error: { code: 'VALIDATION_FAILED', message: 'The logo must be a PNG, JPEG or WebP image.', details: { reason: 'logo-type' } } } });
    await user.upload(await screen.findByTestId('payments-page-logo-input'), png());
    expect(textOf(await screen.findByTestId('payments-page-logo-error'))).toBe('The logo must be a PNG, JPEG or WebP image.');
    expect(textOf(screen.getByTestId('payments-page-logo-state'))).toBe('No logo yet');
  });

  it('shows the country by name and needs a shop name', async () => {
    const { user } = renderTab();
    expect(await screen.findByText('Germany')).toBeTruthy();
    await user.clear(screen.getByTestId('payments-page-name'));
    expect(screen.getByText('The pay page needs a name.')).toBeTruthy();
    expect(screen.getByTestId('payments-page-save').hasAttribute('disabled')).toBe(true);
  });

  it('shows the settings and no control to someone who may only view', async () => {
    renderTab(false);
    const name = await screen.findByTestId('payments-page-name');
    expect((name as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByTestId('payments-page-save')).toBeNull();
    expect(screen.queryByTestId('payments-page-logo-input')).toBeNull();
    expect(screen.getByRole('switch').hasAttribute('disabled') || screen.getByRole('switch').getAttribute('aria-disabled') === 'true').toBe(true);
  });
});
