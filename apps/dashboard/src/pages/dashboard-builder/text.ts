// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Human-label helpers for builder surfaces. Widget ids and Zod config-schema
 * keys are technical identifiers; the palette and the auto-generated config
 * inspector derive readable labels from them (routed through `t()` with these
 * humanized fallbacks, so a future localized key resolves ahead of the
 * fallback).
 */

/** Words kept fully uppercase when they surface as a whole token. */
const ACRONYMS: ReadonlySet<string> = new Set([
  'kpi',
  'ai',
  'api',
  'sql',
  'kv',
  'rtl',
  'ui',
  'id',
  'url',
  'ttl',
  'csv',
  'png',
  'llm',
  'rbac',
  'pii',
  'ohlc',
  'cta',
]);

function splitWords(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter((word) => word.length > 0);
}

/** `'metricFormat'` → `'Metric format'`, `'kpi-stat-card'` → `'KPI stat card'`. */
export function humanize(raw: string): string {
  const words = splitWords(raw);
  if (words.length === 0) return raw;
  return words
    .map((word, index) => {
      if (ACRONYMS.has(word)) return word.toUpperCase();
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(' ');
}

/** i18n key for a widget's display name, derived from its `descriptionKey`. */
export function widgetNameKey(descriptionKey: string): string {
  return descriptionKey.replace(/\.description$/, '.name');
}
