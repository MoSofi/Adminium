import { latnDataTag } from '@adminium/i18n';
import { Avatar, Badge, IconButton, MonoText, StatusPill } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { Download, RotateCcw, Search, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { formatAbsoluteTime } from './column-spec.js';
import type { WidgetProps } from '../../registry/types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `log-table` (annex §3) — an append-oriented event grid: mono timestamps with
 * Today/Yesterday smart prefixes, actor avatar, category pill, an event
 * sentence with a bold mono resource, an HTTP status/code badge, an optional
 * mono IP/URL, a retry/download/inspect action column, live-tail styling, an
 * All/Errors filter, and substring search. Binds to a DESC-ordered
 * `record-list` over an event/log table.
 */

export const logTableConfigSchema = widgetSharedConfigSchema.extend({
  rowAction: z.enum(['retry', 'download', 'inspect', 'none']).default('inspect'),
  search: z.boolean().default(true),
  filters: z.boolean().default(true),
  liveTail: z.boolean().default(false),
  labels: z
    .object({
      searchPlaceholder: z.string().optional(),
      all: z.string().optional(),
      errors: z.string().optional(),
      live: z.string().optional(),
      retry: z.string().optional(),
      download: z.string().optional(),
      inspect: z.string().optional(),
      emptyTitle: z.string().optional(),
      emptyBody: z.string().optional(),
      noMatches: z.string().optional(),
    })
    .optional(),
});
export type LogTableConfig = z.infer<typeof logTableConfigSchema>;

export interface LogRow {
  id: string | number;
  ts: string;
  actor?: string | undefined;
  category?: string | undefined;
  categoryTone?: string | undefined;
  action?: string | undefined;
  resource?: string | undefined;
  status?: string | undefined;
  code?: number | undefined;
  ip?: string | undefined;
  url?: string | undefined;
}

/** HTTP-family tone for a numeric status code. */
export function codeTone(code: number): Tone {
  if (code >= 500) return 'danger';
  if (code >= 400) return 'warn';
  if (code >= 300) return 'info';
  return 'pos';
}

/** True when a row represents an error (danger/warn status or code ≥ 400). */
export function isErrorRow(row: LogRow): boolean {
  if (row.code !== undefined) return row.code >= 400;
  const s = (row.status ?? '').toLowerCase();
  return s === 'error' || s === 'failed' || s === 'failure' || s === 'denied';
}

/** "Today 14:32" / "Yesterday 09:10" / "Jul 12 08:00" — mono log prefix. */
export function smartTimestamp(iso: string, now: number, locale?: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const startOfDay = (ms: number): number => {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const diff = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  // Data-context tag (latn digits, gregorian) via the format layer — also
  // coalesces an empty/invalid locale, which raw `?? 'en-US'` misses ('' throws).
  const tag = latnDataTag(locale ?? 'en-US');
  const hhmm = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(time);
  if (diff <= 0) return `Today ${hhmm}`;
  if (diff === 1) return `Yesterday ${hhmm}`;
  const md = new Intl.DateTimeFormat(tag, { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(time);
  return `${md} ${hhmm}`;
}

const ROW_ACTION_ICON = { retry: <RotateCcw size={14} />, download: <Download size={14} />, inspect: <Search size={14} /> };

export interface LogTableProps {
  rows: readonly LogRow[];
  rowAction?: LogTableConfig['rowAction'];
  search?: boolean | undefined;
  filters?: boolean | undefined;
  liveTail?: boolean | undefined;
  labels?: LogTableConfig['labels'];
  now?: number | undefined;
  locale?: string | undefined;
  onRowAction?: ((action: 'retry' | 'download' | 'inspect', row: LogRow) => void) | undefined;
  testId?: string | undefined;
}

export function LogTable({
  rows,
  rowAction = 'inspect',
  search = true,
  filters = true,
  liveTail = false,
  labels,
  now,
  locale,
  onRowAction,
  testId,
}: LogTableProps) {
  const clock = now ?? Date.now();
  const [query, setQuery] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (errorsOnly && !isErrorRow(row)) return false;
      if (needle === '') return true;
      const haystack = [row.actor, row.category, row.action, row.resource, row.ip, row.url, row.status]
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, query, errorsOnly]);

  return (
    <div data-widget="log-table" data-testid={testId} className="flex h-full flex-col">
      {(search || filters) && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {liveTail && (
            <span className="inline-flex items-center gap-1.5 text-caption font-bold uppercase tracking-wide text-pos">
              <span aria-hidden="true" className="size-2 rounded-full bg-pos motion-safe:animate-pulse" />
              {labels?.live ?? 'Live'}
            </span>
          )}
          {search && (
            <label className="relative flex min-w-0 flex-1 items-center">
              <Search aria-hidden="true" className="pointer-events-none absolute start-2.5 size-3.5 text-fg-subtle" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={labels?.searchPlaceholder ?? 'Search logs…'}
                className="h-8 w-full rounded-md border border-border bg-surface ps-8 pe-2 text-body-sm text-fg placeholder:text-fg-subtle focus-visible:border-accent focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent"
              />
            </label>
          )}
          {filters && (
            <div className="inline-flex shrink-0 items-center rounded-md bg-surface-2 p-0.5" role="group" aria-label="Log filter">
              {[
                { key: false, label: labels?.all ?? 'All' },
                { key: true, label: labels?.errors ?? 'Errors' },
              ].map((option) => (
                <button
                  key={String(option.key)}
                  type="button"
                  data-active={errorsOnly === option.key}
                  onClick={() => setErrorsOnly(option.key)}
                  className="rounded px-2.5 py-1 text-caption font-semibold text-fg-muted data-[active=true]:bg-surface data-[active=true]:text-fg data-[active=true]:shadow-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <SearchX aria-hidden="true" className="size-6 text-fg-subtle" />
            <p className="text-body-sm font-semibold text-fg">
              {rows.length === 0 ? (labels?.emptyTitle ?? 'No log entries') : (labels?.noMatches ?? 'No matching entries')}
            </p>
            {rows.length === 0 && labels?.emptyBody !== undefined && (
              <p className="max-w-xs text-caption text-fg-muted">{labels.emptyBody}</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {filtered.map((row, index) => (
              <li
                key={row.id}
                data-first={liveTail && index === 0}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 data-[first=true]:bg-pos/[0.05] hover:bg-surface-2/50 sm:grid-cols-[9.5rem_auto_1fr_auto_auto]"
              >
                <MonoText className="col-start-1 whitespace-nowrap text-caption text-fg-subtle" title={formatAbsoluteTime(row.ts, locale)}>
                  {smartTimestamp(row.ts, clock, locale)}
                </MonoText>
                <span className="hidden items-center gap-1.5 sm:flex">
                  {row.actor !== undefined && <Avatar name={row.actor} size="xs" />}
                  {row.category !== undefined && (
                    <Badge tone={(row.categoryTone as Tone | undefined) ?? 'neutral'}>{row.category}</Badge>
                  )}
                </span>
                <span className="col-start-2 min-w-0 truncate text-body-sm text-fg-muted sm:col-start-3">
                  {row.action !== undefined && <span>{row.action} </span>}
                  {row.resource !== undefined && <MonoText className="font-semibold text-fg">{row.resource}</MonoText>}
                  {(row.ip ?? row.url) !== undefined && (
                    <MonoText className="ms-2 text-caption text-fg-subtle">{row.ip ?? row.url}</MonoText>
                  )}
                </span>
                <span className="justify-self-end">
                  {row.code !== undefined ? (
                    <Badge tone={codeTone(row.code)} className="font-mono">{row.code}</Badge>
                  ) : row.status !== undefined ? (
                    <StatusPill status={row.status} />
                  ) : null}
                </span>
                {rowAction !== 'none' && (
                  <IconButton
                    size="sm"
                    label={labels?.[rowAction] ?? rowAction}
                    className="justify-self-end"
                    onClick={() => onRowAction?.(rowAction, row)}
                  >
                    {ROW_ACTION_ICON[rowAction]}
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function logRowsOf(data: unknown): LogRow[] {
  const raw = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: unknown[] }).data
      : [];
  return raw.map((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      id: (row['id'] as string | number | undefined) ?? index,
      ts: typeof row['ts'] === 'string' ? row['ts'] : typeof row['created_at'] === 'string' ? (row['created_at'] as string) : new Date().toISOString(),
      actor: typeof row['actor'] === 'string' ? row['actor'] : undefined,
      category: typeof row['category'] === 'string' ? row['category'] : undefined,
      categoryTone: typeof row['categoryTone'] === 'string' ? row['categoryTone'] : undefined,
      action: typeof row['action'] === 'string' ? row['action'] : undefined,
      resource: typeof row['resource'] === 'string' ? row['resource'] : undefined,
      status: typeof row['status'] === 'string' ? row['status'] : undefined,
      code: typeof row['code'] === 'number' ? row['code'] : undefined,
      ip: typeof row['ip'] === 'string' ? row['ip'] : undefined,
      url: typeof row['url'] === 'string' ? row['url'] : undefined,
    };
  });
}

export function LogTableWidget({ config, data, onEvent }: WidgetProps<LogTableConfig>) {
  const source = config.binding;
  const table = source === undefined ? undefined : source.source.schema === undefined ? source.source.name : `${source.source.schema}.${source.source.name}`;
  return (
    <LogTable
      rows={logRowsOf(data)}
      rowAction={config.rowAction}
      search={config.search}
      filters={config.filters}
      liveTail={config.liveTail}
      {...(config.labels === undefined ? {} : { labels: config.labels })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.format?.referenceTime === undefined ? {} : { now: config.format.referenceTime })}
      onRowAction={(action, row) => {
        if (action === 'inspect' && table !== undefined && source !== undefined) {
          onEvent({ type: 'record-open', connectionId: source.connectionId, table, recordId: row.id });
        }
      }}
    />
  );
}

const LOG_TEMPLATES = [
  { category: 'auth', categoryTone: 'info', action: 'signed in', resource: 'session/9f2a', status: 'success', ip: '203.0.113.7' },
  { category: 'billing', categoryTone: 'warn', action: 'charge failed for', resource: 'sub_4821', code: 402 },
  { category: 'api', categoryTone: 'neutral', action: 'POST', resource: '/v1/orders', code: 201 },
  { category: 'webhook', categoryTone: 'accent', action: 'delivered', resource: 'order.paid', code: 200 },
  { category: 'api', categoryTone: 'neutral', action: 'GET', resource: '/v1/reports', code: 500 },
  { category: 'security', categoryTone: 'danger', action: 'blocked request from', resource: 'bot/crawler', status: 'denied', ip: '198.51.100.4' },
  { category: 'export', categoryTone: 'info', action: 'generated', resource: 'customers.csv', status: 'success' },
] as const;
const LOG_ACTORS = ['Ada Lovelace', 'System', 'api-gw', 'Grace Hopper', 'cron'] as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic DESC-ordered `record-list` of log rows (04 §7.7). */
export function logTableDemoData(seed: number): { data: LogRow[] } {
  const random = mulberry32(seed || 1);
  const base = Date.UTC(2026, 6, 14, 14, 30, 0);
  const data: LogRow[] = Array.from({ length: 12 }, (_, index) => {
    const template = LOG_TEMPLATES[Math.floor(random() * LOG_TEMPLATES.length) % LOG_TEMPLATES.length]!;
    return {
      id: index + 1,
      ts: new Date(base - index * 47 * 60_000 - Math.floor(random() * 60) * 1000).toISOString(),
      actor: LOG_ACTORS[Math.floor(random() * LOG_ACTORS.length) % LOG_ACTORS.length]!,
      ...template,
    };
  });
  return { data };
}
