/**
 * `forms` family shared helpers (annex §10) — PURE module (no React, no
 * @adminium/ui, no lucide). Imported by both the family's config module and its
 * components, so the registry metadata graph can reach the schemas + demo
 * generators without dragging component code into the eager chunk (04 §2.3).
 */

import { getFormatters } from '@adminium/i18n';

/** Fall back to `en-US` when a widget's config carries no locale override (04 §2). */
export function resolveLocale(locale: string | undefined): string {
  return locale !== undefined && locale.trim() !== '' ? locale : 'en-US';
}

/** The tone vocabulary shared with @adminium/ui's `IconTile`/`Badge`. */
export const FORM_TONES = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] as const;
export type FormTone = (typeof FORM_TONES)[number];

/**
 * Map the SHARED-CONFIG tone vocabulary onto @adminium/ui's — see the identical
 * note in `system-lib.uiToneOf`: shared config says `muted` where the design
 * system says `neutral`, and every widget forwarding `config.tone` must translate.
 */
export function uiToneOf(tone: string | undefined, fallback: FormTone = 'neutral'): FormTone {
  if (tone === undefined) return fallback;
  if (tone === 'muted') return 'neutral';
  return (FORM_TONES as readonly string[]).includes(tone) ? (tone as FormTone) : fallback;
}

/** `stepper` per-step states (annex §10; mirrors @adminium/ui `StepState`). */
export const STEP_STATES = ['pending', 'active', 'loading', 'done', 'error'] as const;
export type StepState = (typeof STEP_STATES)[number];

/** `validation-issues-list` severities (annex §10 `severityMap`). */
export const ISSUE_SEVERITIES = ['info', 'warn', 'error'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/** Severity → tone. The default map the annex's `severityMap` config overrides. */
export const DEFAULT_SEVERITY_TONE: Record<IssueSeverity, FormTone> = {
  info: 'info',
  warn: 'warn',
  error: 'danger',
};

// ── Payload readers ─────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

/**
 * Read the rows out of a §3 `record-list` envelope (or a bare array). Non-object
 * elements are DROPPED rather than cast — see the identical note in
 * `system-lib.recordRowsOf`.
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

/**
 * Read the single row out of a §3 `record` envelope (`{ row: {...} }`), or
 * `null`. A bare object is accepted so template/story composition can hand a row
 * directly — the same latitude `formValuesOf` gives `form-state`.
 */
export function recordRowOf(data: unknown): Rec | null {
  const envelope = rec(data);
  if (envelope === null) return null;
  if ('row' in envelope) return rec(envelope['row']);
  return envelope;
}

/**
 * Read the `entries` map out of a §3 `boolean-map` envelope. Non-boolean values
 * are dropped: a `boolean-map` whose values are strings is a server bug, and
 * silently coercing `"false"` to `true` would flip a user's setting.
 */
export function booleanEntriesOf(data: unknown): Record<string, boolean> {
  const envelope = rec(data);
  const entries = rec(envelope?.entries) ?? envelope;
  if (entries === null) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
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

/** Clamp an arbitrary number into the 0–100 percent range; non-finite → 0. */
export function clampPct(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Facet counts over a `record-list`, keyed by one field — the live count pills
 * in `filter-chip-bar` (annex §10: "live mono count pills computed from the
 * sibling list"). Insertion order follows first appearance, so the bar's chip
 * order is stable across renders of the same payload.
 */
export function facetCountsOf(rows: readonly Rec[], field: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = stringField(row, field);
    if (value === undefined) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** Localized compact count for the chip/checklist count pills, via the @adminium/i18n Intl layer. */
export function formatCount(count: number | undefined, locale: string | undefined): string | undefined {
  if (count === undefined || !Number.isFinite(count)) return undefined;
  return getFormatters(resolveLocale(locale)).compact(count);
}

/** Localized byte size for the table-inclusion checklist's row estimates. */
export function formatRows(count: number | undefined, locale: string | undefined): string | undefined {
  if (count === undefined || !Number.isFinite(count)) return undefined;
  return getFormatters(resolveLocale(locale)).number(count);
}

/**
 * The password-strength score (annex §10: "4-segment bar filled by score").
 * Re-exported from the widget rather than reimplemented — @adminium/ui owns
 * `defaultPasswordScore`, and a second scoring rule would drift from the one the
 * auth screens already use.
 */
export const PASSWORD_SCORE_MAX = 4;
