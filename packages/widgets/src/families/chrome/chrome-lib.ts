// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chrome` family shared helpers (annex §11) — PURE module (no React, no
 * @adminium/ui, no lucide). Imported by both the family's config module and its
 * components, so the registry metadata graph can reach the schemas + demo
 * generators without dragging component code into the eager chunk (04 §2.3).
 */

import { getFormatters } from '@adminium/i18n';

/** Fall back to `en-US` when a widget's config carries no locale override (04 §2). */
export function resolveLocale(locale: string | undefined): string {
  return locale !== undefined && locale.trim() !== '' ? locale : 'en-US';
}

/**
 * The `command-palette` / `global-search` result-group vocabulary (annex §11:
 * "grouped results in fixed order (Actions/Navigate/Recent or
 * Pages/Metrics/People/Records/Actions)"). Closed vocabulary: a stored config
 * orders these groups, and an index entry declares one — neither can invent a
 * group the renderer has no place for.
 */
export const COMMAND_GROUPS = ['actions', 'navigate', 'recent', 'pages', 'metrics', 'people', 'records'] as const;
export type CommandGroupKey = (typeof COMMAND_GROUPS)[number];

/** The annex's default group order for the ⌘K palette. */
export const DEFAULT_COMMAND_GROUP_ORDER: readonly CommandGroupKey[] = ['actions', 'navigate', 'recent'];

/** The annex's default group order for full-page search results. */
export const DEFAULT_SEARCH_GROUP_ORDER: readonly CommandGroupKey[] = [
  'pages',
  'metrics',
  'people',
  'records',
  'actions',
];

/** `tab-bar` visual styles (annex §11 `style`). */
export const TAB_STYLES = ['underline', 'segmented'] as const;
export type TabStyle = (typeof TAB_STYLES)[number];

// ── Payload readers ─────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

/**
 * Read the rows out of a §3 `record-list` envelope (or a bare array). Non-object
 * elements are DROPPED rather than cast — see the identical note in
 * `system-lib.recordRowsOf`; blind-casting turns the next field access into a
 * render-time TypeError.
 */
export function recordRowsOf(data: unknown): Rec[] {
  const raw = pickRowArray(data);
  const out: Rec[] = [];
  for (const entry of raw) {
    const row = rec(entry);
    if (row !== null) out.push(row);
  }
  return out;
}

function pickRowArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const envelope = rec(data);
  if (envelope === null) return [];
  for (const key of ['rows', 'snapshot', 'data'] as const) {
    const value = envelope[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** Read a string-ish field off an untrusted row (finite numbers coerce; else undefined). */
export function stringField(row: Rec, field: string): string | undefined {
  const value = row[field];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Read a finite-number field off an untrusted row (numeric strings coerce). */
export function numberField(row: Rec, field: string): number | undefined {
  const value = row[field];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Read a boolean-ish field off an untrusted row (accepts 0/1 and 'true'/'false'). */
export function booleanField(row: Rec, field: string): boolean | undefined {
  const value = row[field];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** Narrow an untrusted value to a member of a closed vocabulary, else `fallback`. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Is this href safe to navigate to from widget-rendered data?
 *
 * Chrome widgets render hrefs that came from the DATABASE (a nav table, a search
 * index row). `javascript:` / `data:` / `vbscript:` URLs in that position are a
 * script-injection vector, so only same-origin-relative paths and explicit
 * http(s) URLs are allowed through. Mirrors `media-lib.isSafeHref`.
 */
export function isSafeHref(href: string | undefined): href is string {
  if (href === undefined) return false;
  const trimmed = href.trim();
  if (trimmed === '') return false;
  // Relative paths and fragments are always same-origin.
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) return true;
  return /^https?:\/\//i.test(trimmed);
}

/**
 * Case/diacritic-insensitive substring match — the palette/search filter
 * predicate (annex §11 "live substring filter"). Uses the locale's collator via
 * NFD folding so "José" matches "jose" in every one of the 8 locales.
 */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
}

export function matches(haystack: string | undefined, needle: string): boolean {
  if (haystack === undefined) return false;
  if (needle === '') return true;
  return fold(haystack).includes(fold(needle));
}

/**
 * Split `text` on the first case-insensitive occurrence of `query` into
 * before/match/after, for the palette's match highlighting (annex §11). Returns
 * `null` when there is no match, so callers render the plain string.
 */
export function highlightParts(text: string, query: string): { before: string; match: string; after: string } | null {
  if (query === '') return null;
  const index = fold(text).indexOf(fold(query));
  if (index === -1) return null;
  // Fold is 1:1 per code point for our folding rules (lowercase + strip marks
  // after NFD), but NFD can EXPAND ("é" → "e"+◌́), so slicing the folded index
  // into the original would drift. Re-walk the original to find the true span.
  return spanInOriginal(text, index, query.length);
}

function spanInOriginal(text: string, foldedStart: number, foldedLength: number): { before: string; match: string; after: string } {
  let start = 0;
  let consumed = 0;
  while (start < text.length && consumed < foldedStart) {
    consumed += fold(text[start] as string).length;
    start += 1;
  }
  let end = start;
  let matched = 0;
  while (end < text.length && matched < foldedLength) {
    matched += fold(text[end] as string).length;
    end += 1;
  }
  return { before: text.slice(0, start), match: text.slice(start, end), after: text.slice(end) };
}

/**
 * Collapse a deep breadcrumb trail to `maxDepth` entries (annex §11
 * `maxDepth/collapse`), returning `null` where the middle was elided.
 *
 * The FIRST and LAST crumbs always survive: the root is how you escape, and the
 * last is where you are — collapsing either would make the trail useless. The
 * ellipsis costs one slot, so a trail is only collapsed when doing so actually
 * saves space (`length > maxDepth`).
 */
export function collapseTrail<T>(trail: readonly T[], maxDepth: number): (T | null)[] {
  if (trail.length <= maxDepth) return [...trail];
  const first = trail[0] as T;
  // Reserve one slot for the head and one for the ellipsis; the rest is tail.
  const tailCount = Math.max(1, maxDepth - 2);
  return [first, null, ...trail.slice(trail.length - tailCount)];
}

/** Localized compact count for nav/tab badges ("1.2K"), via the @adminium/i18n Intl layer. */
export function formatCount(count: number | undefined, locale: string | undefined): string | undefined {
  if (count === undefined || !Number.isFinite(count)) return undefined;
  return getFormatters(resolveLocale(locale)).compact(count);
}

/** Localized relative time ("3 hours ago") for search-result freshness meta. */
export function formatUpdated(iso: string | undefined, locale: string | undefined, now: number | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const formatters = getFormatters(resolveLocale(locale));
  // `referenceTime` pins "now" so demo/VRT captures stay byte-deterministic
  // (shared config, 04 §2.1); without it we fall back to the wall clock.
  return now === undefined ? formatters.relative(date) : formatters.relative(date, { now });
}
