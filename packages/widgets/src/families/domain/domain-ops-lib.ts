// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK OPS — shared PURE helpers for the §13 ops / billing / API / marketing
 * cards. JSX-free and React-free: imported by BOTH the family's config module
 * and its components, so the registry metadata graph reaches the schemas + demo
 * generators without dragging component code into the eager chunk (04 §2.3).
 *
 * Sits alongside `domain-lib.ts` (which owns the org-chart / gantt geometry) and
 * reuses its primitives — `mulberry32`, `asRecord`, `stringField`, `toneOf` —
 * rather than re-deriving them, so the whole family shares ONE PRNG and ONE set
 * of lenient payload readers.
 *
 * Two policies are enforced here rather than per widget, because both were easy
 * to get wrong in eighteen places:
 *
 *   1. NO WALL CLOCK. Nothing in this module (or in any demo generator built on
 *      it) calls `Date.now()`. Every "now"-dependent value — a relative stamp, a
 *      running stopwatch — takes `now` as an explicit argument, resolved by the
 *      caller from `config.format.referenceTime` and falling back to the clock
 *      only inside a component's own tick effect. That is what makes `demoData`
 *      byte-identical across runs (04 §7.7 / the determinism gate) and VRT
 *      captures reproducible.
 *   2. INTL ONLY. Every number, date, percent and money value goes through
 *      `@adminium/i18n`'s `getFormatters` (10-i18n-theming.md §4), which already
 *      applies the data-context numeral policy — callers must NOT also pass
 *      `latnDataTag`, which would double-apply the `-u-nu-latn` extension.
 */
import { getFormatters } from '@adminium/i18n';
import type { Tone } from '@adminium/ui';

import { asRecord, clamp, numberField, resolveLocale, stringField } from './domain-lib.js';
import type {
  CardBrand,
  HttpMethod,
  UptimeState,
} from './domain-ops-types.js';
import { CARD_BRANDS, HTTP_METHODS, UPTIME_STATES } from './domain-ops-types.js';

type Rec = Record<string, unknown>;

// ── payload readers ─────────────────────────────────────────────────────────

/**
 * Rows out of a §3 `record-list` envelope (or a bare array, so template/story
 * composition can hand a widget its rows directly).
 *
 * Non-object entries are DROPPED rather than cast: a driver returning a sparse
 * result produces `{ rows: [null, 3] }`, and blind-casting turns the next
 * `row[field]` read into a TypeError inside render — i.e. an error-boundary trip
 * and a dead widget. Callers are guaranteed indexable rows.
 */
export function opsRowsOf(data: unknown): Rec[] {
  const raw = Array.isArray(data) ? data : (asRecord(data)?.rows ?? null);
  if (!Array.isArray(raw)) return [];
  const out: Rec[] = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    if (row !== null) out.push(row);
  }
  return out;
}

/**
 * The single row out of a §3 `record` envelope. Also accepts a bare object so a
 * story can pass the row itself; an envelope with an explicit `row: null` reads
 * as absent (which is exactly what `isEmptyByShape.record` keys the empty state
 * off).
 */
export function opsRowOf(data: unknown): Rec | null {
  const envelope = asRecord(data);
  if (envelope === null) return null;
  if ('row' in envelope) return asRecord(envelope.row);
  return envelope;
}

/** Read a boolean-ish field off an untrusted row (accepts 0/1 and 'true'/'false'). */
export function booleanField(row: Rec, field: string | undefined): boolean | undefined {
  if (field === undefined) return undefined;
  const value = row[field];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return undefined;
}

/**
 * Read a field as a string array. Real columns carry these three ways — a JSON
 * array (pg `text[]` / a JSON column), a comma-separated string (the MySQL/
 * SQLite convention), or a single value — so all three are accepted and anything
 * else degrades to an empty list rather than throwing.
 */
export function stringArrayField(row: Rec, field: string | undefined): string[] {
  if (field === undefined) return [];
  const value = row[field];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
  }
  return [];
}

/** Read a field as a finite-number array (a sparkline / history column). */
export function numberArrayField(row: Rec, field: string | undefined): number[] {
  if (field === undefined) return [];
  const value = row[field];
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const entry of value) {
    const parsed = typeof entry === 'number' ? entry : Number(entry);
    if (Number.isFinite(parsed)) out.push(parsed);
  }
  return out;
}

/** Narrow an untrusted value to a member of a closed vocabulary, else `fallback`. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback;
}

// ── binding source ──────────────────────────────────────────────────────────

/** The `connectionId` + qualified table a `mutate` / `record-open` event carries. */
export interface OpsBindingSource {
  connectionId: string;
  table: string;
}

/**
 * The event target for a bound widget: `connectionId` + the schema-qualified
 * table name, or `null` when the widget is running on `demoData`.
 *
 * The descriptor names the table at `binding.source.name` (+ an optional pg
 * `schema`) — there is no `binding.table` (04 §5.1 / query-descriptor.ts). An
 * UNBOUND widget must not offer write affordances: there is nowhere to send the
 * intent, so a "Revoke" that silently does nothing is worse than no button.
 * Callers use `null` to disable them.
 */
export function opsBindingSourceOf(
  binding: { connectionId: string; source: { schema?: string | undefined; name: string } } | undefined,
): OpsBindingSource | null {
  if (binding === undefined) return null;
  const { schema, name } = binding.source;
  return { connectionId: binding.connectionId, table: schema === undefined ? name : `${schema}.${name}` };
}

// ── masking ─────────────────────────────────────────────────────────────────

/** The bullet the maskers render. U+2022 — never an ASCII `*`. */
const BULLET = '•';

/**
 * Masked PAN for `credit-card-tile` — "•••• •••• •••• 4242", or the amex 4-6-5
 * grouping ("•••• •••••• •4242"), which is the grouping amex cards are actually
 * printed in. Only ever renders the last four: the widget binds a payment-methods
 * table that stores nothing else, and this function is the reason it cannot
 * accidentally print more.
 */
export function maskPan(last4: string, brand: CardBrand): string {
  const tail = last4.slice(-4).padStart(4, BULLET);
  if (brand === 'amex') return `${BULLET.repeat(4)} ${BULLET.repeat(6)} ${BULLET}${tail}`;
  return `${BULLET.repeat(4)} ${BULLET.repeat(4)} ${BULLET.repeat(4)} ${tail}`;
}

/**
 * Masked API key — public `prefix` + bullets + `tail` (annex §13
 * `api-keys-panel`: "masked value (prefix + bullets + tail)").
 *
 * The bullet run is a FIXED width, not the secret's real length: a
 * proportional run leaks how long the key is, which is a (small, free to avoid)
 * oracle. Publishable keys are not secret, so the panel shows them whole — that
 * decision belongs to the caller, which passes `kind`.
 */
export function maskSecret(prefix: string, tail: string, bullets = 12): string {
  return `${prefix}${BULLET.repeat(Math.max(1, bullets))}${tail}`;
}

// ── tone maps ───────────────────────────────────────────────────────────────

/** Per-day / per-service health → semantic tone (annex Operational/Degraded/Down). */
export const UPTIME_TONE: Record<UptimeState, Tone> = {
  operational: 'pos',
  degraded: 'warn',
  down: 'danger',
  unknown: 'neutral',
};

/** Relative bar height per state — the annex's "height + color by state" strip. */
export const UPTIME_HEIGHT: Record<UptimeState, number> = {
  operational: 100,
  degraded: 62,
  down: 34,
  unknown: 18,
};

/** Coerce an untrusted status column onto the closed uptime vocabulary. */
export function uptimeStateOf(value: unknown): UptimeState {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  // Real status columns spell these a dozen ways; map the common synonyms
  // rather than degrade a healthy service to `unknown` (which renders grey and
  // reads as "we lost the data", not "it is up").
  if (['operational', 'up', 'ok', 'healthy', 'online', 'pass'].includes(normalized)) return 'operational';
  if (['degraded', 'warn', 'warning', 'partial', 'slow'].includes(normalized)) return 'degraded';
  if (['down', 'outage', 'fail', 'failed', 'offline', 'error'].includes(normalized)) return 'down';
  return oneOf(normalized, UPTIME_STATES, 'unknown');
}

/** Coerce an untrusted brand column onto the closed card-network vocabulary. */
export function cardBrandOf(value: unknown): CardBrand {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  if (normalized === 'americanexpress' || normalized === 'amex') return 'amex';
  return oneOf(normalized, CARD_BRANDS, 'unknown');
}

/** Coerce an untrusted method column onto the closed HTTP vocabulary. */
export function httpMethodOf(value: unknown): HttpMethod {
  if (typeof value !== 'string') return 'GET';
  const upper = value.trim().toUpperCase();
  return (HTTP_METHODS as readonly string[]).includes(upper) ? (upper as HttpMethod) : 'GET';
}

/** HTTP method → tone. Reads/writes/deletes are visually distinct by tone alone. */
export const METHOD_TONE: Record<HttpMethod, Tone> = {
  GET: 'info',
  POST: 'pos',
  PATCH: 'warn',
  PUT: 'warn',
  DELETE: 'danger',
};

/** Tone → solid background (bars, dots, strips). Mirrors domain-lib's TONE_SOLID_BG. */
export const OPS_TONE_BG: Record<Tone, string> = {
  neutral: 'bg-surface-3',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** Tone → text color only (headline stats, mono values). */
export const OPS_TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent',
  pos: 'text-pos',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
};

/**
 * Tone → inline-START border color. Used for `slo-monitor-card`'s status rule,
 * which the annex specifies as a "status left-border": under RTL that rule
 * belongs on the inline-start edge (it marks the START of the row, not its
 * physical left), so the utility is `border-s-*` — the logical form — per
 * 10-i18n-theming.md §5.2.
 */
export const OPS_TONE_BORDER_S: Record<Tone, string> = {
  neutral: 'border-s-border',
  accent: 'border-s-accent',
  pos: 'border-s-pos',
  warn: 'border-s-warn',
  danger: 'border-s-danger',
  info: 'border-s-info',
};

// ── thresholded tones ───────────────────────────────────────────────────────

/**
 * Error-budget tone (annex §13: "threshold-colored error-budget bar"). The
 * thresholds are REMAINING-budget floors: at or above `warn` is healthy, at or
 * above `danger` is amber, below it is red. Defaults mirror the SLA-monitoring
 * design port (50% / 20%).
 */
export function budgetTone(remaining: number, thresholds?: { warn?: number; danger?: number }): Tone {
  const warnAt = thresholds?.warn ?? 50;
  const dangerAt = thresholds?.danger ?? 20;
  if (remaining >= warnAt) return 'pos';
  if (remaining >= dangerAt) return 'warn';
  return 'danger';
}

/**
 * Significance tone (annex §13 `experiment-variant-compare`: "confidence % bar
 * color-coded (≥95 green / ≥80 amber)"). Below the amber floor the result is
 * not yet a result, so it reads neutral rather than red — a low-confidence test
 * is inconclusive, not failing, and coloring it danger would tell the reader the
 * opposite of the truth.
 */
export function confidenceTone(conf: number, thresholds?: { high?: number; medium?: number }): Tone {
  const high = thresholds?.high ?? 95;
  const medium = thresholds?.medium ?? 80;
  if (conf >= high) return 'pos';
  if (conf >= medium) return 'warn';
  return 'neutral';
}

/**
 * Lift of a variant against the control, in RELATIVE percent
 * ((conv − control) / control × 100) — the number an experiment readout means by
 * "+12.4%". A zero-conversion control has no defined relative lift (the quotient
 * is ∞ or 0/0), so it returns null and the caller renders no pill rather than
 * `Infinity%`.
 */
export function liftPct(conv: number, controlConv: number): number | null {
  if (!Number.isFinite(conv) || !Number.isFinite(controlConv) || controlConv === 0) return null;
  return ((conv - controlConv) / controlConv) * 100;
}

/** Uptime percentage over a day window — operational days ÷ known days. */
export function uptimePct(days: readonly UptimeState[]): number {
  const known = days.filter((state) => state !== 'unknown');
  if (known.length === 0) return 0;
  const up = known.filter((state) => state === 'operational').length;
  return (up / known.length) * 100;
}

/**
 * Annual per-month price after the yearly discount (annex `plan-pricing-cards`:
 * "large mono price with monthly/annual computed switch"). `discount` is a
 * fraction 0–1; the result is the DISCOUNTED MONTHLY rate, which is what the
 * card's big number shows under the annual toggle (the billing note below it
 * spells out the yearly total).
 */
export function annualMonthly(monthly: number, discount: number): number {
  return monthly * (1 - clamp(discount, 0, 1));
}

/** Yearly total for the annual toggle's billing note. */
export function annualTotal(monthly: number, discount: number): number {
  return annualMonthly(monthly, discount) * 12;
}

// ── formatting (Intl layer only) ────────────────────────────────────────────

/**
 * Elapsed seconds → "H:MM:SS" (or "M:SS" under an hour) — `live-timer`'s
 * readout.
 *
 * The digits go through the Intl number layer so the data-context numeral policy
 * applies (10-i18n-theming.md §4.2: mono data stays Latin-digit and
 * tabular-aligned in every locale, `ar-EG` included). `getFormatters` already
 * pins that — do NOT also wrap the tag in `latnDataTag`, which double-applies the
 * `-u-nu-latn` extension.
 *
 * The COLONS are literal: a duration is not a time-of-day, so `Intl.DateTimeFormat`
 * is the wrong tool (it would localize a stopwatch into a clock reading, and
 * wrap past 24h). Negative and non-finite inputs clamp to zero — a stopwatch
 * cannot run backwards, and `NaN:NaN:NaN` is not a readout.
 */
export function formatDuration(totalSeconds: number, locale: string | undefined): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const fmt = getFormatters(resolveLocale(locale));
  const pad = (value: number): string => fmt.number(value, { minimumIntegerDigits: 2 });
  return hours > 0
    ? `${fmt.number(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${fmt.number(minutes)}:${pad(seconds)}`;
}

/**
 * Locale-aware relative stamp ("3 hours ago") for the last-used / last-fired
 * columns. `now` is REQUIRED — the caller resolves it from
 * `config.format.referenceTime`, which is what keeps demo + VRT captures
 * byte-identical. Absent/unparseable instants render nothing.
 */
export function formatSince(epochMs: number | undefined, locale: string | undefined, now: number): string | undefined {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return undefined;
  return getFormatters(resolveLocale(locale)).relative(new Date(epochMs), { now });
}

/** Locale-aware short date for the sync / expiry stamps. */
export function formatDay(epochMs: number | undefined, locale: string | undefined): string | undefined {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return undefined;
  return getFormatters(resolveLocale(locale)).date(new Date(epochMs), 'medium');
}

/** Locale-aware date+time for the "last / next sync" stats. */
export function formatStamp(epochMs: number | undefined, locale: string | undefined): string | undefined {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return undefined;
  return getFormatters(resolveLocale(locale)).dateTime(new Date(epochMs));
}

/**
 * Money through the Intl layer. An EMPTY currency code is schema-valid
 * (`format.currency: ''` — the config fuzzer generates it on purpose) and
 * `Intl.NumberFormat(tag, { style: 'currency', currency: '' })` throws
 * `RangeError`, so it coalesces to USD here rather than crashing the card.
 */
export function formatMoney(value: number, currency: string | undefined, locale: string | undefined): string {
  const code = currency !== undefined && currency.trim() !== '' ? currency : 'USD';
  const fmt = getFormatters(resolveLocale(locale));
  try {
    return fmt.currency(value, code);
  } catch {
    // A structurally-valid-but-unknown ISO code ('xx') still throws.
    return fmt.currency(value, 'USD');
  }
}

/** Percent through the Intl layer. Takes a 0–100 percent, not a 0–1 fraction. */
export function formatPct(value: number, locale: string | undefined, fractionDigits = 0): string {
  return getFormatters(resolveLocale(locale)).percent(clamp(value, 0, 100) / 100, { fractionDigits });
}

/** Plain count through the Intl layer (row counts, participants, requests). */
export function formatCount(value: number, locale: string | undefined): string {
  return getFormatters(resolveLocale(locale)).number(value);
}

/** Compact count for the dense stats ("24.5K rows"). */
export function formatCompact(value: number, locale: string | undefined): string {
  return getFormatters(resolveLocale(locale)).compact(value);
}

/** Milliseconds → "42 ms" through the Intl unit layer. */
export function formatMs(value: number, locale: string | undefined): string {
  return getFormatters(resolveLocale(locale)).number(Math.round(value), {
    style: 'unit',
    unit: 'millisecond',
    unitDisplay: 'short',
  });
}

/** Minutes → "5 min" through the Intl unit layer (the checklist's time estimate). */
export function formatMinutes(value: number, locale: string | undefined): string {
  return getFormatters(resolveLocale(locale)).number(Math.round(value), {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
  });
}

// ── template interpolation ──────────────────────────────────────────────────

/**
 * `{key}` substitution for the localized templates widgets receive through
 * config (the boards `laneSummary` / org-chart `reportsLabel` convention).
 *
 * Widgets are locale-agnostic and get already-translated strings from the host,
 * so they interpolate by plain substitution — there is no ICU runtime in here.
 * Every template that would otherwise need grammatical number agreement is
 * written in a NON-INFLECTING form ("Cycles · {count}", not "{count} cycles"),
 * because faking plurals would render the wrong noun form in every locale with
 * real plural categories (ar has six, cs four).
 */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

// ── row → model resolution shared by several widgets ────────────────────────

/**
 * Resolve the "now" a widget renders against: the pinned
 * `config.format.referenceTime` when present, else the supplied fallback.
 *
 * EVERY caller passes an explicit fallback — components pass their own ticking
 * clock state, and pure/demo paths pass a fixed epoch. Nothing here reaches for
 * `Date.now()` itself, which is what keeps this module (and the generators built
 * on it) clock-free and the determinism gate green.
 */
export function resolveNow(referenceTime: number | undefined, fallback: number): number {
  return referenceTime !== undefined && Number.isFinite(referenceTime) ? referenceTime : fallback;
}

/** Read a field as an epoch-ms instant (accepts ISO strings and epoch numbers). */
export function instantField(row: Rec, field: string | undefined): number | undefined {
  if (field === undefined) return undefined;
  const value = row[field];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const raw = value.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/** Read a percent-ish field, clamped to 0–100 (absent/garbage → `fallback`). */
export function pctField(row: Rec, field: string | undefined, fallback = 0): number {
  if (field === undefined) return fallback;
  const value = numberField(row, field);
  return value === undefined ? fallback : clamp(value, 0, 100);
}

/** Read a non-negative count field (absent/garbage → `fallback`). */
export function countField(row: Rec, field: string | undefined, fallback = 0): number {
  if (field === undefined) return fallback;
  const value = numberField(row, field);
  return value === undefined || value < 0 ? fallback : value;
}

/** Read a string field with a default (the label columns). */
export function labelField(row: Rec, field: string | undefined, fallback: string): string {
  if (field === undefined) return fallback;
  return stringField(row, field) ?? fallback;
}
