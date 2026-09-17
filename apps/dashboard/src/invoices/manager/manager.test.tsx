// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoice manager, rendered through the real router and
 * shell so the topbar's published actions, the toasts and the navigation
 * are the product's own. The API is a fetch stub keyed on the routes the
 * manager calls; the fixtures are the comp's seed (1138-1170): ten
 * templates with de/fr/es/ja variations and seven invoices.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { InvoiceDetail, InvoiceDocumentKind, InvoiceLang, InvoiceStatus, InvoiceSummary, InvoiceSummaryFacts, InvoiceTopic } from '../api.js';
import { emptyBody } from '../model/envelope.js';
import { MANAGER_PREFS_KEY } from './useManagerPrefs.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const DAY = 24 * 3600_000;

function facts(over: Partial<InvoiceSummaryFacts> = {}): InvoiceSummaryFacts {
  return {
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
    ...over,
  };
}

function row(
  kind: InvoiceDocumentKind,
  id: string,
  name: string,
  status: InvoiceStatus,
  topic: InvoiceTopic,
  lang: InvoiceLang,
  summary: Partial<InvoiceSummaryFacts> = {},
  updatedAt = Date.now() - 2 * DAY,
): InvoiceSummary {
  return { id, kind, name, status, topic, lang, starter: null, originId: null, createdAt: 1, updatedAt, summary: facts(summary) };
}

const T = (id: string, name: string, status: InvoiceStatus, topic: InvoiceTopic, lang: InvoiceLang, summary: Partial<InvoiceSummaryFacts> = {}) =>
  row('template', id, name, status, topic, lang, summary);
const D = (id: string, name: string, status: InvoiceStatus, topic: InvoiceTopic, lang: InvoiceLang, summary: Partial<InvoiceSummaryFacts> = {}) =>
  row('invoice', id, name, status, topic, lang, summary);

/** The comp's `seedData()` templates (1141-1153). */
function seedTemplates(): InvoiceSummary[] {
  return [
    T('tpl-standard', 'Standard invoice', 'live', 'recurring', 'en'),
    T('tpl-standard-de', 'Standard invoice · Deutsch', 'live', 'recurring', 'de', { title: 'RECHNUNG' }),
    T('tpl-standard-fr', 'Standard invoice · Français', 'draft', 'recurring', 'fr', { title: 'FACTURE' }),
    T('tpl-sub', 'Subscription invoice', 'live', 'recurring', 'en', { itemCount: 2 }),
    T('tpl-sub-es', 'Subscription invoice · Español', 'live', 'recurring', 'es', { title: 'FACTURA', itemCount: 2 }),
    T('tpl-receipt', 'Payment receipt', 'live', 'receipts', 'en', { title: 'RECEIPT', accent: '#12805c', itemCount: 1, totalMinor: 29_000 }),
    T('tpl-receipt-ja', 'Payment receipt · 日本語', 'live', 'receipts', 'ja', { title: '領収書', accent: '#12805c', itemCount: 1, totalMinor: 29_000 }),
    T('tpl-quote', 'Quote / estimate', 'draft', 'sales', 'en', { title: 'ESTIMATE' }),
    T('tpl-commercial', 'Commercial invoice', 'live', 'logistics', 'en', { title: 'COMMERCIAL INVOICE', itemCount: 1 }),
    T('tpl-hourly', 'Hourly / time', 'live', 'services', 'en', { itemCount: 2 }),
  ];
}

/** The comp's `seedData()` documents (1155-1168). */
function seedInvoices(): InvoiceSummary[] {
  return [
    D('doc-2050', 'Northwind Traders', 'sent', 'recurring', 'en', { number: 'INV-2050', customerName: 'Northwind Traders' }),
    D('doc-2050-de', 'Northwind Traders · Deutsch', 'sent', 'recurring', 'de', { number: 'INV-2050-DE', customerName: 'Northwind Traders', title: 'RECHNUNG' }),
    D('doc-2049', 'Globex Corp', 'paid', 'recurring', 'en', { number: 'INV-2049', customerName: 'Globex Corporation' }),
    D('doc-r881', 'Acme Studio — receipt', 'paid', 'receipts', 'en', { number: 'RCT-0881', customerName: 'Acme Studio', title: 'RECEIPT', itemCount: 1 }),
    D('doc-2048', 'Initech consulting', 'overdue', 'services', 'en', { number: 'INV-2048', customerName: 'Initech LLC', itemCount: 2 }),
    D('doc-2047', 'Hanseatic Logistik', 'sent', 'logistics', 'de', { number: 'INV-2047', customerName: 'Hanseatic Logistik GmbH', title: 'HANDELSRECHNUNG', itemCount: 1 }),
    D('doc-q118', 'Vertex Media — estimate', 'draft', 'sales', 'en', { number: 'EST-0118', customerName: 'Vertex Media', title: 'ESTIMATE' }),
  ];
}

function detail(summary: InvoiceSummary): InvoiceDetail {
  return { ...summary, body: emptyBody(), languages: [] };
}

interface Fixture {
  templates?: InvoiceSummary[];
  invoices?: InvoiceSummary[];
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** A bodiless reply (204), in the same fake shape `jsonResponse` uses. */
function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.reject(new Error('no body')),
  } as unknown as Response;
}

const STARTER_GLYPH = 'file-text';

function stubFetch(fixture: Fixture) {
  const calls: Call[] = [];
  const templates = fixture.templates ?? [];
  const invoices = fixture.invoices ?? [];
  const all = () => [...templates, ...invoices];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, body });
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles: ['super-admin'], nav: { groups: [] } }) }));
    }
    if (method === 'GET' && (url === '/api/v1/invoices' || url.startsWith('/api/v1/invoices?'))) {
      const kind = new URL(url, 'http://test').searchParams.get('kind');
      const items = kind === 'invoice' ? invoices : kind === 'template' ? templates : all();
      return Promise.resolve(jsonResponse(200, { items, counts: { template: templates.length, invoice: invoices.length } }));
    }
    if (url === '/api/v1/invoices/starters') {
      return Promise.resolve(
        jsonResponse(200, {
          starters: [{ key: 'standard', name: 'Standard invoice', category: 'business', icon: STARTER_GLYPH, title: 'INVOICE', accent: '#4f46e5' }],
        }),
      );
    }
    if (url === '/api/v1/invoices' && method === 'POST') {
      const input = body as { kind: InvoiceDocumentKind; starter: string | null };
      return Promise.resolve(jsonResponse(201, detail({ ...row(input.kind, 'new_1', 'Standard invoice', 'draft', 'other', 'en'), starter: input.starter })));
    }
    const one = /^\/api\/v1\/invoices\/([^/?]+)$/.exec(url);
    if (one !== null && method === 'GET') {
      const found = all().find((doc) => doc.id === one[1]) ?? row('template', one[1] ?? '', 'Standard invoice', 'draft', 'other', 'en');
      return Promise.resolve(jsonResponse(200, detail(found)));
    }
    if (one !== null && method === 'PATCH') {
      const found = all().find((doc) => doc.id === one[1]) ?? row('template', one[1] ?? '', 'x', 'draft', 'other', 'en');
      return Promise.resolve(jsonResponse(200, { ...found, ...(body as object) }));
    }
    if (one !== null && method === 'DELETE') {
      return Promise.resolve(emptyResponse(204));
    }
    const duplicate = /^\/api\/v1\/invoices\/([^/?]+)\/duplicate$/.exec(url);
    if (duplicate !== null && method === 'POST') {
      const found = all().find((doc) => doc.id === duplicate[1]) ?? row('template', duplicate[1] ?? '', 'x', 'draft', 'other', 'en');
      return Promise.resolve(jsonResponse(201, detail({ ...found, id: `${found.id}_copy`, name: `${found.name} (copy)`, status: 'draft' })));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function renderPage(fixture: Fixture = {}, path = '/invoices') {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(fixture);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('invoices-toolbar');
  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });
  return { ...stub, queryClient, router, view, user: userEvent.setup() };
}

function headerTexts(): { label: string; sub: string }[] {
  return screen.getAllByTestId('invoices-group-header').map((el) => ({
    label: within(el).getByRole('heading').textContent ?? '',
    sub: within(el).getByTestId('invoices-group-sub').textContent ?? '',
  }));
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
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('InvoiceManager — shell', () => {
  it('publishes the title, the subtitle and ONE primary that follows the tab; no actions menu', async () => {
    const { user } = await renderPage({ templates: seedTemplates(), invoices: seedInvoices() });
    expect(screen.getByRole('heading', { level: 1, name: 'Invoices' })).toBeDefined();
    expect(screen.getByText('Reusable templates & the invoices you build from them.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'New template' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.getByPlaceholderText('Search templates…')).toBeDefined();
    expect(screen.getByRole('tab', { name: /Templates/ }).getAttribute('data-state')).toBe('active');

    await user.click(screen.getByRole('tab', { name: /Invoices/ }));
    expect(await screen.findByRole('button', { name: 'New invoice' })).toBeDefined();
    expect(screen.getByPlaceholderText('Search invoices…')).toBeDefined();
    await screen.findByText('Globex Corp');
    expect(screen.queryByText('Standard invoice')).toBeNull();
  });

  it('the tab counts are the reply’s and do not respond to the search box', async () => {
    const { user } = await renderPage({ templates: seedTemplates(), invoices: seedInvoices() });
    expect(screen.getAllByTestId('tab-count').map((el) => el.textContent)).toEqual(['10', '7']);
    expect(screen.getAllByTestId('invoices-card')).toHaveLength(10);

    await user.type(screen.getByPlaceholderText('Search templates…'), 'zzz');
    expect(await screen.findByText('No templates match')).toBeDefined();
    expect(screen.getAllByTestId('tab-count').map((el) => el.textContent)).toEqual(['10', '7']);

    await user.clear(screen.getByPlaceholderText('Search templates…'));
    await user.type(screen.getByPlaceholderText('Search templates…'), 'deutsch');
    expect(await screen.findAllByTestId('invoices-card')).toHaveLength(1);
    expect(screen.getAllByTestId('tab-count').map((el) => el.textContent)).toEqual(['10', '7']);
  });

  it('search matches the number, the customer, the title word, the topic label and the language names', async () => {
    const { user } = await renderPage({ templates: seedTemplates(), invoices: seedInvoices() }, '/invoices?kind=invoice');
    const box = screen.getByPlaceholderText('Search invoices…');
    const names = () => screen.getAllByTestId('invoices-card-name').map((el) => el.textContent);
    await user.type(box, 'rct-0881');
    expect(names()).toEqual(['Acme Studio — receipt']);
    await user.clear(box);
    await user.type(box, 'initech llc');
    expect(names()).toEqual(['Initech consulting']);
    await user.clear(box);
    await user.type(box, 'handelsrechnung');
    expect(names()).toEqual(['Hanseatic Logistik']);
    await user.clear(box);
    await user.type(box, 'sales & quotes');
    expect(names()).toEqual(['Vertex Media — estimate']);
    await user.clear(box);
    await user.type(box, 'german');
    expect(names()).toEqual(['Northwind Traders · Deutsch', 'Hanseatic Logistik']);
  });

  it("shows the comp's four empty-state copies per tab and per search", async () => {
    const { user } = await renderPage({ templates: [], invoices: [] });
    expect(await screen.findByText('No templates yet')).toBeDefined();
    expect(screen.getByText('Create a reusable invoice template your team can build from.')).toBeDefined();
    expect(within(screen.getByTestId('invoices-empty')).getByRole('button', { name: 'New template' })).toBeDefined();

    await user.type(screen.getByPlaceholderText('Search templates…'), 'zzz');
    expect(await screen.findByText('No templates match')).toBeDefined();
    expect(screen.getByText('Try a different search term.')).toBeDefined();

    await user.click(screen.getByRole('tab', { name: /Invoices/ }));
    expect(await screen.findByText('No invoices match')).toBeDefined();
    expect(screen.getByText('Try a different search term.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('No invoices yet')).toBeDefined();
    expect(screen.getByText('Build your first invoice from a template or a blank canvas.')).toBeDefined();
    expect(within(screen.getByTestId('invoices-empty')).getByRole('button', { name: 'New invoice' })).toBeDefined();
  });

  it('layout and group-by survive a remount via localStorage under the invoices key', async () => {
    const first = await renderPage({ templates: seedTemplates() });
    expect(screen.getByTestId('invoices-gallery')).toBeDefined();
    await first.user.click(screen.getByRole('radio', { name: 'List' }));
    await first.user.click(screen.getByRole('radio', { name: 'Language' }));
    expect(await screen.findByTestId('invoices-list')).toBeDefined();
    expect(JSON.parse(window.localStorage.getItem(MANAGER_PREFS_KEY) ?? '{}')).toEqual({ layout: 'list', groupBy: 'language' });

    first.view.unmount();
    vi.unstubAllGlobals();
    await renderPage({ templates: seedTemplates() });
    expect(screen.getByRole('radio', { name: 'List' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Language' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('invoices-list')).toBeDefined();
  });

  it('renders with the defaults when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { user } = await renderPage({ templates: seedTemplates() });
    expect(screen.getByRole('radio', { name: 'Gallery' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'None' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'List' }));
    expect(await screen.findByTestId('invoices-list')).toBeDefined();
  });

  it('New template → Blank + the starters; a starter → POST { kind, starter } and the editor route opens on the reply', async () => {
    const { user, calls, router } = await renderPage({ templates: seedTemplates() });
    await user.click(screen.getByRole('button', { name: 'New template' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New template')).toBeDefined();
    expect(within(dialog).getByText('Blank invoice')).toBeDefined();
    await waitFor(() => {
      expect(dialog.querySelector('[data-starter="standard"]')).not.toBeNull();
    });
    expect(within(dialog).queryByText('Your templates')).toBeNull();
    await user.click(dialog.querySelector('[data-starter="standard"]') as HTMLElement);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/invoices').map((c) => c.body)).toEqual([{ kind: 'template', starter: 'standard' }]);
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/invoices/new_1');
    });
  });

  it('on the invoices tab the New modal adds Your templates', async () => {
    const { user } = await renderPage({ templates: seedTemplates(), invoices: seedInvoices() }, '/invoices?kind=invoice');
    expect(screen.getByRole('tab', { name: /Invoices/ }).getAttribute('data-state')).toBe('active');
    await user.click(screen.getByRole('button', { name: 'New invoice' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New invoice')).toBeDefined();
    expect(await within(dialog).findByText('Your templates')).toBeDefined();
    expect(within(dialog).getAllByTestId('invoices-from-template')).toHaveLength(10);
  });
});

describe('InvoiceManager — gallery, list and groups', () => {
  it('a card reads name + meta — the customer alone for a template, number · customer for an invoice — with the lang chip and the status pill', async () => {
    const { user } = await renderPage({ templates: seedTemplates(), invoices: seedInvoices() });
    const first = screen.getAllByTestId('invoices-card')[0] as HTMLElement;
    expect(within(first).getByText('Standard invoice')).toBeDefined();
    expect(within(first).getByTestId('invoices-card-meta').textContent).toBe('Northwind Traders');
    expect(within(first).getByTestId('invoices-lang').textContent).toBe('EN');
    expect(within(first).getByTestId('invoices-status').textContent).toBe('Live');

    await user.click(screen.getByRole('tab', { name: /Invoices/ }));
    const cards = await screen.findAllByTestId('invoices-card');
    expect(within(cards[0] as HTMLElement).getByTestId('invoices-card-meta').textContent).toBe('INV-2050 · Northwind Traders');
    expect(within(cards[1] as HTMLElement).getByTestId('invoices-lang').textContent).toBe('DE');
    expect(cards.map((card) => within(card).getByTestId('invoices-status').textContent)).toEqual(['Sent', 'Sent', 'Paid', 'Paid', 'Overdue', 'Sent', 'Draft']);
    expect(cards.map((card) => within(card).getByTestId('invoices-status').getAttribute('data-tone'))).toEqual(['accent', 'accent', 'pos', 'pos', 'danger', 'accent', 'neutral']);
  });

  it('the mini preview draws min(itemCount, 3) rows, the brand word, the title word and the formatted total', async () => {
    await renderPage({
      templates: [
        T('t3', 'Three', 'live', 'other', 'en', { itemCount: 3, totalMinor: 123_456 }),
        T('t1', 'One', 'live', 'other', 'en', { itemCount: 1, totalMinor: 29_000, currency: '€', cents: false, title: 'RECEIPT' }),
        T('t0', 'Zero', 'live', 'other', 'en', { itemCount: 0, totalMinor: -6_300 }),
        T('t9', 'Nine', 'live', 'other', 'en', { itemCount: 9, totalMinor: 0 }),
      ],
    });
    const previews = screen.getAllByTestId('invoices-mini-preview');
    expect(previews.map((el) => within(el).getByTestId('invoices-mini-rows').childElementCount)).toEqual([3, 1, 0, 3]);
    expect(previews.map((el) => within(el).getByTestId('invoices-mini-total').textContent)).toEqual(['$1,234.56', '€290', '−$63.00', '$0.00']);
    expect(within(previews[0] as HTMLElement).getByText('Northwind Studio')).toBeDefined();
    expect(within(previews[1] as HTMLElement).getByText('RECEIPT')).toBeDefined();
    expect(within(previews[0] as HTMLElement).getByText('TOTAL')).toBeDefined();
    expect((previews[0] as HTMLElement).style.getPropertyValue('--adm-invoice-accent')).toBe('#4f46e5');
  });

  it('Language grouping runs en → de → fr → es → pt → ja and skips empties, with "N documents"', async () => {
    const { user } = await renderPage({ templates: seedTemplates() });
    await user.click(screen.getByRole('radio', { name: 'Language' }));
    await screen.findAllByTestId('invoices-group-header');
    expect(headerTexts()).toEqual([
      { label: 'English', sub: '6 documents' },
      { label: 'Deutsch · German', sub: '1 document' },
      { label: 'Français · French', sub: '1 document' },
      { label: 'Español · Spanish', sub: '1 document' },
      { label: '日本語 · Japanese', sub: '1 document' },
    ]);
    const groups = screen.getAllByTestId('invoices-group');
    expect(groups.map((g) => within(g).getAllByTestId('invoices-card').length)).toEqual([6, 1, 1, 1, 1]);
  });

  it('Topic grouping is first-encounter order with "N documents · M languages" — on the Templates tab too', async () => {
    const { user } = await renderPage({ templates: seedTemplates(), invoices: seedInvoices() });
    await user.click(screen.getByRole('radio', { name: 'Topic' }));
    await screen.findAllByTestId('invoices-group-header');
    expect(headerTexts()).toEqual([
      { label: 'Recurring', sub: '5 documents · 4 languages' },
      { label: 'Receipts & refunds', sub: '2 documents · 2 languages' },
      { label: 'Sales & quotes', sub: '1 document · 1 language' },
      { label: 'Shipping & logistics', sub: '1 document · 1 language' },
      { label: 'Professional services', sub: '1 document · 1 language' },
    ]);

    await user.click(screen.getByRole('tab', { name: /Invoices/ }));
    await waitFor(() => {
      expect(headerTexts()[0]).toEqual({ label: 'Recurring', sub: '3 documents · 2 languages' });
    });
    expect(headerTexts().map((h) => h.label)).toEqual(['Recurring', 'Receipts & refunds', 'Professional services', 'Shipping & logistics', 'Sales & quotes']);
  });

  it('the list is ONE table with Name · Status · Updated · Actions, the row sub-line, the relative stamp and group bands inside', async () => {
    const { user } = await renderPage({ invoices: seedInvoices() }, '/invoices?kind=invoice');
    await user.click(screen.getByRole('radio', { name: 'List' }));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((el) => el.textContent)).toEqual(['Name', 'Status', 'Updated', 'Actions']);
    const rows = within(table).getAllByTestId('invoices-row');
    expect(rows).toHaveLength(7);
    const first = rows[0] as HTMLElement;
    expect(within(first).getByTestId('invoices-row-sub').textContent).toBe('INV-2050 · Northwind Traders · Recurring');
    expect(within(first).getByTestId('invoices-lang').textContent).toBe('EN');
    expect(within(first).getByTestId('invoices-status').textContent).toBe('Sent');
    expect(within(first).getByText('2 days ago')).toBeDefined();
    expect(within(first).getAllByRole('button').map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(['Northwind Traders', 'Duplicate', 'Rename', 'Delete']);

    await user.click(screen.getByRole('radio', { name: 'Language' }));
    await waitFor(() => {
      expect(screen.getAllByRole('table')).toHaveLength(1);
      expect(within(screen.getByRole('table')).getAllByTestId('invoices-group-header')).toHaveLength(2);
    });
    expect(headerTexts()).toEqual([
      { label: 'English', sub: '5 documents' },
      { label: 'Deutsch · German', sub: '2 documents' },
    ]);
  });

  it('a row click opens the editor route', async () => {
    const { user, router } = await renderPage({ templates: seedTemplates() });
    await user.click(screen.getByRole('radio', { name: 'List' }));
    const rows = await screen.findAllByTestId('invoices-row');
    await user.click(within(rows[2] as HTMLElement).getByTestId('invoices-row-sub'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/invoices/tpl-standard-fr');
    });
  });

  it('rename commits on Enter, an empty name becomes Untitled, Escape reverts', async () => {
    const { user, calls } = await renderPage({ templates: seedTemplates().slice(0, 1) });
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = await screen.findByRole('textbox', { name: 'New name' });
    expect((input as HTMLInputElement).value).toBe('Standard invoice');
    await user.clear(input);
    await user.type(input, 'Retainer{Enter}');
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PATCH')).toEqual([{ method: 'PATCH', url: '/api/v1/invoices/tpl-standard', body: { name: 'Retainer' } }]);
    });
    expect(screen.queryByRole('textbox', { name: 'New name' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const blank = await screen.findByRole('textbox', { name: 'New name' });
    await user.clear(blank);
    await user.type(blank, '   {Enter}');
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ name: 'Retainer' }, { name: 'Untitled' }]);
    });

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const again = await screen.findByRole('textbox', { name: 'New name' });
    await user.clear(again);
    await user.type(again, 'Nope');
    fireEvent.keyDown(again, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'New name' })).toBeNull();
    });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
  });

  it("delete opens the comp's confirm — Delete {name}? and the kind's sentence — and confirms with a hard DELETE", async () => {
    const { user, calls } = await renderPage({ templates: seedTemplates().slice(0, 1), invoices: seedInvoices().slice(0, 1) });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete Standard invoice?')).toBeDefined();
    expect(within(dialog).getByTestId('invoices-delete-body').textContent).toBe('This can’t be undone. The template will be permanently removed.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);

    await user.click(screen.getByRole('tab', { name: /Invoices/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete Northwind Traders?')).toBeDefined();
    expect(within(dialog).getByTestId('invoices-delete-body').textContent).toBe('This can’t be undone. The invoice will be permanently removed.');
    await user.click(within(dialog).getByTestId('invoices-delete-confirm'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/v1/invoices/doc-2050']);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it("duplicate → POST /duplicate, stays on the manager, and the toast's Undo → DELETE of the copy", async () => {
    const { user, calls, router } = await renderPage({ templates: seedTemplates().slice(0, 1) });
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/invoices/tpl-standard/duplicate')).toBe(true);
    });
    await screen.findByText('Template duplicated');
    expect(router.state.location.pathname).toBe('/invoices');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/v1/invoices/tpl-standard_copy']);
    });
  });

  it('every hover action is reachable by Tab (focus-within reveal asserted)', async () => {
    const { user } = await renderPage({ templates: seedTemplates().slice(0, 1) });
    const actions = screen.getByTestId('invoices-card-actions');
    expect(actions.className).toContain('translate-y-full');
    expect(actions.className).toContain('group-hover:translate-y-0');
    expect(actions.className).toContain('group-focus-within:translate-y-0');
    screen.getByRole('button', { name: 'Edit' }).focus();
    const names: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await user.tab();
      names.push(document.activeElement?.getAttribute('aria-label') ?? '');
    }
    expect(names).toEqual(['Duplicate', 'Rename', 'Delete']);
  });
});
