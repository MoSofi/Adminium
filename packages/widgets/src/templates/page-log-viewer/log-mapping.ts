import type { QueryDescriptor } from '../../page-config/index.js';
import { isErrorRow } from '../../families/tables/LogTable.js';
import type { LogRow } from '../../families/tables/tables-track-f-types.js';
import type { TimelineEntry } from '../../families/feeds/feeds-types.js';

/**
 * `page-log-viewer` field mapping (09-generated-app.md §7.8) — PURE module.
 *
 * The generator binds `log-table` to a raw `record-list` over the audit/event
 * table (candidates rule `tables.log-table`) and its config carries only
 * `title` + `binding` — no column naming. The template therefore projects the
 * real column names onto the `LogRow` anatomy (ts / actor / category / action /
 * resource / status / code / ip / url) by DETERMINISTIC vocabulary detection
 * over the payload's own keys, seeded by the binding's `orderBy` column (the
 * generator always orders a log DESC on its time axis, so that column IS the
 * timestamp). Every helper here is pure and clock-injectable so the template's
 * tests and stories are deterministic (04 §7.7 discipline).
 */

/** Column-name → LogRow-field projection. Absent field ⇔ no matching column. */
export interface LogFieldMap {
  id?: string | undefined;
  ts?: string | undefined;
  actor?: string | undefined;
  category?: string | undefined;
  action?: string | undefined;
  resource?: string | undefined;
  status?: string | undefined;
  code?: string | undefined;
  ip?: string | undefined;
  url?: string | undefined;
}

/** A mapped row that still carries its raw record (trace snippets, keys). */
export type MappedLogRow = LogRow & { raw: Record<string, unknown> };

/**
 * A `record-list` envelope's rows — tolerant of the canonical §3 `{ rows }`,
 * the `{ data }` / `{ snapshot }` shorthands, and a bare array (the same
 * tolerance as the families' own readers, e.g. communication `chatRowsOf`).
 */
export function logRecordRowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null) {
    const envelope = data as { rows?: unknown; data?: unknown; snapshot?: unknown };
    if (Array.isArray(envelope.rows)) return envelope.rows as Record<string, unknown>[];
    if (Array.isArray(envelope.data)) return envelope.data as Record<string, unknown>[];
    if (Array.isArray(envelope.snapshot)) return envelope.snapshot as Record<string, unknown>[];
  }
  return [];
}

/**
 * Detection vocabularies, applied IN THIS ORDER with each column consumed at
 * most once — `level` names both a severity and a category, and mapping it to
 * `status` first is what keeps the Errors filter honest (`isErrorRow` reads
 * status/code, not category).
 */
const FIELD_VOCABULARY: readonly (readonly [keyof LogFieldMap, readonly string[]])[] = [
  ['ts', ['ts', 'created_at', 'timestamp', 'occurred_at', 'logged_at', 'event_time', 'time', 'at', 'updated_at']],
  ['code', ['code', 'status_code', 'http_status', 'response_code']],
  ['status', ['status', 'level', 'severity', 'result', 'outcome', 'state']],
  ['action', ['action', 'event', 'event_type', 'type', 'verb', 'operation', 'message', 'description', 'summary']],
  ['resource', ['resource', 'target', 'entity', 'object', 'record_id', 'table_name', 'endpoint', 'path', 'subject']],
  ['actor', ['actor', 'actor_email', 'user', 'user_email', 'user_name', 'username', 'email', 'author', 'performed_by', 'changed_by']],
  ['category', ['category', 'channel', 'source', 'topic', 'kind', 'scope']],
  ['ip', ['ip', 'ip_address', 'remote_ip', 'client_ip']],
  ['url', ['url', 'href', 'request_url', 'link']],
  ['id', ['id', 'uuid', 'event_id', 'log_id']],
] as const;

/**
 * Detect the LogRow projection from the payload's own keys. `tsHint` (the
 * binding's DESC `orderBy` column) wins the timestamp outright when present in
 * the rows.
 */
export function detectLogFields(
  rows: readonly Record<string, unknown>[],
  tsHint?: string | undefined,
): LogFieldMap {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);

  const map: LogFieldMap = {};
  const used = new Set<string>();
  if (tsHint !== undefined && keys.has(tsHint)) {
    map.ts = tsHint;
    used.add(tsHint);
  }
  for (const [field, candidates] of FIELD_VOCABULARY) {
    if (map[field] !== undefined) continue;
    const hit = candidates.find((name) => keys.has(name) && !used.has(name));
    if (hit === undefined) continue;
    map[field] = hit;
    used.add(hit);
  }
  return map;
}

/** The binding's DESC time axis, if the stored descriptor names one. */
export function tsHintOf(descriptor: QueryDescriptor | null): string | undefined {
  return descriptor?.orderBy?.[0]?.column;
}

function str(row: Record<string, unknown>, field: string | undefined): string | undefined {
  if (field === undefined) return undefined;
  const value = row[field];
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function num(row: Record<string, unknown>, field: string | undefined): number | undefined {
  if (field === undefined) return undefined;
  const value = row[field];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Stable identity for stream dedupe + React keys. */
export function logKeyOf(row: Record<string, unknown>, map: LogFieldMap, index: number): string {
  const id = str(row, map.id ?? 'id');
  if (id !== undefined) return id;
  const ts = str(row, map.ts);
  return ts !== undefined ? `${ts}:${String(index)}` : JSON.stringify(row);
}

/** Project one raw record onto the LogRow anatomy (keeps the raw record). */
export function toMappedLogRow(
  row: Record<string, unknown>,
  map: LogFieldMap,
  index: number,
): MappedLogRow {
  const status = str(row, map.status);
  const code = num(row, map.code);
  return {
    id: logKeyOf(row, map, index),
    ts: str(row, map.ts) ?? '',
    actor: str(row, map.actor),
    category: str(row, map.category),
    action: str(row, map.action),
    resource: str(row, map.resource),
    status,
    code,
    ip: str(row, map.ip),
    url: str(row, map.url),
    raw: row,
  };
}

// ── toolbar filters ──────────────────────────────────────────────────────────

export const LOG_TIME_WINDOWS = [
  { key: 'all', ms: null },
  { key: '1h', ms: 3_600_000 },
  { key: '24h', ms: 86_400_000 },
  { key: '7d', ms: 604_800_000 },
] as const;

export type LogTimeWindowKey = (typeof LOG_TIME_WINDOWS)[number]['key'];

export type LogLevelKey = 'all' | 'errors';

/** Apply the toolbar's level + time filters (09 §7.8) to mapped rows. */
export function filterLogRows(
  rows: readonly MappedLogRow[],
  options: { level: LogLevelKey; window: LogTimeWindowKey; now: number },
): MappedLogRow[] {
  const windowMs = LOG_TIME_WINDOWS.find((entry) => entry.key === options.window)?.ms ?? null;
  return rows.filter((row) => {
    if (options.level === 'errors' && !isErrorRow(row)) return false;
    if (windowMs === null) return true;
    const time = new Date(row.ts).getTime();
    if (Number.isNaN(time)) return true; // unparseable stamps never vanish silently
    return time >= options.now - windowMs;
  });
}

// ── trace detail ─────────────────────────────────────────────────────────────

/** Trace snippet cap — keeps the mono `<pre>` a snippet, not a dump. */
export const TRACE_SNIPPET_MAX = 280;

/**
 * Entries related to a selection: same resource when mapped, else itself.
 * `fallbackTitle` names entries whose row carries neither action nor resource —
 * the render site passes its localized 'Event' (this module stays pure/hookless).
 */
export function traceEntriesOf(
  selected: MappedLogRow,
  rows: readonly MappedLogRow[],
  map: LogFieldMap,
  cap = 12,
  fallbackTitle = 'Event',
): TimelineEntry[] {
  const related =
    map.resource !== undefined && selected.resource !== undefined
      ? rows.filter((row) => row.resource === selected.resource)
      : [selected];
  const ordered = [...related]
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .slice(-cap);

  return ordered.map((row) => {
    const title = [row.action, row.resource].filter((part) => part !== undefined).join(' ') || fallbackTitle;
    const meta = [row.actor, row.category, row.status].filter((part) => part !== undefined).join(' · ');
    const snippet = JSON.stringify(row.raw);
    return {
      id: `trace-${String(row.id)}`,
      title,
      ts: row.ts,
      tone: isErrorRow(row) ? 'danger' : row.id === selected.id ? 'accent' : 'pos',
      ...(meta === '' ? {} : { body: meta }),
      log: snippet.length > TRACE_SNIPPET_MAX ? `${snippet.slice(0, TRACE_SNIPPET_MAX)}…` : snippet,
    };
  });
}
