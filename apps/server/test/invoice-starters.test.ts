// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The seeded document, the twelve starters and the envelope
 * (34-invoices-add-on.md Appendix G, Appendix D.2, §3.9; 34-T46).
 *
 * The assertions with teeth: every seeded string is swept for the 17 §2
 * substrings and for the vendor's name (seeded copy ships in a real row on
 * first use, and Appendix D.2's standing rule says no starter names
 * Adminium, a real company, or a subscription/seat/credit line item); the
 * standard starter's total is the fixture's first case, so the seed and the
 * law agree; and the two 34 O18 caps refuse with a code that names the
 * field.
 */
import { describe, expect, it } from 'vitest';

import { addDays, addMonths, formatDocumentDate } from '../src/invoices/dates.js';
import {
  BODY_BYTES_MAX,
  DEFAULT_BLOCK_ORDER,
  IMAGE_DATA_URL_MAX,
  acceptInvoiceBody,
  assertBodyWithinCaps,
  emptyBody,
  inlineImages,
  invoiceBodyInputSchema,
  invoiceBodySchema,
  normalizeInvoiceBody,
  reconcileBlockOrder,
} from '../src/invoices/document.js';
import { CONTENT_DICTIONARIES, DOCUMENT_LANGUAGES, isInvoiceLang, languageMeta, languageOrder, localizeBody } from '../src/invoices/languages.js';
import { totalsOf } from '../src/invoices/money.js';
import { TEMPLATE_NUMBER, nextInvoiceNumber } from '../src/invoices/numbering.js';
import { STARTER_KEYS, baseBody, blankBody, isInvoiceStarterKey, renderStarter, starterCards, type StarterContext } from '../src/invoices/starters.js';
import { summaryOf } from '../src/invoices/summary.js';

/** 17 §2's grep, verbatim: substrings, case-insensitive. */
const TRAP_RE = /pricing|plan|tier|billing|upgrade|\/mo|free/i;

const NOW = Date.UTC(2026, 6, 12, 9, 30); // Jul 12, 2026
const CTX: StarterContext = { now: NOW, lang: 'en', number: 'INV-1001' };

const CATEGORIES = ['business', 'payments', 'adjustments', 'sales', 'recurring', 'services', 'projects', 'shipping', 'nonprofit'];
const TOPICS = ['recurring', 'services', 'receipts', 'sales', 'logistics'];

describe('the seeded document and the twelve starters (Appendix G, D.2)', () => {
  it('has the comp’s twelve keys in its order, and nine clean category keys', () => {
    expect([...STARTER_KEYS]).toEqual(['standard', 'receipt', 'proforma', 'credit', 'quote', 'subscription', 'deposit', 'hourly', 'milestone', 'commercial', 'donation', 'retainer']);
    const cards = starterCards();
    expect(cards.map((c) => c.key)).toEqual([...STARTER_KEYS]);
    for (const card of cards) {
      expect(CATEGORIES, card.key).toContain(card.category);
      expect(card.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(card.icon.length).toBeGreaterThan(0);
    }
    expect(cards.find((c) => c.key === 'receipt')).toMatchObject({ name: 'Payment receipt', category: 'payments', icon: 'receipt', title: 'RECEIPT', accent: '#12805c' });
    expect(cards.find((c) => c.key === 'standard')?.accent).toBe('#4f46e5');
    expect(isInvoiceStarterKey('donation')).toBe(true);
    expect(isInvoiceStarterKey('late-reminder')).toBe(false);
  });

  it('no seeded string trips the 17 §2 sweep or names the vendor (Appendix D.2’s standing rule)', () => {
    const documents = [baseBody(CTX), blankBody(CTX), ...STARTER_KEYS.map((key) => renderStarter(key, CTX).body)];
    for (const [index, body] of documents.entries()) {
      const text = JSON.stringify(body);
      expect(TRAP_RE.exec(text)?.[0], `document ${String(index)}`).toBeUndefined();
      expect(/adminium/i.test(text), `document ${String(index)} names the vendor`).toBe(false);
    }
    const cards = JSON.stringify(starterCards());
    expect(TRAP_RE.exec(cards)?.[0]).toBeUndefined();
    expect(/adminium/i.test(cards)).toBe(false);
  });

  it('the base is the comp’s base() re-themed: dates from now, the number given, every optional block off', () => {
    const base = baseBody(CTX);
    expect(base).toMatchObject({
      accent: '#4f46e5',
      currency: '$',
      cents: true,
      title: 'INVOICE',
      logoIcon: 'hexagon',
      logoText: 'Orchard Lane',
      customerName: 'Northwind Traders',
      number: 'INV-1001',
      issued: 'Jul 12, 2026',
      due: 'Aug 11, 2026',
      terms: 'Net 30',
      taxRate: '8',
      discountRate: '0',
      poNumber: 'PO-4417',
      recurNext: 'Aug 12, 2026',
      loyLevel: 'Gold',
      bgTint: 0.82,
      custom: [],
      blockOrder: [...DEFAULT_BLOCK_ORDER],
    });
    expect(base.payment[2]).toBe('Reference: INV-1001');
    expect(base.items.map((i) => [i.desc, i.qty, i.rate])).toEqual([
      ['Brand identity — design retainer', '1', '2400'],
      ['Website copy — 6 pages', '6', '180'],
      ['Print collateral — setup', '1', '320'],
    ]);
    expect(new Set(base.items.map((i) => i.id)).size).toBe(3);
    expect(base.payHist.map((p) => p.date)).toEqual(['Jul 2, 2026', 'Jun 2, 2026']);
    const flags = ['shipShow', 'sigShow', 'termsShow', 'attachShow', 'approvalShow', 'qrShow', 'lateShow', 'poShow', 'mcShow', 'recurShow', 'discShow', 'taxbShow', 'payhShow', 'legalShow', 'refShow', 'conShow', 'loyShow', 'delShow'] as const;
    for (const flag of flags) expect(base[flag], flag).toBe(false);
    // The standard starter's total IS the fixture's first case: seed and law agree.
    expect(totalsOf(base).total).toBe(410_400);
    expect(summaryOf(base)).toEqual({
      number: 'INV-1001',
      customerName: 'Northwind Traders',
      title: 'INVOICE',
      logoText: 'Orchard Lane',
      logoIcon: 'hexagon',
      accent: '#4f46e5',
      currency: '$',
      cents: true,
      totalMinor: 410_400,
      itemCount: 3,
    });
  });

  it('a starter is a patch over the base: title, accent, items, row facts — never the block order', () => {
    const standard = renderStarter('standard', CTX);
    expect(standard).toMatchObject({ topic: 'recurring', status: 'draft' });
    expect(standard.body).toMatchObject({ shipShow: true, sigShow: true, termsShow: true, title: 'INVOICE' });
    expect(standard.body.items).toHaveLength(3);

    const receipt = renderStarter('receipt', CTX);
    expect(receipt).toMatchObject({ topic: 'receipts', status: 'paid' });
    expect(receipt.body).toMatchObject({ title: 'RECEIPT', accent: '#12805c', terms: 'Paid', taxRate: '0' });
    expect(receipt.body.items.map((i) => [i.desc, i.qty, i.rate])).toEqual([['Studio membership — monthly', '1', '290']]);
    expect(totalsOf(receipt.body).total).toBe(29_000);

    const credit = renderStarter('credit', CTX);
    expect(credit.body.items[0]?.rate).toBe('-63');
    expect(totalsOf(credit.body).total).toBe(-20_412);

    const donation = renderStarter('donation', CTX);
    expect(donation).toMatchObject({ topic: 'receipts', status: 'paid' });
    expect(donation.body).toMatchObject({ title: 'DONATION RECEIPT', accent: '#0d9488', terms: 'Received' });

    for (const key of STARTER_KEYS) {
      const rendered = renderStarter(key, CTX);
      expect(rendered.body.blockOrder, key).toEqual([...DEFAULT_BLOCK_ORDER]);
      expect(TOPICS, key).toContain(rendered.topic);
      expect(rendered.card.key).toBe(key);
      expect(rendered.body.title).toBe(rendered.card.title);
      // The reply schema accepts every starter whole — a New button never creates a body the serializer strips.
      expect(invoiceBodySchema.safeParse(rendered.body).success, key).toBe(true);
      expect(invoiceBodyInputSchema.safeParse(rendered.body).success, key).toBe(true);
    }
    expect(renderStarter('commercial', CTX)).toMatchObject({ topic: 'logistics' });
    expect(renderStarter('hourly', CTX).body.items.map((i) => i.qty)).toEqual(['24', '38']);
  });

  it('the blank document is the comp’s createBlank patch', () => {
    const blank = blankBody(CTX);
    expect(blank).toMatchObject({
      title: 'INVOICE',
      from: ['Your company', 'Address line', 'email@company.example'],
      customerName: 'Client name',
      customer: ['client@email.example', 'Client address'],
      notes: 'Thank you for your business.',
    });
    expect(blank.items.map((i) => [i.desc, i.qty, i.rate])).toEqual([['Item description', '1', '0']]);
    expect(totalsOf(blank).total).toBe(0);
  });

  it('dates: six locales, UTC, +30 days, +1 month with a clamped day', () => {
    expect(formatDocumentDate(NOW, 'en')).toBe('Jul 12, 2026');
    expect(formatDocumentDate(NOW, 'de')).toBe('12. Juli 2026');
    expect(formatDocumentDate(NOW, 'fr')).toBe('12 juil. 2026');
    expect(formatDocumentDate(NOW, 'es')).toBe('12 jul 2026');
    expect(formatDocumentDate(NOW, 'pt')).toBe('12/07/2026');
    expect(formatDocumentDate(NOW, 'ja')).toBe('2026年7月12日');
    expect(addDays(NOW, 30) - NOW).toBe(30 * 86_400_000);
    expect(formatDocumentDate(addMonths(Date.UTC(2026, 0, 31), 1), 'en')).toBe('Feb 28, 2026');
    expect(formatDocumentDate(addMonths(Date.UTC(2026, 11, 15), 1), 'en')).toBe('Jan 15, 2027');
  });

  it('numbering: INV-1001 + the invoice count, stepped past taken numbers; templates carry the placeholder', async () => {
    const taken = new Set(['INV-1003', 'INV-1004']);
    const repo = {
      counts: async () => Promise.resolve({ template: 5, invoice: 2 }),
      numberExists: async (kind: string, number: string) => Promise.resolve(kind === 'invoice' && taken.has(number)),
    };
    expect(await nextInvoiceNumber(repo)).toBe('INV-1005');
    taken.clear();
    expect(await nextInvoiceNumber(repo)).toBe('INV-1003');
    expect(TEMPLATE_NUMBER).toBe('INV-1000');
  });
});

describe('the envelope (document.ts)', () => {
  it('normalizes anything into the complete shape, with the dashboard’s defaults', () => {
    expect(normalizeInvoiceBody(null)).toEqual(emptyBody());
    expect(normalizeInvoiceBody('nope')).toEqual(emptyBody());
    const loose = normalizeInvoiceBody({
      accent: 'red',
      currency: '',
      items: [{ desc: 'x', qty: 12, rate: 63 }, 'junk', { id: 'keep', qty: '1.5' }],
      taxRate: 8,
      lateDays: '10',
      bgTint: 4,
      apprStatus: 'maybe',
      payHist: [{ status: 'sent' }, { status: 'x' }],
      delSteps: [{ label: 'a', status: 'done' }, { label: 'b', status: 'later' }],
      custom: [{ id: 'c1', type: 'text', title: 'T', body: 'B' }, { id: '', type: 'text' }, { id: 'c2', type: 'mystery' }, { id: 'g', type: 'gallery', images: [{ url: 'u' }] }],
      blockOrder: ['items', 'items', 'cus:c1', 'cus:gone', 'parties'],
    });
    expect(loose.accent).toBe('#4f46e5');
    expect(loose.currency).toBe('$');
    expect(loose.items).toEqual([
      { id: 'i_0', desc: 'x', qty: '12', rate: '63' },
      { id: 'keep', desc: '', qty: '1.5', rate: '0' },
    ]);
    expect(loose.taxRate).toBe('8');
    expect(loose.lateDays).toBe(10);
    expect(loose.bgTint).toBe(0.95);
    expect(loose.apprStatus).toBe('pending');
    expect(loose.payHist.map((p) => p.status)).toEqual(['sent', 'paid']);
    expect(loose.delSteps.map((s) => s.status)).toEqual(['done', 'todo']);
    expect(loose.custom.map((c) => c.id)).toEqual(['c1', 'g']);
    expect(loose.custom[1]).toEqual({ id: 'g', type: 'gallery', title: '', images: [{ id: 'g0', url: 'u' }] });
    // Reconciled: duplicates once, orphans dropped, every built-in present, the unreferenced section appended.
    expect(loose.blockOrder.slice(0, 3)).toEqual(['items', 'cus:c1', 'parties']);
    expect(loose.blockOrder.filter((k) => k === 'items')).toHaveLength(1);
    expect(loose.blockOrder).not.toContain('cus:gone');
    expect(loose.blockOrder.at(-1)).toBe('cus:g');
    for (const key of DEFAULT_BLOCK_ORDER) expect(loose.blockOrder).toContain(key);
    expect(reconcileBlockOrder([], [])).toEqual([...DEFAULT_BLOCK_ORDER]);
    // The complete shape survives the reply schema and the input schema both ways.
    expect(invoiceBodySchema.safeParse(loose).success).toBe(true);
    expect(invoiceBodyInputSchema.safeParse(loose).success).toBe(true);
    expect(normalizeInvoiceBody(loose)).toEqual(loose);
  });

  it('the input schema is lenient on absence and strict on shape and size', () => {
    expect(invoiceBodyInputSchema.safeParse({}).success).toBe(true);
    expect(invoiceBodyInputSchema.safeParse({ items: 'not a list' }).success).toBe(false);
    expect(invoiceBodyInputSchema.safeParse({ from: [{ line: 1 }] }).success).toBe(false);
    expect(invoiceBodyInputSchema.safeParse({ notes: 'x'.repeat(4001) }).success).toBe(false);
    expect(invoiceBodyInputSchema.safeParse({ items: Array.from({ length: 101 }, () => ({})) }).success).toBe(false);
    expect(invoiceBodyInputSchema.safeParse({ custom: Array.from({ length: 61 }, () => ({})) }).success).toBe(false);
    expect(invoiceBodyInputSchema.safeParse({ blockOrder: Array.from({ length: 121 }, () => 'k') }).success).toBe(false);
    expect(invoiceBodyInputSchema.safeParse({ items: [{ qty: 12, rate: '63' }], custom: [{ anything: true }] }).success).toBe(true);
  });

  it('the two O18 caps refuse with a code naming the field', () => {
    const body = { ...emptyBody(), logoImage: `data:image/png;base64,${'A'.repeat(IMAGE_DATA_URL_MAX)}` };
    expect(() => assertBodyWithinCaps(body)).toThrow(expect.objectContaining({ statusCode: 422, details: expect.objectContaining({ code: 'IMAGE_TOO_LARGE', field: 'logoImage' }) }));
    // A plain URL of any length is not an inline image.
    expect(() => assertBodyWithinCaps({ ...emptyBody(), logoImage: `https://x.example/${'a'.repeat(IMAGE_DATA_URL_MAX)}` })).not.toThrow();
    const gallery = {
      ...emptyBody(),
      custom: [{ id: 'g', type: 'gallery' as const, title: '', images: [{ id: 'g0', url: 'data:x' }, { id: 'g1', url: `data:${'B'.repeat(IMAGE_DATA_URL_MAX)}` }] }],
    };
    expect(inlineImages(gallery).map((i) => i.field)).toEqual(['logoImage', 'bgImage', 'qrImage', 'sigImage', 'stampImage', 'custom.g.images.g0', 'custom.g.images.g1']);
    expect(() => assertBodyWithinCaps(gallery)).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'IMAGE_TOO_LARGE', field: 'custom.g.images.g1' }) }));
    expect(inlineImages({ ...emptyBody(), custom: [{ id: 'p', type: 'image', title: '', url: 'data:y', caption: '', height: 1 }] }).at(-1)).toEqual({ field: 'custom.p.url', url: 'data:y' });
    // Under the per-image cap but over the body cap: nine near-cap images.
    const big = { ...emptyBody(), custom: Array.from({ length: 9 }, (_, i) => ({ id: `p${String(i)}`, type: 'image' as const, title: '', url: `data:${'C'.repeat(IMAGE_DATA_URL_MAX - 5)}`, caption: '', height: 1 })) };
    expect(JSON.stringify(big).length).toBeGreaterThan(BODY_BYTES_MAX);
    expect(() => assertBodyWithinCaps(big)).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'BODY_TOO_LARGE' }) }));
    expect(acceptInvoiceBody({ title: 'RECEIPT' }).title).toBe('RECEIPT');
    expect(() => acceptInvoiceBody(body)).toThrow();
  });
});

describe('the six document languages (languages.ts)', () => {
  it('localizes title, terms and notes only; English is the identity; unknown titles stay', () => {
    const base = baseBody(CTX);
    expect(localizeBody(base, 'en')).toEqual(base);
    const de = localizeBody(base, 'de');
    expect(de).toMatchObject({ title: 'RECHNUNG', terms: 'Netto 30', notes: CONTENT_DICTIONARIES.de.notes });
    expect(de.items).toEqual(base.items);
    expect(de.from).toEqual(base.from);
    expect(localizeBody({ ...base, title: 'COMMERCIAL INVOICE' }, 'ja').title).toBe('COMMERCIAL INVOICE');
    expect(localizeBody(renderStarter('credit', CTX).body, 'fr').title).toBe('AVOIR');
    expect(DOCUMENT_LANGUAGES.map((l) => l.code)).toEqual(['en', 'de', 'fr', 'es', 'pt', 'ja']);
    expect(languageMeta('xx')).toEqual({ code: 'en', native: 'English' });
    expect(languageMeta('ja').native).toBe('日本語');
    expect(languageOrder('pt')).toBe(4);
    expect(languageOrder('xx')).toBe(6);
    expect(isInvoiceLang('es')).toBe(true);
    expect(isInvoiceLang('en_US')).toBe(false);
  });
});
