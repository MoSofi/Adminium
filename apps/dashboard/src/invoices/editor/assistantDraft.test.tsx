// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What happens to the invoice editor when the assistant puts a body on it.
 *
 * THE MODAL IS NOT IN THIS TEST. The button is replaced by a probe that
 * calls the host's `applyDraft` directly, because the claim being made here
 * is the EDITOR's: a body arriving from outside behaves like any other
 * structural edit, and one undo takes all of it back.
 *
 * THE SELECTION is the one judgement call. An invoice body is one envelope,
 * not a list of independently comparable blocks, so "the first changed
 * block" has no exact counterpart — the editor lands on the first section
 * the new body has and the old one did not, which is the part a reader has
 * not seen yet.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import type { AssistantHostContext } from '../../assistant/hostContext.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { InvoiceDetail } from '../api.js';
import { emptyBody, type InvoiceBody } from '../model/envelope.js';

/** A body with a section the open document does not show: the landing place. */
const ARTEFACT: Record<string, unknown> = {
  name: 'EU services invoice',
  topic: 'services',
  lang: 'en',
  body: {
    logoText: 'Northwind Studio',
    customerName: 'Contoso Ltd',
    items: [{ id: 'i1', desc: 'Design retainer', qty: '2', rate: '150' }],
    taxRate: '10',
    taxbShow: true,
    taxLines: [{ label: 'VAT', rate: '10' }],
  },
};

let host: AssistantHostContext | null = null;

vi.mock('../../assistant/AskAssistant.js', () => ({
  AskAssistant: (props: { host: AssistantHostContext }) => {
    host = props.host;
    return (
      <button type="button" data-testid="apply-probe" onClick={() => props.host.applyDraft?.(ARTEFACT)}>
        apply
      </button>
    );
  },
}));

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function body(): InvoiceBody {
  return {
    ...emptyBody(),
    logoText: 'Northwind Studio',
    customerName: 'Globex Corporation',
    number: 'INV-2050',
    items: [{ id: 'i1', desc: 'Design retainer — Q3', qty: '2', rate: '150' }],
  };
}

function detail(): InvoiceDetail {
  const docBody = body();
  return {
    id: 'inv_1',
    kind: 'template',
    name: 'Standard invoice',
    status: 'draft',
    topic: 'services',
    lang: 'en',
    starter: null,
    originId: null,
    createdAt: 1,
    updatedAt: 1,
    summary: {
      number: docBody.number,
      customerName: docBody.customerName,
      title: docBody.title,
      logoText: docBody.logoText,
      logoIcon: docBody.logoIcon,
      accent: docBody.accent,
      currency: docBody.currency,
      cents: docBody.cents,
      totalMinor: 30_000,
      itemCount: 1,
    },
    body: docBody,
    languages: [],
  };
}

async function renderEditor() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(
          jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, assistant: { allowed: true, name: 'Milo' } }) }),
        );
      }
      if (url === '/api/v1/invoices/starters') return Promise.resolve(jsonResponse(200, { starters: [] }));
      if (method === 'GET' && (url === '/api/v1/invoices' || url.startsWith('/api/v1/invoices?'))) {
        return Promise.resolve(jsonResponse(200, { items: [], counts: { template: 0, invoice: 0 } }));
      }
      if (method === 'GET' && url === '/api/v1/invoices/inv_1') return Promise.resolve(jsonResponse(200, detail()));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/invoices/inv_1'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('invoices-editor-header');
  return { calls, user: userEvent.setup() };
}

const chip = () => screen.getByTestId('invoices-save-chip');

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a body the assistant proposed', () => {
  it('reaches the editor as the invoice-template host, carrying what is on screen', async () => {
    await renderEditor();
    // The MANAGER is `invoices` (a record); the editor is a template editor
    // whatever kind of document is open in it.
    expect(host?.context).toBe('invoice-template');
    expect(host?.host.documentId).toBe('inv_1');
    expect((host?.draft as InvoiceBody | undefined)?.customerName).toBe('Globex Corporation');
    expect(typeof host?.applyDraft).toBe('function');
  });

  it('replaces the body, marks it unsaved, writes nothing, and lands on the new section', async () => {
    const { calls, user } = await renderEditor();
    expect(chip().textContent).toBe('All changes saved');
    const before = calls.length;

    await user.click(screen.getByTestId('apply-probe'));

    expect(chip().textContent).toBe('Unsaved changes');
    expect(screen.getByDisplayValue('Contoso Ltd')).toBeTruthy();
    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
    expect(calls.length).toBe(before);

    // `taxbreak` is the one section the open document did not show.
    const selected = screen.getByTestId('invoices-canvas').querySelectorAll('[data-section][data-selected]');
    expect([...selected].map((node) => node.getAttribute('data-section'))).toEqual(['taxbreak']);
  });

  it('is taken back by ONE undo', async () => {
    const { user } = await renderEditor();
    await user.click(screen.getByTestId('apply-probe'));
    expect(chip().textContent).toBe('Unsaved changes');

    await user.click(screen.getByTestId('invoices-undo'));

    await waitFor(() => {
      expect(chip().textContent).toBe('All changes saved');
    });
    expect(screen.getByDisplayValue('Globex Corporation')).toBeTruthy();
    expect(screen.getByTestId('invoices-undo').hasAttribute('disabled')).toBe(true);
  });
});
