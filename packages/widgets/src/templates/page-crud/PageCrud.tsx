import {
  Button,
  ConfirmModal,
  Drawer,
  DrawerBody,
  DrawerHeader,
  EmptyState,
  FilterChip,
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
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { RecordDetail } from './RecordDetail.js';
import { RecordForm } from './RecordForm.js';
import { isDeletePreview } from './crud-api.js';
import type {
  CrudApi,
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

/**
 * `page-crud` — the per-table resource template (09-generated-app.md §7.1;
 * annex §14): toolbar (search + filter chips + "New row" — DB framing) that
 * morphs into `bulk-action-toolbar` on selection, type-aware `data-grid`
 * over the CRUD API, keyset `pagination-footer`, detail panel
 * (`detail-key-value` + inbound-FK tabs) for `/p/$slug/r/$recordId`,
 * generated create/edit forms (TwoPhaseModal create — domain framing),
 * references-preflight type-to-confirm cascade delete, and undo toasts on
 * every mutation.
 *
 * All data access flows through the injected `CrudApi` — the dashboard
 * interpreter implements it against `/api/v1/data/:connectionId/:table` and
 * owns routing (detail id in/out via `detailRecordId`/`onDetailRecordChange`).
 */

export const PAGE_CRUD_TEMPLATE_ID = 'page-crud';

export interface PageCrudLabels {
  /** Header CTA — DB framing ("New row"). */
  newRow?: string | undefined;
  /** Create-modal title — domain framing ("Add customer"). */
  createTitle?: string | undefined;
  createSubmit?: string | undefined;
  searchPlaceholder?: string | undefined;
  deleteAction?: string | undefined;
  exportAction?: string | undefined;
  dismiss?: string | undefined;
  undo?: string | undefined;
  editTitle?: string | undefined;
  close?: string | undefined;
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
  /** Route-controlled detail record (child route `/r/$recordId`). */
  detailRecordId?: string | null | undefined;
  onDetailRecordChange?: ((recordId: string | null) => void) | undefined;
  /** Host event sink (FK chips open other tables' records, drill-through). */
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
  error: string | null;
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
  detailRecordId,
  onDetailRecordChange,
  onEvent,
  locale,
  currency,
  labels,
  testId,
}: PageCrudProps) {
  const entity = entityName ?? entityFromTable(source.table);
  const queue = useToastQueue();

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

  // Debounced search → q.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setCursor('');
      setCursorStack([]);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

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
        setList({
          rows: [],
          nextCursor: null,
          loading: false,
          error: reason instanceof Error ? reason.message : 'Query failed',
        });
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

  // --- detail ----------------------------------------------------------------
  const [internalDetailId, setInternalDetailId] = useState<string | null>(null);
  const detailId = detailRecordId !== undefined ? detailRecordId : internalDetailId;
  const setDetailId = useCallback(
    (next: string | null) => {
      setInternalDetailId(next);
      onDetailRecordChange?.(next);
    },
    [onDetailRecordChange],
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
                label: labels?.undo ?? 'Undo',
                onAction: () => {
                  api
                    .undo(undoToken)
                    .then(() => {
                      queue.push({ variant: 'info', title: 'Change undone.' });
                      refetch();
                    })
                    .catch((reason: unknown) => {
                      queue.push({
                        variant: 'error',
                        title: reason instanceof Error ? reason.message : 'Undo failed.',
                      });
                    });
                },
              },
            }),
      });
    },
    [queue, api, refetch, labels?.undo],
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
        pushUndoToast(`${entity[0]?.toUpperCase() ?? ''}${entity.slice(1)} created.`, result.undoToken);
        refetch();
      })
      .catch((reason: unknown) => {
        const fieldErrors = fieldErrorsOf(reason);
        if (fieldErrors !== null) {
          setCreateErrors(fieldErrors);
          return;
        }
        queue.push({ variant: 'error', title: reason instanceof Error ? reason.message : 'Create failed.' });
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
        pushUndoToast('Changes saved.', result.undoToken);
        refetch();
      })
      .catch((reason: unknown) => {
        const fieldErrors = fieldErrorsOf(reason);
        if (fieldErrors !== null) {
          setEditErrors(fieldErrors);
          return;
        }
        queue.push({ variant: 'error', title: reason instanceof Error ? reason.message : 'Update failed.' });
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
      if (detailId === recordId) setDetailId(null);
      pushUndoToast(`${displayValueOf(columns, deleteTarget.record)} deleted.`, isDeletePreview(result) ? null : result.undoToken);
      refetch();
    } catch (reason) {
      queue.push({ variant: 'error', title: reason instanceof Error ? reason.message : 'Delete failed.' });
    }
  };

  const confirmBulkDelete = async () => {
    if (bulkDeleteIds === null) return;
    try {
      if (api.bulk !== undefined) {
        const result = await api.bulk('delete', [...bulkDeleteIds]);
        pushUndoToast(`${String(result.results.filter((r) => r.ok).length)} rows deleted.`, result.undoToken);
      } else {
        for (const id of bulkDeleteIds) await api.remove(id, { confirm: true });
        pushUndoToast(`${String(bulkDeleteIds.length)} rows deleted.`, null);
      }
      setBulkDeleteIds(null);
      setSelected(new Set());
      refetch();
    } catch (reason) {
      queue.push({ variant: 'error', title: reason instanceof Error ? reason.message : 'Bulk delete failed.' });
    }
  };

  const editableColumns = columns;
  const selectedIds = useMemo(() => [...selected], [selected]);
  const rangeStart = list.rows.length === 0 ? 0 : cursorStack.length * pageSize + 1;
  const rangeEnd = cursorStack.length * pageSize + list.rows.length;
  const numberFormat = useMemo(() => getFormatters(locale ?? 'en-US'), [locale]);

  return (
    <div data-part="page-crud" data-testid={testId} className="flex h-full min-h-0 flex-col">
      {/* Toolbar — morphs to the bulk bar while rows are selected (09 §7.1). */}
      <div className="flex min-h-12 items-center gap-2 pb-3">
        {selectedIds.length > 0 ? (
          <BulkActionToolbar
            selectedIds={selectedIds}
            actions={[
              { key: 'export', label: labels?.exportAction ?? 'Export' },
              ...(canDelete ? [{ key: 'delete', label: labels?.deleteAction ?? 'Delete', danger: true }] : []),
            ]}
            onAction={(key, ids) => {
              if (key === 'delete') setBulkDeleteIds(ids);
            }}
            onClear={() => setSelected(new Set())}
          />
        ) : (
          <>
            {toolbarAccessory}
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={labels?.searchPlaceholder ?? `Search ${source.table}…`}
              className="w-72"
              onClear={() => setSearch('')}
              clearLabel="Clear search"
            />
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
                  removeLabel={`Remove ${filter.column} filter`}
                />
              ))}
            </div>
            {canCreate && (
              <Button iconLeft={<Plus />} onClick={() => setCreateOpen(true)}>
                {labels?.newRow ?? 'New row'}
              </Button>
            )}
          </>
        )}
      </div>

      {/* Grid + footer. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        {list.error !== null ? (
          <EmptyState
            tone="danger"
            title="Query failed"
            body={list.error}
            actions={
              <Button size="sm" variant="secondary" onClick={refetch}>
                Retry
              </Button>
            }
          />
        ) : list.loading && list.rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner label="Loading rows" />
          </div>
        ) : list.rows.length === 0 ? (
          q !== '' || filters.length > 0 ? (
            <EmptyState preset="no-matches" title="No matching rows" body="Try a different search or remove a filter." />
          ) : (
            <EmptyState
              preset="no-data"
              title={`No ${entity}s yet`}
              {...(canCreate
                ? {
                    actions: (
                      <Button size="sm" iconLeft={<Plus />} onClick={() => setCreateOpen(true)}>
                        {labels?.newRow ?? 'New row'}
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
              onSelectedChange={setSelected}
              onRowOpen={(row) => setDetailId(rowIdOf(columns, row))}
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
        successTitle={(payload) => `${displayValueOf(columns, payload)} added`}
        successBody={() => 'You can undo this from the toast.'}
        doneLabel="Done"
      >
        <ModalHeader
          title={labels?.createTitle ?? `Add ${entity}`}
          subtitle={`Creates one row in ${source.table}.`}
          closeLabel={labels?.close ?? 'Close'}
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
                ? `Must be unique in ${source.table}.`
                : `Checked against ${numberFormat.number(total)} rows.`
            }
            footer={
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">{labels?.createSubmit ?? `Add ${entity}`}</Button>
              </div>
            }
          />
        </ModalBody>
      </TwoPhaseModal>

      {/* Detail panel — `/p/$slug/r/$recordId` (09 §7.1). */}
      <Drawer open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)} size="md">
        <DrawerHeader title={entity} closeLabel={labels?.close ?? 'Close'} />
        <DrawerBody>
          {detailId !== null && (
            <RecordDetail
              api={api}
              columns={columns}
              recordId={detailId}
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
          title={labels?.editTitle ?? `Edit ${entity}`}
          closeLabel={labels?.close ?? 'Close'}
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
                    Cancel
                  </Button>
                  <Button type="submit">Save changes</Button>
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
        title={`Delete ${entity}`}
        body={
          deleteTarget === null ? null : !deleteTarget.loaded ? (
            'Checking references…'
          ) : deleteTarget.references.length === 0 ? (
            'This row has no inbound references.'
          ) : (
            <div className="flex flex-col gap-2">
              <span>Deleting this row also affects:</span>
              <KeyValueList data-part="delete-consequences">
                {deleteTarget.references.map((reference) => (
                  <KeyValueRow key={reference.relationId} label={`${reference.table}.${reference.column}`} mono>
                    {`${String(reference.count)} ${reference.count === 1 ? 'row' : 'rows'}`}
                  </KeyValueRow>
                ))}
              </KeyValueList>
            </div>
          )
        }
        confirmWord={deleteTarget === null ? '' : displayValueOf(columns, deleteTarget.record)}
        promptLabel={
          deleteTarget === null ? '' : (
            <>
              Type <MonoText>{displayValueOf(columns, deleteTarget.record)}</MonoText> to confirm
            </>
          )
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        closeLabel={labels?.close ?? 'Close'}
        onConfirm={confirmDelete}
      />

      {/* Bulk delete — consequence totals + type-to-confirm count. */}
      <ConfirmModal
        open={bulkDeleteIds !== null}
        onOpenChange={(open) => !open && setBulkDeleteIds(null)}
        title={`Delete ${String(bulkDeleteIds?.length ?? 0)} rows`}
        body="Referential consequences apply to every selected row."
        confirmWord={String(bulkDeleteIds?.length ?? 0)}
        promptLabel={
          <>
            Type <MonoText>{String(bulkDeleteIds?.length ?? 0)}</MonoText> to confirm
          </>
        }
        confirmLabel="Delete rows"
        cancelLabel="Cancel"
        closeLabel={labels?.close ?? 'Close'}
        onConfirm={confirmBulkDelete}
      />

      {/* aria-live keeps the stack out of Radix's modal hideOthers sweep
          (aria-hidden pkg preserves live regions) — undo toasts fired while
          the create/confirm modal is still open stay reachable. */}
      <ToastStack {...queue.stackProps} aria-live="polite" dismissLabel={labels?.dismiss ?? 'Dismiss'} />
    </div>
  );
}
