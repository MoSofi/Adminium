// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The customer's pay page, state by state, against a pretend server: what it
 * shows, what it never shows, one h1 on every state, the polite region, focus
 * after a press, the language menu's keys, and the bank card's copy buttons.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@adminium/i18n/react';

import type { PayPage } from './api.js';
import { monogram, PayApp } from './PayApp.js';
import { initPayWords } from './words.js';

const SHOP = { name: 'Crumb & Co.', email: 'hello@crumbandco.de', phone: '+49 30 1234567', hasLogo: false };
const PAYABLE = { label: 'INV-0042', currency: 'EUR', due: '120.00', total: '120.00', alreadyPaid: null, dueDate: '2026-11-02', lines: null };
const BANK = {
  source: 'manual',
  method: 'bank-transfer',
  label: null,
  details: { accounts: [{ currency: 'EUR', holder: 'Crumb & Co. GmbH', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' }] },
};

function pageOf(patch: Partial<PayPage>): PayPage {
  return { state: 'ready', test: false, shop: SHOP, payable: PAYABLE, ways: [{ source: 'payments-stripe', method: 'card', label: null, details: null }, BANK], processing: null, attempt: null, ...patch };
}

let answers: Record<string, unknown>;

function answer(url: string): Response {
  const body = Object.entries(answers).find(([path]) => url.endsWith(path))?.[1];
  if (body === undefined) return new Response('{}', { status: 404 });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function show(route: Parameters<typeof PayApp>[0]['route'], locale: 'en_US' | 'ar_EG' = 'en_US'): Promise<void> {
  const i18n = await initPayWords(locale);
  const wrap = (node: ReactNode): ReactNode => <I18nProvider i18n={i18n}>{node}</I18nProvider>;
  await act(async () => {
    render(wrap(<PayApp route={route} />));
  });
}

const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';

beforeEach(() => {
  answers = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => answer(String(url))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('dir');
});

describe('the pay page', () => {
  it('shows the shop, what is due and when, and the ways to pay, never the customer', async () => {
    answers[`/pay/api/${TOKEN}`] = pageOf({});
    await show({ kind: 'link', token: TOKEN });
    expect(await screen.findByRole('heading', { level: 1, name: 'INV-0042' })).toBeTruthy();
    expect(screen.getByText('Amount due')).toBeTruthy();
    expect(screen.getByText('€120.00')).toBeTruthy();
    expect(screen.getByText(/^Due /)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pay by card and other ways/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pay by bank transfer/ })).toBeTruthy();
    expect(screen.getByText("You'll pay on the Stripe page. This shop never sees your card.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/adminium/i);
    expect(document.title).toBe('Pay INV-0042');
  });

  it('says how much of the total is already paid, in one sentence', async () => {
    answers[`/pay/api/${TOKEN}`] = pageOf({ payable: { ...PAYABLE, due: '70.00', alreadyPaid: '50.00' } });
    await show({ kind: 'link', token: TOKEN });
    expect(await screen.findByText('€50.00 of €120.00 is already paid.')).toBeTruthy();
    expect(screen.getByText('€70.00')).toBeTruthy();
  });

  it('shows a dead link nothing of what it was for, with one h1 and the shop’s contact', async () => {
    for (const state of ['unknown', 'expired'] as const) {
      answers[`/pay/api/${TOKEN}`] = pageOf({ state, payable: null, ways: [] });
      await show({ kind: 'link', token: TOKEN });
      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading.textContent).toBe(state === 'expired' ? 'This pay link has expired.' : "This link doesn't work.");
      expect(screen.queryByText('INV-0042')).toBeNull();
      expect(screen.getAllByRole('link', { name: 'hello@crumbandco.de' }).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: /Pay by/ })).toBeNull();
      cleanup();
    }
  });

  it('keeps only the bank transfer when the link is locked for the hour', async () => {
    answers[`/pay/api/${TOKEN}`] = pageOf({ state: 'locked', ways: [BANK] });
    await show({ kind: 'link', token: TOKEN });
    expect(await screen.findByText('Too many payment tries on this link.')).toBeTruthy();
    expect(screen.getByText('Please try again in an hour, or pay by bank transfer.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /card/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Pay by bank transfer/ })).toBeTruthy();
  });

  it('opens the bank details with copy buttons, moves focus to them, and goes back', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    answers[`/pay/api/${TOKEN}`] = pageOf({});
    await show({ kind: 'link', token: TOKEN });
    await user.click(await screen.findByRole('button', { name: /Pay by bank transfer/ }));
    const card = screen.getByRole('heading', { name: 'Bank transfer' });
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(screen.getByText('DE89 3704 0044 0532 0130 00')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy IBAN' }));
    expect(writeText).toHaveBeenCalledWith('DE89370400440532013000');
    expect(await screen.findByText('IBAN copied.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy Amount' }));
    expect(writeText).toHaveBeenLastCalledWith('120.00');
    await user.click(screen.getByRole('button', { name: /Other ways to pay/ }));
    expect(await screen.findByRole('button', { name: /Pay by card and other ways/ })).toBeTruthy();
  });

  it('thanks the customer on the way back, with the receipt line only when a receipt went out', async () => {
    for (const receiptSent of [true, false]) {
      answers['/pay/api/back/abcdefghijklmnop'] = pageOf({ state: 'paid', ways: [], attempt: { provider: 'payments-stripe', amount: '120.00', at: Date.UTC(2026, 9, 20), receiptSent } });
      await show({ kind: 'back', nonce: 'abcdefghijklmnop', left: false });
      expect(await screen.findByText('Thank you. Your payment of €120.00 arrived.')).toBeTruthy();
      expect(screen.getByText('Paid')).toBeTruthy();
      expect(screen.queryByText('A receipt is on its way to your email.') !== null).toBe(receiptSent);
      expect(screen.queryByText('Ask Crumb & Co. if you need a receipt.') !== null).toBe(!receiptSent);
      expect(screen.queryByText(/Download/)).toBeNull();
      cleanup();
    }
  });

  it('names the service it is checking with, and says the shop will check a payment that differs', async () => {
    answers['/pay/api/back/abcdefghijklmnop'] = pageOf({ state: 'checking', ways: [], attempt: { provider: 'payments-paypal', amount: '120.00', at: 1, receiptSent: false } });
    await show({ kind: 'back', nonce: 'abcdefghijklmnop', left: false });
    expect(await screen.findByText('Checking with PayPal…')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Checking with PayPal… This takes a few seconds.');
    cleanup();

    answers['/pay/api/back/abcdefghijklmnop'] = pageOf({ state: 'shop-checks', ways: [], attempt: { provider: 'payments-stripe', amount: '100.00', at: 1, receiptSent: false } });
    await show({ kind: 'back', nonce: 'abcdefghijklmnop', left: false });
    expect(await screen.findByText('The shop will check this payment')).toBeTruthy();
    expect(screen.queryByText(/Thank you/)).toBeNull();
  });

  it('says which page the customer left', async () => {
    answers['/pay/api/back/abcdefghijklmnop'] = pageOf({ state: 'cancelled', ways: [], attempt: { provider: 'payments-stripe', amount: '120.00', at: 1, receiptSent: false } });
    await show({ kind: 'back', nonce: 'abcdefghijklmnop', left: true });
    expect(await screen.findByText('You left the Stripe page before paying.')).toBeTruthy();
    expect(screen.getByText('Nothing was taken.')).toBeTruthy();
  });

  it('shows the test band on a test link', async () => {
    answers[`/pay/api/${TOKEN}`] = pageOf({ test: true, ways: [{ source: 'demo', method: 'card', label: null, details: null }] });
    await show({ kind: 'link', token: TOKEN });
    expect(await screen.findByRole('note')).toBeTruthy();
    expect(screen.getByText('Test page — no money moves.')).toBeTruthy();
  });

  it('moves through the language menu by keys and gives focus back', async () => {
    const user = userEvent.setup();
    answers[`/pay/api/${TOKEN}`] = pageOf({});
    await show({ kind: 'link', token: TOKEN });
    const button = await screen.findByRole('button', { name: 'Language: English' });
    await user.click(button);
    const menu = screen.getByRole('menu', { name: 'Language' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(8);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(items[7]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('reads right to left in Arabic, with amounts and numbers left to right', async () => {
    answers[`/pay/api/${TOKEN}`] = pageOf({});
    await show({ kind: 'link', token: TOKEN }, 'ar_EG');
    const amount = await screen.findByText((_, node) => node?.classList.contains('pp-amount') === true);
    expect(amount.getAttribute('dir')).toBe('ltr');
    expect(amount.textContent).toMatch(/[0-9]/);
    expect(amount.textContent).not.toMatch(/[٠-٩]/);
  });

  it('draws a two-letter tile for a shop with no logo', () => {
    expect(monogram('Crumb & Co.')).toBe('C&');
    expect(monogram('  9 Lives Bakery')).toBe('9L');
  });
});
