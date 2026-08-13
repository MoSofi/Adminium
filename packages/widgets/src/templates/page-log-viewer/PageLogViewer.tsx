import { Button, EmptyState, Spinner } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useMemo, useState } from 'react';

import {
  LOG_TIME_WINDOWS,
  detectLogFields,
  filterLogRows,
  logKeyOf,
  logRecordRowsOf,
  toMappedLogRow,
  traceEntriesOf,
  tsHintOf,
  type LogLevelKey,
  type LogTimeWindowKey,
  type MappedLogRow,
} from './log-mapping.js';
import { useWidgetStream } from '../../binding/useWidgetStream.js';
import type { StreamTransport } from '../../binding/stream-types.js';
import { LogTable } from '../../families/tables/LogTable.js';
import { TimelineVertical } from '../../families/feeds/TimelineVertical.js';
import { WidgetHost, type WidgetDataState } from '../../frame/WidgetHost.js';
import { pageLayoutSchema, queryDescriptorSchema, type PageLayout, type QueryDescriptor } from '../../page-config/index.js';
import type { LayoutItem } from '../../page-config/layout.js';
import type { WidgetEvent } from '../../registry/types.js';
import {
  useDashboardData,
  type DashboardDataAdapter,
  type DashboardDataStates,
} from '../page-dashboard/data-adapter.js';

/**
 * `page-log-viewer` template renderer (09-generated-app.md §7.8; annex §14 —
 * comps: Audit Log / Webhooks Log / Workflow Logs).
 *
 * Renders the stored `config.layout` of a log archetype page: the KPI band via
 * `WidgetHost` (per-instance states, demo fallback — the page-dashboard
 * resolution), the required `log` slot as a directly-composed `log-table`
 * (families/tables) under a template toolbar carrying the LEVEL (All/Errors)
 * and TIME (All/1h/24h/7d) filters, and the `trace` slot as
 * `timeline-vertical`. Selecting a row (the log-table's inspect action) swaps
 * the trace pane to the selection's related events — per-step status dots +
 * mono snippets (§7.8) — with a clear-selection control.
 *
 * LIVE TAIL (§7.8 "live tail (WS `stream`)"): when the host passes
 * `liveChannel` (`widget-data:{connectionId}:{table}`, from the log binding's
 * source), the template folds realtime record events into the snapshot through
 * `useWidgetStream` over the injected StreamTransport, renders the Live pill,
 * and offers Pause/Resume with a held-events counter. Without a channel the
 * page is a plain fetched log — stories and demo mode need no socket.
 */

export const PAGE_LOG_VIEWER_TEMPLATE_ID = 'page-log-viewer';

export interface PageLogViewerLabels {
  live?: string | undefined;
  pause?: string | undefined;
  resume?: string | undefined;
  all?: string | undefined;
  errors?: string | undefined;
  traceTitle?: string | undefined;
  latestTitle?: string | undefined;
  clearSelection?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  loadFailed?: string | undefined;
  retry?: string | undefined;
}

/**
 * Literal bundle key per time window (`all` reuses the shared filter-bar "All").
 * Indexed rather than assembled so the extractor sees each key and a fifth
 * `LOG_TIME_WINDOWS` entry is a compile error, not a raw dotted string in the
 * toolbar (10 §2.5).
 */
const WINDOW_KEY = {
  all: 'ui:widgets.forms.filterChipBar.all',
  '1h': 'ui:templates.logViewer.window.1h',
  '24h': 'ui:templates.logViewer.window.24h',
  '7d': 'ui:templates.logViewer.window.7d',
} as const satisfies Record<LogTimeWindowKey, string>;

export interface PageLogViewerProps {
  /** The page's `config.layout` document (raw — validated here). */
  layout: unknown;
  /** Transport for bound widgets; absent → demo mode (04 §5.3). */
  adapter?: DashboardDataAdapter | undefined;
  /** Page-control params forwarded to every binding. */
  params?: Record<string, unknown> | undefined;
  /** Host/test override — wins over adapter/demo resolution per instance. */
  states?: DashboardDataStates | undefined;
  /** `widget-data:{connectionId}:{table}` — enables the live tail. */
  liveChannel?: string | undefined;
  /** Explicit transport override (tests/stories); defaults to context. */
  streamTransport?: StreamTransport | undefined;
  /** Widget events (record-open, drill-through) bubble here. */
  onEvent?: ((instanceId: string, event: WidgetEvent) => void) | undefined;
  /** Injectable clock for the time filter + smart timestamps (tests). */
  now?: number | undefined;
  locale?: string | undefined;
  labels?: PageLogViewerLabels | undefined;
  className?: string | undefined;
  testId?: string | undefined;
}

const EMPTY_LAYOUT: PageLayout = { version: 1, items: [] };

const LOG_WIDGET_IDS = new Set(['log-table', 'realtime-feed']);

/** Split the layout into the roles this template renders. */
export function classifyLogViewerItems(layout: PageLayout): {
  log: LayoutItem | null;
  trace: LayoutItem | null;
  stats: LayoutItem[];
} {
  const items = layout.items;
  const log =
    items.find((item) => LOG_WIDGET_IDS.has(item.widget)) ??
    items.find((item) => item.i === 'log') ??
    null;
  const trace =
    items.find((item) => item !== log && (item.widget === 'timeline-vertical' || item.i === 'trace')) ?? null;
  const stats = items.filter((item) => item !== log && item !== trace);
  return { log, trace, stats };
}

function descriptorOf(item: LayoutItem | null): QueryDescriptor | null {
  if (item === null) return null;
  const parsed = queryDescriptorSchema.safeParse(item.config['binding']);
  return parsed.success ? parsed.data : null;
}

export function PageLogViewer({
  layout,
  adapter,
  params,
  states,
  liveChannel,
  streamTransport,
  onEvent,
  now,
  locale,
  labels,
  className,
  testId,
}: PageLogViewerProps) {
  const t = useMaybeT();
  const parsed = useMemo(() => {
    const result = pageLayoutSchema.safeParse(layout);
    if (result.success) return { layout: result.data, invalid: false };
    return { layout: EMPTY_LAYOUT, invalid: true };
  }, [layout]);

  const dataStates = useDashboardData(parsed.layout, adapter, params);
  const stateFor = (instanceId: string): WidgetDataState =>
    states?.[instanceId] ?? dataStates[instanceId] ?? { status: 'loading' };

  const { log, trace, stats } = useMemo(() => classifyLogViewerItems(parsed.layout), [parsed.layout]);
  const logState = log === null ? null : stateFor(log.i);
  const descriptor = useMemo(() => descriptorOf(log), [log]);

  // --- rows + field detection -------------------------------------------------
  const snapshotRows = useMemo(
    () => (logState?.status === 'success' ? logRecordRowsOf(logState.data) : []),
    [logState?.status, logState?.data],
  );
  const fieldMap = useMemo(
    () => detectLogFields(snapshotRows, tsHintOf(descriptor)),
    [snapshotRows, descriptor],
  );

  // --- live tail ----------------------------------------------------------------
  // The channel gates on snapshot readiness: useWidgetStream re-seeds its buffer
  // on channel change, so flipping undefined → channel AFTER the fetch lands
  // seeds the buffer with the real rows instead of the initial empty state.
  const ready = logState?.status === 'success';
  const stream = useWidgetStream<Record<string, unknown>>({
    channel: ready ? liveChannel : undefined,
    snapshot: snapshotRows,
    getKey: (row) => logKeyOf(row, fieldMap, 0),
    ...(streamTransport === undefined ? {} : { transport: streamTransport }),
  });
  const live = liveChannel !== undefined;
  const rawRows = live ? stream.items : snapshotRows;

  const mappedRows = useMemo(
    () => rawRows.map((row, index) => toMappedLogRow(row, fieldMap, index)),
    [rawRows, fieldMap],
  );

  // --- toolbar filters (09 §7.8: level/time in the toolbar) --------------------
  const [level, setLevel] = useState<LogLevelKey>('all');
  const [window, setWindow] = useState<LogTimeWindowKey>('all');
  const clock = now ?? Date.now();
  const visibleRows = useMemo(
    () => filterLogRows(mappedRows, { level, window, now: clock }),
    [mappedRows, level, window, clock],
  );

  // --- trace selection ----------------------------------------------------------
  const [selected, setSelected] = useState<MappedLogRow | null>(null);
  const traceState = trace === null ? null : stateFor(trace.i);

  if (parsed.invalid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-log-viewer-invalid">
        {t(
          'ui:templates.logViewer.invalidLayout',
          'This log page’s stored layout is invalid. Regenerate the page or reset its layout.',
        )}
      </p>
    );
  }

  return (
    <div data-part="page-log-viewer" data-testid={testId} className={`flex h-full min-h-0 flex-col gap-4 ${className ?? ''}`}>
      {/* KPI band — hosted instances with per-item states/demo (04 §5.3). */}
      {stats.length > 0 && (
        <div data-part="log-kpi-row" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((item) => (
            <div key={item.i} className="min-h-28">
              <WidgetHost
                widgetId={item.widget}
                instanceId={item.i}
                config={item.config}
                data={stateFor(item.i)}
                onEvent={onEvent === undefined ? undefined : (event) => onEvent(item.i, event)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Toolbar — level + time filters, live tail controls (09 §7.8). */}
      <div data-part="log-toolbar" className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex items-center rounded-md bg-surface-2 p-0.5"
          role="group"
          aria-label={t('ui:templates.logViewer.levelFilterLabel', 'Log level filter')}
        >
          {(
            [
              { key: 'all' as const, label: labels?.all ?? t('ui:widgets.forms.filterChipBar.all', 'All') },
              { key: 'errors' as const, label: labels?.errors ?? t('ui:widgets.tables.logTable.errorsLabel', 'Errors') },
            ]
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              data-part="level-filter"
              data-level={option.key}
              data-active={level === option.key}
              onClick={() => setLevel(option.key)}
              className="rounded px-2.5 py-1 text-caption font-semibold text-fg-muted data-[active=true]:bg-surface data-[active=true]:text-fg data-[active=true]:shadow-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              {option.label}
            </button>
          ))}
        </div>

        <div
          className="inline-flex items-center rounded-md bg-surface-2 p-0.5"
          role="group"
          aria-label={t('ui:templates.logViewer.timeFilterLabel', 'Time window filter')}
        >
          {LOG_TIME_WINDOWS.map((option) => (
            <button
              key={option.key}
              type="button"
              data-part="time-filter"
              data-window={option.key}
              data-active={window === option.key}
              onClick={() => setWindow(option.key)}
              className="rounded px-2.5 py-1 font-mono text-caption font-semibold text-fg-muted data-[active=true]:bg-surface data-[active=true]:text-fg data-[active=true]:shadow-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              {option.key === 'all'
                ? (labels?.all ?? t(WINDOW_KEY.all, 'All'))
                : t(WINDOW_KEY[option.key], option.key)}
            </button>
          ))}
        </div>

        <div className="ms-auto flex items-center gap-2">
          {live && stream.paused && stream.unread > 0 && (
            <span data-part="held-count" className="font-mono text-caption text-fg-subtle">
              {t('ui:templates.logViewer.heldCount', '+{count}', { count: String(stream.unread) })}
            </span>
          )}
          {live && (
            <Button
              size="sm"
              variant="secondary"
              data-part="tail-toggle"
              onClick={() => {
                // Zero the unread counter when pausing, so the badge counts
                // exactly the events held while paused ("+N while paused").
                if (!stream.paused) stream.markRead();
                stream.setPaused(!stream.paused);
              }}
            >
              {stream.paused
                ? (labels?.resume ?? t('ui:widgets.feeds.realtimeFeed.resumeLabel', 'Resume'))
                : (labels?.pause ?? t('ui:widgets.feeds.realtimeFeed.pauseLabel', 'Pause'))}
            </Button>
          )}
        </div>
      </div>

      {/* The log itself — the manifest's required slot. */}
      <div data-part="log-panel" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        {log === null ? (
          <EmptyState
            preset="no-data"
            title={labels?.emptyTitle ?? t('ui:templates.logViewer.missingSlotTitle', 'No log widget on this page')}
            body={t('ui:templates.logViewer.missingSlotBody', 'The stored layout has no log slot. Regenerate the page.')}
          />
        ) : logState?.status === 'error' ? (
          <EmptyState
            tone="danger"
            title={labels?.loadFailed ?? t('ui:templates.logViewer.loadFailed', 'The log query failed')}
            body={logState.error instanceof Error ? logState.error.message : undefined}
            actions={
              logState.refetch === undefined ? undefined : (
                <Button size="sm" variant="secondary" onClick={logState.refetch}>
                  {labels?.retry ?? t('ui:action.retry', 'Retry')}
                </Button>
              )
            }
          />
        ) : logState?.status === 'loading' ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner label={t('ui:templates.logViewer.loading', 'Loading log entries')} />
          </div>
        ) : (
          <LogTable
            rows={visibleRows}
            search
            filters={false}
            liveTail={live && stream.connected && !stream.paused}
            now={clock}
            {...(locale === undefined ? {} : { locale })}
            labels={{
              live: labels?.live ?? t('ui:widgets.tables.logTable.liveLabel', 'Live'),
              emptyTitle: labels?.emptyTitle ?? t('ui:widgets.tables.logTable.emptyTitle', 'No log entries'),
              ...(labels?.emptyBody === undefined ? {} : { emptyBody: labels.emptyBody }),
            }}
            rowAction="inspect"
            onRowAction={(_action, row) => {
              setSelected((row as MappedLogRow | undefined) ?? null);
            }}
            testId="page-log-viewer-table"
          />
        )}
      </div>

      {/* Trace slot — selection-driven per-step trace, else the slot's widget. */}
      {(trace !== null || selected !== null) && (
        <div data-part="trace-panel" className="flex max-h-80 min-h-40 flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
            <h3 className="min-w-0 flex-1 truncate text-body-sm font-bold text-fg">
              {selected !== null
                ? `${labels?.traceTitle ?? t('ui:templates.logViewer.traceTitle', 'Trace')} · ${String(selected.resource ?? selected.action ?? selected.id)}`
                : (labels?.latestTitle ?? t('ui:templates.logViewer.latestTitle', 'Latest activity'))}
            </h3>
            {selected !== null && (
              <Button size="sm" variant="ghost" data-part="trace-clear" onClick={() => setSelected(null)}>
                {labels?.clearSelection ?? t('ui:templates.logViewer.backToLatest', 'Back to latest')}
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {selected !== null ? (
              <TimelineVertical
                entries={traceEntriesOf(
                  selected,
                  mappedRows,
                  fieldMap,
                  undefined,
                  t('ui:templates.logViewer.eventFallback', 'Event'),
                )}
                variant="trace"
                now={clock}
                {...(locale === undefined ? {} : { locale })}
                testId="page-log-viewer-trace"
              />
            ) : trace !== null ? (
              <WidgetHost
                widgetId={trace.widget}
                instanceId={trace.i}
                config={trace.config}
                data={traceState ?? { status: 'loading' }}
                onEvent={onEvent === undefined ? undefined : (event) => onEvent(trace.i, event)}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
