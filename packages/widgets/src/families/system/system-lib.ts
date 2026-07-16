/**
 * `system` family shared helpers (annex §12) — PURE module (no React, no
 * @adminium/ui, no lucide). Imported by both the family's config module and its
 * components, so the registry metadata graph can reach the schemas + demo
 * generators without dragging component code into the eager chunk (04 §2.3).
 *
 * The readers here are deliberately LENIENT: system widgets bind to whatever a
 * real table/health-check returns, and a malformed payload must degrade to a
 * fallback render rather than throw into the WidgetErrorBoundary (04 §3).
 */

import { getFormatters } from '@adminium/i18n';

/** The tone vocabulary shared with @adminium/ui's `IconTile`/`Badge`. */
export const SYSTEM_TONES = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] as const;
export type SystemTone = (typeof SYSTEM_TONES)[number];

/**
 * Map the SHARED-CONFIG tone vocabulary onto @adminium/ui's.
 *
 * The two differ by exactly one member and it is not an oversight: shared config
 * (04 §2.1) offers `muted` — an authoring word for "de-emphasised" — while the
 * design system's `Tone` calls that same slot `neutral`. Every widget that
 * forwards `config.tone` to a UI primitive must translate, so the mapping lives
 * here once rather than being re-derived (and re-mistaken) per widget.
 */
export function uiToneOf(tone: string | undefined, fallback: SystemTone = 'neutral'): SystemTone {
  if (tone === undefined) return fallback;
  if (tone === 'muted') return 'neutral';
  return (SYSTEM_TONES as readonly string[]).includes(tone) ? (tone as SystemTone) : fallback;
}

/**
 * The `state-hero` view vocabulary (annex §12: "stateMap keyed by view id
 * (404/500/offline/forbidden/maintenance/conn-error)"). Closed vocabulary — a
 * stored config can never smuggle an unknown view past the schema.
 */
export const STATE_HERO_VIEWS = ['404', '500', 'offline', 'forbidden', 'maintenance', 'conn-error'] as const;
export type StateHeroViewId = (typeof STATE_HERO_VIEWS)[number];

/** Per-line kind in `progress-log-console` (mirrors the Studio LogConsole vocabulary). */
export const LOG_LINE_KINDS = ['info', 'ok', 'warn', 'error', 'running'] as const;
export type LogLineKind = (typeof LOG_LINE_KINDS)[number];

/** `connection-status` state machine (annex §12: connecting → connected | failed). */
export const CONNECTION_STATES = ['idle', 'connecting', 'connected', 'failed'] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/**
 * `autosave-indicator` phases (annex §12: warn-dot "Unsaved changes" → spinner
 * "Saving…" → green check "All changes saved"). Mirrors @adminium/ui's
 * `AutosaveStatus` exactly — `dirty` was added there for this annex requirement.
 */
export const AUTOSAVE_STATUSES = ['idle', 'dirty', 'saving', 'saved', 'error'] as const;
export type AutosaveStatus = (typeof AUTOSAVE_STATUSES)[number];

/** Aggregate service health, worst-wins (annex §12 `status-banner-hero`). */
export const SERVICE_STATES = ['up', 'degraded', 'down'] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

// ── Binding source ──────────────────────────────────────────────────────────

/** The `connectionId` + qualified table a `mutate`/`record-open` event carries. */
export interface BindingSource {
  connectionId: string;
  table: string;
}

/**
 * The event target for a bound widget: `connectionId` + the schema-qualified
 * table name, or `null` when the widget is running on `demoData` (no binding).
 * An unbound widget must not offer write affordances — there is nowhere to send
 * the intent — so callers use `null` to disable them (04 §5).
 */
export function bindingSourceOf(
  binding: { connectionId: string; source: { schema?: string | undefined; name: string } } | undefined,
): BindingSource | null {
  if (binding === undefined) return null;
  const { schema, name } = binding.source;
  return { connectionId: binding.connectionId, table: schema === undefined ? name : `${schema}.${name}` };
}

// ── Payload readers ─────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

/**
 * Read the single row out of a §3 `record` envelope. Also accepts a bare object
 * so template/story composition can hand a widget its row directly.
 */
export function recordRowOf(data: unknown): Rec | null {
  const envelope = rec(data);
  if (envelope === null) return null;
  const row = rec(envelope.row);
  if (row !== null) return row;
  // Bare object (not an envelope) — treat it as the row itself.
  return 'row' in envelope ? null : envelope;
}

/**
 * Read the rows out of a §3 `record-list` envelope (or a bare array / `stream`
 * snapshot).
 *
 * Every element is checked to be a real object and non-objects are DROPPED, not
 * cast: a payload like `{ rows: [null, 'x', 3] }` is not hypothetical — a driver
 * returning a sparse result, or a `stream` snapshot carrying a tombstone, both
 * produce it, and blind-casting turns the next `row[field]` access into a
 * TypeError inside render (an error-boundary trip, i.e. a dead widget). Callers
 * are guaranteed indexable rows.
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

/** Clamp an arbitrary number into the 0–100 percent range; non-finite → 0. */
export function clampPct(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Narrow an untrusted value to a member of a closed vocabulary, else `fallback`. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Worst-wins aggregate of a service list (annex §12 `status-banner-hero`:
 * "bg/border/icon/title derive from worst child state").
 */
export function worstServiceState(states: readonly ServiceState[]): ServiceState {
  if (states.includes('down')) return 'down';
  if (states.includes('degraded')) return 'degraded';
  return 'up';
}

/** Fall back to `en-US` when a widget's config carries no locale override (04 §2). */
export function resolveLocale(locale: string | undefined): string {
  return locale !== undefined && locale.trim() !== '' ? locale : 'en-US';
}

/**
 * Format an epoch-ms timestamp as a locale-aware short time ("14:32"), used for
 * the "last checked" / "saved at" stamps. Goes through the @adminium/i18n Intl
 * layer (10-i18n-theming.md §4) rather than raw `Intl` so numbering systems and
 * the data/prose context rules stay consistent with the rest of the product.
 */
export function formatStamp(epochMs: number | undefined, locale: string | undefined): string | undefined {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return undefined;
  return getFormatters(resolveLocale(locale)).time(new Date(epochMs));
}
