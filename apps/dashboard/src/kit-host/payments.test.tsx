// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's payment parts on an app's own screen, over the person's own
 * session: the refund's two steps (and its refusal when the app keeps its
 * refunds as its own rows), and Copy pay link reusing the record's current
 * link before it makes one.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KitMounted, PayLinkProps, RefundProps } from './contract.js';
import { mount } from './index.js';

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  method: string;
  path: string;
  csrf: string | null;
  body: unknown;
}

function stub(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call = { method: init?.method ?? 'GET', path: input, csrf: headers['x-adminium-csrf'] ?? null, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) };
      calls.push(call);
      return answer(call);
    }),
  );
  return calls;
}

const PREVIEW = { label: 'C-7', provider: 'payments-stripe', test: false, taken: '20.00', currency: 'EUR', refundable: '20.00', paidWith: 'Visa ••4242', refusal: null };

describe('the kit payment parts', () => {
  let mounted: KitMounted<RefundProps> | KitMounted<PayLinkProps> | null = null;
  afterEach(() => {
    act(() => mounted?.unmount());
    mounted = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('refunds in two steps, with the session token, and says the refund was asked', async () => {
    const calls = stub((call) =>
      call.path.endsWith('/refund') ? reply(200, { data: PREVIEW } ) : reply(200, { data: { refund: { id: 'rfd_1', state: 'succeeded', amount: '5.00', currency: 'EUR' }, fresh: true } }),
    );
    const element = document.body.appendChild(document.createElement('div'));
    const refunded = vi.fn();
    mounted = await mount('refund', element, { attemptId: 'pat_1', csrfToken: 'tok', locale: 'en-US', dir: 'ltr', onRefunded: refunded });
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('kit-refund-part'));
    await user.type(screen.getByTestId('kit-refund-amount'), '5.00');
    await user.click(screen.getByTestId('kit-refund-continue'));
    expect(screen.getByText(/Refund €5.00 to Visa ••4242\?/)).toBeTruthy();
    await user.click(screen.getByTestId('kit-refund-submit'));
    expect((await screen.findByTestId('kit-refund-done')).textContent).toContain('Refund of €5.00 requested.');
    const asked = calls.find((call) => call.path === '/api/v1/payments/refunds')!;
    expect(asked).toMatchObject({ method: 'POST', csrf: 'tok', body: { attemptId: 'pat_1', amount: '5.00', reason: 'requested_by_customer', note: null } });
    expect((asked.body as { key: string }).key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(refunded).toHaveBeenCalledWith({ id: 'rfd_1', state: 'succeeded', amount: '5.00', currency: 'EUR' });
  });

  it("says to refund in the app when the app keeps its refunds as its own rows", async () => {
    stub(() => reply(200, { data: { ...PREVIEW, refusal: { code: 'IN_APP', message: 'x' } } }));
    const element = document.body.appendChild(document.createElement('div'));
    mounted = await mount('refund', element, { attemptId: 'pat_2', csrfToken: 'tok', locale: 'en-US', dir: 'ltr' });
    expect((await screen.findByTestId('kit-refund-refused')).textContent).toBe('Refund this payment in its app, where its refunds are kept.');
  });

  it("copies the record's current pay link, and makes one only when there is none", async () => {
    let current: { url: string; expiresAt: number } | null = { url: 'https://pay.crumbandco.de/pay/AAAAAAAAAAAAAAAAAAAAAA', expiresAt: Date.UTC(2026, 11, 15) };
    const calls = stub((call) =>
      call.path === '/api/v1/payments/links/current' ? reply(200, { data: current }) : reply(200, { data: { link: { url: 'https://pay.crumbandco.de/pay/BBBBBBBBBBBBBBBBBBBBBB', expiresAt: Date.UTC(2026, 11, 20) }, replaced: false } }),
    );
    const element = document.body.appendChild(document.createElement('div'));
    const payable = { kind: 'profile' as const, connectionId: 'con_1', tableName: 'public.orders', rowKey: '7' };
    // user-event puts a clipboard of its own on the page: what the part copies is read back from it.
    const user = userEvent.setup();
    mounted = await mount('pay-link', element, { payable, csrfToken: 'tok', locale: 'en-US', dir: 'ltr' });
    await user.click(await screen.findByTestId('kit-pay-link-copy'));
    await screen.findByTestId('kit-pay-link-copied');
    expect(await navigator.clipboard.readText()).toBe('https://pay.crumbandco.de/pay/AAAAAAAAAAAAAAAAAAAAAA');
    expect(calls.map((call) => call.path)).toEqual(['/api/v1/payments/links/current']);
    current = null;
    await user.click(screen.getByTestId('kit-pay-link-copy'));
    await waitFor(() => expect(calls).toHaveLength(3));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('https://pay.crumbandco.de/pay/BBBBBBBBBBBBBBBBBBBBBB'));
    expect(calls.map((call) => call.path)).toEqual(['/api/v1/payments/links/current', '/api/v1/payments/links/current', '/api/v1/payments/links']);
    expect(calls.every((call) => call.csrf === 'tok')).toBe(true);
  });
});
