// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The canvas (O25): every one of the 27 kinds draws when
 * its flag is on and one custom section of each type exists; the gate leaves
 * the five permanent blocks with every flag off; the ladder prints the money
 * law's figures with the discount row shown only above zero; the tax
 * breakdown uses the ladder's base; the letterhead is read-only; and every
 * input on the sheet — text fields and file inputs alike — has an accessible
 * name.
 *
 * Rendered through the real router (the editor owns selection and the
 * modal). The axe pass runs in the e2e file against the built canvas:
 * happy-dom cannot host axe-core.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../../app/query.js';
import { createAppRouter } from '../../../app/router.js';
import { installTestI18n } from '../../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../../test/fixtures.js';
import type { InvoiceDetail } from '../../api.js';
import { BLOCK_VOCABULARY } from '../../model/blocks.js';
import { DEFAULT_BLOCK_ORDER, emptyBody, type CustomSection, type InvoiceBody } from '../../model/envelope.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const CUSTOM: CustomSection[] = [
  { id: 'c_text', type: 'text', title: 'Additional notes', body: 'Deliverables ship on the 1st.' },
  { id: 'c_image', type: 'image', title: 'Site photo', url: '', caption: 'Add a caption', height: 200 },
  {
    id: 'c_kv',
    type: 'kv',
    title: 'Reference details',
    rows: [
      { k: 'Cost centre', v: 'CC-4410' },
      { k: 'Contract', v: 'MSA-2026-08' },
    ],
  },
  {
    id: 'c_gallery',
    type: 'gallery',
    title: 'Images',
    images: [
      { id: 'g1', url: '' },
      { id: 'g2', url: 'data:image/png;base64,iVBORw0KGgo=' },
      { id: 'g3', url: '' },
    ],
  },
];

/** Every flag on, one custom section of each type, and the numbers the money tests assert. */
function fullBody(over: Partial<InvoiceBody> = {}): InvoiceBody {
  return {
    ...emptyBody(),
    logoText: 'Northwind Studio',
    from: ['Northwind Studio', '12 Harbour Lane', 'accounts@northwind.example'],
    customerName: 'Globex Corporation',
    customer: ['ap@globex.example', '1 Globex Plaza'],
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
    discountRate: '0',
    payment: ['Bank transfer', 'Reference INV-2050'],
    notes: 'Thank you for your business.',
    shipShow: true,
    shipName: 'Globex Warehouse',
    ship: ['Dock 4'],
    sigShow: true,
    sigName: 'Ava Reyes',
    sigTitle: 'Director',
    termsShow: true,
    termsLabel: 'I accept the terms above.',
    termsChecked: true,
    attachShow: true,
    attachments: [{ name: 'timesheet.pdf', size: '214 KB' }],
    approvalShow: true,
    apprName: 'Ben Ortiz',
    apprTitle: 'Finance lead',
    apprStatus: 'approved',
    qrShow: true,
    qrCaption: 'Scan to pay',
    lateShow: true,
    lateRate: '1.5',
    lateDays: 7,
    poShow: true,
    poTerms: 'Goods remain ours until paid.',
    mcShow: true,
    fx: [{ code: 'EUR', sym: '€', rate: '0.92' }],
    recurShow: true,
    recurFreq: 'Monthly',
    recurNext: '1 Oct 2026',
    recurCount: '3 of 12',
    discShow: true,
    discCodes: [{ code: 'WELCOME10', label: 'Welcome offer', amount: '25' }],
    taxbShow: true,
    taxLines: [
      { label: 'State', rate: '6' },
      { label: 'City', rate: '4' },
    ],
    payhShow: true,
    payHist: [{ date: '15 Aug 2026', method: 'Card', amount: '$100.00', status: 'paid' }],
    legalShow: true,
    legalText: 'Registered in Delaware.',
    refShow: true,
    refText: 'Refunds within 14 days.',
    conShow: true,
    conName: 'Ava Reyes',
    conEmail: 'ava@northwind.example',
    conPhone: '+1 555 0100',
    loyShow: true,
    loyBalance: 1240,
    loyEarned: 120,
    loyLevel: 'Gold',
    delShow: true,
    delSteps: [
      { label: 'Ordered', status: 'done' },
      { label: 'Packed', status: 'current' },
      { label: 'Delivered', status: 'todo' },
    ],
    custom: CUSTOM,
    blockOrder: [...DEFAULT_BLOCK_ORDER, ...CUSTOM.map((section) => `cus:${section.id}`)],
    ...over,
  };
}

function detail(docBody: InvoiceBody, over: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: 'inv_1',
    kind: 'invoice',
    name: 'Globex Corporation',
    status: 'sent',
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
    languages: [{ id: 'inv_1', lang: 'en', name: 'Globex Corporation', status: 'sent' }],
    ...over,
  };
}

function stubFetch(doc: InvoiceDetail) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles: ['super-admin'], nav: { groups: [] } }) }));
      }
      if (url === `/api/v1/invoices/${doc.id}` && method === 'GET') return Promise.resolve(jsonResponse(200, doc));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
}

async function renderCanvas(doc: InvoiceDetail = detail(fullBody())) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch(doc);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [`/invoices/${doc.id}`] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const paper = await screen.findByTestId('invoices-paper');
  return { paper, router, user: userEvent.setup() };
}

const blockKeys = () => screen.getAllByTestId('invoices-block').map((el) => el.getAttribute('data-block') ?? '');

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

describe('InvoiceCanvas — the vocabulary and the gate (Appendix F, O19)', () => {
  it('draws all 27 kinds with every flag on and one custom section of each type', async () => {
    const { paper } = await renderCanvas();
    const keys = blockKeys();
    expect(keys).toHaveLength(27);
    expect([...keys].sort()).toEqual([...BLOCK_VOCABULARY]);
    expect(keys.slice(0, 23)).toEqual([...DEFAULT_BLOCK_ORDER]);
    expect(keys.slice(23)).toEqual(['custom.text', 'custom.image', 'custom.kv', 'custom.gallery']);
    // A few family markers, verbatim from the comp.
    expect(within(paper).getByText('From')).toBeDefined();
    expect(within(paper).getByText('Invoice to')).toBeDefined();
    expect(within(paper).getByText('Ship to')).toBeDefined();
    expect(within(paper).getByText('Late payment fee')).toBeDefined();
    expect(within(paper).getByTestId('invoices-latefees-sentence').textContent).toBe('A late fee of 1.5% per month applies to balances unpaid more than 7 days past the due date.');
    expect(within(paper).getByText('Recurring — Monthly')).toBeDefined();
    expect(within(paper).getByText('Next on 1 Oct 2026 · 3 of 12')).toBeDefined();
    expect(within(paper).getByTestId('invoices-loyalty-balance').textContent).toBe('1,240 pts · Gold');
    expect(within(paper).getByText('+120')).toBeDefined();
    expect(within(paper).getByText('WELCOME10')).toBeDefined();
    expect(within(paper).getByText('−$25.00')).toBeDefined();
    expect(within(paper).getByText('Also payable in')).toBeDefined();
    expect(within(paper).getByText('Pay by QR')).toBeDefined();
    expect(within(paper).getByTestId('invoices-qr-placeholder')).toBeDefined();
    expect(within(paper).getByText('Questions? Contact us')).toBeDefined();
    expect(within(paper).getByText('Delivery timeline')).toBeDefined();
    expect(within(paper).getAllByTestId('invoices-delivery-step').map((el) => el.getAttribute('data-status'))).toEqual(['done', 'current', 'todo']);
    expect(within(paper).getByTestId('invoices-approval').getAttribute('data-status')).toBe('approved');
    expect(within(paper).getByText('Approved')).toBeDefined();
    expect(within(paper).getByText('timesheet.pdf')).toBeDefined();
    expect(within(paper).getByText('Paid')).toBeDefined();
    expect(within(paper).getByText('Date signed')).toBeDefined();
    expect(within(paper).getByRole('checkbox', { name: 'I accept the terms above.' }).getAttribute('aria-checked')).toBe('true');
    // The custom kinds: the seeded rows, the gallery's filled slot, the image drop.
    expect(within(paper).getAllByTestId('invoices-kv-row')).toHaveLength(2);
    expect(within(paper).getAllByTestId('invoices-gallery-slot').map((el) => el.hasAttribute('data-filled'))).toEqual([false, true, false]);
    expect(within(paper).getByText('Click to upload an image')).toBeDefined();
    // Each block is a slot with its grip and its insert chip.
    expect(within(paper).getAllByTestId('invoices-grip')).toHaveLength(27);
    expect(within(paper).getAllByTestId('invoices-insert-above')).toHaveLength(27);
    expect(within(paper).getByTestId('invoices-add-section').textContent).toBe('Add section');
  });

  it('with every flag off only the five permanent blocks render — no ghost buttons', async () => {
    const { paper } = await renderCanvas(detail(fullBody({ ...emptyBody(), items: fullBody().items, custom: [], blockOrder: [...DEFAULT_BLOCK_ORDER] })));
    expect(blockKeys()).toEqual(['parties', 'meta', 'items', 'totals', 'paynotes']);
    expect(within(paper).queryByText(/^Add (shipping|signature|terms|attachments|approval|payment|late|purchase|multi|recurring|discount|tax|legal|refund|contact|loyalty|delivery)/)).toBeNull();
    expect(within(paper).getAllByTestId('invoices-section').map((el) => el.getAttribute('data-section'))).toEqual([
      'branding',
      'theme',
      'from',
      'customer',
      'meta',
      'items',
      'tax',
      'payment',
      'notes',
    ]);
  });
});

describe('InvoiceCanvas — the money (O25)', () => {
  it('the ladder prints the law’s figures; the discount row is hidden at 0', async () => {
    const { paper } = await renderCanvas();
    expect(within(paper).getAllByTestId('invoices-item-amount').map((el) => el.textContent)).toEqual(['$300.00', '$90.50']);
    expect(within(paper).getByTestId('invoices-subtotal').textContent).toBe('$390.50');
    expect(within(paper).queryByTestId('invoices-discount-row')).toBeNull();
    expect(within(paper).getByText('Tax (10%)')).toBeDefined();
    expect(within(paper).getByTestId('invoices-tax').textContent).toBe('$39.05');
    expect(within(paper).getByText('Total')).toBeDefined();
    expect(within(paper).queryByText('Total due')).toBeNull();
    expect(within(paper).getByTestId('invoices-total').textContent).toBe('$429.55');
    // Six consumers, one derivation.
    expect(within(paper).getByTestId('invoices-qr-due').textContent).toBe('Amount due · $429.55');
    expect(within(paper).getByTestId('invoices-recurring-amount').textContent).toBe('$429.55');
    expect(within(paper).getByTestId('invoices-fx-row').textContent).toBe('EUR€395.19');
    expect(within(paper).getByText('Converted from $429.55 at indicative rates.')).toBeDefined();
    // Breakdown on the undiscounted base when there is no discount.
    expect(within(paper).getAllByTestId('invoices-tax-line-amount').map((el) => el.textContent)).toEqual(['$23.43', '$15.62']);
  });

  it('at 10 % the discount row shows with a U+2212 in the positive green; tax and the breakdown use the discounted base', async () => {
    const { paper } = await renderCanvas(detail(fullBody({ discountRate: '10' })));
    const discount = within(paper).getByTestId('invoices-discount-row');
    expect(within(discount).getByText('Discount (10%)')).toBeDefined();
    expect(within(discount).getByText('−$39.05').className).toContain('text-pos');
    expect(within(paper).getByTestId('invoices-tax').textContent).toBe('$35.15');
    expect(within(paper).getByTestId('invoices-total').textContent).toBe('$386.60');
    expect(within(paper).getAllByTestId('invoices-tax-line-amount').map((el) => el.textContent)).toEqual(['$21.09', '$14.06']);
    expect(within(paper).getAllByTestId('invoices-tax-line').map((el) => el.textContent)).toEqual(['State6%$21.09', 'City4%$14.06']);
  });

  it('a document without decimals prints whole figures', async () => {
    const { paper } = await renderCanvas(detail(fullBody({ cents: false, currency: '¥' })));
    expect(within(paper).getByTestId('invoices-total').textContent).toBe('¥430');
    expect(within(paper).getByTestId('invoices-subtotal').textContent).toBe('¥391');
  });
});

describe('InvoiceCanvas — the letterhead, selection and names (a11y)', () => {
  it('the title, number and status are read-only text; the brand name is an input; clicking a region selects it', async () => {
    const { paper, user } = await renderCanvas();
    expect(within(paper).getByTestId('invoices-title').textContent).toBe('INVOICE');
    expect(within(paper).getByTestId('invoices-number').textContent).toBe('INV-2050');
    expect(within(paper).getByTestId('invoices-status').textContent).toBe('Sent');
    expect(within(paper).queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect((within(paper).getByRole('textbox', { name: 'Brand name' }) as HTMLInputElement).value).toBe('Northwind Studio');
    expect(within(paper).getByText('Branding · click to edit')).toBeDefined();
    expect(within(paper).getByTestId('invoices-logo-tile')).toBeDefined();

    const theme = within(paper).getByRole('group', { name: 'Title & theme' });
    expect(theme.hasAttribute('data-selected')).toBe(false);
    await user.click(theme);
    expect(theme.hasAttribute('data-selected')).toBe(true);
    expect(within(paper).getByRole('group', { name: 'Branding' }).hasAttribute('data-selected')).toBe(false);
    // The keyboard path: every region carries a hidden Edit button.
    expect(within(paper).getByRole('button', { name: 'Edit Line items' })).toBeDefined();
    expect(within(paper).getByRole('button', { name: 'Edit Additional notes' })).toBeDefined();
  });

  it('typing on the sheet edits the draft with no request and one undo step per field', async () => {
    const { paper, user } = await renderCanvas();
    const customer = within(paper).getByRole('textbox', { name: 'Customer name' }) as HTMLInputElement;
    await user.click(customer);
    await user.type(customer, ' Ltd');
    expect(customer.value).toBe('Globex Corporation Ltd');
    expect(within(paper).getByRole('group', { name: 'Invoice to' }).hasAttribute('data-selected')).toBe(true);
    const qty = within(paper).getByRole('textbox', { name: 'Quantity of line 1' }) as HTMLInputElement;
    await user.clear(qty);
    await user.type(qty, '3');
    expect(within(paper).getByTestId('invoices-subtotal').textContent).toBe('$540.50');
    expect(screen.getByTestId('invoices-save-chip').textContent).toBe('Unsaved changes');
    await user.click(screen.getByTestId('invoices-undo'));
    expect(within(paper).getByTestId('invoices-subtotal').textContent).toBe('$390.50');
    await user.click(screen.getByTestId('invoices-undo'));
    expect(customer.value).toBe('Globex Corporation');
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);
  });

  it('every text input and every file input on the sheet has an accessible name', async () => {
    const { paper } = await renderCanvas();
    const boxes = within(paper).getAllByRole('textbox');
    expect(boxes.length).toBeGreaterThan(20);
    for (const box of boxes) {
      expect(box.getAttribute('aria-label') ?? '').not.toBe('');
    }
    const files = [...paper.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    expect(files).toHaveLength(3);
    for (const file of files) {
      const named = (file.getAttribute('aria-label') ?? '') !== '' || (file.closest('label')?.textContent ?? '').trim() !== '';
      expect(named).toBe(true);
    }
    // Every grip, clear and remove button is named.
    for (const button of within(paper).getAllByRole('button')) {
      expect((button.getAttribute('aria-label') ?? button.textContent ?? '').trim()).not.toBe('');
    }
  });
});
