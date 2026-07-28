import { useMaybeT } from '@adminium/i18n/react';
import { Button, EmptyState, Spinner, StatusPill } from '@adminium/ui';
import { useCallback, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { WidgetHost } from '../../frame/WidgetHost.js';
import type { WidgetDataState } from '../../frame/WidgetHost.js';
import { DetailKeyValue } from '../../families/tables/DetailKeyValue.js';
import { formatRelativeTime, uiToneOf } from '../../families/tables/column-spec.js';
import type { WidgetEvent } from '../../registry/types.js';
import {
  useDashboardData,
  type DashboardDataAdapter,
  type DashboardDataStates,
} from '../page-dashboard/data-adapter.js';
import {
  SUBTITLE_FIELD_CANDIDATES,
  TITLE_FIELD_CANDIDATES,
  UPDATED_FIELD_CANDIDATES,
  bridgeFieldConfig,
  cellText,
  configString,
  enumTonesOf,
  guessField,
  humanizeName,
  itemTableOf,
  parseTemplateBody,
  recordRowsOf,
  slotItemOf,
  specsForRecord,
  type TemplateBody,
} from '../stored-config.js';
import type { GridRow, GridTone, LayoutItem } from '../../page-config/index.js';

/**
 * `page-master-detail` — the split-view archetype (09-generated-app.md §7.3;
 * annex §14 "Ticket Queue, Workflow Logs, AB Experiments, Audience Segments"):
 * a `master` rail whose selection drives the sticky `detail` pane, a status
 * filter-chip bar with live facet counts, `J`/`K` selection movement, and a
 * derived micro-KPI subtitle ("3 open · 2 pending").
 *
 * Detail pane composition follows the manifest: `detail-key-value` renders the
 * selected record's fields client-side (the record is already in the master
 * payload — no second round trip); a DOMAIN card in the slot (`gantt-chart`,
 * `chat-thread`, `org-chart`, …) mounts through WidgetHost over its own stored
 * binding, with generator `*Column` keys bridged onto the widget's `*Field`
 * schema. The optional `detail-activity` slot mounts below the pane.
 *
 * M7-T04 comp fixes carried here: every enum pill tint comes from the stored
 * `enumTones` map flowing through config — never a hardcoded tone — and the
 * filtered zero-match state is `no-matches` + "Clear filters", distinct from
 * the first-use `no-data` state (research/ia-mapping.md §5, Ticket Queue).
 */

export const PAGE_MASTER_DETAIL_TEMPLATE_ID = 'page-master-detail';

const MASTER_WIDGETS = ['master-list'] as const;
const DETAIL_WIDGETS = ['detail-key-value', 'chat-thread', 'org-chart', 'gantt-chart'] as const;
const ACTIVITY_WIDGETS = ['timeline-vertical', 'activity-feed'] as const;

const PRIORITY_FIELD_CANDIDATES = ['priority', 'severity', 'urgency'] as const;
const PROGRESS_FIELD_CANDIDATES = ['progress', 'pct', 'completion'] as const;

export interface PageMasterDetailLabels {
  allFilter?: string | undefined;
  clearFilters?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  noMatchesTitle?: string | undefined;
  noMatchesBody?: string | undefined;
  errorTitle?: string | undefined;
  retry?: string | undefined;
  loading?: string | undefined;
  selectPrompt?: string | undefined;
}

export interface PageMasterDetailProps {
  /** The stored page config body (`{ layout, toolbar, overlays, … }`). */
  config: unknown;
  adapter?: DashboardDataAdapter | undefined;
  params?: Record<string, unknown> | undefined;
  states?: DashboardDataStates | undefined;
  /** Route-controlled selection (deep links restore it — 09 §7.3). */
  selectedId?: string | null | undefined;
  onSelectedChange?: ((recordId: string | null) => void) | undefined;
  onEvent?: ((instanceId: string, event: WidgetEvent) => void | Promise<unknown>) | undefined;
  labels?: PageMasterDetailLabels | undefined;
  locale?: string | undefined;
  /** Injectable clock for deterministic relative timestamps. */
  now?: number | undefined;
  testId?: string | undefined;
}

interface MasterFields {
  titleField: string;
  subtitleField: string | undefined;
  statusField: string | undefined;
  priorityField: string | undefined;
  progressField: string | undefined;
  updatedField: string | undefined;
  enumTones: Record<string, GridTone> | undefined;
}

function masterFieldsOf(item: LayoutItem | undefined, rows: readonly GridRow[]): MasterFields {
  const config = item?.config ?? {};
  return {
    titleField:
      configString(config, 'titleField', 'titleColumn') ?? guessField(rows, TITLE_FIELD_CANDIDATES) ?? 'name',
    subtitleField:
      configString(config, 'subtitleField', 'subtitleColumn') ?? guessField(rows, SUBTITLE_FIELD_CANDIDATES),
    statusField: configString(config, 'statusField', 'statusColumn', 'groupBy'),
    priorityField:
      configString(config, 'priorityField', 'priorityColumn') ?? guessField(rows, PRIORITY_FIELD_CANDIDATES),
    progressField:
      configString(config, 'progressField', 'progressColumn') ?? guessField(rows, PROGRESS_FIELD_CANDIDATES),
    updatedField: configString(config, 'updatedField') ?? guessField(rows, UPDATED_FIELD_CANDIDATES),
    enumTones: enumTonesOf(config),
  };
}

function rowIdText(row: GridRow, index: number): string {
  const id = row['id'];
  return typeof id === 'string' || typeof id === 'number' ? String(id) : String(index);
}

/** "3 open · 2 pending" — the §7.3 derived micro-KPI subtitle. */
export function deriveStatusSubtitle(rows: readonly GridRow[], statusField: string | undefined): string | null {
  if (statusField === undefined || rows.length === 0) return null;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = cellText(row[statusField]);
    if (value === undefined) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
  if (top.length === 0) return null;
  return top.map(([value, count]) => `${String(count)} ${humanizeName(value).toLowerCase()}`).join(' · ');
}

export function PageMasterDetail({
  config,
  adapter,
  params,
  states,
  selectedId,
  onSelectedChange,
  onEvent,
  labels,
  locale,
  now,
  testId,
}: PageMasterDetailProps) {
  const t = useMaybeT();
  const body: TemplateBody = useMemo(() => parseTemplateBody(config), [config]);
  const dataStates = useDashboardData(body.layout, adapter, params);
  const stateFor = useCallback(
    (item: LayoutItem | undefined): WidgetDataState =>
      item === undefined
        ? { status: 'loading' }
        : (states?.[item.i] ?? dataStates[item.i] ?? { status: 'loading' }),
    [states, dataStates],
  );

  const masterItem = useMemo(() => slotItemOf(body.layout, 'master', MASTER_WIDGETS), [body.layout]);
  const detailItem = useMemo(() => slotItemOf(body.layout, 'detail', DETAIL_WIDGETS), [body.layout]);
  const activityItem = useMemo(
    () => slotItemOf(body.layout, 'detail-activity', ACTIVITY_WIDGETS),
    [body.layout],
  );

  const masterState = stateFor(masterItem);
  const rows = useMemo(() => recordRowsOf(masterState.data), [masterState.data]);
  const fields = useMemo(() => masterFieldsOf(masterItem, rows), [masterItem, rows]);

  // --- filter chips (live facet counts) ---------------------------------------
  const [filter, setFilter] = useState<string | null>(null);
  const facets = useMemo(() => {
    if (fields.statusField === undefined) return [];
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = cellText(row[fields.statusField as string]);
      if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [rows, fields.statusField]);

  const visibleRows = useMemo(
    () =>
      filter === null || fields.statusField === undefined
        ? rows
        : rows.filter((row) => cellText(row[fields.statusField as string]) === filter),
    [rows, filter, fields.statusField],
  );

  // --- selection ---------------------------------------------------------------
  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const controlled = selectedId !== undefined;
  const chosen = controlled ? selectedId : internalSelected;
  const select = useCallback(
    (next: string | null) => {
      setInternalSelected(next);
      onSelectedChange?.(next);
    },
    [onSelectedChange],
  );
  // Display default: first visible row when nothing is chosen. Deliberately
  // NOT pushed through onSelectedChange — a deep link must not be rewritten
  // by a render-time default.
  const firstVisibleId = visibleRows.length === 0 ? null : rowIdText(visibleRows[0] as GridRow, 0);
  const effectiveSelected = chosen ?? firstVisibleId;
  const selectedRow = useMemo(
    () => visibleRows.find((row, index) => rowIdText(row, index) === effectiveSelected) ??
      rows.find((row, index) => rowIdText(row, index) === effectiveSelected),
    [visibleRows, rows, effectiveSelected],
  );

  const emitOpen = useCallback(
    (recordId: string) => {
      const scope = itemTableOf(masterItem);
      if (scope !== undefined && masterItem !== undefined) {
        void onEvent?.(masterItem.i, {
          type: 'record-open',
          connectionId: scope.connectionId,
          table: scope.table,
          recordId,
        });
      }
    },
    [masterItem, onEvent],
  );

  // J/K move selection (09 §7.3) — list navigation, not a global hotkey.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'j' && event.key !== 'k') return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]') !== null) return;
      if (visibleRows.length === 0) return;
      const currentIndex = visibleRows.findIndex((row, index) => rowIdText(row, index) === effectiveSelected);
      const nextIndex =
        event.key === 'j'
          ? Math.min(visibleRows.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1);
      const nextRow = visibleRows[nextIndex];
      if (nextRow !== undefined) {
        event.preventDefault();
        select(rowIdText(nextRow, nextIndex));
      }
    },
    [visibleRows, effectiveSelected, select],
  );

  const subtitle = useMemo(
    () => deriveStatusSubtitle(rows, fields.statusField),
    [rows, fields.statusField],
  );

  const toneFor = useCallback(
    (value: string | undefined) =>
      value === undefined || fields.enumTones?.[value] === undefined
        ? undefined
        : uiToneOf(fields.enumTones[value] as GridTone),
    [fields.enumTones],
  );

  const detailSpecs = useMemo(() => {
    if (selectedRow === undefined) return [];
    const toneFields: Record<string, Record<string, GridTone> | undefined> = {};
    if (fields.statusField !== undefined) toneFields[fields.statusField] = fields.enumTones;
    if (fields.priorityField !== undefined) toneFields[fields.priorityField] = fields.enumTones;
    return specsForRecord(selectedRow, { toneFields, displayField: fields.titleField });
  }, [selectedRow, fields]);

  if (!body.valid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-master-detail-invalid">
        {t(
          'ui:templates.masterDetail.invalidConfig',
          'This page’s stored configuration is invalid. Regenerate the page to restore it.',
        )}
      </p>
    );
  }

  const domainDetail = detailItem !== undefined && detailItem.widget !== 'detail-key-value';
  const masterTitle =
    configString(masterItem?.config ?? {}, 'title') ?? t('ui:templates.masterDetail.railTitle', 'Records');
  const selectedStatus =
    selectedRow === undefined || fields.statusField === undefined
      ? undefined
      : cellText(selectedRow[fields.statusField]);
  const selectedStatusTone = toneFor(selectedStatus);

  return (
    <div
      data-part="page-master-detail"
      data-testid={testId}
      className="flex h-full min-h-0 flex-col"
      onKeyDown={onKeyDown}
    >
      {/* Filter chip bar with live facet counts (§7.3). */}
      {facets.length > 0 && (
        <div
          role="group"
          aria-label={t('ui:widgets.forms.filterChipBar.a11yLabel', 'Filter')}
          className="flex min-h-10 flex-wrap items-center gap-1.5 pb-3"
        >
          {[null, ...facets.map(([value]) => value)].map((value) => {
            const count = value === null ? rows.length : (facets.find(([v]) => v === value)?.[1] ?? 0);
            return (
              <button
                key={value ?? '__all__'}
                type="button"
                data-active={filter === value}
                onClick={() => setFilter(value)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-caption font-semibold text-fg-muted data-[active=true]:border-accent data-[active=true]:bg-accent-soft data-[active=true]:text-accent hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              >
                {value === null
                  ? (labels?.allFilter ?? t('ui:widgets.forms.filterChipBar.all', 'All'))
                  : humanizeName(value)}
                <span className="font-mono tabular-nums text-fg-subtle">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Master rail. */}
        <section
          aria-label={masterTitle}
          className="flex w-1/3 min-w-64 max-w-96 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface"
        >
          <header className="border-b border-border px-3 py-2.5">
            <h3 className="truncate text-body-sm font-bold text-fg">{masterTitle}</h3>
            {subtitle !== null && (
              <p data-part="master-subtitle" className="mt-0.5 truncate font-mono text-caption tabular-nums text-fg-subtle">
                {subtitle}
              </p>
            )}
          </header>
          {masterState.status === 'error' ? (
            <EmptyState
              compact
              tone="danger"
              title={labels?.errorTitle ?? t('ui:templates.masterDetail.errorTitle', 'This list failed to load')}
              body={masterState.error instanceof Error ? masterState.error.message : undefined}
              actions={
                masterState.refetch === undefined ? undefined : (
                  <Button size="sm" variant="secondary" onClick={masterState.refetch}>
                    {labels?.retry ?? t('ui:action.retry', 'Retry')}
                  </Button>
                )
              }
            />
          ) : masterState.status === 'loading' ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <Spinner label={labels?.loading ?? t('ui:templates.masterDetail.loading', 'Loading records')} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              compact
              preset="no-data"
              title={labels?.emptyTitle ?? t('ui:state.empty', 'Nothing here yet')}
              body={labels?.emptyBody ?? t('ui:templates.masterDetail.emptyBody', 'Records appear here as rows land in the table.')}
            />
          ) : visibleRows.length === 0 ? (
            // Filtered empty — distinct from first-use (M7-T04 / ia-mapping §5).
            <EmptyState
              compact
              preset="no-matches"
              title={labels?.noMatchesTitle ?? t('ui:templates.masterDetail.noMatchesTitle', 'No matching records')}
              body={labels?.noMatchesBody ?? t('ui:templates.masterDetail.noMatchesBody', 'Try removing a filter.')}
              actions={
                <Button size="sm" variant="secondary" onClick={() => setFilter(null)}>
                  {labels?.clearFilters ?? t('ui:templates.common.clearFilters', 'Clear filters')}
                </Button>
              }
            />
          ) : (
            <ul data-part="master-rail" className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
              {visibleRows.map((row, index) => {
                const id = rowIdText(row, index);
                const title = cellText(row[fields.titleField]) ?? id;
                const status =
                  fields.statusField === undefined ? undefined : cellText(row[fields.statusField]);
                const priority =
                  fields.priorityField === undefined ? undefined : cellText(row[fields.priorityField]);
                const rowSubtitle =
                  fields.subtitleField === undefined ? undefined : cellText(row[fields.subtitleField]);
                const updated =
                  fields.updatedField === undefined ? undefined : cellText(row[fields.updatedField]);
                const priorityTone = toneFor(priority);
                const statusTone = toneFor(status);
                const isSelected = effectiveSelected === id;
                return (
                  <li key={id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-current={isSelected ? true : undefined}
                      data-selected={isSelected}
                      onClick={() => {
                        select(id);
                        emitOpen(id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          select(id);
                          emitOpen(id);
                        }
                      }}
                      className="flex flex-col gap-1 border-s-2 border-transparent px-3 py-2.5 data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft/60 hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-fg">{title}</span>
                        {priority !== undefined && (
                          // Priority tint flows from the stored enumTones map —
                          // never hardcoded (M7-T04, Ticket Queue defect).
                          <StatusPill
                            status={priority}
                            {...(priorityTone === undefined ? {} : { tone: priorityTone })}
                            data-part="priority-pill"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {status !== undefined && (
                          <StatusPill
                            status={status}
                            {...(statusTone === undefined ? {} : { tone: statusTone })}
                            data-part="status-pill"
                          />
                        )}
                        {rowSubtitle !== undefined && (
                          <span className="min-w-0 truncate text-caption text-fg-muted">{rowSubtitle}</span>
                        )}
                        {updated !== undefined && (
                          <span className="ms-auto shrink-0 font-mono text-caption tabular-nums text-fg-subtle">
                            {formatRelativeTime(updated, { ...(locale === undefined ? {} : { locale }), ...(now === undefined ? {} : { now }) })}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Detail pane (sticky — the rail scrolls independently). */}
        <section
          aria-label={t('ui:templates.common.detailLabel', 'Detail')}
          className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto"
        >
          {domainDetail ? (
            <div className="min-h-80">
              <WidgetHost
                widgetId={detailItem.widget}
                instanceId={detailItem.i}
                config={bridgeFieldConfig(detailItem.config)}
                data={stateFor(detailItem)}
                onEvent={onEvent === undefined ? undefined : (event) => void onEvent(detailItem.i, event)}
              />
            </div>
          ) : selectedRow === undefined ? (
            <div className="flex flex-1 flex-col justify-center rounded-lg border border-border bg-surface">
              <EmptyState
                compact
                preset="no-data"
                title={labels?.selectPrompt ?? t('ui:templates.masterDetail.selectPrompt', 'Select a record')}
                body={labels?.emptyBody ?? t('ui:templates.masterDetail.selectBody', 'Choose an item from the list to see its details.')}
              />
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface" data-part="detail-pane">
              <header className="flex items-center gap-2 border-b border-border px-4 py-3">
                <h3 className="min-w-0 flex-1 truncate text-body-sm font-bold text-fg">
                  {cellText(selectedRow[fields.titleField]) ?? effectiveSelected}
                </h3>
                {selectedStatus !== undefined && (
                  <StatusPill
                    status={selectedStatus}
                    {...(selectedStatusTone === undefined ? {} : { tone: selectedStatusTone })}
                  />
                )}
              </header>
              <DetailKeyValue columns={detailSpecs} record={selectedRow} testId="master-detail-record" />
            </div>
          )}

          {activityItem !== undefined && (
            <div className="min-h-56">
              <WidgetHost
                widgetId={activityItem.widget}
                instanceId={activityItem.i}
                config={activityItem.config}
                data={stateFor(activityItem)}
                onEvent={onEvent === undefined ? undefined : (event) => void onEvent(activityItem.i, event)}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
