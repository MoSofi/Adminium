// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The manager's view-model helpers: the status pill's tone and
 * label, the topic and language labels, the comp's search and grouping
 * rules, and the two text lines a card and a row print.
 *
 * STATUS IS A COLUMN, shared by both kinds (comp 1393, 1579): the pill maps
 * the five stored values straight to tones — draft neutral · live pos · sent
 * accent · paid pos · overdue danger — and never derives.
 *
 * TOPIC GLYPHS are returned by a switch, not stored under an `icon:` key:
 * `scripts/gen-icon-core.mjs` sweeps `icon:` literals into the ENTRY chunk's
 * core set, and this surface is lazy — its names resolve through
 * `invoiceIcon` (`../icons.ts`), never through the core.
 */
import type { Tone } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { InvoiceLang, InvoiceStatus, InvoiceSummary, InvoiceSummaryFacts, InvoiceTopic } from '../api.js';
import { DOCUMENT_LANGUAGES, languageMeta } from '../model/languages.js';
import type { ManagerGroupBy } from './useManagerPrefs.js';

/** The comp's `statusMeta` (1393). */
export const STATUS_TONE: Record<InvoiceStatus, Tone> = {
  draft: 'neutral',
  live: 'pos',
  sent: 'accent',
  paid: 'pos',
  overdue: 'danger',
};

export function statusLabel(status: InvoiceStatus): string {
  switch (status) {
    case 'draft':
      return t('invoices:status.draft', 'Draft');
    case 'live':
      return t('invoices:status.live', 'Live');
    case 'sent':
      return t('invoices:status.sent', 'Sent');
    case 'paid':
      return t('invoices:status.paid', 'Paid');
    case 'overdue':
      return t('invoices:status.overdue', 'Overdue');
  }
}

/** The comp's `topics()` labels (1173-1182), with the first renamed per 34 Appendix D.2. */
export function topicLabel(topic: InvoiceTopic): string {
  switch (topic) {
    case 'recurring':
      return t('invoices:topic.recurring', 'Recurring');
    case 'services':
      return t('invoices:topic.services', 'Professional services');
    case 'receipts':
      return t('invoices:topic.receipts', 'Receipts & refunds');
    case 'sales':
      return t('invoices:topic.sales', 'Sales & quotes');
    case 'logistics':
      return t('invoices:topic.logistics', 'Shipping & logistics');
    case 'other':
      return t('invoices:topic.other', 'Uncategorised');
  }
}

/** The comp's `topics()` glyphs (1173-1182), by name for `invoiceIcon`. */
export function topicIcon(topic: InvoiceTopic): string {
  switch (topic) {
    case 'recurring':
      return 'repeat';
    case 'services':
      return 'briefcase';
    case 'receipts':
      return 'receipt';
    case 'sales':
      return 'file-signature';
    case 'logistics':
      return 'ship';
    case 'other':
      return 'folder';
  }
}

/** The language's ENGLISH name (the comp's `label`, 1185-1190) — chrome, so a message key; the native name is content and lives in `model/languages.ts`. */
export function languageLabel(code: InvoiceLang): string {
  switch (code) {
    case 'en':
      return t('invoices:languages.en', 'English');
    case 'de':
      return t('invoices:languages.de', 'German');
    case 'fr':
      return t('invoices:languages.fr', 'French');
    case 'es':
      return t('invoices:languages.es', 'Spanish');
    case 'pt':
      return t('invoices:languages.pt', 'Portuguese');
    case 'ja':
      return t('invoices:languages.ja', 'Japanese');
  }
}

/** The group header's label (comp 1218): `native · English`, or the one name when they are the same word. */
export function languageGroupLabel(code: InvoiceLang): string {
  const native = languageMeta(code).native;
  const english = languageLabel(code);
  return native === english ? english : `${native} · ${english}`;
}

/** The starter reply's category keys → the tile's second line (comp `cat`, 1117-1130). */
export function categoryLabel(category: string): string {
  switch (category) {
    case 'business':
      return t('invoices:new.category.business', 'Business');
    case 'payments':
      return t('invoices:new.category.payments', 'Payments');
    case 'adjustments':
      return t('invoices:new.category.adjustments', 'Adjustments');
    case 'sales':
      return t('invoices:new.category.sales', 'Sales');
    case 'recurring':
      return t('invoices:new.category.recurring', 'Recurring');
    case 'services':
      return t('invoices:new.category.services', 'Services');
    case 'projects':
      return t('invoices:new.category.projects', 'Projects');
    case 'shipping':
      return t('invoices:new.category.shipping', 'Shipping');
    case 'nonprofit':
      return t('invoices:new.category.nonprofit', 'Nonprofit');
    default:
      return category;
  }
}

/** The list row's glyph (comp 1435): the receipt for a receipt, the sheet for everything else. */
export function rowIcon(summary: Pick<InvoiceSummaryFacts, 'title'>): 'receipt' | 'file-text' {
  return summary.title === 'RECEIPT' || summary.title === 'DONATION RECEIPT' ? 'receipt' : 'file-text';
}

/** The card's second line (comp 1440): `number · customer` for an invoice, the customer alone for a template. */
export function cardMeta(doc: Pick<InvoiceSummary, 'kind' | 'summary'>): string {
  return doc.kind === 'invoice' ? `${doc.summary.number} · ${doc.summary.customerName}` : doc.summary.customerName;
}

/** The row's second line (comp 1441): `number · customer · topic`. */
export function rowSub(doc: Pick<InvoiceSummary, 'topic' | 'summary'>): string {
  return `${doc.summary.number} · ${doc.summary.customerName} · ${topicLabel(doc.topic)}`;
}

/** The thumbnail's line-item rows (comp 1432): `itemCount`, clamped to the three the card has room for. */
export function previewRowCount(summary: Pick<InvoiceSummaryFacts, 'itemCount'>): number {
  return Math.max(0, Math.min(3, Math.trunc(summary.itemCount)));
}

// --- search ------------------------------------------------------------------

/** The comp's `filtered()` (1369): name, number, customer, title, the topic label and both language names. */
export function matchesSearch(doc: InvoiceSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const haystack = [
    doc.name,
    doc.summary.number,
    doc.summary.customerName,
    doc.summary.title,
    topicLabel(doc.topic),
    languageLabel(doc.lang),
    languageMeta(doc.lang).native,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

// --- grouping ----------------------------------------------------------------

export interface ManagerGroupHeader {
  /** A name for `invoiceIcon`: the topic's glyph, or `languages`. */
  glyph: string;
  label: string;
  sub: string;
}

export interface ManagerGroup {
  key: string;
  /** `null` for the single ungrouped run of cards. */
  header: ManagerGroupHeader | null;
  items: InvoiceSummary[];
}

function documentsSub(count: number): string {
  return t('invoices:manager.group.documents', '{count, plural, one {# document} other {# documents}}', { count });
}

function languagesSub(count: number): string {
  return t('invoices:manager.group.languages', '{count, plural, one {# language} other {# languages}}', { count });
}

/**
 * The comp's `groupCards` (1208-1236): language groups walk the fixed
 * language order and skip empties; topic groups are first-encounter order
 * over the cards and count the distinct languages inside.
 */
export function groupDocuments(items: readonly InvoiceSummary[], groupBy: ManagerGroupBy): ManagerGroup[] {
  if (groupBy === 'none' || items.length === 0) return [{ key: 'all', header: null, items: [...items] }];

  if (groupBy === 'language') {
    const out: ManagerGroup[] = [];
    for (const language of DOCUMENT_LANGUAGES) {
      const docs = items.filter((doc) => doc.lang === language.code);
      if (docs.length === 0) continue;
      out.push({
        key: `lg-${language.code}`,
        header: { glyph: 'languages', label: languageGroupLabel(language.code), sub: documentsSub(docs.length) },
        items: docs,
      });
    }
    return out;
  }

  const byTopic = new Map<InvoiceTopic, ManagerGroup>();
  for (const doc of items) {
    let group = byTopic.get(doc.topic);
    if (group === undefined) {
      group = { key: `tp-${doc.topic}`, header: { glyph: topicIcon(doc.topic), label: topicLabel(doc.topic), sub: '' }, items: [] };
      byTopic.set(doc.topic, group);
    }
    group.items.push(doc);
  }
  for (const group of byTopic.values()) {
    const languages = new Set(group.items.map((doc) => doc.lang)).size;
    if (group.header !== null) group.header.sub = `${documentsSub(group.items.length)} · ${languagesSub(languages)}`;
  }
  return [...byTopic.values()];
}
