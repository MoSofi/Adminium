// SPDX-License-Identifier: AGPL-3.0-only
import {
  Badge,
  Button,
  ConfirmModal,
  Drawer,
  DrawerBody,
  DrawerHeader,
  EmptyState,
  KeyValueList,
  KeyValueRow,
  MonoText,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToastStack,
  useToastQueue,
} from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecordForm } from '../page-crud/RecordForm.js';
import { isDeletePreview } from '../page-crud/crud-api.js';
import type {
  CrudApi,
  CrudGetResult,
  CrudListParams,
  CrudListResult,
  CrudReferenceCount,
  CrudRow,
  CrudSort,
} from '../page-crud/crud-api.js';
import { DataGrid } from '../../families/tables/DataGrid.js';
import { DetailKeyValue } from '../../families/tables/DetailKeyValue.js';
import { PaginationFooter } from '../../families/tables/PaginationFooter.js';
import { CellValue } from '../../families/tables/cells.js';
import type { CellContext } from '../../families/tables/cells.js';
import { displayValueOf, rowIdOf } from '../../families/tables/column-spec.js';
import type { GridColumnSpec } from '../../families/tables/column-spec.js';
import { TimelineVertical } from '../../families/feeds/TimelineVertical.js';
import type { TimelineEntry } from '../../families/feeds/feeds-types.js';
import type { WidgetEvent } from '../../registry/types.js';

/**
 * `page-record` — the record detail page (30-record-pages.md D4; 09 §7.1;
 * Customer 360 comp): the template every generated `page-crud` body has named
 * in `config.detail.template` since the body vocabulary was written, now
 * rendered for real at `/p/$slug/r/$recordId`.
 *
 * Composition: key-field hero (+ status/timestamp meta and Edit/Delete per
 * grants and `readOnly`), the `detail-key-value` field grid (two columns at
 * `lg`), then one tab per `detail.tabs[]` entry — each a REAL paginated
 * `data-grid` over the referencing table, count-pilled from
 * `referenceCounts` — plus the per-record Activity timeline when the host
 * wires one (absent otherwise, 30 D6).
 *
 * All data access flows through the injected seams: the page's own `CrudApi`,
 * a `PageRecordRelated` host adapter for the referencing tables (list +
 * column resolution + linkability, 30 D5), and a `RecordActivityFeed` for the
 * audit-backed timeline. Widgets never import the dashboard's api layer.
 */

export const PAGE_RECORD_TEMPLATE_ID = 'page-record';

/** Default related-tab page size — a record's related list, not a workbench. */
const RELATED_PAGE_SIZE = 10;

/** One `detail.tabs[]` entry, as stored (30-T01's schema). */
export interface PageRecordTabConfig {
  /** Referencing table id ("public.invoice_items"). */
  table: string;
  /** FK column into this page's table; absent ⇒ counts only, no body. */
  fkColumn?: string | undefined;
  label?: string | undefined;
}

/** Grid metadata for a referencing table that has its own page (30 D5). */
export interface PageRecordRelatedResolution {
  columns: readonly GridColumnSpec[];
  defaultSort: CrudSort | null;
  /**
   * May the caller CREATE rows of this table (the in-tab "New row" flow)?
   * Resolved by the host from the target page's own reply — its per-caller
   * `canCreate` and its `readOnly` — so the tab never offers a button the
   * server would 403 or the target page itself refuses. Absent means "not
   * computed" and the button stays hidden: unlike the page-level write
   * capabilities (where absent defaults open for older servers), this
   * affordance is NEW, so nothing regresses by requiring the signal.
   */
  canCreate?: boolean | undefined;
}

/** Host adapter for the related-record tabs (30 D5). */
export interface PageRecordRelated {
  /** List rows of `table` — the host's CrudApi bound to that table. */
  list(table: string, params: CrudListParams): Promise<CrudListResult>;
  /**
   * The table's own page metadata (its column specs + default sort), or null
   * when no page shows it — the tab then derives text columns from the rows.
   */
  resolve(table: string): Promise<PageRecordRelatedResolution | null>;
  /** Whether rows of `table` navigate to that table's record page (30 D5). */
  linkable(table: string): boolean;
  /**
   * The host's full CrudApi bound to `table` — what the in-tab create writes
   * through (and where its FK combobox lookups come from). Optional so hosts
   * and fixtures predating the flow keep working; without it the tab is
   * read-only exactly as before.
   */
  api?(table: string): CrudApi | null;
}

/** One per-record audit entry, already shaped for display (30 D6). */
export interface RecordActivityEntry {
  id: string;
  /** Actor display label ("Ava Reyes"). */
  actorLabel: string;
  /** Dotted verb — `record.create` / `record.update` / `record.delete` / `record.undo`. */
  action: string;
  /** Epoch ms. */
  at: number;
  /** Changed-column count — never the images themselves (30 D6). */
  changedFields?: number | undefined;
}

export interface RecordActivityPage {
  entries: RecordActivityEntry[];
  nextCursor: string | null;
}

/** Host adapter over the audit entity filter (30 WS-A). */
export interface RecordActivityFeed {
  list(params: { cursor?: string | undefined }): Promise<RecordActivityPage>;
}

export interface PageRecordLabels {
  edit?: string | undefined;
  delete?: string | undefined;
  close?: string | undefined;
  dismiss?: string | undefined;
  undo?: string | undefined;
  activityTab?: string | undefined;
}

export interface PageRecordProps {
  api: CrudApi;
  columns: readonly GridColumnSpec[];
  /** Page scope (envelope `source`) — events carry it. */
  source: { connectionId: string | null; table: string };
  recordId: string;
  /** Singular entity noun for domain framing ("invoice"). */
  entityName?: string | undefined;
  /** `config.keyField` — hero headline column; falls back to the display value. */
  keyField?: string | null | undefined;
  /** `config.readOnly` — no write affordance anywhere on the page (30 D7). */
  readOnly?: boolean | undefined;
  /** `config.detail.tabs` (30-T01). */
  tabs?: readonly PageRecordTabConfig[] | undefined;
  related?: PageRecordRelated | undefined;
  /** Absent/null ⇒ the Activity tab does not render (30 D6). */
  activity?: RecordActivityFeed | null | undefined;
  canUpdate?: boolean | undefined;
  canDelete?: boolean | undefined;
  canUnmask?: boolean | undefined;
  onEvent?: ((event: WidgetEvent) => void) | undefined;
  /** The record was deleted — navigate off the page (30 §3.2). */
  onDeleted?: ((undoToken: string | null) => void) | undefined;
  /** The record does not exist (404) — host renders its not-found state. */
  onMissing?: (() => void) | undefined;
  /** Fired when the record loads/reloads — hero feeds breadcrumb/doc title. */
  onLoaded?: ((info: { hero: string }) => void) | undefined;
  locale?: string | undefined;
  currency?: string | undefined;
  labels?: PageRecordLabels | undefined;
  testId?: string | undefined;
}

function isNotFound(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    'status' in reason &&
    (reason as { status: unknown }).status === 404
  );
}

/**
 * Minimal text specs derived from row keys — the degradation for a
 * referencing table with no page of its own (30 D5). Masking still renders
 * faithfully: `CellValue` reads the row's `_masked` marker, not the spec.
 */
function derivedColumns(rows: readonly CrudRow[]): GridColumnSpec[] {
  return Object.keys(rows[0] ?? {})
    .filter((key) => key !== '_masked')
    .slice(0, 6)
    .map((key, index) => ({
      name: key,
      label: key,
      logicalType: 'text',
      semantic: null,
      format: null,
      pii: false,
      mono: false,
      sortable: false,
      hidden: false,
      primaryKey: false,
      nullable: true,
      hasDefault: false,
      unique: false,
      readOnly: true,
      maxLength: null,
      isDisplay: index === 0,
    }));
}

// --- related tab -------------------------------------------------------------

function RelatedRecordsTab({
  tab,
  related,
  pkValue,
  count,
  connectionId,
  writable,
  onCreated,
  onEvent,
  cellContext,
  locale,
}: {
  tab: PageRecordTabConfig;
  related: PageRecordRelated;
  pkValue: unknown;
  /** The pill count — doubles as the footer total. */
  count: number | null;
  connectionId: string | null;
  /** The PARENT page's write gate (30 D7): readOnly hides every affordance. */
  writable: boolean;
  /** A row was created here — the parent refreshes its count pills. */
  onCreated?: (() => void) | undefined;
  onEvent?: ((event: WidgetEvent) => void) | undefined;
  cellContext: CellContext;
  locale?: string | undefined;
}) {
  const t = useMaybeT();
  const queue = useToastQueue();
  const [resolution, setResolution] = useState<PageRecordRelatedResolution | null | 'pending'>('pending');
  const [rows, setRows] = useState<CrudRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [cursor, setCursor] = useState('');
  const [pageSize, setPageSize] = useState(RELATED_PAGE_SIZE);
  const [sort, setSort] = useState<CrudSort | null>(null);
  const [sortTouched, setSortTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  /** Bumped after a create so the current page refetches even at cursor ''. */
  const [refreshTick, setRefreshTick] = useState(0);

  // Resolve the target table's own page metadata once per tab activation
  // (Radix mounts a tab's content on first activation — the lazy-fetch
  // contract the fan-out risk note pins).
  useEffect(() => {
    let alive = true;
    related
      .resolve(tab.table)
      .then((resolved) => {
        if (alive) setResolution(resolved);
      })
      .catch(() => {
        if (alive) setResolution(null);
      });
    return () => {
      alive = false;
    };
  }, [related, tab.table]);

  const fkColumn = tab.fkColumn;
  // The related table's own default sort until the user sorts by hand (D4).
  const effectiveSort = sortTouched
    ? sort
    : resolution === 'pending'
      ? null
      : (resolution?.defaultSort ?? null);

  useEffect(() => {
    if (fkColumn === undefined || resolution === 'pending') return;
    let alive = true;
    setError(null);
    related
      .list(tab.table, {
        limit: pageSize,
        cursor,
        where: { column: fkColumn, op: 'eq', value: pkValue },
        ...(effectiveSort === null ? {} : { order: [effectiveSort] }),
      })
      .then((result) => {
        if (!alive) return;
        setRows(result.data);
        setNextCursor(result.cursor?.next ?? null);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setRows([]);
        setError(reason instanceof Error ? reason.message : t('ui:state.error', 'Something went wrong'));
      });
    return () => {
      alive = false;
    };
  }, [related, tab.table, fkColumn, pkValue, pageSize, cursor, effectiveSort, resolution, refreshTick]);

  /*
   * The in-tab create (30 follow-up): the child row is born already attached —
   * the FK column never renders as a field; its value is THIS record, injected
   * at submit. Offered only when every gate agrees: the parent page is
   * writable (D7), the target table's own page resolved AND said the caller
   * may create (its per-caller `canCreate` + its own readOnly — see
   * `PageRecordRelatedResolution.canCreate`), and the host wired a write api.
   */
  const crud = related.api?.(tab.table) ?? null;
  const creatable =
    writable &&
    fkColumn !== undefined &&
    resolution !== 'pending' &&
    resolution !== null &&
    resolution.canCreate === true &&
    crud !== null;
  // Domain framing from the tab's label ("Invoice items" → "invoice item"),
  // falling back to the table-derived noun; singularized ONCE either way.
  const childEntity =
    tab.label !== undefined
      ? tab.label.toLowerCase().endsWith('s')
        ? tab.label.toLowerCase().slice(0, -1)
        : tab.label.toLowerCase()
      : entityFromTable(tab.table);
  const createColumns = useMemo(
    () =>
      resolution === 'pending' || resolution === null
        ? []
        : resolution.columns.filter((column) => column.name !== fkColumn),
    [resolution, fkColumn],
  );

  const handleCreate = (values: CrudRow) => {
    if (crud === null || fkColumn === undefined) return;
    setCreateErrors({});
    crud
      .create({ ...values, [fkColumn]: pkValue })
      .then(() => {
        setCreateOpen(false);
        queue.push({
          variant: 'success',
          title: t('ui:templates.crud.toast.created', '{entity} created.', {
            entity: childEntity.charAt(0).toUpperCase() + childEntity.slice(1),
          }),
        });
        // Refetch this tab's current page and let the parent refresh pills.
        setRefreshTick((tick) => tick + 1);
        onCreated?.();
      })
      .catch((reason: unknown) => {
        const fieldErrors =
          typeof reason === 'object' && reason !== null && 'fieldErrors' in reason
            ? (reason as { fieldErrors: Record<string, string> }).fieldErrors
            : null;
        if (fieldErrors !== null) {
          setCreateErrors(fieldErrors);
          return;
        }
        queue.push({
          variant: 'error',
          title:
            reason instanceof Error
              ? reason.message
              : t('ui:templates.crud.toast.createFailed', 'Create failed.'),
        });
      });
  };

  const addButton = creatable ? (
    <Button size="sm" variant="secondary" iconLeft={<Plus />} onClick={() => setCreateOpen(true)}>
      {t('ui:templates.crud.newRow', 'New row')}
    </Button>
  ) : null;
  const createDrawer = creatable ? (
    <Drawer open={createOpen} onOpenChange={(open) => !open && setCreateOpen(false)} size="md">
      <DrawerHeader
        title={t('ui:templates.crud.createTitle', 'Add {entity}', { entity: childEntity })}
        closeLabel={t('ui:action.close', 'Close')}
      />
      <DrawerBody>
        {createOpen && (
          <RecordForm
            formId={`page-record-add-${tab.table}`}
            columns={createColumns}
            mode="create"
            errors={createErrors}
            lookup={crud.lookup?.bind(crud)}
            onSubmit={handleCreate}
            footer={
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                  {t('ui:action.cancel', 'Cancel')}
                </Button>
                <Button type="submit">
                  {t('ui:templates.crud.createSubmit', 'Add {entity}', { entity: childEntity })}
                </Button>
              </div>
            }
          />
        )}
      </DrawerBody>
    </Drawer>
  ) : null;

  if (fkColumn === undefined) {
    // A tab whose FK column the config no longer names: counts only.
    return (
      <p className="px-1 py-3 text-body-sm text-fg-muted">
        {t(
          'ui:templates.crud.detail.relatedCount',
          '{count, plural, one {{n} related record in {table}} other {{n} related records in {table}}}',
          { count: count ?? 0, n: String(count ?? 0), table: tab.table },
        )}
      </p>
    );
  }
  if (error !== null) {
    return (
      <p role="alert" className="px-1 py-3 text-body-sm text-danger">
        {error}
      </p>
    );
  }
  if (rows === null || resolution === 'pending') {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner label={t('ui:templates.crud.loadingRows', 'Loading rows')} />
      </div>
    );
  }
  if (rows.length === 0 && cursorStack.length === 0) {
    // The empty tab is exactly where "New row" earns its place — the first
    // child of a fresh parent starts here.
    return (
      <>
        <EmptyState
          compact
          preset="no-data"
          title={t('ui:templates.record.relatedEmptyTitle', 'No related records')}
          {...(addButton === null ? {} : { actions: addButton })}
        />
        {createDrawer}
      </>
    );
  }

  const columns = resolution?.columns ?? derivedColumns(rows);
  // Rows navigate only when the table has a page of its own (30 D5) — a link
  // that goes nowhere is worse than no link.
  const linkable = resolution !== null && related.linkable(tab.table);
  const rangeStart = rows.length === 0 ? 0 : cursorStack.length * pageSize + 1;
  const rangeEnd = cursorStack.length * pageSize + rows.length;

  return (
    <div data-part="record-related-tab" data-table={tab.table}>
      {addButton !== null && <div className="mb-2 flex justify-end">{addButton}</div>}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <DataGrid
        columns={columns}
        rows={rows}
        sort={effectiveSort}
        onSortChange={(next) => {
          setSortTouched(true);
          setSort(next);
          setCursor('');
          setCursorStack([]);
        }}
        {...(linkable
          ? {
              onRowOpen: (row: CrudRow) => {
                onEvent?.({
                  type: 'record-open',
                  ...(connectionId === null ? {} : { connectionId }),
                  table: tab.table,
                  recordId: rowIdOf(columns, row),
                });
              },
            }
          : {})}
        cellContext={cellContext}
        density="compact"
      />
      <PaginationFooter
        {...(locale === undefined ? {} : { locale })}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        total={count}
        hasPrev={cursorStack.length > 0}
        hasNext={nextCursor !== null}
        onPrev={() => {
          const previous = cursorStack.at(-1);
          if (previous === undefined) return;
          setCursorStack((stack) => stack.slice(0, -1));
          setCursor(previous);
        }}
        onNext={() => {
          if (nextCursor === null) return;
          setCursorStack((stack) => [...stack, cursor]);
          setCursor(nextCursor);
        }}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setCursor('');
          setCursorStack([]);
        }}
      />
      </div>
      {createDrawer}
    </div>
  );
}

// --- activity tab ------------------------------------------------------------

const ACTIVITY_TONE: Record<string, string> = {
  'record.create': 'pos',
  'record.update': 'accent',
  'record.delete': 'danger',
  'record.undo': 'warn',
};

function ActivityTab({ feed, locale }: { feed: RecordActivityFeed; locale?: string | undefined }) {
  const t = useMaybeT();
  const [entries, setEntries] = useState<RecordActivityEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (cursor: string | undefined) => {
      setLoading(true);
      feed
        .list(cursor === undefined ? {} : { cursor })
        .then((page) => {
          setEntries((current) => [...(cursor === undefined ? [] : (current ?? [])), ...page.entries]);
          setNextCursor(page.nextCursor);
          setLoading(false);
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : t('ui:state.error', 'Something went wrong'));
          setLoading(false);
        });
    },
    [feed, t],
  );

  useEffect(() => {
    load(undefined);
  }, [load]);

  if (error !== null) {
    return (
      <p role="alert" className="px-1 py-3 text-body-sm text-danger">
        {error}
      </p>
    );
  }
  if (entries === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner label={t('ui:templates.record.loadingActivity', 'Loading activity')} />
      </div>
    );
  }

  const sentenceFor = (entry: RecordActivityEntry): string => {
    const actor = entry.actorLabel;
    switch (entry.action) {
      case 'record.create':
        return t('ui:templates.record.activity.created', '{actor} created this record', { actor });
      case 'record.update':
        return t('ui:templates.record.activity.updated', '{actor} updated this record', { actor });
      case 'record.delete':
        return t('ui:templates.record.activity.deleted', '{actor} deleted this record', { actor });
      case 'record.undo':
        return t('ui:templates.record.activity.undone', '{actor} undid a change', { actor });
      default:
        return `${actor} · ${entry.action}`;
    }
  };

  const timeline: TimelineEntry[] = entries.map((entry) => ({
    id: entry.id,
    title: sentenceFor(entry),
    ts: new Date(entry.at).toISOString(),
    tone: ACTIVITY_TONE[entry.action] ?? 'neutral',
    ...(entry.changedFields === undefined || entry.changedFields === 0
      ? {}
      : {
          body: t(
            'ui:templates.record.activity.changedFields',
            '{count, plural, one {{n} field changed} other {{n} fields changed}}',
            { count: entry.changedFields, n: String(entry.changedFields) },
          ),
        }),
  }));

  return (
    <div className="flex flex-col gap-2" data-part="record-activity">
      <TimelineVertical
        entries={timeline}
        {...(locale === undefined ? {} : { locale })}
        // D6: honest emptiness — the feed shows what Adminium recorded, which
        // is not a claim that nothing ever happened (bulk writes carry no
        // per-row entity; other tools never audited here at all).
        emptyTitle={t('ui:templates.record.activityEmptyTitle', 'No activity recorded')}
        emptyBody={t(
          'ui:templates.record.activityEmptyBody',
          'Changes made through Adminium will appear here.',
        )}
      />
      {nextCursor !== null && (
        <div className="px-3 pb-2">
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => load(nextCursor)}>
            {t('ui:templates.record.activityLoadOlder', 'Load older activity')}
          </Button>
        </div>
      )}
    </div>
  );
}

// --- the page ----------------------------------------------------------------

export function PageRecord({
  api,
  columns,
  source,
  recordId,
  entityName,
  keyField,
  readOnly = false,
  tabs = [],
  related,
  activity,
  canUpdate = true,
  canDelete = true,
  canUnmask = false,
  onEvent,
  onDeleted,
  onMissing,
  onLoaded,
  locale,
  currency,
  labels,
  testId,
}: PageRecordProps) {
  const t = useMaybeT();
  const queue = useToastQueue();
  const entity = entityName ?? entityFromTable(source.table);

  const [result, setResult] = useState<CrudGetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [editOpen, setEditOpen] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ references: CrudReferenceCount[]; loaded: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .get(recordId, { include: 'inboundCounts' })
      .then((loaded) => {
        if (alive) setResult(loaded);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        if (isNotFound(reason)) {
          onMissing?.();
          return;
        }
        setError(reason instanceof Error ? reason.message : t('ui:templates.record.loadError', 'Failed to load the record.'));
      });
    return () => {
      alive = false;
    };
  }, [api, recordId, reloadTick]);

  const cellContext: CellContext = useMemo(
    () => ({
      onEvent,
      canUnmask,
      connectionId: source.connectionId ?? undefined,
      locale,
      currency,
    }),
    [onEvent, canUnmask, source.connectionId, locale, currency],
  );

  const record = result?.data ?? null;
  const counts = result?.inboundCounts ?? [];

  const heroValue = useMemo(() => {
    if (record === null) return null;
    // Key-field highlight (09 §8.3) — read off the RECORD, not the column
    // specs: `keyField` is generation's chosen display column, and the ~8-column
    // list cap routinely drops it from `config.columns` (a free-text company
    // name never makes the grid) while `api.get` still returns it. Masked or
    // absent values fall through to the drawer's PK fallback — row identity
    // always resolves.
    const keyed = keyField == null ? undefined : record[keyField];
    return keyed !== null && keyed !== undefined && String(keyed) !== ''
      ? String(keyed)
      : displayValueOf(columns, record);
  }, [record, columns, keyField]);

  useEffect(() => {
    if (heroValue !== null) onLoaded?.({ hero: heroValue });
  }, [heroValue, onLoaded]);

  const countFor = (tab: PageRecordTabConfig): number | null => {
    const match = counts.find(
      (count) =>
        count.table === tab.table && (tab.fkColumn === undefined || count.column === tab.fkColumn),
    );
    return match?.count ?? null;
  };

  const writable = !readOnly;
  const showEdit = writable && canUpdate;
  const showDelete = writable && canDelete;

  const handleUpdate = (values: CrudRow) => {
    setEditErrors({});
    api
      .update(recordId, values)
      .then((updated) => {
        setEditOpen(false);
        queue.push({
          variant: 'success',
          title: t('ui:templates.crud.toast.saved', 'Changes saved.'),
          ...(updated.undoToken === null
            ? {}
            : {
                action: {
                  label: labels?.undo ?? t('ui:action.undo', 'Undo'),
                  onAction: () => {
                    api
                      .undo(updated.undoToken as string)
                      .then(() => {
                        queue.push({ variant: 'info', title: t('ui:templates.crud.toast.undone', 'Change undone.') });
                        setReloadTick((tick) => tick + 1);
                      })
                      .catch((reason: unknown) => {
                        queue.push({
                          variant: 'error',
                          title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.undoFailed', 'Undo failed.'),
                        });
                      });
                  },
                },
              }),
        });
        setReloadTick((tick) => tick + 1);
      })
      .catch((reason: unknown) => {
        const fieldErrors =
          typeof reason === 'object' && reason !== null && 'fieldErrors' in reason
            ? (reason as { fieldErrors: Record<string, string> }).fieldErrors
            : null;
        if (fieldErrors !== null) {
          setEditErrors(fieldErrors);
          return;
        }
        queue.push({
          variant: 'error',
          title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.updateFailed', 'Update failed.'),
        });
      });
  };

  const openDelete = () => {
    setDeleteTarget({ references: [], loaded: false });
    api
      .remove(recordId, { dryRun: true })
      .then((preview) => {
        setDeleteTarget((current) =>
          current === null
            ? current
            : { references: isDeletePreview(preview) ? preview.references : [], loaded: true },
        );
      })
      .catch(() => {
        setDeleteTarget((current) => (current === null ? current : { ...current, loaded: true }));
      });
  };

  const confirmDelete = async () => {
    try {
      const removed = await api.remove(recordId, { confirm: true });
      setDeleteTarget(null);
      // The record no longer exists — staying is a 404 with extra steps
      // (30 §3.2). The host owns the navigation and the undo toast.
      onDeleted?.(isDeletePreview(removed) ? null : removed.undoToken);
    } catch (reason) {
      queue.push({
        variant: 'error',
        title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.deleteFailed', 'Delete failed.'),
      });
    }
  };

  if (error !== null) {
    return (
      <EmptyState
        tone="danger"
        title={t('ui:templates.record.loadError', 'Failed to load the record.')}
        body={error}
        actions={
          <Button size="sm" variant="secondary" onClick={() => setReloadTick((tick) => tick + 1)}>
            {t('ui:action.retry', 'Retry')}
          </Button>
        }
      />
    );
  }
  if (record === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner label={t('ui:templates.common.loadingRecord', 'Loading record')} />
      </div>
    );
  }

  const hero = heroValue ?? displayValueOf(columns, record);
  const statusColumn = columns.find((column) => column.semantic === 'status-workflow' && !column.hidden);
  const stampColumn =
    columns.find((column) => column.semantic === 'updated-at' && !column.hidden) ??
    columns.find((column) => column.semantic === 'created-at' && !column.hidden);

  const visibleColumns = columns.filter((column) => !column.hidden);
  const splitAt = Math.ceil(visibleColumns.length / 2);
  const fieldHalves =
    visibleColumns.length > 6
      ? [visibleColumns.slice(0, splitAt), visibleColumns.slice(splitAt)]
      : [visibleColumns];

  const hasTabs = tabs.length > 0 && related !== undefined;
  const hasActivity = activity !== null && activity !== undefined;
  const pkValue = pkValueOf(columns, record);

  return (
    <div data-part="page-record" data-testid={testId} className="flex flex-col gap-5">
      {/* Hero — key field + meta chips + actions (D4). */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h2 className="min-w-0 truncate text-h2 text-fg">{hero}</h2>
            {statusColumn !== undefined && (
              <CellValue column={statusColumn} row={record} context={cellContext} />
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body-sm text-fg-muted">
            <span className="capitalize">{entity}</span>
            <span aria-hidden="true">·</span>
            <MonoText className="text-body-sm">{recordId}</MonoText>
            {stampColumn !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  {stampColumn.label}
                  <CellValue column={stampColumn} row={record} context={cellContext} />
                </span>
              </>
            )}
          </div>
        </div>
        {(showEdit || showDelete) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {showEdit && (
              <Button size="sm" variant="secondary" iconLeft={<Pencil />} onClick={() => setEditOpen(true)}>
                {labels?.edit ?? t('ui:action.edit', 'Edit')}
              </Button>
            )}
            {showDelete && (
              <Button size="sm" variant="destructive" iconLeft={<Trash2 />} onClick={openDelete}>
                {labels?.delete ?? t('ui:action.delete', 'Delete')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Field grid — two columns at lg, one below (D4). */}
      <div
        data-part="record-fields"
        className={`grid gap-x-8 ${fieldHalves.length === 2 ? 'lg:grid-cols-2' : ''}`}
      >
        {fieldHalves.map((half, index) => (
          <DetailKeyValue
            key={index}
            columns={half}
            record={record}
            cellContext={cellContext}
            showTypeTags
          />
        ))}
      </div>

      {/* Related-record tabs + Activity (D4/D6). */}
      {(hasTabs || hasActivity) && (
        <Tabs defaultValue={hasTabs ? `tab-0` : '__activity'}>
          <TabsList>
            {hasTabs &&
              tabs.map((tab, index) => (
                <TabsTrigger
                  key={`${tab.table}:${tab.fkColumn ?? ''}`}
                  value={`tab-${String(index)}`}
                  {...(countFor(tab) === null ? {} : { count: countFor(tab) as number })}
                >
                  {tab.label ?? tab.table.split('.').pop()}
                </TabsTrigger>
              ))}
            {hasActivity && (
              <TabsTrigger value="__activity">
                {labels?.activityTab ?? t('ui:templates.record.activityTab', 'Activity')}
              </TabsTrigger>
            )}
          </TabsList>
          {hasTabs &&
            tabs.map((tab, index) => (
              <TabsContent key={`${tab.table}:${tab.fkColumn ?? ''}`} value={`tab-${String(index)}`}>
                <RelatedRecordsTab
                  tab={tab}
                  related={related}
                  pkValue={pkValue}
                  count={countFor(tab)}
                  connectionId={source.connectionId}
                  writable={writable}
                  onCreated={() => {
                    // A child was born — the pill counts (and the record's
                    // inbound-reference chip) refresh through the same reload
                    // the edit flow uses.
                    setReloadTick((tick) => tick + 1);
                  }}
                  onEvent={onEvent}
                  cellContext={cellContext}
                  {...(locale === undefined ? {} : { locale })}
                />
              </TabsContent>
            ))}
          {hasActivity && (
            <TabsContent value="__activity">
              <ActivityTab feed={activity} {...(locale === undefined ? {} : { locale })} />
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Edit — the existing generated-form flow (D4). */}
      {showEdit && (
        <Drawer open={editOpen} onOpenChange={(open) => !open && setEditOpen(false)} size="md">
          <DrawerHeader
            title={t('ui:templates.crud.editTitle', 'Edit {entity}', { entity })}
            closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
          />
          <DrawerBody>
            {editOpen && (
              <RecordForm
                formId="page-record-edit-form"
                columns={columns}
                mode="edit"
                initialValues={record}
                errors={editErrors}
                lookup={api.lookup?.bind(api)}
                onSubmit={handleUpdate}
                footer={
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
                      {t('ui:action.cancel', 'Cancel')}
                    </Button>
                    <Button type="submit">{t('ui:templates.crud.saveSubmit', 'Save changes')}</Button>
                  </div>
                }
              />
            )}
          </DrawerBody>
        </Drawer>
      )}

      {/* Cascade-aware type-to-confirm delete — same flow as the list (D4). */}
      {showDelete && (
        <ConfirmModal
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={t('ui:templates.crud.deleteTitle', 'Delete {entity}', { entity })}
          body={
            deleteTarget === null ? null : !deleteTarget.loaded ? (
              t('ui:templates.crud.deletePreflight', 'Checking references…')
            ) : deleteTarget.references.length === 0 ? (
              t('ui:templates.crud.deleteNoReferences', 'This row has no inbound references.')
            ) : (
              <div className="flex flex-col gap-2">
                <span>{t('ui:templates.crud.deleteConsequencesIntro', 'Deleting this row also affects:')}</span>
                <KeyValueList data-part="delete-consequences">
                  {deleteTarget.references.map((reference) => (
                    <KeyValueRow key={reference.relationId} label={`${reference.table}.${reference.column}`} mono>
                      {t('ui:templates.crud.referenceRows', '{count, plural, one {{n} row} other {{n} rows}}', {
                        count: reference.count,
                        n: String(reference.count),
                      })}
                    </KeyValueRow>
                  ))}
                </KeyValueList>
              </div>
            )
          }
          confirmWord={displayValueOf(columns, record)}
          promptLabel={confirmPromptFor(t, displayValueOf(columns, record))}
          confirmLabel={t('ui:action.delete', 'Delete')}
          cancelLabel={t('ui:action.cancel', 'Cancel')}
          closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
          onConfirm={confirmDelete}
        />
      )}

      <ToastStack
        {...queue.stackProps}
        aria-live="polite"
        dismissLabel={labels?.dismiss ?? t('ui:widgets.feeds.toastStack.dismissLabel', 'Dismiss')}
      />
      {counts.length > 0 && (
        <p className="text-caption text-fg-subtle">
          <Badge tone="info">{counts.reduce((sum, reference) => sum + reference.count, 0)}</Badge>{' '}
          {t('ui:templates.crud.detail.inboundReferences', 'inbound references')}
        </p>
      )}
    </div>
  );
}

function entityFromTable(table: string): string {
  const name = table.split('.').pop() ?? table;
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

function pkValueOf(columns: readonly GridColumnSpec[], record: CrudRow): unknown {
  const pk = columns.find((column) => column.primaryKey);
  return pk === undefined ? null : record[pk.name];
}

/**
 * 'Type {value} to confirm' with the value spliced in as MonoText — the same
 * sentinel splice PageCrud uses (rich text through an ICU arg seam).
 */
function confirmPromptFor(t: ReturnType<typeof useMaybeT>, value: string) {
  const [before = '', after = ''] = t('ui:templates.crud.confirmPrompt', 'Type {value} to confirm', {
    value: '\u0000',
  }).split('\u0000');
  return (
    <>
      {before}
      <MonoText>{value}</MonoText>
      {after}
    </>
  );
}
