// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The manager's view-model helpers: a document's derived status,
 * the language facts behind the lang pill, the comp's search and grouping
 * rules.
 *
 * STATUS IS DERIVED, never stored. A template is live when it is enabled; a
 * campaign's pill is its latest run — no run yet is a draft, and a cancelled
 * run reads as one too because the campaign is back to being editable copy
 * that nobody has received.
 */
import { LOCALES, isLocaleId, localeEntry } from '@adminium/i18n';
import type { Tone } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { EmailCategory, EmailDocumentSummary } from '../api.js';
import type { RunProgress } from '../useRunProgress.js';
import type { ManagerGroupBy } from './useManagerPrefs.js';

export type DocumentStatus = 'draft' | 'live' | 'scheduled' | 'sending' | 'sent' | 'failed';

/** The comp's status map (1073) — draft/live/sent/scheduled — plus the two a real run can end in. */
export const STATUS_TONE: Record<DocumentStatus, Tone> = {
  draft: 'neutral',
  live: 'pos',
  scheduled: 'warn',
  sending: 'accent',
  sent: 'accent',
  failed: 'danger',
};

export function statusOf(doc: EmailDocumentSummary): DocumentStatus {
  if (doc.kind === 'template') return doc.enabled ? 'live' : 'draft';
  const run = doc.run;
  if (run === undefined) return 'draft';
  switch (run.status) {
    case 'scheduled':
      return 'scheduled';
    case 'running':
      return 'sending';
    case 'sent':
      return 'sent';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'draft';
  }
}

export function statusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'draft':
      return t('email:status.draft', 'Draft');
    case 'live':
      return t('email:status.live', 'Live');
    case 'scheduled':
      return t('email:status.scheduled', 'Scheduled');
    case 'sending':
      return t('email:status.sending', 'Sending');
    case 'sent':
      return t('email:status.sent', 'Sent');
    case 'failed':
      return t('email:status.failed', 'Failed');
  }
}

export function categoryLabel(category: EmailCategory): string {
  switch (category) {
    case 'transactional':
      return t('email:category.transactional', 'Transactional');
    case 'lifecycle':
      return t('email:category.lifecycle', 'Lifecycle');
    case 'marketing':
      return t('email:category.marketing', 'Marketing');
  }
}

/**
 * The card's second line (comp 1385): a template shows its subject; a
 * campaign that has gone out shows its counts — "N sent · M failed", opens
 * being refused — one going out right now shows the job's progress, and one
 * that has not shows its category.
 */
export function cardMeta(doc: EmailDocumentSummary, progress: RunProgress | null = null): string {
  if (doc.kind === 'template') return doc.subject;
  const run = doc.run;
  if (run !== undefined && run.status === 'running' && progress !== null) {
    return t('email:run.sending', 'Sending · {pct}%', { pct: progress.pct });
  }
  if (run !== undefined && (run.status === 'sent' || run.status === 'failed' || run.status === 'running')) {
    return t('email:run.counts', '{sent} sent · {failed} failed', {
      sent: run.sent.toLocaleString(),
      failed: run.failed.toLocaleString(),
    });
  }
  return categoryLabel(doc.category);
}

// --- languages ---------------------------------------------------------------

export interface LocaleFacts {
  id: string;
  /** The pill's code — `EN`, or `ZH-CN` when two variations share a language. */
  code: string;
  native: string;
  english: string;
  dir: 'ltr' | 'rtl';
  tag: string;
}

function languageOf(localeId: string): string {
  return localeId.split(/[_-]/)[0]?.toLowerCase() ?? localeId.toLowerCase();
}

/**
 * The facts the pill and the language group need. `siblings` is every locale
 * on screen: a language subtag alone is the comp's pill (`EN`), and it grows
 * a region only when another variation would otherwise read the same.
 */
export function localeFacts(localeId: string, siblings: readonly string[]): LocaleFacts {
  const language = languageOf(localeId);
  const ambiguous = siblings.some((other) => other !== localeId && languageOf(other) === language);
  const tag = localeId.replace('_', '-');
  const code = ambiguous ? tag.toUpperCase() : language.toUpperCase();
  if (isLocaleId(localeId)) {
    const entry = localeEntry(localeId);
    return { id: localeId, code, native: entry.native, english: entry.english, dir: entry.dir, tag: entry.tag };
  }
  return { id: localeId, code, native: localeId, english: localeId, dir: 'ltr', tag };
}

/** Registry order — `en_US` first, then the built-ins as shipped, unknown ids after by id. */
export function localeOrder(localeId: string): number {
  const index = LOCALES.findIndex((entry) => entry.id === localeId);
  return index === -1 ? LOCALES.length : index;
}

export function compareByLocale(a: EmailDocumentSummary, b: EmailDocumentSummary): number {
  return localeOrder(a.locale) - localeOrder(b.locale) || a.locale.localeCompare(b.locale);
}

// --- search ------------------------------------------------------------------

/** The comp's filter (1049): name, subject, category, topic and the language's names and code. */
export function matchesSearch(doc: EmailDocumentSummary, facts: LocaleFacts, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const haystack = [doc.name, doc.subject, doc.category, categoryLabel(doc.category), doc.topicLabel, facts.english, facts.native, facts.code]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

// --- grouping ----------------------------------------------------------------

export interface ManagerGroup {
  key: string;
  /** `null` for the single ungrouped run of cards. */
  header: { icon: 'languages' | EmailCategory; label: string; sub: string } | null;
  items: EmailDocumentSummary[];
}

function needsTranslationSuffix(count: number): string {
  return count === 0 ? '' : ' · ' + t('email:group.needsTranslation', '{count} needs translation', { count });
}

/** The comp's `groupCards` (946–969), on real rows. */
export function groupDocuments(
  items: readonly EmailDocumentSummary[],
  groupBy: ManagerGroupBy,
  factsOf: (localeId: string) => LocaleFacts,
): ManagerGroup[] {
  if (groupBy === 'none' || items.length === 0) return [{ key: 'all', header: null, items: [...items] }];

  if (groupBy === 'language') {
    const byLocale = new Map<string, EmailDocumentSummary[]>();
    for (const doc of items) {
      const bucket = byLocale.get(doc.locale);
      if (bucket === undefined) byLocale.set(doc.locale, [doc]);
      else bucket.push(doc);
    }
    const locales = [...byLocale.keys()].sort((a, b) => localeOrder(a) - localeOrder(b) || a.localeCompare(b));
    return locales.map((locale) => {
      const docs = byLocale.get(locale) ?? [];
      const facts = factsOf(locale);
      const missing = docs.filter((d) => d.needsTranslation).length;
      return {
        key: `lg-${locale}`,
        header: {
          icon: 'languages',
          label: facts.native === facts.english ? facts.english : `${facts.native} · ${facts.english}`,
          sub:
            t('email:group.emails', '{count, plural, one {# email} other {# emails}}', { count: docs.length }) +
            needsTranslationSuffix(missing),
        },
        items: docs,
      };
    });
  }

  const byTopic = new Map<string, ManagerGroup>();
  for (const doc of items) {
    let group = byTopic.get(doc.key);
    if (group === undefined) {
      group = { key: `tp-${doc.key}`, header: { icon: doc.category, label: doc.topicLabel, sub: '' }, items: [] };
      byTopic.set(doc.key, group);
    }
    group.items.push(doc);
  }
  for (const group of byTopic.values()) {
    group.items.sort(compareByLocale);
    const missing = group.items.filter((d) => d.needsTranslation).length;
    if (group.header !== null) {
      group.header.sub =
        t('email:group.languages', '{count, plural, one {# language} other {# languages}}', {
          count: group.items.length,
        }) + needsTranslationSuffix(missing);
    }
  }
  return [...byTopic.values()];
}

// --- colour ------------------------------------------------------------------

/** The comp's `hexToRgba` (797). */
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return `rgba(79,70,229,${String(alpha)})`;
  return `rgba(${String((n >> 16) & 255)},${String((n >> 8) & 255)},${String(n & 255)},${String(alpha)})`;
}

/** The default accent when a document carries no brand of its own (renderer's `DEFAULT_EMAIL_ACCENT`). */
export const DEFAULT_ACCENT = '#4f46e5';

export function accentOf(doc: Pick<EmailDocumentSummary, 'brand'>, fallback = DEFAULT_ACCENT): string {
  const accent = doc.brand?.accent;
  return accent !== undefined && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : fallback;
}
