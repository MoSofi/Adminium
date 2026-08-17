// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared, framework-light helpers for the `tables` family M7 Wave-4 TAIL slice
 * (annex §3) — envelope extraction, tone coercion, the good/bad delta polarity
 * the metric widgets share, Intl-routed value formatting, and the proportional
 * bar maths for `ranked-entity-list`.
 *
 * JSX-free and provider-free (the feeds/calendar convention): widgets render in
 * stories and tests without a wrapper, and the dashboard resolves label
 * overrides through @adminium/i18n at the host boundary (04 §2).
 *
 * Numeral policy (10-i18n-theming.md §4.2): every value here is *data context*,
 * so it goes through `getFormatters(tag)` — which already applies the
 * latn-digit/gregorian data policy internally. Callers must NOT also wrap the
 * tag in `latnDataTag`, which would double-apply the `-u-` extension.
 */
import { getFormatters } from '@adminium/i18n';
import type { Tone } from '@adminium/ui';

import type { RankedEntity } from './tables-tail-types.js';

const KNOWN_TONES: ReadonlySet<string> = new Set(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);

/** Coerce an untrusted tone string to a valid `Tone`, defaulting as given. */
export function tailToneOf(value: unknown, fallback: Tone = 'neutral'): Tone {
  return typeof value === 'string' && KNOWN_TONES.has(value) ? (value as Tone) : fallback;
}

/**
 * Coalesce an empty/whitespace locale to `en-US`. `getFormatters` normalizes an
 * empty tag itself, but a schema-valid `format.locale: ''` also reaches
 * `Avatar`'s `String#toLocaleUpperCase('')`, which throws — so widgets normalize
 * once at the boundary, before any locale-sensitive call (the calendar/media
 * `resolveLocale` convention).
 */
export function resolveLocale(locale: string | undefined): string {
  return locale !== undefined && locale.trim() !== '' ? locale : 'en-US';
}

/** Extract `record-list` rows from a data envelope (mirrors feeds/boards). */
export function tailRowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null) {
    const envelope = data as { data?: unknown; rows?: unknown; items?: unknown };
    if (Array.isArray(envelope.data)) return envelope.data as Record<string, unknown>[];
    if (Array.isArray(envelope.rows)) return envelope.rows as Record<string, unknown>[];
    if (Array.isArray(envelope.items)) return envelope.items as Record<string, unknown>[];
  }
  return [];
}

/** A defined, non-empty string field, else undefined. */
export function stringField(row: Record<string, unknown>, key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  const value = row[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A finite number field, else undefined. Tolerates pg-style numeric strings. */
export function numberField(row: Record<string, unknown>, key: string | undefined): number | undefined {
  if (key === undefined) return undefined;
  const value = row[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** A finite numeric array field (the row sparkline), else undefined. */
export function seriesField(row: Record<string, unknown>, key: string): number[] | undefined {
  const value = row[key];
  if (!Array.isArray(value)) return undefined;
  const points = value.filter((point): point is number => typeof point === 'number' && Number.isFinite(point));
  return points.length > 0 ? points : undefined;
}

// --- delta polarity -----------------------------------------------------------

export type GoodDirection = 'up' | 'down';

/**
 * The good direction for a metric: an explicit per-metric config override wins,
 * then the row's own `goodDirection`, else `up` (annex §3: the delta pills are
 * "good/bad aware", and `top-movers-list` takes a `goodDirectionByMetric` map).
 */
export function goodDirectionFor(
  name: string,
  rowDirection: string | undefined,
  overrides: Record<string, string> | undefined,
): GoodDirection {
  const explicit = overrides?.[name] ?? rowDirection;
  return explicit === 'down' ? 'down' : 'up';
}

/** Delta sign → the DeltaPill trend (a 0 delta is flat, never up). */
export function trendOf(delta: number | undefined): 'up' | 'down' | 'flat' {
  if (delta === undefined || !Number.isFinite(delta) || delta === 0) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/**
 * True when a move is BAD for its metric — the annex's "danger for bad movers".
 * `DeltaPill` derives its own tone from `trend` + `invertGood`, so this is only
 * for the surrounding chrome (the mover's icon tile tone).
 */
export function isBadMove(delta: number, good: GoodDirection): boolean {
  if (delta === 0) return false;
  return good === 'up' ? delta < 0 : delta > 0;
}

/** Icon-tile tone for a mover row: explicit tone wins, else good/bad polarity. */
export function moverTone(tone: unknown, delta: number, good: GoodDirection): Tone {
  if (typeof tone === 'string' && KNOWN_TONES.has(tone)) return tone as Tone;
  if (delta === 0) return 'neutral';
  return isBadMove(delta, good) ? 'danger' : 'pos';
}

// --- Intl-routed value formatting ---------------------------------------------

export interface MetricValueOptions {
  /** Currency code from column metadata — never from the viewer's locale (§4.4). */
  currency?: string | undefined;
  /** Unit suffix appended to a bare number ("ms", "req/s"); `%` uses percent. */
  unit?: string | undefined;
  /** Compact ("24.5K") vs. plain grouping. */
  compact?: boolean | undefined;
}

/**
 * Format a metric row's value. An already-formatted string passes through (the
 * binding may project a display string); a number routes through the Intl layer
 * per its currency/unit metadata.
 */
export function formatMetricValue(
  value: number | string | undefined,
  tag: string,
  options: MetricValueOptions = {},
): string {
  if (typeof value === 'string') return value;
  if (value === undefined || !Number.isFinite(value)) return '—';
  const fmt = getFormatters(tag);
  if (options.currency !== undefined) return fmt.currency(value, options.currency);
  if (options.unit === '%') return fmt.percent(value / 100, { fractionDigits: 1 });
  const base = options.compact === true ? fmt.compact(value) : fmt.number(value);
  return options.unit === undefined ? base : `${base} ${options.unit}`;
}

/** Signed percent delta for a delta pill ("+12.4%" / "-3.1%"). */
export function formatDelta(delta: number | undefined, tag: string): string {
  if (delta === undefined || !Number.isFinite(delta)) return '—';
  const fmt = getFormatters(tag);
  const magnitude = fmt.percent(Math.abs(delta) / 100, { fractionDigits: 1 });
  if (delta === 0) return magnitude;
  // The sign is composed rather than formatted with `signDisplay` so the glyph
  // stays beside the number under RTL bidi reordering (the pill is `dir`-neutral
  // mono text, and Intl's minus sign would otherwise detach from its digits).
  return `${delta > 0 ? '+' : '−'}${magnitude}`;
}

/** Localized rank number ("1", "١") — data context via the Intl layer. */
export function formatRank(rank: number, tag: string): string {
  return getFormatters(tag).number(rank);
}

// --- ranked-entity-list bar maths ---------------------------------------------

/** A ranked row with its 1-based rank and its bar width as a 0–100 percent. */
export interface RankedRow extends RankedEntity {
  rank: number;
  /** Bar width as a percent of the LARGEST value in the slice (annex). */
  pct: number;
  /** The row's share of the slice total — the `percent` value format. */
  share: number;
}

/**
 * Sort desc by value, slice to top-N, and derive each row's proportional bar.
 * The bar is scaled against the slice's own max (not the grand total), which is
 * what makes the annex's "proportional accent bar" readable after the top-N cut:
 * the leader always fills the track. `share` keeps the true total-relative
 * percentage available for the `percent` value format.
 */
export function rankRows(rows: readonly RankedEntity[], n: number): RankedRow[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value).slice(0, Math.max(1, n));
  const max = sorted.reduce((best, row) => Math.max(best, row.value), 0);
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.value) ? row.value : 0), 0);
  return sorted.map((row, index) => ({
    ...row,
    rank: index + 1,
    pct: max > 0 ? Math.round((row.value / max) * 1000) / 10 : 0,
    share: total > 0 ? row.value / total : 0,
  }));
}

// --- accordion-list open-state ------------------------------------------------

/**
 * Next open set after toggling `id`. `exclusive` collapses every sibling (annex:
 * "single- or multi-open"), and re-clicking the open row closes it in both modes.
 */
export function toggleOpen(open: ReadonlySet<string>, id: string, exclusive: boolean): Set<string> {
  if (exclusive) return open.has(id) ? new Set() : new Set([id]);
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
