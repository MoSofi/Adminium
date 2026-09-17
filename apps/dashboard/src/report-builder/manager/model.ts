// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The manager's view-model helpers (M4–M11): the status pill's tone and
 * label, the starter categories, the comp's search rule, and the two text
 * lines a card and a row print.
 *
 * STATUS IS A COLUMN, shared by both kinds (comp `statusMeta` 563): the pill
 * maps the three stored values straight to tones — draft neutral ·
 * sent accent · live pos — and never derives. The KEY `sent` reads
 * *Published* (D22).
 *
 * NO GROUPING. The invoice manager's `groupDocuments` has no twin here: this
 * comp draws no group segment and no group bands (M7).
 */
import type { Tone } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { ReportDocumentKind, ReportStatus, ReportSummary } from '../api.js';

/** The comp's `statusMeta` (563). */
export const STATUS_TONE: Record<ReportStatus, Tone> = {
  draft: 'neutral',
  sent: 'accent',
  live: 'pos',
};

export function statusLabel(status: ReportStatus): string {
  switch (status) {
    case 'draft':
      return t('reportBuilder:status.draft', 'Draft');
    case 'sent':
      return t('reportBuilder:status.sent', 'Published');
    case 'live':
      return t('reportBuilder:status.live', 'Live');
  }
}

/** The eight starter categories (Appendix C), labelled from their lowercase keys. */
export function categoryLabel(category: string): string {
  switch (category) {
    case 'leadership':
      return t('reportBuilder:category.leadership', 'Leadership');
    case 'operations':
      return t('reportBuilder:category.operations', 'Operations');
    case 'revenue':
      return t('reportBuilder:category.revenue', 'Revenue');
    case 'growth':
      return t('reportBuilder:category.growth', 'Growth');
    case 'finance':
      return t('reportBuilder:category.finance', 'Finance');
    case 'product':
      return t('reportBuilder:category.product', 'Product');
    case 'success':
      return t('reportBuilder:category.success', 'Success');
    case 'engineering':
      return t('reportBuilder:category.engineering', 'Engineering');
    default:
      return category;
  }
}

/** The twelve starter names (Appendix C) — English on the row, keyed on the card. */
export function starterName(key: string, fallback: string): string {
  switch (key) {
    case 'exec':
      return t('reportBuilder:starter.exec', 'Executive summary');
    case 'weekly':
      return t('reportBuilder:starter.weekly', 'Weekly digest');
    case 'mbr':
      return t('reportBuilder:starter.mbr', 'Monthly business review');
    case 'sales':
      return t('reportBuilder:starter.sales', 'Sales report');
    case 'marketing':
      return t('reportBuilder:starter.marketing', 'Marketing report');
    case 'finance':
      return t('reportBuilder:starter.finance', 'Financial statement');
    case 'product':
      return t('reportBuilder:starter.product', 'Product analytics');
    case 'health':
      return t('reportBuilder:starter.health', 'Customer health');
    case 'campaign':
      return t('reportBuilder:starter.campaign', 'Campaign recap');
    case 'board':
      return t('reportBuilder:starter.board', 'Board deck');
    case 'incident':
      return t('reportBuilder:starter.incident', 'Incident postmortem');
    case 'scorecard':
      return t('reportBuilder:starter.scorecard', 'KPI scorecard');
    default:
      return fallback;
  }
}

/** "N blocks" — the plural the card, the row and the starter tile all share. */
export function blocksLabel(count: number): string {
  return t('reportBuilder:card.meta.blocks', '{count, plural, one {# block} other {# blocks}}', { count });
}

/**
 * The card's second line (comp 585): *"{kicker} · N blocks"* on the Reports
 * tab, *"N blocks"* on Templates. The kicker is the document's, not the row's
 * name — the comp reads it off the body and this reads it off the summary.
 */
export function cardMeta(doc: ReportSummary, tab: ReportDocumentKind): string {
  const blocks = blocksLabel(doc.summary.blockCount);
  if (tab === 'template') return blocks;
  return t('reportBuilder:card.meta.kickerBlocks', '{kicker} · {blocks}', { kicker: doc.summary.kicker, blocks });
}

/** The row's second line (comp 585): *"{reportTitle} · N blocks"* on BOTH tabs. */
export function rowSub(doc: ReportSummary): string {
  return t('reportBuilder:card.sub', '{title} · {blocks}', { title: doc.summary.reportTitle, blocks: blocksLabel(doc.summary.blockCount) });
}

/**
 * The card and row glyph. The comp's `starterIconFor` (697) finds it by
 * matching the document's `reportTitle` against the starter table, so
 * renaming the title silently changes the icon; the row carries its starter's
 * icon instead and a blank document carries `file-text`.
 */
export function rowIcon(doc: ReportSummary): string {
  return doc.summary.starterIcon === '' ? 'file-text' : doc.summary.starterIcon;
}

/** The comp's `filtered()` (548): name, report title and kicker, lowercase substring. */
export function matchesSearch(doc: ReportSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return `${doc.name} ${doc.summary.reportTitle} ${doc.summary.kicker}`.toLowerCase().includes(q);
}
