// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The six DOCUMENT languages (the comp's `langs()` 1183-1192, `i18n()`
 * 1194-1202, `localize()` 1203-1207).
 *
 * A document's language is the CUSTOMER's, not the admin UI's locale (as
 * amended): the list is the comp's own — three of its six are not UI locales
 * and five UI locales are not in it — and every string in this file is
 * document CONTENT (the word the customer reads on the sheet), which is why
 * none of it is an `invoices:` message key. The chrome around the sheet
 * follows the viewer's locale as usual.
 *
 * `localizeBody` translates exactly what the comp translates — the title
 * word, the payment terms and the notes — and nothing else: a variation
 * keeps its line items, addresses and optional blocks verbatim (the comp's
 * `addLangVariant`, 1237-1253).
 */
import type { InvoiceBody } from './envelope.js';

export type InvoiceLang = 'en' | 'de' | 'fr' | 'es' | 'pt' | 'ja';

export interface DocumentLanguage {
  code: InvoiceLang;
  /** The language's own name — what the menu shows first (comp 351). */
  native: string;
}

/** The comp's fixed order (1185-1190): language groups always run this way. */
export const DOCUMENT_LANGUAGES: readonly DocumentLanguage[] = [
  { code: 'en', native: 'English' },
  { code: 'de', native: 'Deutsch' },
  { code: 'fr', native: 'Français' },
  { code: 'es', native: 'Español' },
  { code: 'pt', native: 'Português' },
  { code: 'ja', native: '日本語' },
];

export function isInvoiceLang(value: unknown): value is InvoiceLang {
  return DOCUMENT_LANGUAGES.some((language) => language.code === value);
}

/** The comp's `langMeta` (1193): unknown codes read as English. */
export function languageMeta(code: string): DocumentLanguage {
  return DOCUMENT_LANGUAGES.find((language) => language.code === code) ?? DOCUMENT_LANGUAGES[0]!;
}

export function languageOrder(code: string): number {
  const index = DOCUMENT_LANGUAGES.findIndex((language) => language.code === code);
  return index === -1 ? DOCUMENT_LANGUAGES.length : index;
}

interface ContentDictionary {
  titles: Readonly<Record<string, string>>;
  terms: string;
  notes: string;
}

/** The comp's content dictionaries (1196-1200), verbatim. */
export const CONTENT_DICTIONARIES: Readonly<Record<Exclude<InvoiceLang, 'en'>, ContentDictionary>> = {
  de: {
    titles: { INVOICE: 'RECHNUNG', RECEIPT: 'QUITTUNG', PROFORMA: 'PROFORMA-RECHNUNG', ESTIMATE: 'KOSTENSCHÄTZUNG', 'CREDIT NOTE': 'GUTSCHRIFT', DEPOSIT: 'ANZAHLUNG' },
    terms: 'Netto 30',
    notes: 'Zahlbar innerhalb von 30 Tagen. Vielen Dank für Ihren Auftrag.',
  },
  fr: {
    titles: { INVOICE: 'FACTURE', RECEIPT: 'REÇU', PROFORMA: 'FACTURE PROFORMA', ESTIMATE: 'DEVIS', 'CREDIT NOTE': 'AVOIR', DEPOSIT: 'ACOMPTE' },
    terms: 'Net 30',
    notes: 'Paiement dû sous 30 jours. Merci de votre confiance.',
  },
  es: {
    titles: { INVOICE: 'FACTURA', RECEIPT: 'RECIBO', PROFORMA: 'FACTURA PROFORMA', ESTIMATE: 'PRESUPUESTO', 'CREDIT NOTE': 'NOTA DE CRÉDITO', DEPOSIT: 'ANTICIPO' },
    terms: 'Neto 30',
    notes: 'Pago a 30 días. Gracias por su confianza.',
  },
  pt: {
    titles: { INVOICE: 'FATURA', RECEIPT: 'RECIBO', PROFORMA: 'FATURA PROFORMA', ESTIMATE: 'ORÇAMENTO', 'CREDIT NOTE': 'NOTA DE CRÉDITO', DEPOSIT: 'SINAL' },
    terms: 'Net 30',
    notes: 'Pagamento em 30 dias. Obrigado pela preferência.',
  },
  ja: {
    titles: { INVOICE: '請求書', RECEIPT: '領収書', PROFORMA: '見積請求書', ESTIMATE: '見積書', 'CREDIT NOTE': '訂正請求書', DEPOSIT: '前受金' },
    terms: '30日以内',
    notes: '30日以内にお支払いください。ご利用ありがとうございます。',
  },
};

/**
 * The comp's `localize` (1203-1207): title, terms and notes move to the target
 * language; a title the dictionary lacks (COMMERCIAL INVOICE, DONATION
 * RECEIPT) stays as written; English is the identity.
 */
export function localizeBody(body: InvoiceBody, lang: InvoiceLang): InvoiceBody {
  if (lang === 'en') return { ...body };
  const dictionary = CONTENT_DICTIONARIES[lang];
  return {
    ...body,
    title: dictionary.titles[body.title] ?? body.title,
    terms: dictionary.terms,
    notes: dictionary.notes,
  };
}
