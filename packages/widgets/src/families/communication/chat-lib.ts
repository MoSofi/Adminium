import { getFormatters, latnDataTag } from '@adminium/i18n';

import { formatAbsoluteTime, formatRelativeTime } from '../tables/column-spec.js';

/**
 * Shared helpers for the `communication` family (annex §9) — the seeded PRNG
 * demo generators use, the `record-list` row readers, the author/day grouping
 * that drives `chat-thread`'s bubble runs + day separators, and the Intl-routed
 * time formatting.
 *
 * Kept framework-light (no i18n provider dependency, no React): widgets stay
 * pure and render in stories/tests without a wrapper — the dashboard resolves
 * user-visible labels through @adminium/i18n at the host boundary and passes
 * them down as config, exactly like the feeds/boards families (04 §2, 04-T06).
 */

/** Mulberry32 — the repo's deterministic seeded PRNG (see feeds/feed-lib.tsx). */
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
 * Fixed demo epoch so `demoData(seed)` is byte-identical across runs and
 * platforms (04 §7.7). Matches the feeds family's `DEMO_EPOCH`.
 */
export const CHAT_DEMO_EPOCH = Date.UTC(2026, 6, 14, 12, 0, 0);

/**
 * A `record-list` envelope's rows. Tolerant of every shape the repo emits: the
 * §3 canonical `{ rows }` the server's shapers return (apps/server
 * `ShapedRecordList`), the `{ data }` / `{ snapshot }` shorthands, and a bare
 * array. `rows` is checked first — it is the contract these widgets declare.
 */
export function chatRowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null) {
    const envelope = data as { rows?: unknown; data?: unknown; snapshot?: unknown };
    if (Array.isArray(envelope.rows)) return envelope.rows as Record<string, unknown>[];
    if (Array.isArray(envelope.data)) return envelope.data as Record<string, unknown>[];
    if (Array.isArray(envelope.snapshot)) return envelope.snapshot as Record<string, unknown>[];
  }
  return [];
}

/** Read a row field as a string, or `undefined` when absent/non-scalar. */
export function stringField(row: Record<string, unknown>, field: string): string | undefined {
  const value = row[field];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** Read a row field as a boolean (accepts 1/0, 'true'/'false'). */
export function boolField(row: Record<string, unknown>, field: string): boolean {
  const value = row[field];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return false;
}

/** Read a row field as a finite number, else 0. */
export function numberField(row: Record<string, unknown>, field: string): number {
  const value = row[field];
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ── message model ───────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string | number;
  /** Display name of the author; `own` decides the alignment, not this. */
  author?: string | undefined;
  /** True when the viewer wrote it → bubble aligns to the INLINE-END edge. */
  own: boolean;
  body: string;
  /** ISO 8601 timestamp. */
  sentAt: string;
  attachments?: readonly ChatAttachment[] | undefined;
}

export interface ChatAttachment {
  name: string;
  /** Optional human size string ("2.4 MB"); rendered mono beside the name. */
  size?: string | undefined;
}

/**
 * One rendered bubble: the message plus the run/grouping decisions. A "run" is
 * a maximal streak of consecutive messages by the same author on the same day —
 * only the FIRST message of a run shows the avatar + author name, and only the
 * LAST shows the timestamp (annex §9: "avatar on first message of a run").
 */
export interface ChatBubble extends ChatMessage {
  /** First message of an author-run → render the avatar + name. */
  startsRun: boolean;
  /** Last message of an author-run → render the mono timestamp. */
  endsRun: boolean;
}

/** A day's worth of bubbles behind one `chat-thread` day separator. */
export interface ChatDayGroup {
  /** `YYYY-MM-DD` (UTC) — stable React key and the separator's identity. */
  key: string;
  /** Midnight UTC of the day, for Intl formatting at render time. */
  date: Date;
  bubbles: ChatBubble[];
}

/** `YYYY-MM-DD` in UTC for an ISO timestamp; `''` when unparseable. */
export function isoDayOf(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  return new Date(time).toISOString().slice(0, 10);
}

/** Ascending sort by `sentAt` — stable for equal timestamps (index tiebreak). */
export function sortBySentAt(messages: readonly ChatMessage[]): ChatMessage[] {
  return [...messages]
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const delta = new Date(a.message.sentAt).getTime() - new Date(b.message.sentAt).getTime();
      if (Number.isNaN(delta)) return a.index - b.index;
      return delta !== 0 ? delta : a.index - b.index;
    })
    .map((entry) => entry.message);
}

/**
 * Group an ordered message list into day groups of author-runs (annex §9).
 * Messages are sorted by `sentAt` first, so an out-of-order payload still
 * renders chronologically. A run breaks on an author change, an `own` change,
 * or a day boundary — so a day separator can never appear *inside* a run.
 */
export function groupMessages(messages: readonly ChatMessage[]): ChatDayGroup[] {
  const ordered = sortBySentAt(messages);
  const groups: ChatDayGroup[] = [];

  for (const [index, message] of ordered.entries()) {
    const day = isoDayOf(message.sentAt);
    let group = groups[groups.length - 1];
    if (group === undefined || group.key !== day) {
      const time = new Date(message.sentAt).getTime();
      group = {
        key: day,
        date: new Date(Number.isNaN(time) ? CHAT_DEMO_EPOCH : `${day}T00:00:00.000Z`),
        bubbles: [],
      };
      groups.push(group);
    }
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    const sameRunAs = (other: ChatMessage | undefined): boolean =>
      other !== undefined &&
      other.own === message.own &&
      (other.author ?? '') === (message.author ?? '') &&
      isoDayOf(other.sentAt) === day;

    group.bubbles.push({
      ...message,
      startsRun: !sameRunAs(previous),
      endsRun: !sameRunAs(next),
    });
  }
  return groups;
}

/** Map an untrusted `record-list` row to a {@link ChatMessage} via config field names. */
export function toChatMessage(
  row: Record<string, unknown>,
  index: number,
  fields: {
    authorField: string;
    bodyField: string;
    sentAtField: string;
    attachmentsField: string;
    ownField: string;
    /** When set, a row whose author equals this is the viewer's own message. */
    ownAuthor?: string | undefined;
  },
): ChatMessage {
  const author = stringField(row, fields.authorField);
  const own =
    fields.ownAuthor !== undefined && author !== undefined
      ? author === fields.ownAuthor
      : boolField(row, fields.ownField);
  const sentAt = stringField(row, fields.sentAtField);
  const attachments = attachmentsOf(row[fields.attachmentsField]);
  return {
    id: (row['id'] as string | number | undefined) ?? index,
    ...(author === undefined ? {} : { author }),
    own,
    body: stringField(row, fields.bodyField) ?? '',
    sentAt: sentAt ?? new Date(CHAT_DEMO_EPOCH).toISOString(),
    ...(attachments.length === 0 ? {} : { attachments }),
  };
}

/** Normalize an attachments cell: array of strings or {name,size} objects. */
export function attachmentsOf(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ChatAttachment[] => {
    if (typeof entry === 'string') return [{ name: entry }];
    if (typeof entry === 'object' && entry !== null) {
      const record = entry as Record<string, unknown>;
      const name = stringField(record, 'name');
      if (name === undefined) return [];
      const size = stringField(record, 'size');
      return [{ name, ...(size === undefined ? {} : { size }) }];
    }
    return [];
  });
}

// ── typing-indicator: the §3 `boolean-map` envelope ─────────────────────────

/**
 * A `boolean-map` envelope's `entries` (04 §3; `isEmptyByShape['boolean-map']`
 * reads the same key, so an `{}` payload routes to WidgetFrame's empty state
 * before the widget ever sees it). Annex §9 types `typing-indicator` as
 * "boolean per conversation", so the keys are conversation ids.
 *
 * Tolerant of the bare-record shorthand (`{ c1: true }`) a hand-written demo or
 * a thin host adapter may pass, and coerces 1/0 + 'true'/'false' cells the way
 * `boolField` does — a driver that returns MySQL TINYINT(1) or a stringified
 * boolean must not read as "nobody is typing".
 */
export function typingEntriesOf(data: unknown): Record<string, boolean> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const envelope = data as { entries?: unknown };
  const source =
    typeof envelope.entries === 'object' && envelope.entries !== null && !Array.isArray(envelope.entries)
      ? (envelope.entries as Record<string, unknown>)
      : (data as Record<string, unknown>);
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(source)) {
    if (key === 'entries') continue; // never fold the envelope key into itself
    out[key] = boolField(source, key);
  }
  return out;
}

/**
 * Is anyone typing? `conversationId` selects the annex's "boolean per
 * conversation"; without one (an unbound/demo instance) ANY live entry counts,
 * so the widget still animates instead of sitting mute.
 */
export function isTypingIn(entries: Record<string, boolean>, conversationId?: string | undefined): boolean {
  if (conversationId !== undefined) return entries[conversationId] === true;
  return Object.values(entries).some((value) => value);
}

// ── call-widget: the §3 `record` envelope ───────────────────────────────────

/** A `record` envelope's row (04 §3: `isEmpty ⇔ row == null`). Tolerant of a bare object. */
export function recordRowOf(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const envelope = data as { row?: unknown };
  if (typeof envelope.row === 'object' && envelope.row !== null && !Array.isArray(envelope.row)) {
    return envelope.row as Record<string, unknown>;
  }
  return 'row' in envelope ? null : (data as Record<string, unknown>);
}

/** The two call kinds annex §9 names ("voice/video kind label"). */
export const CALL_KINDS = ['voice', 'video'] as const;
export type CallKind = (typeof CALL_KINDS)[number];

/**
 * Call lifecycle. `ringing` is the annex's headline state (the expanding accent
 * ring); the rest let one stored instance cover the whole call rather than
 * needing a widget per phase.
 */
export const CALL_STATES = ['ringing', 'connecting', 'active', 'ended'] as const;
export type CallState = (typeof CALL_STATES)[number];

/** Coerce an untrusted cell to a known call kind (default `voice`). */
export function callKindOf(value: unknown): CallKind {
  return (CALL_KINDS as readonly string[]).includes(String(value)) ? (value as CallKind) : 'voice';
}

/** Coerce an untrusted cell to a known call state (default `ringing`). */
export function callStateOf(value: unknown): CallState {
  return (CALL_STATES as readonly string[]).includes(String(value)) ? (value as CallState) : 'ringing';
}

// ── Intl-routed formatting (data context — latn digits per 10 §4.2) ──────────

/**
 * Coerce an untrusted locale tag to one `Intl` accepts. `format.locale` is an
 * optional free-string in the shared widget config, so `''` is SCHEMA-VALID and
 * reaches us — and every `Intl` constructor (plus `toLocaleLowerCase`) throws
 * `RangeError: Incorrect locale information provided` on an empty tag. The
 * `||` (not `??`) is deliberate: it coalesces the empty string too, mirroring
 * `formatMoney`'s `currency || 'USD'` guard in tables/column-spec.
 */
export function localeOf(tag: string | undefined): string {
  const trimmed = (tag ?? '').trim();
  if (trimmed === '') return 'en-US';
  try {
    // A syntactically invalid tag ("x-1", "north") throws here rather than at
    // every call site downstream.
    return Intl.getCanonicalLocales(trimmed).length > 0 ? trimmed : 'en-US';
  } catch {
    return 'en-US';
  }
}

const daySeparatorFmts = new Map<string, Intl.DateTimeFormat>();
const clockFmts = new Map<string, Intl.DateTimeFormat>();

function memoFmt(
  cache: Map<string, Intl.DateTimeFormat>,
  tag: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const resolved = latnDataTag(localeOf(tag));
  let fmt = cache.get(resolved);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat(resolved, { ...options, timeZone: 'UTC' });
    cache.set(resolved, fmt);
  }
  return fmt;
}

/**
 * Day-separator label — "Today" / "Yesterday" via `Intl.RelativeTimeFormat`'s
 * `numeric: 'auto'` when within a day of `now`, else a localized weekday+date
 * ("Tue, Jul 14"). `now` is injectable so tests/VRT captures are deterministic.
 */
export function fmtDaySeparator(tag: string, date: Date, now: number): string {
  const today = new Date(now).toISOString().slice(0, 10);
  const key = date.toISOString().slice(0, 10);
  const dayDelta = Math.round(
    (Date.parse(`${key}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000,
  );
  if (Math.abs(dayDelta) <= 1) {
    return new Intl.RelativeTimeFormat(latnDataTag(localeOf(tag)), { numeric: 'auto' }).format(dayDelta, 'day');
  }
  return memoFmt(daySeparatorFmts, tag, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}

/** Per-message wall-clock stamp ("9:41 AM") — mono metadata slot. */
export function fmtClock(tag: string, iso: string): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '';
  return memoFmt(clockFmts, tag, { hour: 'numeric', minute: '2-digit' }).format(time);
}

/** Localized count for the unread pill (latn digits, tabular-safe). */
export function fmtCount(tag: string, count: number): string {
  return getFormatters(latnDataTag(localeOf(tag))).number(count);
}

// ── binding → event source ──────────────────────────────────────────────────

/**
 * The `{connectionId, table}` pair a `record-open` / `mutate` event carries,
 * read off the widget's query descriptor (04 §5.1: `binding.source.name` is the
 * table/view). Tolerant of a `table`-spelled source and of an absent binding
 * (a demoData-backed instance still renders and emits against `records`).
 */
export function sourceOf(binding: unknown): { connectionId?: string | undefined; table: string } {
  const descriptor = binding as
    | { connectionId?: string; source?: { name?: string; table?: string } }
    | undefined;
  return {
    connectionId: descriptor?.connectionId,
    table: descriptor?.source?.name ?? descriptor?.source?.table ?? 'records',
  };
}

/** Re-exported so the family's relative times route through the same Intl layer. */
export { formatAbsoluteTime, formatRelativeTime };
