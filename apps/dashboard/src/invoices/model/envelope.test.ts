// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The envelope: a partial body is completed with every default, a full
 * body survives the wire unchanged, and the composition is reconciled — no
 * orphan keys, nothing lost, nothing twice.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_BLOCK_ORDER, emptyBody, normalizeBody, reconcileBlockOrder, type CustomSection, type InvoiceBody } from './envelope.js';

/** Every built-in on, one of each custom type, every list non-empty — the widest body the sheet can hold. */
function fullBody(): InvoiceBody {
  const custom: CustomSection[] = [
    { id: 'c_text', type: 'text', title: 'Scope', body: 'Design and build.' },
    { id: 'c_image', type: 'image', title: 'Site photo', url: 'data:image/png;base64,AAAA', caption: 'Before', height: 180 },
    { id: 'c_kv', type: 'kv', title: 'Reference details', rows: [{ k: 'Cost centre', v: 'CC-4410' }] },
    { id: 'c_gallery', type: 'gallery', title: 'Images', images: [{ id: 'g1', url: '' }, { id: 'g2', url: 'data:image/png;base64,BBBB' }, { id: 'g3', url: '' }] },
  ];
  return {
    ...emptyBody(),
    accent: '#0d9488',
    currency: '€',
    cents: false,
    title: 'ESTIMATE',
    logoIcon: 'gem',
    logoText: 'Northwind Studio',
    from: ['Northwind Studio', '12 Harbour Lane'],
    customerName: 'Globex Corporation',
    customer: ['ap@globex.com', '77 Enterprise Way'],
    number: 'EST-0118',
    issued: 'Jul 12, 2026',
    due: 'Aug 11, 2026',
    terms: 'Valid 30 days',
    poNumber: 'PO-4417',
    items: [
      { id: 'i1', desc: 'Design consulting — Jul', qty: '24', rate: '145' },
      { id: 'i2', desc: 'Front-end development — Jul', qty: '38.5', rate: '165' },
    ],
    taxRate: '8',
    discountRate: '2.5',
    payment: ['Bank transfer', 'IBAN GB29 NWBK 6016 1331 9268 19'],
    notes: 'Thank you for your business.',
    shipShow: true,
    shipName: 'Globex — Receiving',
    ship: ['Dock 4', 'Newark, NJ'],
    sigShow: true,
    sigName: 'Ava Reyes',
    sigTitle: 'Authorised signatory',
    termsShow: true,
    termsLabel: 'I agree to the terms.',
    termsChecked: true,
    attachShow: true,
    attachments: [{ name: 'Statement of work.pdf', size: '214 KB' }],
    approvalShow: true,
    apprName: 'Jordan Lee',
    apprTitle: 'Finance Director',
    apprStatus: 'approved',
    qrShow: true,
    qrCaption: 'Scan to pay',
    lateShow: true,
    lateRate: '1.5',
    lateDays: 7,
    poShow: true,
    poTerms: 'Goods remain returnable within 14 days.',
    mcShow: true,
    fx: [{ code: 'GBP', sym: '£', rate: '0.79' }],
    recurShow: true,
    recurFreq: 'Quarterly',
    recurNext: 'Oct 12, 2026',
    recurCount: '4 invoices',
    discShow: true,
    discCodes: [{ code: 'WELCOME10', label: '10% welcome credit', amount: '29' }],
    taxbShow: true,
    taxLines: [{ label: 'State tax', rate: '6' }, { label: 'City tax', rate: '2' }],
    payhShow: true,
    payHist: [{ date: 'Jul 2, 2026', method: 'Visa ·· 4242', amount: '$500.00', status: 'paid' }],
    legalShow: true,
    legalText: 'Registered in Delaware.',
    refShow: true,
    refText: 'Full refunds within 30 days.',
    conShow: true,
    conName: 'Support',
    conEmail: 'support@example.com',
    conPhone: '+1 (555) 010-0100',
    loyShow: true,
    loyBalance: 1240,
    loyEarned: 290,
    loyLevel: 'Gold',
    delShow: true,
    delSteps: [{ label: 'Ordered', status: 'done' }, { label: 'Shipped', status: 'current' }, { label: 'Delivered', status: 'todo' }],
    bgImage: 'data:image/png;base64,CCCC',
    bgTint: 0.5,
    logoImage: 'data:image/png;base64,DDDD',
    qrImage: 'data:image/png;base64,EEEE',
    sigImage: 'data:image/png;base64,FFFF',
    stampImage: 'data:image/png;base64,GGGG',
    custom,
    blockOrder: ['parties', 'cus:c_text', ...DEFAULT_BLOCK_ORDER.slice(1), 'cus:c_image', 'cus:c_kv', 'cus:c_gallery'],
  };
}

describe('normalizeBody', () => {
  it('completes a partial body with every default', () => {
    const body = normalizeBody({ title: 'RECEIPT', customerName: 'Acme Studio', items: [{ desc: 'Charitable contribution' }] });
    expect(body).toEqual({
      ...emptyBody(),
      title: 'RECEIPT',
      customerName: 'Acme Studio',
      items: [{ id: 'i_0', desc: 'Charitable contribution', qty: '1', rate: '0' }],
    });
    expect(Object.keys(body).sort()).toEqual(Object.keys(emptyBody()).sort());
  });

  it('is the empty body for anything that is not an object', () => {
    expect(normalizeBody(null)).toEqual(emptyBody());
    expect(normalizeBody('nope')).toEqual(emptyBody());
    expect(normalizeBody([1, 2])).toEqual(emptyBody());
  });

  it('round-trips a full body — all 23 built-ins on and one of each custom type — through JSON unchanged', () => {
    const body = fullBody();
    expect(normalizeBody(JSON.parse(JSON.stringify(body)))).toEqual(body);
  });

  it('coerces what it can and defaults what it cannot', () => {
    const body = normalizeBody({
      accent: 'red',
      cents: 'yes',
      bgTint: 4,
      lateDays: '12',
      apprStatus: 'maybe',
      payHist: [{ date: 'x', status: 'nonsense' }],
      delSteps: [{ label: 'a', status: 'later' }],
      custom: [{ id: 'k', type: 'unknown' }, { type: 'text', title: 'no id' }],
    });
    expect(body.accent).toBe(emptyBody().accent);
    expect(body.cents).toBe(true);
    expect(body.bgTint).toBe(0.95);
    expect(body.lateDays).toBe(12);
    expect(body.apprStatus).toBe('pending');
    expect(body.payHist[0]?.status).toBe('paid');
    expect(body.delSteps[0]?.status).toBe('todo');
    expect(body.custom).toEqual([]);
  });
});

describe('reconcileBlockOrder', () => {
  const kept: CustomSection = { id: 'kept', type: 'text', title: 'Kept', body: '' };

  it('drops an orphan cus: key', () => {
    const order = reconcileBlockOrder([...DEFAULT_BLOCK_ORDER, 'cus:gone'], []);
    expect(order).toEqual([...DEFAULT_BLOCK_ORDER]);
  });

  it('appends an unreferenced custom section', () => {
    const order = reconcileBlockOrder([...DEFAULT_BLOCK_ORDER], [kept]);
    expect(order).toEqual([...DEFAULT_BLOCK_ORDER, 'cus:kept']);
  });

  it('adds a missing built-in at the end', () => {
    const without = DEFAULT_BLOCK_ORDER.filter((key) => key !== 'qr');
    const order = reconcileBlockOrder(without, []);
    expect(order).toEqual([...without, 'qr']);
  });

  it('dedupes a repeated key, keeping the first position', () => {
    const order = reconcileBlockOrder(['items', 'parties', 'items', 'cus:kept', 'cus:kept'], [kept]);
    expect(order.filter((key) => key === 'items')).toHaveLength(1);
    expect(order.filter((key) => key === 'cus:kept')).toHaveLength(1);
    expect(order.slice(0, 3)).toEqual(['items', 'parties', 'cus:kept']);
    expect(order).toHaveLength(DEFAULT_BLOCK_ORDER.length + 1);
  });

  it('keeps an authored order and drops an unknown key', () => {
    const order = reconcileBlockOrder(['totals', 'cus:kept', 'parties', 'bogus'], [kept]);
    expect(order.slice(0, 3)).toEqual(['totals', 'cus:kept', 'parties']);
    expect(order).not.toContain('bogus');
    expect(new Set(order).size).toBe(order.length);
    for (const key of DEFAULT_BLOCK_ORDER) expect(order).toContain(key);
  });

  it('normalizeBody reconciles the stored order the same way', () => {
    const body = normalizeBody({ blockOrder: ['items', 'cus:gone', 'items'], custom: [{ id: 'kept', type: 'text', title: 'Kept', body: '' }] });
    expect(body.blockOrder[0]).toBe('items');
    expect(body.blockOrder).not.toContain('cus:gone');
    expect(body.blockOrder.at(-1)).toBe('cus:kept');
    expect(body.blockOrder).toHaveLength(DEFAULT_BLOCK_ORDER.length + 1);
  });
});
