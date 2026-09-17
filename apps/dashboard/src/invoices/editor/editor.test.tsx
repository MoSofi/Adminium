// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor shell (O19, O22, O24): explicit save with its chip and
 * history, the discard guard, the gate (an off block is absent, and returns
 * through the Add-section modal at the index the chip was opened from),
 * custom sections, the keyboard reorder, the primary's label, the language
 * menu and Delete. Rendered through the real router and shell so the
 * topbar's Back and the blocker are the product's own; the API is a fetch
 * stub keyed on the routes the editor calls.
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
import type { InvoiceDetail, InvoicePutBody } from '../api.js';
import { emptyBody, type InvoiceBody } from '../model/envelope.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function body(over: Partial<InvoiceBody> = {}): InvoiceBody {
  return {
    ...emptyBody(),
    logoText: 'Northwind Studio',
    from: ['Northwind Studio', '12 Harbour Lane'],
    customerName: 'Globex Corporation',
    customer: ['ap@globex.example'],
    number: 'INV-2050',
    issued: '2026-09-01',
    due: '2026-10-01',
    terms: 'Net 30',
    poNumber: 'PO-7781',
    items: [
      { id: 'i1', desc: 'Design retainer — Q3', qty: '2', rate: '150' },
      { id: 'i2', desc: 'Consulting — 1 hour', qty: '1', rate: '90.5' },
    ],
    taxRate: '10',
    payment: ['Bank transfer'],
    notes: 'Thank you for your business.',
    sigShow: true,
    sigName: 'Ava Reyes',
    sigTitle: 'Director',
    ...over,
  };
}

function detail(over: Partial<InvoiceDetail> = {}, docBody: InvoiceBody = body()): InvoiceDetail {
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
      totalMinor: 42_955,
      itemCount: docBody.items.length,
    },
    body: docBody,
    languages: [
      { id: 'inv_1', lang: 'en', name: 'Standard invoice', status: 'draft' },
      { id: 'inv_de', lang: 'de', name: 'Standard invoice · Deutsch', status: 'draft' },
    ],
    ...over,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.reject(new Error('no body')),
  } as unknown as Response;
}

function stubFetch(doc: InvoiceDetail) {
  const calls: Call[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const parsed = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, body: parsed });
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles: ['super-admin'], nav: { groups: [] } }) }));
    }
    if (method === 'GET' && (url === '/api/v1/invoices' || url.startsWith('/api/v1/invoices?'))) {
      return Promise.resolve(jsonResponse(200, { items: [], counts: { template: 0, invoice: 0 } }));
    }
    if (url === '/api/v1/invoices/starters') return Promise.resolve(jsonResponse(200, { starters: [] }));
    if (url === `/api/v1/invoices/${doc.id}` && method === 'GET') return Promise.resolve(jsonResponse(200, doc));
    if (url === `/api/v1/invoices/${doc.id}` && method === 'PUT') {
      const put = parsed as InvoicePutBody;
      return Promise.resolve(jsonResponse(200, detail({ ...doc, name: put.name, status: put.status, topic: put.topic, lang: put.lang }, put.body)));
    }
    if (url === `/api/v1/invoices/${doc.id}` && method === 'DELETE') return Promise.resolve(emptyResponse(204));
    if (url === `/api/v1/invoices/${doc.id}/languages` && method === 'POST') {
      const input = parsed as { lang: string };
      return Promise.resolve(jsonResponse(201, detail({ id: `inv_${input.lang}`, lang: 'fr', name: 'Standard invoice · Français' })));
    }
    if (url === `/api/v1/invoices/${doc.id}/duplicate` && method === 'POST') {
      return Promise.resolve(jsonResponse(201, detail({ id: `${doc.id}_copy`, name: `${doc.name} (copy)` })));
    }
    if (url === '/api/v1/invoices/inv_fr' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, detail({ id: 'inv_fr', lang: 'fr', name: 'Standard invoice · Français' })));
    }
    if (url === '/api/v1/invoices/inv_de' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, detail({ id: 'inv_de', lang: 'de', name: 'Standard invoice · Deutsch' })));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function renderEditor(doc: InvoiceDetail = detail()) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(doc);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [`/invoices/${doc.id}`] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('invoices-editor-header');
  return { ...stub, queryClient, router, user: userEvent.setup() };
}

const nameInput = () => screen.getByTestId('invoices-editor-name') as HTMLInputElement;
const chip = () => screen.getByTestId('invoices-save-chip');
const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT');
const blockKeys = () => screen.getAllByTestId('invoices-block').map((el) => el.getAttribute('data-block'));
const selectedRegions = () => [...document.querySelectorAll('[data-testid="invoices-section"][data-selected]')].map((el) => el.getAttribute('data-section'));

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
});

describe('Invoice editor — save, history, guard (O22)', () => {
  it('typing never issues a request; the chip reads Unsaved changes; Save → one PUT → All changes saved', async () => {
    const { user, calls } = await renderEditor();
    expect(chip().textContent).toBe('All changes saved');
    const before = calls.length;
    await user.click(nameInput());
    await user.type(nameInput(), ' 2026');
    expect(nameInput().value).toBe('Standard invoice 2026');
    expect(chip().textContent).toBe('Unsaved changes');
    expect(screen.getByRole('heading', { level: 1, name: 'Standard invoice 2026' })).toBeDefined();
    expect(calls.length).toBe(before);

    await user.click(screen.getByTestId('invoices-save'));
    await waitFor(() => {
      expect(chip().textContent).toBe('All changes saved');
    });
    expect(puts(calls)).toHaveLength(1);
    expect(puts(calls)[0]?.url).toBe('/api/v1/invoices/inv_1');
    const sent = puts(calls)[0]?.body as InvoicePutBody;
    expect(sent.name).toBe('Standard invoice 2026');
    expect(sent.status).toBe('draft');
    expect(sent.lang).toBe('en');
    expect(sent.body.items).toHaveLength(2);
  });

  it('Ctrl/⌘+S saves, inside the name field too', async () => {
    const { user, calls } = await renderEditor();
    await user.click(nameInput());
    await user.type(nameInput(), '!');
    expect(chip().textContent).toBe('Unsaved changes');
    fireEvent.keyDown(nameInput(), { key: 's', ctrlKey: true });
    await waitFor(() => {
      expect(puts(calls)).toHaveLength(1);
    });
    await waitFor(() => {
      expect(chip().textContent).toBe('All changes saved');
    });
  });

  it('Undo restores the previous draft and re-dirties; Redo returns', async () => {
    const { user, calls } = await renderEditor();
    expect(screen.getByTestId('invoices-undo').hasAttribute('disabled')).toBe(true);
    await user.click(nameInput());
    await user.type(nameInput(), ' 2026');
    await user.click(screen.getByTestId('invoices-save'));
    await waitFor(() => {
      expect(chip().textContent).toBe('All changes saved');
    });
    await user.click(screen.getByTestId('invoices-undo'));
    expect(nameInput().value).toBe('Standard invoice');
    expect(chip().textContent).toBe('Unsaved changes');
    expect(puts(calls)).toHaveLength(1);
    await user.click(screen.getByTestId('invoices-redo'));
    expect(nameInput().value).toBe('Standard invoice 2026');
    expect(chip().textContent).toBe('All changes saved');
  });

  it('Back with a dirty draft opens the discard modal; Keep editing stays, Discard leaves without a request', async () => {
    const { user, calls, router } = await renderEditor();
    await user.click(nameInput());
    await user.type(nameInput(), ' 2026');
    await user.click(screen.getByRole('link', { name: 'Back' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Discard unsaved changes?')).toBeDefined();
    expect(within(dialog).getByTestId('invoices-discard-body').textContent).toBe('Your edits to Standard invoice 2026 will be lost.');
    await user.click(within(dialog).getByTestId('invoices-discard-keep'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.state.location.pathname).toBe('/invoices/inv_1');
    expect(nameInput().value).toBe('Standard invoice 2026');

    await user.click(screen.getByRole('link', { name: 'Back' }));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('invoices-discard-confirm'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/invoices');
    });
    expect(puts(calls)).toHaveLength(0);
  });

  it('Back with a clean draft leaves at once', async () => {
    const { user, router } = await renderEditor();
    await user.click(screen.getByRole('link', { name: 'Back' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/invoices');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Invoice editor — the gate and the Add-section modal (O19)', () => {
  it('an off block is ABSENT from the canvas and a chip in the modal; picking it shows the block and selects its section', async () => {
    const { user } = await renderEditor(detail({}, body({ sigShow: false })));
    expect(blockKeys()).toEqual(['parties', 'meta', 'items', 'totals', 'paynotes']);
    expect(screen.queryByText('Add signature block')).toBeNull();
    expect(selectedRegions()).toEqual(['branding']);

    await user.click(screen.getByTestId('invoices-add-section'));
    const modal = await screen.findByTestId('invoices-add-modal');
    expect(within(modal).getAllByTestId('invoices-add-custom')).toHaveLength(4);
    const chips = within(modal).getAllByTestId('invoices-add-builtin').map((el) => el.getAttribute('data-block'));
    expect(chips).toHaveLength(18);
    expect(chips).toContain('signature');
    expect(chips).not.toContain('parties');

    await user.click(within(modal).getByRole('button', { name: 'Signature' }));
    await waitFor(() => {
      expect(screen.queryByTestId('invoices-add-modal')).toBeNull();
    });
    // Appended by the trailing button (`at: null`): the key stays where the order had it.
    expect(blockKeys()).toEqual(['parties', 'meta', 'items', 'totals', 'paynotes', 'signature']);
    expect(selectedRegions()).toEqual(['signature']);
    expect(chip().textContent).toBe('Unsaved changes');
  });

  it('the modal lists exactly the off sections; when none remain it says so', async () => {
    const on = Object.fromEntries(
      (
        [
          'shipShow',
          'sigShow',
          'termsShow',
          'attachShow',
          'approvalShow',
          'qrShow',
          'lateShow',
          'poShow',
          'mcShow',
          'recurShow',
          'discShow',
          'taxbShow',
          'payhShow',
          'legalShow',
          'refShow',
          'conShow',
          'loyShow',
          'delShow',
        ] as const
      ).map((flag) => [flag, true]),
    ) as Partial<InvoiceBody>;
    const { user } = await renderEditor(detail({}, body(on)));
    expect(blockKeys()).toHaveLength(23);
    await user.click(screen.getByTestId('invoices-add-section'));
    const modal = await screen.findByTestId('invoices-add-modal');
    expect(within(modal).queryAllByTestId('invoices-add-builtin')).toHaveLength(0);
    expect(within(modal).getByTestId('invoices-add-none').textContent).toBe('Every standard block is already on this invoice.');
  });

  it('a between-block chip passes the PRE-FILTER index; the trailing button appends', async () => {
    const { user, calls } = await renderEditor(detail({}, body({ sigShow: false, shipShow: false })));
    // shipping (1) is hidden, so meta's pre-filter index is 2.
    const meta = screen.getAllByTestId('invoices-block').find((el) => el.getAttribute('data-block') === 'meta') as HTMLElement;
    expect(meta.getAttribute('data-index')).toBe('2');
    expect(within(meta).getByTestId('invoices-insert-above').getAttribute('aria-label')).toBe('Add a section above Invoice details');
    await user.click(within(meta).getByTestId('invoices-insert-above'));
    await user.click(within(await screen.findByTestId('invoices-add-modal')).getByRole('button', { name: 'Signature' }));
    await waitFor(() => {
      expect(screen.queryByTestId('invoices-add-modal')).toBeNull();
    });
    expect(blockKeys()).toEqual(['parties', 'signature', 'meta', 'items', 'totals', 'paynotes']);

    await user.click(screen.getByTestId('invoices-add-section'));
    await user.click(within(await screen.findByTestId('invoices-add-modal')).getByRole('button', { name: /^Detail rows/ }));
    await waitFor(() => {
      expect(screen.queryByTestId('invoices-add-modal')).toBeNull();
    });
    expect(blockKeys()).toEqual(['parties', 'signature', 'meta', 'items', 'totals', 'paynotes', 'custom.kv']);

    await user.click(screen.getByTestId('invoices-save'));
    await waitFor(() => {
      expect(puts(calls)).toHaveLength(1);
    });
    const sent = puts(calls)[0]?.body as InvoicePutBody;
    expect(sent.body.blockOrder.slice(0, 4)).toEqual(['parties', 'shipping', 'signature', 'meta']);
    expect(sent.body.blockOrder).toHaveLength(24);
    expect(sent.body.blockOrder[23]).toBe(`cus:${sent.body.custom[0]?.id ?? ''}`);
    expect(sent.body.sigShow).toBe(true);
    expect(sent.body.shipShow).toBe(false);
  });

  it('a custom text section is added with the seed, edited and removed; removal falls back to Line items', async () => {
    const { user } = await renderEditor();
    await user.click(screen.getByTestId('invoices-add-section'));
    await user.click(within(await screen.findByTestId('invoices-add-modal')).getByRole('button', { name: /^Text section/ }));
    await waitFor(() => {
      expect(blockKeys()).toContain('custom.text');
    });
    expect(selectedRegions()).toHaveLength(1);
    expect(selectedRegions()[0]?.startsWith('cus:')).toBe(true);
    expect((screen.getByTestId('invoices-canvas-custom-title') as HTMLInputElement).value).toBe('Additional notes');
    const area = screen.getByTestId('invoices-canvas-custom-body') as HTMLTextAreaElement;
    expect(area.value).toBe('Add your own copy here — scope, delivery notes, conditions or a message to the client.');
    await user.clear(area);
    await user.type(area, 'Deliverables ship on the 1st.');
    expect(area.value).toBe('Deliverables ship on the 1st.');

    await user.click(screen.getByTestId('invoices-canvas-custom-remove'));
    expect(blockKeys()).not.toContain('custom.text');
    expect(selectedRegions()).toEqual(['items']);
  });

  it('ArrowUp / ArrowDown on a grip moves the block past its VISIBLE neighbour (a11y path)', async () => {
    const { user, calls } = await renderEditor(detail({}, body({ sigShow: false, shipShow: false })));
    const grips = () => screen.getAllByTestId('invoices-grip');
    expect(grips()[1]?.getAttribute('aria-label')).toBe('Drag to reorder section: Invoice details');
    fireEvent.keyDown(grips()[1] as HTMLElement, { key: 'ArrowUp' });
    expect(blockKeys()).toEqual(['meta', 'parties', 'items', 'totals', 'paynotes']);
    fireEvent.keyDown(grips()[0] as HTMLElement, { key: 'ArrowDown' });
    expect(blockKeys()).toEqual(['parties', 'meta', 'items', 'totals', 'paynotes']);
    fireEvent.keyDown(grips()[0] as HTMLElement, { key: 'ArrowUp' });
    expect(blockKeys()).toEqual(['parties', 'meta', 'items', 'totals', 'paynotes']);
    // One history step per move: two undos walk both back.
    await user.click(screen.getByTestId('invoices-undo'));
    expect(blockKeys()).toEqual(['meta', 'parties', 'items', 'totals', 'paynotes']);
    await user.click(screen.getByTestId('invoices-undo'));
    expect(blockKeys()).toEqual(['parties', 'meta', 'items', 'totals', 'paynotes']);
    expect(puts(calls)).toHaveLength(0);
  });
});

describe('Invoice editor — header (O24)', () => {
  it('the primary reads Save template for a template and Save invoice for an invoice (no provider installed)', async () => {
    await renderEditor();
    expect(screen.getByTestId('invoices-save').textContent).toBe('Save template');
    expect(screen.getByTestId('invoices-editor-header').textContent).toContain('Template');
  });

  it('…and Save invoice for an invoice', async () => {
    await renderEditor(detail({ kind: 'invoice', name: 'Globex Corporation' }));
    expect(screen.getByTestId('invoices-save').textContent).toBe('Save invoice');
    expect(screen.queryByText('Send invoice')).toBeNull();
    expect(screen.getByTestId('invoices-editor-header').textContent).toContain('Invoice');
  });

  it('the language menu lists six rows as Editing / Open / Create; Create POSTs /languages and opens the reply', async () => {
    const { user, calls, router } = await renderEditor();
    expect(screen.getByTestId('invoices-language-button').textContent).toBe('EN');
    await user.click(screen.getByTestId('invoices-language-button'));
    const menu = await screen.findByTestId('invoices-language-menu');
    const rows = within(menu).getAllByTestId('invoices-language-row');
    expect(rows.map((row) => row.getAttribute('data-lang'))).toEqual(['en', 'de', 'fr', 'es', 'pt', 'ja']);
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['editing', 'open', 'create', 'create', 'create', 'create']);
    expect(within(rows[0] as HTMLElement).getByText('Editing')).toBeDefined();
    expect(within(rows[1] as HTMLElement).getByText('Open')).toBeDefined();
    expect(within(rows[2] as HTMLElement).getByText('Français')).toBeDefined();
    expect(within(rows[2] as HTMLElement).getByText('French')).toBeDefined();
    expect(within(menu).getByText('Creating a language makes a linked copy, grouped under the same topic.')).toBeDefined();

    await user.click(rows[2] as HTMLElement);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', url: '/api/v1/invoices/inv_1/languages', body: { lang: 'fr' } }]);
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/invoices/inv_fr');
    });
    expect(await screen.findByDisplayValue('Standard invoice · Français')).toBeDefined();
  });

  it('Open on an existing sibling navigates to it', async () => {
    const { user, router, calls } = await renderEditor();
    await user.click(screen.getByTestId('invoices-language-button'));
    const menu = await screen.findByTestId('invoices-language-menu');
    await user.click(within(menu).getByText('Deutsch').closest('button') as HTMLElement);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/invoices/inv_de');
    });
    expect(await screen.findByDisplayValue('Standard invoice · Deutsch')).toBeDefined();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('Images selects the images section; Duplicate POSTs /duplicate and toasts with Undo', async () => {
    const { user, calls, router } = await renderEditor();
    await user.click(screen.getByTestId('invoices-images'));
    expect(screen.getAllByTestId('invoices-inspector-header')[0]?.getAttribute('data-section')).toBe('images');

    await user.click(screen.getByTestId('invoices-duplicate'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/invoices/inv_1/duplicate')).toBe(true);
    });
    await screen.findByText('Template duplicated');
    expect(router.state.location.pathname).toBe('/invoices/inv_1');
    // The toast's Undo, not the header's history button of the same name.
    const undo = screen.getAllByRole('button', { name: 'Undo' }).find((el) => el.getAttribute('data-testid') !== 'invoices-undo') as HTMLElement;
    await user.click(undo);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/v1/invoices/inv_1_copy']);
    });
  });

  it("Delete opens the comp's confirm, DELETEs and leaves for the manager on the document's tab", async () => {
    const { user, calls, router } = await renderEditor(detail({ kind: 'invoice', name: 'Globex Corporation' }));
    await user.click(nameInput());
    await user.type(nameInput(), '!');
    await user.click(screen.getByTestId('invoices-delete'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete Globex Corporation!?')).toBeDefined();
    expect(within(dialog).getByTestId('invoices-delete-body').textContent).toBe('This can’t be undone. The invoice will be permanently removed.');
    await user.click(within(dialog).getByTestId('invoices-delete-confirm'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/v1/invoices/inv_1']);
    });
    // The guard is bypassed on purpose: a dirty draft of a deleted row has nowhere to go.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/invoices');
    });
    expect(router.state.location.search).toEqual({ kind: 'invoice' });
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
  });
});
