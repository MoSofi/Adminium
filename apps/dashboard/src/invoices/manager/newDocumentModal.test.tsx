// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The New modal (34-invoices-add-on.md Appendix E §M15, O20): the grid is
 * Blank + the twelve starters, plus *Your templates* on the invoices tab; a
 * pick creates through the API and hands the reply up.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { InvoiceDetail, InvoiceDocumentKind, InvoiceStarterCard, InvoiceSummary } from '../api.js';
import { emptyBody } from '../model/envelope.js';
import { NewDocumentModal } from './NewDocumentModal.js';

/** The comp's `starterDefs()` keys (1117-1130; Appendix G). */
const STARTERS: readonly [string, string, string][] = [
  ['standard', 'Standard invoice', 'business'],
  ['receipt', 'Payment receipt', 'payments'],
  ['proforma', 'Proforma invoice', 'business'],
  ['credit', 'Credit note', 'adjustments'],
  ['quote', 'Quote / estimate', 'sales'],
  ['subscription', 'Subscription invoice', 'recurring'],
  ['deposit', 'Deposit invoice', 'payments'],
  ['hourly', 'Hourly / time', 'services'],
  ['milestone', 'Milestone invoice', 'projects'],
  ['commercial', 'Commercial invoice', 'shipping'],
  ['donation', 'Donation receipt', 'nonprofit'],
  ['retainer', 'Retainer invoice', 'services'],
];

const GLYPH = 'file-text';

function starter([key, name, category]: readonly [string, string, string]): InvoiceStarterCard {
  return { key, name, category, icon: GLYPH, title: 'INVOICE', accent: '#4f46e5' };
}

function summary(over: Partial<InvoiceSummary> = {}): InvoiceSummary {
  return {
    id: 'tpl-standard',
    kind: 'template',
    name: 'Standard invoice',
    status: 'live',
    topic: 'recurring',
    lang: 'en',
    starter: 'standard',
    originId: null,
    createdAt: 1,
    updatedAt: 1,
    summary: {
      number: 'INV-2050',
      customerName: 'Northwind Traders',
      title: 'INVOICE',
      logoText: 'Northwind Studio',
      logoIcon: 'hexagon',
      accent: '#4f46e5',
      currency: '$',
      cents: true,
      totalMinor: 123_456,
      itemCount: 3,
    },
    ...over,
  };
}

function detail(over: Partial<InvoiceSummary> = {}): InvoiceDetail {
  return { ...summary(over), body: emptyBody(), languages: [] };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(templates: InvoiceSummary[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      if (url === '/api/v1/invoices/starters') {
        return Promise.resolve(jsonResponse(200, { starters: STARTERS.map(starter) }));
      }
      if (url.startsWith('/api/v1/invoices?kind=template') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { items: templates, counts: { template: templates.length, invoice: 0 } }));
      }
      if (url === '/api/v1/invoices' && method === 'POST') {
        const input = body as { kind: InvoiceDocumentKind; starter: string | null };
        return Promise.resolve(jsonResponse(201, detail({ id: 'new_1', kind: input.kind, starter: input.starter })));
      }
      const from = /^\/api\/v1\/invoices\/([^/]+)\/from-template$/.exec(url);
      if (from !== null && method === 'POST') {
        return Promise.resolve(jsonResponse(201, detail({ id: 'inv_new', kind: 'invoice', originId: from[1] ?? null })));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

function renderModal(kind: InvoiceDocumentKind, templates: InvoiceSummary[] = []) {
  const calls = stubFetch(templates);
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AppToastProvider>
        <NewDocumentModal kind={kind} onClose={onClose} onCreated={onCreated} />
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return { calls, onCreated, onClose, user: userEvent.setup() };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewDocumentModal', () => {
  it('renders Blank invoice + the twelve starters for a template, with the category labels, and no Your templates', async () => {
    renderModal('template');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New template')).toBeDefined();
    expect(within(dialog).getByText('Start from a blank canvas or a ready-made template.')).toBeDefined();
    await waitFor(() => {
      expect(within(dialog).getAllByTestId('invoices-starter')).toHaveLength(13);
    });
    expect(within(dialog).getByText('Blank invoice')).toBeDefined();
    expect(within(dialog).getByText('Build from scratch')).toBeDefined();
    const tiles = within(dialog).getAllByTestId('invoices-starter');
    expect(tiles.map((el) => el.getAttribute('data-starter'))).toEqual(['', ...STARTERS.map(([key]) => key)]);
    expect(within(tiles[1] as HTMLElement).getByText('Standard invoice')).toBeDefined();
    expect(within(tiles[1] as HTMLElement).getByText('Business')).toBeDefined();
    expect(within(tiles[11] as HTMLElement).getByText('Nonprofit')).toBeDefined();
    expect(within(dialog).queryByText('Your templates')).toBeNull();
  });

  it('adds Your templates — the workspace’s templates as mini sheets — for an invoice, and still says Blank invoice', async () => {
    renderModal('invoice', [summary(), summary({ id: 'tpl-receipt', name: 'Payment receipt', summary: { ...summary().summary, title: 'RECEIPT', customerName: 'Acme Studio', totalMinor: 29_000, itemCount: 1 } })]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New invoice')).toBeDefined();
    expect(within(dialog).getByText('Blank invoice')).toBeDefined();
    await waitFor(() => {
      expect(within(dialog).getAllByTestId('invoices-starter')).toHaveLength(13);
    });
    expect(await within(dialog).findByText('Your templates')).toBeDefined();
    const tiles = within(dialog).getAllByTestId('invoices-from-template');
    expect(tiles).toHaveLength(2);
    expect(within(tiles[1] as HTMLElement).getByText('Payment receipt')).toBeDefined();
    expect(within(tiles[1] as HTMLElement).getByText('Acme Studio')).toBeDefined();
    expect(within(tiles[1] as HTMLElement).getByTestId('invoices-mini-total').textContent).toBe('$290.00');
    expect(within(tiles[1] as HTMLElement).getByTestId('invoices-mini-rows').childElementCount).toBe(1);
  });

  it('picking a starter POSTs { kind, starter } and hands the reply up', async () => {
    const { calls, onCreated, user } = renderModal('template');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getAllByTestId('invoices-starter')).toHaveLength(13);
    });
    await user.click(dialog.querySelector('[data-starter="donation"]') as HTMLElement);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ kind: 'template', starter: 'donation' }]);
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    expect((onCreated.mock.calls[0]?.[0] as InvoiceDetail).id).toBe('new_1');
  });

  it('Blank posts a null starter; a template tile starts an invoice from it', async () => {
    const { calls, onCreated, user } = renderModal('invoice', [summary()]);
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByText('Blank invoice'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ kind: 'invoice', starter: null }]);
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });

    await user.click(await within(dialog).findByTestId('invoices-from-template'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/invoices/tpl-standard/from-template')).toBe(true);
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(2);
    });
    const created = onCreated.mock.calls[1]?.[0] as InvoiceDetail;
    expect(created.kind).toBe('invoice');
    expect(created.originId).toBe('tpl-standard');
  });
});
