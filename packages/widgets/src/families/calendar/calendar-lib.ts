import { getFormatters, latnDataTag, weekInfo } from '@adminium/i18n';
import type { Tone } from '@adminium/ui';

/**
 * Shared helpers for the `calendar` family (annex §5) — a deterministic seeded
 * PRNG for `demoData`, tone coercion, and the locale-aware date machinery every
 * calendar widget needs: a 42-cell month grid, locale-aware week start (via the
 * @adminium/i18n `weekInfo` layer, never a hardcoded Sunday/Monday), weekday
 * headers, and Intl-routed date/time/number formatting.
 *
 * Numeral policy (10-i18n-theming.md §4.2): calendar day numbers, times, and
 * the month/year title are *data-context* strings → Latin digits + gregorian
 * (`latnDataTag`) so the grid stays `tabular-nums`-aligned in every locale
 * including `ar_EG`. Weekday/month NAMES localize to the locale's script.
 *
 * Kept framework-light (no i18n provider dependency), like the `feeds` family —
 * widgets render in stories/tests without a wrapper and the dashboard resolves
 * label overrides through @adminium/i18n at the host boundary (04 §2).
 */

/** Mulberry32 — the repo's deterministic seeded PRNG (see feeds/tables). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pick from a non-empty tuple. */
export function pickFrom<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length] as T;
}

/**
 * Coalesce an empty/whitespace locale to `en-US`. `getFormatters` already
 * normalizes an empty tag, but a schema-valid `format.locale: ''` reaches
 * `Avatar`'s `String#toLocaleUpperCase('')`, which throws
 * `RangeError: Incorrect locale information provided` — so widgets normalize the
 * tag once, at the boundary, before any locale-sensitive call.
 */
export function resolveLocale(locale: string | undefined): string {
  return locale !== undefined && locale.trim() !== '' ? locale : 'en-US';
}

// --- Binding source -----------------------------------------------------------

/** The `connectionId` + qualified table a `record-open`/`mutate` event carries. */
export interface BindingSource {
  connectionId: string;
  table: string;
}

/**
 * The event target for a bound widget: `connectionId` + the schema-qualified
 * table name, or `null` when the widget is running on `demoData` (no binding) —
 * an unbound widget must never emit a mutation against a table that isn't there
 * (the tables/CardGallery + boards + media convention).
 *
 * NB the descriptor is `binding.source.name` (+ optional `schema`), NOT a flat
 * `binding.table` (04 §5.1).
 */
export function bindingSourceOf(
  binding: { connectionId: string; source: { schema?: string | undefined; name: string } } | undefined,
): BindingSource | null {
  if (binding === undefined) return null;
  const { schema, name } = binding.source;
  return { connectionId: binding.connectionId, table: schema === undefined ? name : `${schema}.${name}` };
}

/** Persona names (BRIEF §4) for the resource/member scheduling widgets. */
export const PERSONA_NAMES = [
  'Ada Lovelace',
  'Grace Hopper',
  'Alan Turing',
  'Katherine Johnson',
  'Edsger Dijkstra',
  'Barbara Liskov',
  'Donald Knuth',
  'Radia Perlman',
] as const;

/**
 * Fixed demo anchor month — July 2026 (matches the repo's `DEMO_EPOCH`), so
 * `demoData(seed)` is byte-identical across runs and never touches `Date.now()`
 * (04 §7.7). `ANCHOR_TODAY` is the "today" a story/VRT capture can pin for the
 * today-ring without a wall-clock read.
 */
export const ANCHOR_YEAR = 2026;
export const ANCHOR_MONTH = 6; // 0-based → July
export const ANCHOR_TODAY = '2026-07-15';

const KNOWN_TONES: ReadonlySet<string> = new Set(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);

/**
 * Tone → colored inline-start border + soft tint + tone text. Paired with a
 * `border-s-2`/`border-s-4` width utility on the element (`border-{tone}`
 * colors all sides, only the start side has width → a start accent bar that
 * mirrors under RTL). Shared by the event chips and shift chips.
 */
export const TONE_SOFT_BORDER: Record<Tone, string> = {
  neutral: 'border-fg-subtle bg-surface-2 text-fg',
  accent: 'border-accent bg-accent-soft text-accent',
  pos: 'border-pos bg-pos-soft text-pos',
  warn: 'border-warn bg-warn-soft text-warn',
  danger: 'border-danger bg-danger-soft text-danger',
  info: 'border-info bg-info-soft text-info',
};

/** Tone → border color only (for a colored side bar over a plain surface). */
export const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-fg-subtle',
  accent: 'border-accent',
  pos: 'border-pos',
  warn: 'border-warn',
  danger: 'border-danger',
  info: 'border-info',
};

/** Tone → solid background (utilization segments, dots). */
export const TONE_SOLID_BG: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** Coerce an untrusted tone string to a valid `Tone`, defaulting as given. */
export function toneOf(value: unknown, fallback: Tone = 'accent'): Tone {
  return typeof value === 'string' && KNOWN_TONES.has(value) ? (value as Tone) : fallback;
}

/**
 * Category → tone cycle used when an event/assignment carries no explicit tone
 * and the config supplies no `categoryColorMap`. Deterministic per category
 * name so the same category always draws the same color.
 */
const TONE_CYCLE: readonly Tone[] = ['accent', 'info', 'pos', 'warn', 'danger', 'neutral'];

/** Stable FNV-1a-ish hash of a string → index into a palette. */
export function hashIndex(value: string, modulo: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return modulo <= 0 ? 0 : hash % modulo;
}

/** Tone for a category, honoring an explicit map, else a stable hashed cycle. */
export function categoryTone(category: string | undefined, map?: Record<string, string> | undefined): Tone {
  if (category === undefined) return 'accent';
  const explicit = map?.[category];
  if (explicit !== undefined) return toneOf(explicit);
  return TONE_CYCLE[hashIndex(category, TONE_CYCLE.length)] as Tone;
}

// --- ISO date helpers (all UTC — deterministic regardless of the host TZ) -----

/** `YYYY-MM-DD` key for a UTC date. */
export function isoDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** UTC midnight `Date` from a `YYYY-MM-DD` (or full ISO) string. */
export function parseIsoDay(value: string): Date {
  const day = value.length >= 10 ? value.slice(0, 10) : value;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? new Date(`${ANCHOR_YEAR}-07-01T00:00:00.000Z`) : date;
}

/** The `Date` for an event's start instant (date + optional `HH:MM` time), UTC. */
export function eventInstant(event: { date: string; time?: string | undefined }): Date {
  const day = event.date.length >= 10 ? event.date.slice(0, 10) : event.date;
  if (event.time !== undefined && /^\d{1,2}:\d{2}$/.test(event.time)) {
    const [h, m] = event.time.split(':');
    const iso = `${day}T${String(h).padStart(2, '0')}:${m}:00.000Z`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return parseIsoDay(day);
}

/** ISO weekday (1 = Mon … 7 = Sun) → JS `getUTCDay` (0 = Sun … 6 = Sat). */
function isoToJsWeekday(isoDay: number): number {
  return isoDay % 7;
}

/** Locale's first day of the week as a JS weekday (0 = Sun … 6 = Sat). */
export function firstJsWeekday(tag: string, override?: number | undefined): number {
  const iso = override !== undefined ? override : weekInfo(tag).firstDay;
  return isoToJsWeekday(iso);
}

export interface MonthCell {
  /** `YYYY-MM-DD`. */
  key: string;
  date: Date;
  /** Day-of-month (1–31). */
  day: number;
  /** Belongs to the displayed month (vs. leading/trailing spill days). */
  inMonth: boolean;
  /** JS weekday (0 = Sun … 6 = Sat). */
  weekday: number;
}

/**
 * The 42-cell (6 week × 7 day) month grid for `year`/`monthIndex` (0-based),
 * starting on the locale's first weekday (or an explicit ISO `firstDayOverride`).
 * Leading/trailing cells spill into the neighboring months (`inMonth: false`).
 */
export function monthGrid(year: number, monthIndex: number, firstJs: number): MonthCell[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (firstWeekday - firstJs + 7) % 7;
  const start = new Date(Date.UTC(year, monthIndex, 1 - offset));
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    cells.push({
      key: isoDayKey(date),
      date,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthIndex && date.getUTCFullYear() === year,
      weekday: date.getUTCDay(),
    });
  }
  return cells;
}

/** The seven days of the week starting `startJs`, as ISO dates for a reference week. */
export function weekDays(startIso: string, firstJs: number): { key: string; date: Date; weekday: number }[] {
  const start = parseIsoDay(startIso);
  const offset = (start.getUTCDay() - firstJs + 7) % 7;
  const weekStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - offset));
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + i));
    return { key: isoDayKey(date), date, weekday: date.getUTCDay() };
  });
}

// --- Intl-routed formatting (memoized; data-context digits per §4.2) ----------

const weekdayFmts = new Map<string, Intl.DateTimeFormat>();
const monthTitleFmts = new Map<string, Intl.DateTimeFormat>();
const dayLabelFmts = new Map<string, Intl.DateTimeFormat>();
/**
 * Short month names get their OWN cache. `memoFmt` keys on the resolved tag, so
 * two option sets sharing a map would collide on the first tag they see and the
 * second caller would silently get the first one's format.
 */
const monthShortFmts = new Map<string, Intl.DateTimeFormat>();

function memoFmt(
  cache: Map<string, Intl.DateTimeFormat>,
  tag: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const resolved = latnDataTag(tag);
  let fmt = cache.get(resolved);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat(resolved, { ...options, timeZone: 'UTC' });
    cache.set(resolved, fmt);
  }
  return fmt;
}

/** Localized day number (Latin digits, data context — `tabular-nums` safe). */
export function fmtDayNumber(tag: string, day: number): string {
  return getFormatters(tag).number(day);
}

/** "July 2026" — month long + numeric year, locale-scripted names, latn digits. */
export function fmtMonthTitle(tag: string, date: Date): string {
  return memoFmt(monthTitleFmts, tag, { month: 'long', year: 'numeric' }).format(date);
}

/**
 * Seven short weekday header labels, ordered from the locale's first weekday.
 * `firstJs` is a JS weekday (0 = Sun … 6 = Sat); reference week anchored on a
 * known Sunday (2023-01-01) so the names are stable and TZ-independent.
 */
export function weekdayHeaders(tag: string, firstJs: number): string[] {
  const fmt = memoFmt(weekdayFmts, tag, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => {
    const jsDay = (firstJs + i) % 7;
    return fmt.format(new Date(Date.UTC(2023, 0, 1 + jsDay)));
  });
}

/** "Wednesday, July 15" — weekday + month + day for the agenda header. */
export function fmtDayLabel(tag: string, date: Date): string {
  return memoFmt(dayLabelFmts, tag, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

/** Short weekday + day for compact column headers ("Wed 15"). */
export function fmtColumnDay(tag: string, date: Date): { weekday: string; day: string } {
  return {
    weekday: memoFmt(weekdayFmts, tag, { weekday: 'short' }).format(date),
    day: fmtDayNumber(tag, date.getUTCDate()),
  };
}

/** Event start time ("9:00 AM" / "٩:٠٠…") via the Intl layer, pinned to UTC. */
export function fmtEventTime(tag: string, event: { date: string; time?: string | undefined }): string {
  if (event.time === undefined) return '';
  return getFormatters(tag).time(eventInstant(event), { timeZone: 'UTC' });
}

/** Short month name for the `upcoming-events-list` date block ("Jul", "يوليو"). */
export function fmtMonthShort(tag: string, date: Date): string {
  return memoFmt(monthShortFmts, tag, { month: 'short' }).format(date);
}

/**
 * A job's next-run instant ("Jul 20, 09:00"). Data context via the Intl layer —
 * `getFormatters` already pins latn digits + gregorian for it, so callers must
 * NOT also wrap the tag in `latnDataTag`.
 */
export function fmtNextRun(tag: string, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return getFormatters(tag).dateTime(date, { timeZone: 'UTC' });
}

// --- calendar-legend-filter ---------------------------------------------------

/**
 * Aggregate a `calendar-events` payload into legend categories with counts
 * (annex §5: "categories aggregated from events"). Order is first-seen so the
 * legend is stable across renders and locales; uncategorized events bucket under
 * `fallback` rather than vanishing from the counts.
 */
export function aggregateCategories(
  events: readonly { category?: string | undefined; tone?: string | undefined }[],
  map?: Record<string, string> | undefined,
  fallback = 'other',
): { name: string; count: number; tone: Tone }[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  const tones = new Map<string, Tone>();
  for (const event of events) {
    const name = event.category ?? fallback;
    if (!counts.has(name)) {
      order.push(name);
      tones.set(name, event.tone === undefined ? categoryTone(name, map) : toneOf(event.tone));
    }
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return order.map((name) => ({
    name,
    count: counts.get(name) ?? 0,
    tone: tones.get(name) ?? 'accent',
  }));
}

// --- upcoming-events-list -----------------------------------------------------

/**
 * Events at or after `fromKey` (`YYYY-MM-DD`), date-then-time ascending, capped
 * at `n` — the annex's "events WHERE date ≥ today ORDER BY date LIMIT n".
 *
 * The cutoff is a DAY key, not an instant: an event earlier today is still
 * "upcoming" until the day rolls over, which is what the Release Calendar comp
 * shows (today's release stays on the list all day).
 */
export function upcomingFrom<T extends { date: string; time?: string | undefined }>(
  events: readonly T[],
  fromKey: string,
  n: number,
): T[] {
  return events
    .filter((event) => event.date.slice(0, 10) >= fromKey)
    .sort((a, b) => eventInstant(a).getTime() - eventInstant(b).getTime())
    .slice(0, Math.max(1, n));
}

// --- date-range-picker --------------------------------------------------------

/** `YYYY-MM-DD` `days` after (or, negative, before) an ISO day. */
export function addDays(key: string, days: number): string {
  const date = parseIsoDay(key);
  return isoDayKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days)));
}

/** Inclusive day-key range test — string compare is safe for `YYYY-MM-DD`. */
export function isInRange(key: string, start: string | null, end: string | null): boolean {
  if (start === null || end === null) return false;
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return key >= lo && key <= hi;
}

/** Whole days between two day keys, inclusive of both endpoints. */
export function daysBetween(start: string, end: string): number {
  const from = parseIsoDay(start).getTime();
  const to = parseIsoDay(end).getTime();
  return Math.abs(Math.round((to - from) / 86_400_000)) + 1;
}

/**
 * The default quick presets (annex §5: "quick presets (7d/30d/QTD…)"). Labels
 * are ENGLISH DEFAULTS: widgets are locale-agnostic and the host passes
 * translated labels through config, the same contract as the boards family's
 * announcements (04 §2).
 */
export type DefaultRangePresetId = '7d' | '30d' | '90d' | 'mtd' | 'qtd' | 'ytd';

export const DEFAULT_RANGE_PRESETS: readonly {
  id: DefaultRangePresetId;
  label: string;
  days?: number;
  anchor?: 'mtd' | 'qtd' | 'ytd';
}[] = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'mtd', label: 'Month to date', anchor: 'mtd' },
  { id: 'qtd', label: 'Quarter to date', anchor: 'qtd' },
  { id: 'ytd', label: 'Year to date', anchor: 'ytd' },
];

/**
 * Resolve a preset against a reference day (`YYYY-MM-DD`) into an inclusive day
 * pair. `days: 7` means "the last 7 days INCLUDING today" (today − 6 … today),
 * which is what the comps' "Last 7 days" summary counts — an off-by-one here
 * silently shifts every bound query the picker feeds.
 */
export function resolvePreset(
  preset: { days?: number | undefined; anchor?: 'mtd' | 'qtd' | 'ytd' | undefined },
  referenceKey: string,
): { start: string; end: string } {
  const reference = parseIsoDay(referenceKey);
  if (preset.anchor !== undefined) {
    const year = reference.getUTCFullYear();
    const month = reference.getUTCMonth();
    const startMonth = preset.anchor === 'mtd' ? month : preset.anchor === 'qtd' ? Math.floor(month / 3) * 3 : 0;
    return { start: isoDayKey(new Date(Date.UTC(year, startMonth, 1))), end: referenceKey };
  }
  const span = preset.days ?? 1;
  return { start: addDays(referenceKey, -(Math.max(1, span) - 1)), end: referenceKey };
}
