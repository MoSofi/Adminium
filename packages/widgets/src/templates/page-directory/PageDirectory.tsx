import { useMaybeT } from '@adminium/i18n/react';
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerHeader,
  EmptyState,
  SearchInput,
  Spinner,
} from '@adminium/ui';
import { useCallback, useMemo, useState } from 'react';

import { WidgetHost } from '../../frame/WidgetHost.js';
import type { WidgetDataState } from '../../frame/WidgetHost.js';
import { CardGallery } from '../../families/tables/CardGallery.js';
import type { GalleryCard } from '../../families/tables/CardGallery.js';
import { DetailKeyValue } from '../../families/tables/DetailKeyValue.js';
import { OrgChart } from '../../families/domain/OrgChart.js';
import type { WidgetEvent } from '../../registry/types.js';
import {
  useDashboardData,
  type DashboardDataAdapter,
  type DashboardDataStates,
} from '../page-dashboard/data-adapter.js';
import {
  SUBTITLE_FIELD_CANDIDATES,
  TITLE_FIELD_CANDIDATES,
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
import type { GridRow, LayoutItem } from '../../page-config/index.js';

/**
 * `page-directory` — the people archetype (09-generated-app.md §7.7; annex
 * §14 "Team Directory, Org Chart (tree variant)"): an optional
 * `micro-kpi-subtitle` summary strip, a search/filter toolbar, and the
 * `directory` slot rendered either as a `card-gallery(person)` grid or — when
 * the generator matched a self-FK people table — the cycle-safe `org-chart`
 * tree. A person card opens the record drawer (`detail-key-value`), routed by
 * the host through `detailRecordId`/`onDetailRecordChange` exactly like
 * `page-crud`'s detail panel.
 *
 * Data flows through the same per-instance resolution as `page-dashboard`:
 * `states` override → adapter batch → deterministic demo data (04 §5.3).
 */

export const PAGE_DIRECTORY_TEMPLATE_ID = 'page-directory';

/** Directory-slot widgets the manifest accepts (templates/page-directory.json). */
const DIRECTORY_WIDGETS = ['card-gallery', 'org-chart'] as const;

/** Dept-ish columns whose distinct values seed the filter chip bar (§7.7). */
const FILTER_FIELD_CANDIDATES = ['dept', 'department', 'team', 'division', 'category', 'role'] as const;

export interface PageDirectoryLabels {
  searchPlaceholder?: string | undefined;
  allFilter?: string | undefined;
  clearFilters?: string | undefined;
  close?: string | undefined;
  detailTitle?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  noMatchesTitle?: string | undefined;
  noMatchesBody?: string | undefined;
  errorTitle?: string | undefined;
  retry?: string | undefined;
  loading?: string | undefined;
  /** "{count}" placeholder — plain substitution, widgets carry no ICU. */
  memberCount?: string | undefined;
}

export interface PageDirectoryProps {
  /** The stored page config body (`{ layout, toolbar, overlays, … }`). */
  config: unknown;
  /** Transport for bound widgets; absent → demo mode (04 §5.3). */
  adapter?: DashboardDataAdapter | undefined;
  params?: Record<string, unknown> | undefined;
  /** Per-instance override — wins over adapter/demo resolution. */
  states?: DashboardDataStates | undefined;
  /** Route-controlled drawer record (`/p/$slug/r/$recordId`, 09 §2.3). */
  detailRecordId?: string | null | undefined;
  onDetailRecordChange?: ((recordId: string | null) => void) | undefined;
  onEvent?: ((instanceId: string, event: WidgetEvent) => void | Promise<unknown>) | undefined;
  labels?: PageDirectoryLabels | undefined;
  testId?: string | undefined;
}

function interpolateCount(template: string | undefined, count: number): string {
  return (template ?? '{count} people').replace('{count}', String(count));
}

/**
 * Row-derived id fallback for the org-chart variant: generated archetype
 * configs carry no `idField` and real people tables rarely call their pk
 * `id` (Northwind: `employee_id`) — without the real key every parent
 * reference dangles and the tree collapses to the "no reporting structure"
 * empty state. Prefer a literal `id`, else the first `*_id`-shaped column
 * that is not the parent pointer itself.
 */
function detectIdField(rows: readonly GridRow[], parentField: string): string {
  const first = rows[0];
  if (first === undefined || 'id' in first) return 'id';
  const key = Object.keys(first).find(
    (name) => name !== parentField && /(^|_)id$/i.test(name),
  );
  return key ?? 'id';
}

/** Project a directory row onto the gallery card shape via the config map. */
function cardOf(row: GridRow, titleField: string, subtitleField: string | undefined, index: number): GalleryCard {
  const id = row['id'];
  return {
    id: typeof id === 'string' || typeof id === 'number' ? id : index,
    title: cellText(row[titleField]) ?? `#${String(index + 1)}`,
    ...(subtitleField === undefined ? {} : { subtitle: cellText(row[subtitleField]) }),
    ...(cellText(row['status']) === undefined ? {} : { status: cellText(row['status']) }),
  };
}

export function PageDirectory({
  config,
  adapter,
  params,
  states,
  detailRecordId,
  onDetailRecordChange,
  onEvent,
  labels,
  testId,
}: PageDirectoryProps) {
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

  const summaryItem = useMemo(() => slotItemOf(body.layout, 'summary', ['micro-kpi-subtitle']), [body.layout]);
  const directoryItem = useMemo(() => slotItemOf(body.layout, 'directory', DIRECTORY_WIDGETS), [body.layout]);
  const directoryState = stateFor(directoryItem);
  const rows = useMemo(() => recordRowsOf(directoryState.data), [directoryState.data]);
  const isOrgChart = directoryItem?.widget === 'org-chart';
  const itemConfig = directoryItem?.config ?? {};

  // --- toolbar state -----------------------------------------------------------
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string | null>(null);

  const titleField =
    configString(itemConfig, 'titleField', 'titleColumn', 'labelField', 'labelColumn') ??
    guessField(rows, TITLE_FIELD_CANDIDATES) ??
    'name';
  const subtitleField =
    configString(itemConfig, 'subtitleField', 'subtitleColumn', 'roleField') ??
    guessField(rows, SUBTITLE_FIELD_CANDIDATES);
  const filterField =
    configString(itemConfig, 'filterField', 'filterColumn', 'deptField') ??
    guessField(rows, FILTER_FIELD_CANDIDATES);

  const filterValues = useMemo(() => {
    if (filterField === undefined) return [];
    return [...new Set(rows.map((row) => cellText(row[filterField])).filter((v): v is string => v !== undefined))];
  }, [rows, filterField]);

  const visibleRows = useMemo(() => {
    let out = rows;
    if (filter !== null && filterField !== undefined) {
      out = out.filter((row) => cellText(row[filterField]) === filter);
    }
    const query = search.trim().toLowerCase();
    if (query !== '') {
      out = out.filter((row) =>
        [titleField, subtitleField, 'email']
          .filter((field): field is string => field !== undefined)
          .some((field) => cellText(row[field])?.toLowerCase().includes(query)),
      );
    }
    return out;
  }, [rows, filter, filterField, search, titleField, subtitleField]);

  // --- record drawer -----------------------------------------------------------
  const [internalDetailId, setInternalDetailId] = useState<string | null>(null);
  const detailId = detailRecordId !== undefined ? detailRecordId : internalDetailId;
  const setDetailId = useCallback(
    (next: string | null) => {
      setInternalDetailId(next);
      onDetailRecordChange?.(next);
    },
    [onDetailRecordChange],
  );
  const detailRow = useMemo(
    () => (detailId === null ? undefined : rows.find((row) => String(row['id'] ?? '') === detailId)),
    [rows, detailId],
  );
  const detailSpecs = useMemo(
    () =>
      detailRow === undefined
        ? []
        : specsForRecord(detailRow, {
            ...(filterField === undefined ? {} : { toneFields: { [filterField]: enumTonesOf(itemConfig) } }),
            displayField: titleField,
          }),
    [detailRow, filterField, itemConfig, titleField],
  );

  const openCard = useCallback(
    (card: GalleryCard) => {
      setDetailId(String(card.id));
      const scope = itemTableOf(directoryItem);
      if (scope !== undefined && directoryItem !== undefined) {
        void onEvent?.(directoryItem.i, {
          type: 'record-open',
          connectionId: scope.connectionId,
          table: scope.table,
          recordId: card.id,
        });
      }
    },
    [setDetailId, directoryItem, onEvent],
  );

  if (!body.valid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-directory-invalid">
        {t(
          'ui:templates.directory.invalidConfig',
          'This directory’s stored configuration is invalid. Regenerate the page to restore it.',
        )}
      </p>
    );
  }

  const memberTotal = isOrgChart ? rows.length : visibleRows.length;
  // `count` drives the ICU plural; `n` passes the digits through
  // pre-stringified so ICU never regroups them (DayAgenda convention). A
  // labels.memberCount override keeps the documented plain "{count}"
  // substitution — widget labels carry no ICU.
  const memberCountText =
    labels?.memberCount !== undefined
      ? interpolateCount(labels.memberCount, memberTotal)
      : t('ui:templates.directory.memberCount', '{count, plural, one {{n} person} other {{n} people}}', {
          count: memberTotal,
          n: String(memberTotal),
        });
  const detailTitle = labels?.detailTitle ?? t('ui:templates.directory.detailTitle', 'Person');

  return (
    <div data-part="page-directory" data-testid={testId} className="flex h-full min-h-0 flex-col">
      {/* Summary strip — the optional micro-KPI slot (manifest `summary`). */}
      {summaryItem !== undefined && (
        <div className="pb-3">
          <WidgetHost
            widgetId={summaryItem.widget}
            instanceId={summaryItem.i}
            config={summaryItem.config}
            data={stateFor(summaryItem)}
            onEvent={onEvent === undefined ? undefined : (event) => void onEvent(summaryItem.i, event)}
          />
        </div>
      )}

      {/* Toolbar — search + dept filter chips (§7.7). */}
      <div className="flex min-h-12 flex-wrap items-center gap-2 pb-3">
        {!isOrgChart && (
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={labels?.searchPlaceholder ?? t('ui:templates.directory.searchPlaceholder', 'Search people…')}
            className="w-72"
            onClear={() => setSearch('')}
            clearLabel={t('ui:action.clearSearch', 'Clear search')}
          />
        )}
        {filterValues.length > 0 && (
          <div
            role="group"
            aria-label={t('ui:widgets.forms.filterChipBar.a11yLabel', 'Filter')}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
          >
            {[null, ...filterValues].map((value) => (
              <button
                key={value ?? '__all__'}
                type="button"
                data-active={filter === value}
                onClick={() => setFilter(value)}
                className="rounded-full border border-border px-2.5 py-0.5 text-caption font-semibold text-fg-muted data-[active=true]:border-accent data-[active=true]:bg-accent-soft data-[active=true]:text-accent hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              >
                {value === null
                  ? (labels?.allFilter ?? t('ui:widgets.forms.filterChipBar.all', 'All'))
                  : humanizeName(value)}
              </button>
            ))}
          </div>
        )}
        {directoryState.status === 'success' && (
          <span className="ms-auto font-mono text-caption tabular-nums text-fg-subtle" data-part="directory-count">
            {memberCountText}
          </span>
        )}
      </div>

      {/* Directory body. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        {directoryState.status === 'error' ? (
          <EmptyState
            tone="danger"
            title={labels?.errorTitle ?? t('ui:templates.directory.errorTitle', 'This directory failed to load')}
            body={directoryState.error instanceof Error ? directoryState.error.message : undefined}
            actions={
              directoryState.refetch === undefined ? undefined : (
                <Button size="sm" variant="secondary" onClick={directoryState.refetch}>
                  {labels?.retry ?? t('ui:action.retry', 'Retry')}
                </Button>
              )
            }
          />
        ) : directoryState.status === 'loading' ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner label={labels?.loading ?? t('ui:templates.directory.loading', 'Loading people')} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            preset="no-data"
            title={labels?.emptyTitle ?? t('ui:templates.directory.emptyTitle', 'No people yet')}
            body={labels?.emptyBody ?? t('ui:templates.directory.emptyBody', 'People appear here as rows land in the table.')}
          />
        ) : isOrgChart ? (
          <OrgChart
            data={{ rows }}
            fields={{
              idField:
                configString(itemConfig, 'idField', 'idColumn') ??
                detectIdField(
                  rows,
                  configString(itemConfig, 'parentField', 'parentColumn') ?? 'manager_id',
                ),
              parentField: configString(itemConfig, 'parentField', 'parentColumn') ?? 'manager_id',
              labelField: titleField,
              ...(subtitleField === undefined ? {} : { roleField: subtitleField }),
              ...(filterField === undefined ? {} : { deptField: filterField }),
            }}
            testId="page-directory-org-chart"
          />
        ) : visibleRows.length === 0 ? (
          // Filtered empty state — MUST be distinct from first-use (09 §6.2).
          <EmptyState
            preset="no-matches"
            title={labels?.noMatchesTitle ?? t('ui:templates.directory.noMatchesTitle', 'No matching people')}
            body={labels?.noMatchesBody ?? t('ui:templates.common.noMatchesBody', 'Try a different search or remove a filter.')}
            actions={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setFilter(null);
                }}
              >
                {labels?.clearFilters ?? t('ui:templates.common.clearFilters', 'Clear filters')}
              </Button>
            }
          />
        ) : (
          <div className="nb-scroll min-h-0 flex-1 overflow-y-auto">
            <CardGallery
              cards={visibleRows.map((row, index) => cardOf(row, titleField, subtitleField, index))}
              thumbnail="monogram"
              onOpen={openCard}
              testId="page-directory-gallery"
            />
          </div>
        )}
      </div>

      {/* Person drawer — detail-key-value over the selected row (§7.7). */}
      <Drawer open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)} size="md">
        <DrawerHeader
          title={detailRow === undefined ? detailTitle : (cellText(detailRow[titleField]) ?? detailTitle)}
          closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
        />
        <DrawerBody>
          {detailRow === undefined ? (
            <div className="flex items-center justify-center py-10">
              <Spinner label={labels?.loading ?? t('ui:templates.common.loadingRecord', 'Loading record')} />
            </div>
          ) : (
            <DetailKeyValue columns={detailSpecs} record={detailRow} testId="page-directory-detail" />
          )}
        </DrawerBody>
      </Drawer>
    </div>
  );
}
