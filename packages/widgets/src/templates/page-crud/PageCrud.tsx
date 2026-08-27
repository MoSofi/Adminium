// SPDX-License-Identifier: AGPL-3.0-only
import {
  Button,
  ConfirmModal,
  Drawer,
  DrawerBody,
  DrawerHeader,
  EmptyState,
  FilterChip,
  IconButton,
  KeyValueList,
  KeyValueRow,
  ModalBody,
  ModalHeader,
  MonoText,
  SearchInput,
  Spinner,
  ToastStack,
  TwoPhaseModal,
  useModalFlow,
  useToastQueue,
} from '@adminium/ui';
import { getFormatters } from '@adminium/i18n';
import { useMaybeT } from '@adminium/i18n/react';
import { ArrowUpRight, Eye, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { RecordDetail } from './RecordDetail.js';
import { RecordForm } from './RecordForm.js';
import { isDeletePreview } from './crud-api.js';
import type {
  CrudApi,
  CrudExportFormat,
  CrudFilterCondition,
  CrudListParams,
  CrudReferenceCount,
  CrudRow,
  CrudSort,
} from './crud-api.js';
import { BulkActionToolbar } from '../../families/tables/BulkActionToolbar.js';
import { DataGrid } from '../../families/tables/DataGrid.js';
import { PaginationFooter } from '../../families/tables/PaginationFooter.js';
import type { CellContext } from '../../families/tables/cells.js';
import { displayValueOf, rowIdOf } from '../../families/tables/column-spec.js';
import type { GridColumnSpec } from '../../families/tables/column-spec.js';
import type { WidgetEvent } from '../../registry/types.js';
import { describeDataError } from '../../lib/data-error.js';

/**
 * `page-crud` — the per-table resource template (09-generated-app.md §7.1;
 * annex §14): toolbar (search + filter chips + "New row" — DB framing) that
 * morphs into `bulk-action-toolbar` on selection (CSV export + cascade
 * delete), type-aware `data-grid` over the CRUD API, keyset
 * `pagination-footer`, generated create/edit forms (TwoPhaseModal create —
 * domain framing), references-preflight type-to-confirm cascade delete, and
 * undo toasts on every mutation.
 *
 * ROW SEMANTICS (30-record-pages.md D1/§3.3): a row is a LINK — click/Enter
 * emit `record-open` and the host navigates to the record PAGE
 * (`/p/$slug/r/$recordId`, rendered by `page-record`). The old
 * route-controlled detail drawer survives as an ephemeral PEEK behind the eye
 * action in the row-actions column: plain component state, no URL write, and
 * an "Open page" affordance in its header so the peek is a step toward the
 * page, never a dead end.
 *
 * All data access flows through the injected `CrudApi` — the dashboard
 * interpreter implements it against `/api/v1/data/:connectionId/:table`; the
 * host owns all navigation through the `record-open` events.
 */

export const PAGE_CRUD_TEMPLATE_ID = 'page-crud';

/**
 * The format the selection bar's Export produces. One button, one format:
 * `bulk-action-toolbar` renders flat buttons with nowhere to put a chooser,
 * and CSV is the interchange default every consumer of an admin export
 * expects. JSON-lines stays reachable through `CrudApi.export` and the Data
 * exports page; `xlsx` is a server 422 (see `lib/export.ts`).
 */
const BULK_EXPORT_FORMAT: CrudExportFormat = 'csv';

export interface PageCrudLabels {
  /** Header CTA — DB framing ("New row"). */
  newRow?: string | undefined;
  /** Create-modal title — domain framing ("Add customer"). */
  createTitle?: string | undefined;
  createSubmit?: string | undefined;
  searchPlaceholder?: string | undefined;
  deleteAction?: string | undefined;
  /** Bulk export of the selection (CSV — see `BULK_EXPORT_FORMAT`). */
  exportAction?: string | undefined;
  dismiss?: string | undefined;
  undo?: string | undefined;
  editTitle?: string | undefined;
  close?: string | undefined;
  /** Accessible name of the row's eye action (30 D1). */
  peek?: string | undefined;
}

/**
 * The saved-view-relevant slice of the toolbar query state (M5-T06). The host
 * serializes this into `adminium_views.config` and restores it via the initial
 * props (`initialSearch`/`defaultSort`/`initialFilters`/`pageSize`) on remount.
 */
export interface PageCrudGridState {
  search: string;
  sort: CrudSort | null;
  filters: CrudFilterCondition[];
  pageSize: number;
}

export interface PageCrudProps {
  api: CrudApi;
  columns: readonly GridColumnSpec[];
  /** Page scope (envelope `source`) — events carry it. */
  source: { connectionId: string | null; table: string };
  /** Singular entity noun for domain framing ("customer"). */
  entityName?: string | undefined;
  pageSize?: number | undefined;
  defaultSort?: CrudSort | null | undefined;
  /** Seeded filter conditions (chips scaffold). */
  initialFilters?: readonly CrudFilterCondition[] | undefined;
  /** Seeded toolbar search text (saved-view restore). */
  initialSearch?: string | undefined;
  /** Rendered at the start of the toolbar — e.g. the saved-views switcher. */
  toolbarAccessory?: ReactNode | undefined;
  /** Notified whenever the saved-view-relevant query state changes. */
  onGridStateChange?: ((state: PageCrudGridState) => void) | undefined;
  canCreate?: boolean | undefined;
  canUpdate?: boolean | undefined;
  canDelete?: boolean | undefined;
  /** Caller may reveal PII cells (server sends them unmasked). */
  canUnmask?: boolean | undefined;
  /** Host event sink: row click/Enter and FK chips emit `record-open` here
   *  (the host navigates to the record page, 30 D1), drill-through, mutate. */
  onEvent?: ((event: WidgetEvent) => void) | undefined;
  locale?: string | undefined;
  currency?: string | undefined;
  labels?: PageCrudLabels | undefined;
  testId?: string | undefined;
}

/** Debounce for the toolbar search → `q` param. */
export const SEARCH_DEBOUNCE_MS = 250;

interface ListState {
  rows: CrudRow[];
  nextCursor: string | null;
  loading: boolean;
  /**
   * The REJECTION, not its message.
   *
   * This was a flattened string, which threw away the server's error code
   * before anything could read it — so a connection an operator had paused
   * (meta wave 0019) rendered as "Query failed" under a Retry button that
   * could never work. `describeDataError` needs the object.
   */
  error: unknown;
}

interface DeleteTarget {
  record: CrudRow;
  references: CrudReferenceCount[];
  /** null while the preflight is in flight. */
  loaded: boolean;
}

function entityFromTable(table: string): string {
  const name = table.split('.').pop() ?? table;
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

const FILTER_OP_GLYPHS: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'in',
  like: '~',
  ilike: '~',
  is_null: 'is null',
  not_null: 'not null',
  between: '…',
};

export function PageCrud({
  api,
  columns,
  source,
  entityName,
  pageSize: initialPageSize = 50,
  defaultSort = null,
  initialFilters = [],
  initialSearch = '',
  toolbarAccessory,
  onGridStateChange,
  canCreate = true,
  canUpdate = true,
  canDelete = true,
  canUnmask = false,
  onEvent,
  locale,
  currency,
  labels,
  testId,
}: PageCrudProps) {
  const entity = entityName ?? entityFromTable(source.table);
  const queue = useToastQueue();
  const t = useMaybeT();

  // --- query state -----------------------------------------------------------
  const [search, setSearch] = useState(initialSearch);
  const [q, setQ] = useState(initialSearch);
  const [sort, setSort] = useState<CrudSort | null>(defaultSort);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [filters, setFilters] = useState<readonly CrudFilterCondition[]>(initialFilters);
  /** Keyset history: cursors of the pages before the current one ('' = first). */
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [cursor, setCursor] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  // --- data ------------------------------------------------------------------
  const [list, setList] = useState<ListState>({ rows: [], nextCursor: null, loading: true, error: null });
  const [total, setTotal] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /**
   * THE SELECTED ROWS THEMSELVES, kept because the selection outlives the page
   * it was made on. Paging forward replaces `list.rows`, and the browser-side
   * export used to filter that array by the selected ids — so selecting on page
   * one, paging forward, selecting again and exporting silently wrote a file
   * with only the second page's rows in it. Nothing said so; the file just had
   * fewer rows than the toolbar's count.
   *
   * A row must be ON SCREEN to be selected, which is what makes the snapshot
   * fillable at all — and what decides where each half of it is maintained:
   * membership on selection, removal on state, freshness on the list. Held in a
   * ref rather than state because nothing renders from it — writing it during
   * render would be a second source of truth for the same selection.
   */
  const selectedRows = useRef(new Map<string, CrudRow>());

  /**
   * Membership is captured HERE, in the handler, from the rows the grid was
   * rendering when the click happened — not in an effect keyed on `list.rows`.
   * An effect can only add rows that are loaded when it runs, so it made
   * membership depend on effect ordering against the list, which is the same
   * class of bug as the one this snapshot exists to fix. The handler cannot
   * miss: the row was on screen, or it could not have been clicked.
   */
  const changeSelection = useCallback(
    (next: ReadonlySet<string>) => {
      const snapshot = selectedRows.current;
      for (const row of list.rows) {
        const id = rowIdOf(columns, row);
        if (next.has(id)) snapshot.set(id, row);
      }
      setSelected(next);
    },
    [columns, list.rows],
  );

  // REMOVAL is derived from state instead, because several paths drop a
  // selection without going through the grid at all — Clear, bulk delete, and
  // the single-row delete. Deriving it means none of them can forget.
  useEffect(() => {
    const snapshot = selectedRows.current;
    for (const id of snapshot.keys()) if (!selected.has(id)) snapshot.delete(id);
  }, [selected]);

  // FRESHNESS, and nothing else: a row that is already in the snapshot takes
  // the newer copy when the list reloads, so an edited row exports what it
  // says on screen. This cannot add or drop membership.
  useEffect(() => {
    const snapshot = selectedRows.current;
    for (const row of list.rows) {
      const id = rowIdOf(columns, row);
      if (snapshot.has(id)) snapshot.set(id, row);
    }
  }, [columns, list.rows]);

  const listParams = useMemo<CrudListParams>(
    () => ({
      limit: pageSize,
      cursor,
      ...(q === '' ? {} : { q }),
      ...(filters.length === 0 ? {} : { where: filters.length === 1 ? (filters[0] as CrudFilterCondition) : { and: [...filters] } }),
      ...(sort === null ? {} : { order: [sort] }),
    }),
    [pageSize, cursor, q, filters, sort],
  );

  /**
   * Debounced search → q, AND ONLY WHEN THERE IS SOMETHING TO DEBOUNCE.
   *
   * Without the guard this effect also runs on mount, and 250ms later it fired
   * `setCursor('')` on a table nobody had searched — snapping the grid back to
   * page one under anyone who had paged forward inside that window, and
   * unmounting the rows they were looking at. Rare by hand, reliable on a busy
   * machine where the timer lands late: it is what made the cross-page export
   * test fail one run in three, by detaching the checkbox mid-click.
   *
   * `search === q` is exactly "the live query already says this" — true on
   * mount, and true again the moment the timer below has fired, which is what
   * keeps this from re-arming itself.
   */
  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => {
      setQ(search);
      setCursor('');
      setCursorStack([]);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q]);

  // Report the saved-view-relevant query state so the host can persist a view
  // from the current grid (M5-T06). Pagination cursor is intentionally excluded
  // — a view restores a query, not a scroll position.
  useEffect(() => {
    onGridStateChange?.({ search, sort, filters: [...filters], pageSize });
  }, [onGridStateChange, search, sort, filters, pageSize]);

  // Main list load (keyset mode).
  useEffect(() => {
    let alive = true;
    setList((current) => ({ ...current, loading: true, error: null }));
    api
      .list(listParams)
      .then((result) => {
        if (!alive) return;
        setList({ rows: result.data, nextCursor: result.cursor?.next ?? null, loading: false, error: null });
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setList({ rows: [], nextCursor: null, loading: false, error: reason });
      });
    return () => {
      alive = false;
    };
  }, [api, listParams, reloadTick]);

  // Count probe — keyset replies carry no total (08 §2.7), so the footer's
  // "of 8,402" and the unique-check microcopy come from one estimated count.
  useEffect(() => {
    let alive = true;
    api
      .list({ limit: 1, offset: 0, count: 'estimated', ...(q === '' ? {} : { q }) })
      .then((result) => {
        if (alive) setTotal(result.page?.total ?? null);
      })
      .catch(() => {
        if (alive) setTotal(null);
      });
    return () => {
      alive = false;
    };
  }, [api, q, filters, reloadTick]);

  const refetch = useCallback(() => {
    setReloadTick((tick) => tick + 1);
  }, []);

  /**
   * The error panel's contents, or null while the list is fine.
   *
   * Split out because a PAUSED connection is not a failed query: it gets its
   * own title, a calmer tone and no Retry (`lib/data-error.ts`).
   */
  const listError =
    list.error == null
      ? null
      : describeDataError(
          list.error,
          t('ui:templates.crud.queryFailed', 'Query failed'),
          t('ui:templates.common.connectionPaused', 'This connection is paused'),
        );

  // --- peek (30 D1) ----------------------------------------------------------
  // EPHEMERAL local state, deliberately: the record URL now means the record
  // PAGE, so the peek writes nothing to the URL — closing it leaves search,
  // sort, filters and pagination exactly as they were.
  const [peekId, setPeekId] = useState<string | null>(null);

  /** Row click/Enter → the host navigates to the record page (30 §3.3). */
  const openRecordPage = useCallback(
    (recordId: string) => {
      onEvent?.({
        type: 'record-open',
        ...(source.connectionId === null ? {} : { connectionId: source.connectionId }),
        table: source.table,
        recordId,
      });
    },
    [onEvent, source.connectionId, source.table],
  );

  // --- create ----------------------------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const createFlow = useModalFlow<CrudRow>();
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});

  // --- edit ------------------------------------------------------------------
  const [editRecord, setEditRecord] = useState<CrudRow | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // --- delete ----------------------------------------------------------------
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<readonly string[] | null>(null);

  // --- export ----------------------------------------------------------------
  const [exporting, setExporting] = useState(false);

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

  const pushUndoToast = useCallback(
    (title: string, undoToken: string | null) => {
      queue.push({
        variant: 'success',
        title,
        ...(undoToken === null
          ? {}
          : {
              action: {
                label: labels?.undo ?? t('ui:action.undo', 'Undo'),
                onAction: () => {
                  api
                    .undo(undoToken)
                    .then(() => {
                      queue.push({ variant: 'info', title: t('ui:templates.crud.toast.undone', 'Change undone.') });
                      refetch();
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
    },
    [queue, api, refetch, labels?.undo, t],
  );

  const fieldErrorsOf = (reason: unknown): Record<string, string> | null => {
    if (typeof reason === 'object' && reason !== null && 'fieldErrors' in reason) {
      return (reason as { fieldErrors: Record<string, string> }).fieldErrors;
    }
    return null;
  };

  const handleCreate = (values: CrudRow) => {
    setCreateErrors({});
    api
      .create(values)
      .then((result) => {
        createFlow.toSuccess(result.data ?? values);
        pushUndoToast(
          t('ui:templates.crud.toast.created', '{entity} created.', {
            entity: `${entity[0]?.toUpperCase() ?? ''}${entity.slice(1)}`,
          }),
          result.undoToken,
        );
        refetch();
      })
      .catch((reason: unknown) => {
        const fieldErrors = fieldErrorsOf(reason);
        if (fieldErrors !== null) {
          setCreateErrors(fieldErrors);
          return;
        }
        queue.push({
          variant: 'error',
          title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.createFailed', 'Create failed.'),
        });
      });
  };

  const handleUpdate = (values: CrudRow) => {
    if (editRecord === null) return;
    const recordId = rowIdOf(columns, editRecord);
    setEditErrors({});
    api
      .update(recordId, values)
      .then((result) => {
        setEditRecord(null);
        pushUndoToast(t('ui:templates.crud.toast.saved', 'Changes saved.'), result.undoToken);
        refetch();
      })
      .catch((reason: unknown) => {
        const fieldErrors = fieldErrorsOf(reason);
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

  const openDeleteFor = (record: CrudRow) => {
    setDeleteTarget({ record, references: [], loaded: false });
    const recordId = rowIdOf(columns, record);
    // References preflight — consequences render in the confirm modal (09 §7.1).
    api
      .remove(recordId, { dryRun: true })
      .then((result) => {
        setDeleteTarget((current) =>
          current !== null && rowIdOf(columns, current.record) === recordId
            ? { ...current, references: isDeletePreview(result) ? result.references : [], loaded: true }
            : current,
        );
      })
      .catch(() => {
        setDeleteTarget((current) =>
          current !== null && rowIdOf(columns, current.record) === recordId ? { ...current, loaded: true } : current,
        );
      });
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    const recordId = rowIdOf(columns, deleteTarget.record);
    try {
      const result = await api.remove(recordId, { confirm: true });
      setDeleteTarget(null);
      if (peekId === recordId) setPeekId(null);
      // A deleted row cannot stay SELECTED. The bulk bar would go on counting
      // it, and — now that the export carries the whole selection rather than
      // whatever the loaded page happens to hold — the file would carry a row
      // the table no longer has. The bulk-delete path already clears the whole
      // selection; this is the same rule for the single-row path.
      setSelected((current) => {
        if (!current.has(recordId)) return current;
        const next = new Set(current);
        next.delete(recordId);
        return next;
      });
      pushUndoToast(
        t('ui:templates.crud.toast.deleted', '{name} deleted.', { name: displayValueOf(columns, deleteTarget.record) }),
        isDeletePreview(result) ? null : result.undoToken,
      );
      refetch();
    } catch (reason) {
      queue.push({
        variant: 'error',
        title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.deleteFailed', 'Delete failed.'),
      });
    }
  };

  const confirmBulkDelete = async () => {
    if (bulkDeleteIds === null) return;
    try {
      // `count` drives the ICU plural; `n` is the pre-stringified count so the
      // digits render exactly as before (no locale regrouping).
      const bulkDeletedTitle = (count: number) =>
        t('ui:templates.crud.toast.bulkDeleted', '{count, plural, one {{n} row deleted.} other {{n} rows deleted.}}', {
          count,
          n: String(count),
        });
      if (api.bulk !== undefined) {
        const result = await api.bulk('delete', [...bulkDeleteIds]);
        pushUndoToast(bulkDeletedTitle(result.results.filter((r) => r.ok).length), result.undoToken);
      } else {
        for (const id of bulkDeleteIds) await api.remove(id, { confirm: true });
        pushUndoToast(bulkDeletedTitle(bulkDeleteIds.length), null);
      }
      setBulkDeleteIds(null);
      setSelected(new Set());
      refetch();
    } catch (reason) {
      queue.push({
        variant: 'error',
        title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.bulkDeleteFailed', 'Bulk delete failed.'),
      });
    }
  };

  /**
   * Bulk Export. `api.export` queues the server-side run (whole result set,
   * server-side masking, artifact in Data exports); without it the selected
   * rows — already on screen — are serialized and downloaded here, which is
   * the difference between an export button and a dead one. `xlsx` is offered
   * by neither path: `POST /exports` rejects it 422 by design.
   *
   * The format is fixed at CSV rather than chosen here. `BulkActionToolbar`
   * takes flat buttons and cannot host a chooser, so a second format would
   * mean a second permanent button in the selection bar; JSON-lines is a
   * pipeline format whose home is the Data exports page's format selector,
   * and `lib/export.ts` + `CrudApi.export` still carry both.
   */
  const runExport = async (format: CrudExportFormat, ids: readonly string[]) => {
    setExporting(true);
    try {
      if (api.export !== undefined) {
        await api.export({ format, ids: [...ids], params: listParams });
        queue.push({
          variant: 'success',
          // Nothing visible happens on the queued path — the artifact shows up
          // on another page — so this one has to say so. `exportBuilder.running`
          // is the bundle's existing "Preparing your export…"; the export-run it
          // describes is literally the one being queued here.
          title: t('ui:widgets.forms.exportBuilder.running', 'Preparing your export…'),
        });
      } else {
        // Dynamic: DOM-only serialization behind a click, and `/p/$slug` is in
        // the dashboard's entry chunk (scripts/check-entry-budget.mjs).
        const { downloadRows } = await import('../../lib/export.js');
        // From the SNAPSHOT, not from `list.rows` — the selection spans pages
        // and the loaded page is only the last of them. In `ids` order, which
        // is the order the rows were selected in.
        const snapshot = selectedRows.current;
        const rows = ids.flatMap((id) => {
          const row = snapshot.get(id);
          return row === undefined ? [] : [row];
        });
        downloadRows(format, columns.map((column) => column.name), rows, source.table);
        // No toast on the whole-selection path: the file lands in the browser's
        // own download UI, which is the confirmation. A toast would restate it.
        if (rows.length < ids.length) {
          // Unreachable by design — every id in `ids` was selected from a row
          // that had been rendered, which is what fills the snapshot. It is
          // here so that this export can never again be quietly short: an
          // incomplete file has to say the number it wrote.
          queue.push({
            variant: 'warning',
            title: t(
              'ui:templates.crud.toast.exportIncomplete',
              'Exported {written, number} of {selected, number} selected rows — reload and try again.',
              { written: rows.length, selected: ids.length },
            ),
          });
        }
      }
      // The selection SURVIVES an export: it is not destructive, and the rows
      // are usually still wanted afterwards.
    } catch (reason) {
      queue.push({
        variant: 'error',
        title: reason instanceof Error ? reason.message : t('ui:state.error', 'Something went wrong'),
      });
    } finally {
      setExporting(false);
    }
  };

  const editableColumns = columns;
  const selectedIds = useMemo(() => [...selected], [selected]);
  const rangeStart = list.rows.length === 0 ? 0 : cursorStack.length * pageSize + 1;
  const rangeEnd = cursorStack.length * pageSize + list.rows.length;
  const numberFormat = useMemo(() => getFormatters(locale ?? 'en-US'), [locale]);

  // 'Type {value} to confirm' is rich text (the value renders in MonoText):
  // format with a sentinel arg, then splice the styled node in at the seam.
  const confirmPromptFor = (value: string): ReactNode => {
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
  };

  return (
    <div data-part="page-crud" data-testid={testId} className="flex h-full min-h-0 flex-col">
      {/* ONE card holds toolbar + grid + footer, each pair separated by a
          hairline — the composition both comps use (Data Table.dc.html and
          CRUD Admin.dc.html are identical on this point). The toolbar used to
          float above a separate card, which read as two unrelated slabs and
          left the grid's card without the elevation every other surface has.
          `shadow-card` is `--shadow`, the token the comps set on this box.

          Height is content-driven and only CAPPED by the viewport
          (`max-h-full`, not `flex-1`): a page holding ten rows draws a card
          that ends just under its footer instead of one stretched to the
          bottom of the window with a band of empty surface between the last
          row and the pagination bar. Past the cap the card stops growing and
          the grid region below scrolls inside it, so the toolbar and footer
          stay pinned exactly as before. The outer `h-full` is what
          `max-h-full` resolves against, so both are load-bearing. */}
      <div className="flex max-h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        {/* Toolbar. Search first, then the views/filter control, then the
            active filter chips; only the END slot swaps on selection (09 §7.1
            "morphs"). Selecting rows used to replace the WHOLE rail, which took
            the search box and the chips off screen exactly when a user is
            mid-way through narrowing a set — so they could no longer see, let
            alone adjust, the query their selection came from. */}
        <div className="flex min-h-[62px] items-center gap-2.5 border-b border-border px-4 py-3.5">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              labels?.searchPlaceholder ??
              t('ui:templates.crud.searchPlaceholder', 'Search {table}…', { table: source.table })
            }
            className="w-72"
            onClear={() => setSearch('')}
            clearLabel={t('ui:action.clearSearch', 'Clear search')}
          />
          {toolbarAccessory}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {filters.map((filter, index) => (
              <FilterChip
                key={`${filter.column}-${String(index)}`}
                field={filter.column}
                op={FILTER_OP_GLYPHS[filter.op] ?? filter.op}
                value={filter.op === 'is_null' || filter.op === 'not_null' ? '' : String(filter.value)}
                onRemove={() => {
                  setFilters((current) => current.filter((_, i) => i !== index));
                  setCursor('');
                  setCursorStack([]);
                }}
                removeLabel={t('ui:templates.crud.removeFilter', 'Remove {column} filter', { column: filter.column })}
              />
            ))}
          </div>
          {selectedIds.length > 0 ? (
            <BulkActionToolbar
              selectedIds={selectedIds}
              actions={[
                {
                  key: 'export',
                  label: labels?.exportAction ?? t('ui:templates.crud.exportAction', 'Export'),
                  disabled: exporting,
                },
                ...(canDelete
                  ? [{ key: 'delete', label: labels?.deleteAction ?? t('ui:action.delete', 'Delete'), danger: true }]
                  : []),
              ]}
              onAction={(key, ids) => {
                if (key === 'delete') setBulkDeleteIds(ids);
                if (key === 'export') void runExport(BULK_EXPORT_FORMAT, ids);
              }}
              onClear={() => setSelected(new Set())}
            />
          ) : (
            canCreate && (
              /* `topbar` is the size authored for exactly this CTA — the comp's
                 700 weight and asymmetric inset that keeps the leading `+` from
                 drifting off its label. The default `md` rendered it a weight
                 lighter and evenly padded. */
              <Button size="topbar" iconLeft={<Plus />} onClick={() => setCreateOpen(true)}>
                {labels?.newRow ?? t('ui:templates.crud.newRow', 'New row')}
              </Button>
            )
          )}
        </div>

        {listError !== null ? (
          <EmptyState
            tone={listError.tone}
            title={listError.title}
            body={listError.body}
            actions={
              // A paused connection offers no Retry: see `describeDataError`.
              listError.retryable ? (
                <Button size="sm" variant="secondary" onClick={refetch}>
                  {t('ui:action.retry', 'Retry')}
                </Button>
              ) : undefined
            }
          />
        ) : list.loading && list.rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner label={t('ui:templates.crud.loadingRows', 'Loading rows')} />
          </div>
        ) : list.rows.length === 0 ? (
          q !== '' || filters.length > 0 ? (
            <EmptyState
              preset="no-matches"
              title={t('ui:templates.crud.noMatchesTitle', 'No matching rows')}
              body={t('ui:templates.common.noMatchesBody', 'Try a different search or remove a filter.')}
            />
          ) : (
            <EmptyState
              preset="no-data"
              // `count` is the row total behind this state (always 0 here) so
              // locales get the ICU plural machinery on the entity noun.
              title={t('ui:templates.crud.emptyTitle', '{count, plural, one {No {entity} yet} other {No {entity}s yet}}', {
                count: 0,
                entity,
              })}
              {...(canCreate
                ? {
                    actions: (
                      <Button size="sm" iconLeft={<Plus />} onClick={() => setCreateOpen(true)}>
                        {labels?.newRow ?? t('ui:templates.crud.newRow', 'New row')}
                      </Button>
                    ),
                  }
                : {})}
            />
          )
        ) : (
          <div className="nb-scroll min-h-0 flex-1 overflow-y-auto">
            <DataGrid
              columns={columns}
              rows={list.rows}
              sort={sort}
              onSortChange={(next) => {
                setSort(next === null ? null : next);
                setCursor('');
                setCursorStack([]);
              }}
              selectable
              selected={selected}
              onSelectedChange={changeSelection}
              onRowOpen={(row) => openRecordPage(rowIdOf(columns, row))}
              rowEnd={(row) => (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={labels?.peek ?? t('ui:templates.crud.peekAction', 'Peek')}
                  onClick={() => setPeekId(rowIdOf(columns, row))}
                >
                  <Eye className="size-3.5" />
                </IconButton>
              )}
              labels={{ rowActions: t('ui:widgets.tables.dataGrid.rowActionsLabel', 'Row actions') }}
              cellContext={cellContext}
            />
          </div>
        )}
        <PaginationFooter
          {...(locale === undefined ? {} : { locale })}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          total={total}
          hasPrev={cursorStack.length > 0}
          hasNext={list.nextCursor !== null}
          onPrev={() => {
            const previous = cursorStack.at(-1);
            if (previous === undefined) return;
            setCursorStack((stack) => stack.slice(0, -1));
            setCursor(previous);
          }}
          onNext={() => {
            if (list.nextCursor === null) return;
            setCursorStack((stack) => [...stack, cursor]);
            setCursor(list.nextCursor);
          }}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCursor('');
            setCursorStack([]);
          }}
          disabled={list.loading}
        />
      </div>

      {/* Create — TwoPhaseModal, domain framing (09 §7.1). */}
      <TwoPhaseModal
        flow={createFlow}
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateErrors({});
        }}
        successTitle={(payload) =>
          t('ui:templates.crud.createSuccessTitle', '{name} added', { name: displayValueOf(columns, payload) })
        }
        successBody={() => t('ui:templates.crud.createSuccessBody', 'You can undo this from the toast.')}
        doneLabel={t('ui:widgets.forms.modalWizard.done', 'Done')}
      >
        <ModalHeader
          title={labels?.createTitle ?? t('ui:templates.crud.createTitle', 'Add {entity}', { entity })}
          subtitle={t('ui:templates.crud.createSubtitle', 'Creates one row in {table}.', { table: source.table })}
          closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
        />
        <ModalBody>
          <RecordForm
            formId="page-crud-create-form"
            columns={editableColumns}
            mode="create"
            errors={createErrors}
            lookup={api.lookup?.bind(api)}
            onSubmit={handleCreate}
            uniqueHelper={() =>
              total === null
                ? t('ui:templates.crud.uniqueHelper', 'Must be unique in {table}.', { table: source.table })
                : // `count` drives the ICU plural; `n` keeps the pre-formatted digits.
                  t(
                    'ui:templates.crud.uniqueHelperCounted',
                    '{count, plural, one {Checked against {n} row.} other {Checked against {n} rows.}}',
                    { count: total, n: numberFormat.number(total) },
                  )
            }
            footer={
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                  {t('ui:action.cancel', 'Cancel')}
                </Button>
                <Button type="submit">
                  {labels?.createSubmit ?? t('ui:templates.crud.createSubmit', 'Add {entity}', { entity })}
                </Button>
              </div>
            }
          />
        </ModalBody>
      </TwoPhaseModal>

      {/* Peek — ephemeral row preview behind the eye action (30 D1). The
          header's "Open page" lands on the record page, so the peek is a step
          toward it, never a dead end. */}
      <Drawer open={peekId !== null} onOpenChange={(open) => !open && setPeekId(null)} size="md">
        <DrawerHeader title={entity} closeLabel={labels?.close ?? t('ui:action.close', 'Close')}>
          <button
            type="button"
            data-part="peek-open-page"
            className="mt-0.5 inline-flex items-center gap-1 text-body-sm font-semibold text-accent hover:underline"
            onClick={() => {
              const target = peekId;
              setPeekId(null);
              if (target !== null) openRecordPage(target);
            }}
          >
            {t('ui:templates.crud.openPage', 'Open page')}
            <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </DrawerHeader>
        <DrawerBody>
          {peekId !== null && (
            <RecordDetail
              api={api}
              columns={columns}
              recordId={peekId}
              cellContext={cellContext}
              {...(canUpdate ? { onEdit: (record: CrudRow) => setEditRecord(record) } : {})}
              {...(canDelete ? { onDelete: (record: CrudRow) => openDeleteFor(record) } : {})}
            />
          )}
        </DrawerBody>
      </Drawer>

      {/* Edit — generated form over the record. */}
      <Drawer open={editRecord !== null} onOpenChange={(open) => !open && setEditRecord(null)} size="md">
        <DrawerHeader
          title={labels?.editTitle ?? t('ui:templates.crud.editTitle', 'Edit {entity}', { entity })}
          closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
        />
        <DrawerBody>
          {editRecord !== null && (
            <RecordForm
              formId="page-crud-edit-form"
              columns={editableColumns}
              mode="edit"
              initialValues={editRecord}
              errors={editErrors}
              lookup={api.lookup?.bind(api)}
              onSubmit={handleUpdate}
              footer={
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" onClick={() => setEditRecord(null)}>
                    {t('ui:action.cancel', 'Cancel')}
                  </Button>
                  <Button type="submit">{t('ui:templates.crud.saveSubmit', 'Save changes')}</Button>
                </div>
              }
            />
          )}
        </DrawerBody>
      </Drawer>

      {/* Cascade-aware type-to-confirm delete (09 §7.1). */}
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
        confirmWord={deleteTarget === null ? '' : displayValueOf(columns, deleteTarget.record)}
        promptLabel={deleteTarget === null ? '' : confirmPromptFor(displayValueOf(columns, deleteTarget.record))}
        confirmLabel={t('ui:action.delete', 'Delete')}
        cancelLabel={t('ui:action.cancel', 'Cancel')}
        closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
        onConfirm={confirmDelete}
      />

      {/* Bulk delete — consequence totals + type-to-confirm count. */}
      <ConfirmModal
        open={bulkDeleteIds !== null}
        onOpenChange={(open) => !open && setBulkDeleteIds(null)}
        title={t('ui:templates.crud.bulkDeleteTitle', '{count, plural, one {Delete {n} row} other {Delete {n} rows}}', {
          count: bulkDeleteIds?.length ?? 0,
          n: String(bulkDeleteIds?.length ?? 0),
        })}
        body={t('ui:templates.crud.bulkDeleteBody', 'Referential consequences apply to every selected row.')}
        confirmWord={String(bulkDeleteIds?.length ?? 0)}
        promptLabel={confirmPromptFor(String(bulkDeleteIds?.length ?? 0))}
        confirmLabel={t('ui:templates.crud.bulkDeleteConfirm', 'Delete rows')}
        cancelLabel={t('ui:action.cancel', 'Cancel')}
        closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
        onConfirm={confirmBulkDelete}
      />

      {/* aria-live keeps the stack out of Radix's modal hideOthers sweep
          (aria-hidden pkg preserves live regions) — undo toasts fired while
          the create/confirm modal is still open stay reachable. */}
      <ToastStack
        {...queue.stackProps}
        aria-live="polite"
        dismissLabel={labels?.dismiss ?? t('ui:widgets.feeds.toastStack.dismissLabel', 'Dismiss')}
      />
    </div>
  );
}
