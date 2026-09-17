// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The six document languages: the fixed order, and `localizeBody` — the
 * comp's `localize` (1203-1207) — which moves exactly three fields and leaves
 * a title the dictionary lacks alone.
 */
import { describe, expect, it } from 'vitest';

import { emptyBody, type InvoiceBody } from './envelope.js';
import { CONTENT_DICTIONARIES, DOCUMENT_LANGUAGES, isInvoiceLang, languageMeta, languageOrder, localizeBody, type InvoiceLang } from './languages.js';

const NON_ENGLISH: readonly Exclude<InvoiceLang, 'en'>[] = ['de', 'fr', 'es', 'pt', 'ja'];

function sample(title = 'INVOICE'): InvoiceBody {
  return {
    ...emptyBody(),
    title,
    terms: 'Net 30',
    notes: 'Payment due within 30 days. Thank you for your business.',
    items: [{ id: 'i1', desc: 'Design retainer — Q3', qty: '1', rate: '3000' }],
    from: ['Northwind Studio'],
    customerName: 'Globex Corporation',
    shipShow: true,
    ship: ['Dock 4'],
  };
}

describe('the fixed order', () => {
  it('runs en → de → fr → es → pt → ja', () => {
    expect(DOCUMENT_LANGUAGES.map((language) => language.code)).toEqual(['en', 'de', 'fr', 'es', 'pt', 'ja']);
    expect(DOCUMENT_LANGUAGES.map((language) => language.native)).toEqual(['English', 'Deutsch', 'Français', 'Español', 'Português', '日本語']);
    expect(DOCUMENT_LANGUAGES.map((language) => languageOrder(language.code))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(languageOrder('zh')).toBe(6);
  });

  it('reads an unknown code as English', () => {
    expect(languageMeta('xx')).toEqual(DOCUMENT_LANGUAGES[0]);
    expect(isInvoiceLang('pt')).toBe(true);
    expect(isInvoiceLang('ar')).toBe(false);
  });
});

describe('localizeBody', () => {
  it('changes only title, terms and notes', () => {
    const source = sample();
    for (const lang of NON_ENGLISH) {
      const out = localizeBody(source, lang);
      const { title, terms, notes, ...rest } = out;
      const { title: srcTitle, terms: srcTerms, notes: srcNotes, ...srcRest } = source;
      expect(rest).toEqual(srcRest);
      expect(title).toBe(CONTENT_DICTIONARIES[lang].titles['INVOICE']);
      expect(terms).toBe(CONTENT_DICTIONARIES[lang].terms);
      expect(notes).toBe(CONTENT_DICTIONARIES[lang].notes);
      expect(title).not.toBe(srcTitle);
      expect(terms === srcTerms && notes === srcNotes).toBe(false);
    }
  });

  it('translates the six dictionary titles per language', () => {
    for (const lang of NON_ENGLISH) {
      for (const [english, translated] of Object.entries(CONTENT_DICTIONARIES[lang].titles)) {
        expect(localizeBody(sample(english), lang).title).toBe(translated);
      }
      expect(Object.keys(CONTENT_DICTIONARIES[lang].titles).sort()).toEqual(['CREDIT NOTE', 'DEPOSIT', 'ESTIMATE', 'INVOICE', 'PROFORMA', 'RECEIPT']);
    }
  });

  it('COMMERCIAL INVOICE and DONATION RECEIPT stay English in every language', () => {
    for (const lang of NON_ENGLISH) {
      expect(localizeBody(sample('COMMERCIAL INVOICE'), lang).title).toBe('COMMERCIAL INVOICE');
      expect(localizeBody(sample('DONATION RECEIPT'), lang).title).toBe('DONATION RECEIPT');
    }
  });

  it('en is the identity — a copy, not the same object', () => {
    const source = sample();
    const out = localizeBody(source, 'en');
    expect(out).toEqual(source);
    expect(out).not.toBe(source);
  });

  it('does not mutate its input', () => {
    const source = sample();
    const before = JSON.stringify(source);
    localizeBody(source, 'ja');
    expect(JSON.stringify(source)).toBe(before);
  });
});
