/**
 * Intl formatting layer (10-i18n-theming.md §4). All numbers, dates,
 * currencies, relative times, and lists render through here — never through
 * hand-rolled helpers or `toLocaleString('en-US')`.
 *
 * Numeral policy (§4.2, normative): `ctx: "data"` (the default) forces Latin
 * digits (`-u-nu-latn`) and the gregorian calendar (`-ca-gregory`) so mono
 * data cells stay `tabular-nums`-aligned in every locale, including `ar_EG`;
 * `ctx: "prose"` uses the locale's default numbering system, so Arabic prose
 * renders Arabic-Indic digits. `Intl.*` instances are expensive — memoized
 * per `(tag, options, context)`.
 */

export type FmtContext = 'data' | 'prose';

export interface Formatters {
  number(v: number, o?: Intl.NumberFormatOptions & { ctx?: FmtContext }): string;
  /** 24500 → "24.5K" / "24 500" per locale. */
  compact(v: number, o?: { ctx?: FmtContext }): string;
  percent(v: number, o?: { fractionDigits?: number; ctx?: FmtContext }): string;
  /** Currency code comes from column metadata, never from the viewer's locale (§4.4). */
  currency(v: number, currency: string, o?: { ctx?: FmtContext }): string;
  /** Intl unit style, "1.2 MB". Data context (mono cells). */
  bytes(v: number): string;
  date(d: Date | string | number, style?: 'short' | 'medium' | 'long', o?: { ctx?: FmtContext; timeZone?: string }): string;
  time(d: Date | string | number, o?: { ctx?: FmtContext; timeZone?: string }): string;
  dateTime(d: Date | string | number, o?: { ctx?: FmtContext; timeZone?: string }): string;
  /** `formatRange`, collapses shared parts. */
  dateRange(a: Date | string | number, b: Date | string | number): string;
  /** "3 hours ago" — auto unit, prose context; absolute date past ~26 days (§4.5). */
  relative(d: Date | string | number, o?: { now?: number }): string;
  list(items: string[], type?: 'conjunction' | 'disjunction'): string;
  /** Client-side sorts (in-memory widget sorts, ⌘K ordering) — `numeric: true`. */
  collator(): Intl.Collator;
}

/** Static week-info fallback for the 8 locales (§4.5). ISO-8601 day numbers (1 = Monday … 7 = Sunday). */
export interface WeekInfo {
  firstDay: number;
  weekend: readonly number[];
}

const WEEK_INFO_FALLBACK: Readonly<Record<string, WeekInfo>> = {
  'en-US': { firstDay: 7, weekend: [6, 7] },
  'de-DE': { firstDay: 1, weekend: [6, 7] },
  'fr-FR': { firstDay: 1, weekend: [6, 7] },
  'cs-CZ': { firstDay: 1, weekend: [6, 7] },
  'da-DK': { firstDay: 1, weekend: [6, 7] },
  'zh-CN': { firstDay: 1, weekend: [6, 7] },
  'zh-TW': { firstDay: 1, weekend: [6, 7] },
  'ar-EG': { firstDay: 6, weekend: [5, 6] },
};

/** `Intl.Locale#getWeekInfo()` where available, else the static table. */
export function weekInfo(tag: string): WeekInfo {
  try {
    const locale = new Intl.Locale(tag) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number; weekend: number[] };
      weekInfo?: { firstDay: number; weekend: number[] };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info !== undefined) return { firstDay: info.firstDay, weekend: info.weekend };
  } catch {
    // Fall through to the static table.
  }
  return WEEK_INFO_FALLBACK[tag] ?? { firstDay: 1, weekend: [6, 7] };
}

/** §4.2/§4.3: latn digits + gregorian calendar pinned for data context. */
function tagFor(tag: string, ctx: FmtContext): string {
  // Coalesce empty/invalid tags (see `normalizeTag`) before appending the
  // `-u-...` extension, so `latnDataTag('')` and direct `Intl.*` builds off it
  // don't produce an invalid `"-u-nu-latn-…"` tag that throws.
  const base = normalizeTag(tag);
  if (ctx === 'prose') return base;
  return base.includes('-u-') ? `${base}-nu-latn-ca-gregory` : `${base}-u-nu-latn-ca-gregory`;
}

/**
 * The data-context BCP-47 tag (latn digits + gregorian calendar, §4.2) for
 * callers that must build an `Intl.*` instance this layer does not expose —
 * e.g. a narrow-style relative-time formatter for a mono grid cell. Keeps the
 * numeral policy in one place instead of hand-rolling the `-u-nu-latn` suffix.
 */
export function latnDataTag(tag: string): string {
  return tagFor(tag, 'data');
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const listFormats = new Map<string, Intl.ListFormat>();
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();
const collators = new Map<string, Intl.Collator>();

function numberFormat(tag: string, ctx: FmtContext, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const resolved = tagFor(tag, ctx);
  const key = `${resolved}|${JSON.stringify(options)}`;
  let fmt = numberFormats.get(key);
  if (fmt === undefined) {
    fmt = new Intl.NumberFormat(resolved, options);
    numberFormats.set(key, fmt);
  }
  return fmt;
}

function dateFormat(tag: string, ctx: FmtContext, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const resolved = tagFor(tag, ctx);
  const key = `${resolved}|${JSON.stringify(options)}`;
  let fmt = dateFormats.get(key);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat(resolved, options);
    dateFormats.set(key, fmt);
  }
  return fmt;
}

function toDate(d: Date | string | number): Date {
  return d instanceof Date ? d : new Date(d);
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'] as const;

const DATE_STYLES: Record<'short' | 'medium' | 'long', Intl.DateTimeFormatOptions> = {
  short: { dateStyle: 'short' },
  medium: { dateStyle: 'medium' },
  long: { dateStyle: 'long' },
};

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const formattersByTag = new Map<string, Formatters>();

function buildFormatters(tag: string): Formatters {
  const relativeFor = (t: string): Intl.RelativeTimeFormat => {
    let fmt = relativeFormats.get(t);
    if (fmt === undefined) {
      fmt = new Intl.RelativeTimeFormat(t, { numeric: 'auto' });
      relativeFormats.set(t, fmt);
    }
    return fmt;
  };

  const fmt: Formatters = {
    number(v, o = {}) {
      const { ctx = 'data', ...options } = o;
      return numberFormat(tag, ctx, options).format(v);
    },

    compact(v, o = {}) {
      return numberFormat(tag, o.ctx ?? 'data', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
    },

    percent(v, o = {}) {
      const digits = o.fractionDigits ?? 0;
      return numberFormat(tag, o.ctx ?? 'data', {
        style: 'percent',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(v);
    },

    currency(v, currency, o = {}) {
      return numberFormat(tag, o.ctx ?? 'data', { style: 'currency', currency }).format(v);
    },

    bytes(v) {
      const magnitude = v === 0 ? 0 : Math.floor(Math.log10(Math.abs(v)) / 3);
      const index = Math.min(Math.max(magnitude, 0), BYTE_UNITS.length - 1);
      const unit = BYTE_UNITS[index] ?? 'byte';
      return numberFormat(tag, 'data', {
        style: 'unit',
        unit,
        unitDisplay: 'short',
        maximumFractionDigits: 1,
      }).format(v / 1000 ** index);
    },

    date(d, style = 'medium', o = {}) {
      return dateFormat(tag, o.ctx ?? 'data', {
        ...DATE_STYLES[style],
        ...(o.timeZone === undefined ? {} : { timeZone: o.timeZone }),
      }).format(toDate(d));
    },

    time(d, o = {}) {
      return dateFormat(tag, o.ctx ?? 'data', {
        timeStyle: 'short',
        ...(o.timeZone === undefined ? {} : { timeZone: o.timeZone }),
      }).format(toDate(d));
    },

    dateTime(d, o = {}) {
      return dateFormat(tag, o.ctx ?? 'data', {
        dateStyle: 'medium',
        timeStyle: 'short',
        ...(o.timeZone === undefined ? {} : { timeZone: o.timeZone }),
      }).format(toDate(d));
    },

    dateRange(a, b) {
      return dateFormat(tag, 'data', { dateStyle: 'medium' }).formatRange(toDate(a), toDate(b));
    },

    relative(d, o = {}) {
      const now = o.now ?? Date.now();
      const delta = toDate(d).getTime() - now;
      const abs = Math.abs(delta);
      const rtf = relativeFor(tag); // prose context: relative times live in sentences (§4.2)
      if (abs < 45_000) return rtf.format(0, 'second'); // "now" via numeric: 'auto'
      if (abs < 90 * MINUTE) return rtf.format(Math.round(delta / MINUTE), 'minute');
      if (abs < 22 * HOUR) return rtf.format(Math.round(delta / HOUR), 'hour');
      if (abs < 26 * DAY) return rtf.format(Math.round(delta / DAY), 'day');
      return fmt.date(d);
    },

    list(items, type = 'conjunction') {
      const key = `${tag}|${type}`;
      let lf = listFormats.get(key);
      if (lf === undefined) {
        lf = new Intl.ListFormat(tag, { type });
        listFormats.set(key, lf);
      }
      return lf.format(items);
    },

    collator() {
      let c = collators.get(tag);
      if (c === undefined) {
        c = new Intl.Collator(tag, { numeric: true });
        collators.set(tag, c);
      }
      return c;
    },
  };

  return fmt;
}

/**
 * Coalesce an empty/whitespace/structurally-invalid tag to `en-US`. Callers
 * often pass `config.locale ?? 'en-US'`, which lets an empty string `''` slip
 * through (`??` only catches null/undefined) — and `new Intl.NumberFormat('')`
 * throws `RangeError`. Normalizing here makes every formatter safe against a
 * schema-valid empty locale, so no widget crashes on it.
 */
function normalizeTag(tag: string): string {
  if (typeof tag !== 'string' || tag.trim() === '') return 'en-US';
  try {
    Intl.getCanonicalLocales(tag); // throws RangeError on an invalid tag
    return tag;
  } catch {
    return 'en-US';
  }
}

/** Memoized per BCP-47 tag. Framework-free — the React binding is `useFmt()` (./react.js entry). */
export function getFormatters(tag: string): Formatters {
  const normalized = normalizeTag(tag);
  let fmt = formattersByTag.get(normalized);
  if (fmt === undefined) {
    fmt = buildFormatters(normalized);
    formattersByTag.set(normalized, fmt);
  }
  return fmt;
}
