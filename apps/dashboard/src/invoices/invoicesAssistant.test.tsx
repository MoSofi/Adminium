// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the invoice pages hand the assistant.
 *
 * THE MONEY IS THE CLAIM WORTH PINNING. Two previews show figures, and
 * neither may compute one: both are `model/money.ts`'s, the same law the
 * document the save writes is priced by. So the tests here compare what the
 * preview renders against what `totalsOf` says, rather than against a number
 * somebody typed into a fixture — a hand-written expectation would agree
 * with a second copy of the law just as happily as with the real one.
 *
 * THE READ-ONLY PAPER is the other half: the sheet inside the modal is this
 * page's own canvas with nothing on it to operate, which is what makes "one
 * invoice renderer" true rather than aspirational.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import type { BootstrapData } from '../app/bootstrap.js';
import { DraftPreview } from '../assistant/parts/DraftPreview.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import type { InvoiceDetail, InvoiceSummary } from './api.js';
import { bodyOf, draftOf } from './assistant.js';
import { InvoiceCanvas } from './editor/canvas/InvoiceCanvas.js';
import { emptyBody, type InvoiceBody } from './model/envelope.js';
import { formatMoney, totalsOf } from './model/money.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

/** A template artefact as the turn produces it: the envelope's shape, not a stored row. */
const ARTEFACT: Record<string, unknown> = {
  name: 'EU services invoice',
  topic: 'services',
  lang: 'en',
  body: {
    logoText: 'Northwind Studio',
    customerName: 'Globex Corporation',
    title: 'INVOICE',
    number: 'INV-2051',
    items: [
      { id: 'i1', desc: 'Design retainer', qty: '2', rate: '150' },
      { id: 'i2', desc: 'Consulting', qty: '1', rate: '90.5' },
    ],
    taxRate: '10',
    notes: 'Thank you.',
  },
};

function summary(id: string, name: string): InvoiceSummary {
  return {
    id,
    kind: 'template',
    name,
    status: 'draft',
    topic: 'services',
    lang: 'en',
    starter: null,
    originId: null,
    createdAt: 1,
    updatedAt: 1,
    summary: {
      number: 'INV-2050',
      customerName: 'Globex Corporation',
      title: 'INVOICE',
      logoText: 'Northwind Studio',
      logoIcon: 'hexagon',
      accent: '#4f46e5',
      currency: '$',
      cents: true,
      totalMinor: 42_955,
      itemCount: 2,
    },
  };
}

function detail(): InvoiceDetail {
  const docBody: InvoiceBody = { ...emptyBody(), logoText: 'Northwind Studio', customerName: 'Globex Corporation' };
  return { ...summary('inv_1', 'Standard invoice'), body: docBody, languages: [] };
}

function stubFetch(bootstrap: BootstrapData) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: bootstrap }));
      if (url === '/api/v1/invoices/starters') return Promise.resolve(jsonResponse(200, { starters: [] }));
      if (method === 'GET' && (url === '/api/v1/invoices' || url.startsWith('/api/v1/invoices?'))) {
        return Promise.resolve(jsonResponse(200, { items: [summary('inv_1', 'Standard invoice')], counts: { template: 1, invoice: 0 } }));
      }
      if (method === 'GET' && url === '/api/v1/invoices/inv_1') return Promise.resolve(jsonResponse(200, detail()));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
}

async function renderAt(path: string, assistant: BootstrapData['assistant']) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch(makeBootstrap({ nav: { groups: [] }, ...(assistant === undefined ? {} : { assistant }) }));
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId(path === '/invoices' ? 'invoices-toolbar' : 'invoices-editor-header');
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
  vi.restoreAllMocks();
});

describe('the artefact as a document', () => {
  it('fills the envelope from whatever the turn produced', () => {
    const body = bodyOf(ARTEFACT);
    expect(body.customerName).toBe('Globex Corporation');
    expect(body.items).toHaveLength(2);
    // Absent in the artefact; the envelope's own defaults, not blanks.
    expect(body.accent).toBe(emptyBody().accent);
    expect(body.blockOrder).toEqual(emptyBody().blockOrder);
  });

  it('reads the draft as unsaved, whatever the artefact claims', () => {
    const draft = draftOf(ARTEFACT);
    expect(draft.name).toBe('EU services invoice');
    expect(draft.topic).toBe('services');
    // A proposal is a draft: nothing the model writes is live, sent or paid.
    expect(draft.status).toBe('draft');
    expect(draftOf({ topic: 'not-a-topic', lang: 'kl' }).topic).toBe('other');
    expect(draftOf({}).lang).toBe('en');
  });
});

describe('the read-only paper', () => {
  function renderSheet(readOnly: boolean) {
    const draft = draftOf(ARTEFACT);
    const { container } = render(
      <InvoiceCanvas
        draft={draft}
        totals={totalsOf(draft.body)}
        {...(readOnly
          ? { readOnly: true }
          : {
              section: 'branding' as const,
              onSelect: () => undefined,
              onInsertAt: () => undefined,
              onAppend: () => undefined,
              onRemoveCustom: () => undefined,
              onImageRejected: () => undefined,
            })}
      />,
    );
    return container;
  }

  it('is the page’s own sheet with nothing on it to operate', () => {
    const container = renderSheet(true);
    expect(screen.getByTestId('invoices-paper')).toBeTruthy();
    expect(screen.getByText('Globex Corporation')).toBeTruthy();
    expect(screen.getByText('Design retainer')).toBeTruthy();
    // No inline fields, no rings, no grips, no insert chips, no Add section.
    expect(container.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(0);
    expect(screen.queryByTestId('invoices-add-section')).toBeNull();
    expect(screen.queryByTestId('invoices-grip')).toBeNull();
    expect(screen.queryByTestId('invoices-insert-above')).toBeNull();
    expect(screen.queryByTestId('invoices-add-item')).toBeNull();
    // Nothing focusable at all: the only buttons the sheet ever had were ways
    // to change it or ways to select a section for an inspector that is not here.
    expect([...container.querySelectorAll('button')].filter((node) => !node.hasAttribute('disabled'))).toHaveLength(0);
  });

  it('prices every line and the total by the page’s own law', () => {
    renderSheet(true);
    const body = bodyOf(ARTEFACT);
    const totals = totalsOf(body);
    const amounts = screen.getAllByTestId('invoices-item-amount').map((node) => node.textContent);
    expect(amounts).toEqual(totals.lines.map((minor) => formatMoney(minor, body.currency, body.cents)));
    expect(screen.getByTestId('invoices-total').textContent).toBe(formatMoney(totals.total, body.currency, body.cents));
  });

  it('still edits when it is not read-only', () => {
    const container = renderSheet(false);
    expect(screen.getByTestId('invoices-add-section')).toBeTruthy();
    expect(container.querySelectorAll('input').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-selected]').length).toBeGreaterThan(0);
  });
});

describe('the record grid', () => {
  it('shows the total the document would carry, not the model’s arithmetic', () => {
    const body = bodyOf(ARTEFACT);
    const totals = totalsOf(body);
    render(
      <DraftPreview
        artefact={ARTEFACT}
        basedOnLabel="Standard invoice"
        amounts={totals.lines.map((minor) => formatMoney(minor, body.currency, body.cents))}
        total={formatMoney(totals.total, body.currency, body.cents)}
      />,
    );
    // 2 × 150 + 1 × 90.50 = 390.50, +10 % tax = 429.55. The figure is asserted
    // against the law rather than against that sentence, which is a comment.
    expect(screen.getByTestId('assistant-draft-total').textContent).toBe(formatMoney(totals.total, body.currency, body.cents));
    expect(screen.getByText('Standard invoice')).toBeTruthy();
    expect(screen.getByText('2 lines')).toBeTruthy();
  });
});

describe('the Ask button', () => {
  it('renders in the manager and the editor when the grant is there', async () => {
    await renderAt('/invoices', { allowed: true, name: 'Ada' });
    expect(screen.getByTestId('ask-assistant').textContent).toContain('Ask Ada');
    cleanup();
    vi.unstubAllGlobals();

    await renderAt('/invoices/inv_1', { allowed: true, name: 'Ada' });
    expect(screen.getByTestId('ask-assistant')).toBeTruthy();
  });

  it('renders in neither without the grant', async () => {
    await renderAt('/invoices', { allowed: false, name: 'Milo' });
    expect(screen.queryByTestId('ask-assistant')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    await renderAt('/invoices/inv_1', { allowed: false, name: 'Milo' });
    expect(screen.queryByTestId('ask-assistant')).toBeNull();
  });
});
