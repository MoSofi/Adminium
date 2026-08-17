import { useMaybeT } from '@adminium/i18n/react';
import { Checkbox } from '@adminium/ui';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { RowSelectionState, SortingState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { CellValue, cellAlignClass } from './cells.js';
import type { CellContext } from './cells.js';
import { compareCellValues, rowIdOf } from './column-spec.js';
import type { GridColumnSpec, GridRow } from './column-spec.js';

/**
 * `data-grid` — the canonical CRUD table (annex §3): headless
 * @tanstack/react-table over ui primitives, CSS-grid-free `<table>`-less
 * layout is NOT required — we keep semantic rows via div grid per comp
 * (uppercase letter-spaced micro headers on `--surface-2`, hover highlight,
 * selected tint, checkbox multi-select, type-aware cells).
 *
 * Sorting: with `onSortChange` the grid is server-sorted (manualSorting —
 * the host reissues the query, 09 §7.1); without it, a client-side
 * type-aware sort applies `compareCellValues`, which coerces numeric columns
 * through `Number()` — the Data Table string-mrr defect fix
 * (research/ia-mapping.md §5).
 */

export interface DataGridSort {
  column: string;
  dir: 'asc' | 'desc';
}

export interface DataGridProps {
  columns: readonly GridColumnSpec[];
  rows: readonly GridRow[];
  /** Stable row id; defaults to the specs' PK columns (`rowIdOf`). */
  rowId?: ((row: GridRow) => string) | undefined;
  /** Current sort (server mode) or initial sort (client mode). */
  sort?: DataGridSort | null | undefined;
  /** Server-sort callback — presence switches the grid to manual sorting. */
  onSortChange?: ((sort: DataGridSort | null) => void) | undefined;
  /** Checkbox multi-select. */
  selectable?: boolean | undefined;
  selected?: ReadonlySet<string> | undefined;
  onSelectedChange?: ((ids: ReadonlySet<string>) => void) | undefined;
  /** Row click → detail (09 §7.1 `rowAction: detail`). */
  onRowOpen?: ((row: GridRow) => void) | undefined;
  /** Cell context: FK `record-open` events, PII unmask, format overrides. */
  cellContext?: CellContext | undefined;
  density?: 'comfortable' | 'compact' | undefined;
  /** Trailing per-row slot (kebab menu). */
  rowEnd?: ((row: GridRow) => ReactNode) | undefined;
  /** Accessible labels (i18n). */
  labels?:
    | {
        selectAll?: string | undefined;
        selectRow?: string | undefined;
        sortBy?: string | undefined;
      }
    | undefined;
  testId?: string | undefined;
}

const columnHelper = createColumnHelper<GridRow>();

export function DataGrid({
  columns,
  rows,
  rowId,
  sort,
  onSortChange,
  selectable = false,
  selected,
  onSelectedChange,
  onRowOpen,
  cellContext,
  density = 'comfortable',
  rowEnd,
  labels,
  testId,
}: DataGridProps) {
  const t = useMaybeT();
  const manualSorting = onSortChange !== undefined;
  const visibleSpecs = useMemo(() => columns.filter((column) => !column.hidden), [columns]);
  const getRowId = useMemo(() => rowId ?? ((row: GridRow) => rowIdOf(columns, row)), [rowId, columns]);

  const tableColumns = useMemo(
    () =>
      visibleSpecs.map((spec) =>
        columnHelper.accessor((row) => row[spec.name], {
          id: spec.name,
          enableSorting: spec.sortable,
          // Client-mode type-aware comparator (numeric fix — never lexicographic).
          sortingFn: (a, b) => compareCellValues(spec, a.original[spec.name], b.original[spec.name]),
          header: () => spec.label,
          cell: (info) => <CellValue column={spec} row={info.row.original} context={cellContext ?? {}} />,
        }),
      ),
    [visibleSpecs, cellContext],
  );

  const controlledSorting: SortingState = useMemo(
    () => (sort === null || sort === undefined ? [] : [{ id: sort.column, desc: sort.dir === 'desc' }]),
    [sort],
  );
  // Client mode (no onSortChange): the grid owns its sorting state — `sort`
  // only seeds the initial order (the controlled prop would otherwise pin the
  // rows to server order and clicks would never reorder).
  const [clientSorting, setClientSorting] = useState<SortingState>(controlledSorting);
  const sortingState = manualSorting ? controlledSorting : clientSorting;

  const rowSelection: RowSelectionState = useMemo(() => {
    const state: RowSelectionState = {};
    if (selected !== undefined) for (const id of selected) state[id] = true;
    return state;
  }, [selected]);

  const table = useReactTable({
    data: rows as GridRow[],
    columns: tableColumns,
    getRowId,
    state: { sorting: sortingState, rowSelection },
    manualSorting,
    enableRowSelection: selectable,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      onSelectedChange?.(new Set(Object.keys(next).filter((id) => next[id] === true)));
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sortingState) : updater;
      if (manualSorting) {
        const head = next[0];
        onSortChange?.(head === undefined ? null : { column: head.id, dir: head.desc ? 'desc' : 'asc' });
      } else {
        setClientSorting(next);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    ...(manualSorting ? {} : { getSortedRowModel: getSortedRowModel() }),
  });

  /* Row metrics come from the density axis (02 §1.8, §3): the cells below set
     `py-[var(--row-py)]` (13px / 7px) and `text-[length:var(--cell-fs)]`
     (13px / 12px). Both are declared once in @adminium/tokens/density.css, and
     this grid — the component they were authored for — is their only consumer,
     so the hardcoded `px-3 py-2.5` pair that used to live here silently unpinned
     the whole axis: `data-density="compact"` reflowed cards but never tables,
     and the cell font sat a tier below the comp's 13px. The `density` prop is a
     per-instance OVERRIDE of the ambient axis, applied by re-declaring the
     attribute on this subtree rather than by re-declaring the values
     (02 acceptance #1: no package outside tokens declares them).
     Only the inline inset is density-invariant — 14px in every comp. */
  const gridPad = 'px-3.5';
  const headerRows = table.getHeaderGroups();
  const bodyRows = table.getRowModel().rows;
  const allSelected = selectable && bodyRows.length > 0 && bodyRows.every((row) => row.getIsSelected());
  const someSelected = selectable && bodyRows.some((row) => row.getIsSelected());

  return (
    <div
      data-testid={testId}
      data-part="data-grid"
      role="table"
      aria-rowcount={rows.length}
      {...(density === 'compact' ? { 'data-density': 'compact' as const } : {})}
      className="min-w-full overflow-x-auto"
    >
      {headerRows.map((headerGroup) => (
        <div
          key={headerGroup.id}
          role="row"
          className="flex items-center border-b border-border bg-surface-2"
        >
          {selectable && (
            <div role="columnheader" className="flex w-11 shrink-0 items-center justify-center py-2">
              <Checkbox
                aria-label={labels?.selectAll ?? t('ui:widgets.tables.dataGrid.selectAllLabel', 'Select all rows')}
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={(checked) => {
                  const next = new Set<string>();
                  if (checked === true) for (const row of bodyRows) next.add(row.id);
                  onSelectedChange?.(next);
                }}
              />
            </div>
          )}
          {headerGroup.headers.map((header) => {
            const spec = visibleSpecs.find((candidate) => candidate.name === header.column.id) as GridColumnSpec;
            const sorted = header.column.getIsSorted();
            const sortable = header.column.getCanSort();
            const label = flexRender(header.column.columnDef.header, header.getContext());
            /* `text-micro` IS the comp's header tier (10.5px/700/.05em) and the
               house pattern for it — see `Label`'s eyebrow, which names table
               headers as a use. The hand-rolled trio it replaces drifted on two
               axes: .08em tracking and `--fg-muted`, where every comp header is
               .05em on `--fg-subtle`. */
            const headerText = (
              <span className="truncate text-micro uppercase text-fg-subtle">
                {label}
              </span>
            );
            return (
              <div
                key={header.id}
                role="columnheader"
                aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                className={`flex min-w-0 flex-1 items-center py-[11px] ${gridPad} ${cellAlignClass(spec)}`}
              >
                {sortable ? (
                  <button
                    type="button"
                    onClick={header.column.getToggleSortingHandler()}
                    aria-label={
                      labels?.sortBy !== undefined
                        ? `${labels.sortBy} ${spec.label}`
                        : t('ui:widgets.tables.dataGrid.sortByLabel', 'Sort by {column}', { column: spec.label })
                    }
                    className="group inline-flex min-w-0 items-center gap-[5px] rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {headerText}
                    {sorted === 'asc' ? (
                      <ArrowUp className="size-3 shrink-0 text-accent" aria-hidden="true" />
                    ) : sorted === 'desc' ? (
                      <ArrowDown className="size-3 shrink-0 text-accent" aria-hidden="true" />
                    ) : (
                      <ChevronsUpDown className="size-3 shrink-0 text-fg-subtle opacity-0 group-hover:opacity-100" aria-hidden="true" />
                    )}
                  </button>
                ) : (
                  headerText
                )}
              </div>
            );
          })}
          {rowEnd !== undefined && <div role="columnheader" className="w-11 shrink-0" />}
        </div>
      ))}

      <div role="rowgroup" className="divide-y divide-border">
        {bodyRows.map((row) => {
          const isSelected = row.getIsSelected();
          return (
            <div
              key={row.id}
              role="row"
              aria-selected={selectable ? isSelected : undefined}
              data-selected={isSelected ? '' : undefined}
              onClick={onRowOpen === undefined ? undefined : () => onRowOpen(row.original)}
              onKeyDown={
                onRowOpen === undefined
                  ? undefined
                  : (event) => {
                      if (event.key === 'Enter' && event.target === event.currentTarget) onRowOpen(row.original);
                    }
              }
              tabIndex={onRowOpen === undefined ? undefined : 0}
              /* Full-strength tints, as in both comps: the /60 alpha washed the
                 selected row out to a hint and made the hover barely visible. */
              className={`flex items-center transition-colors ${
                isSelected ? 'bg-accent-soft' : 'hover:bg-surface-2'
              } ${onRowOpen === undefined ? '' : 'cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'}`}
            >
              {selectable && (
                <div
                  role="cell"
                  className="flex w-11 shrink-0 items-center justify-center py-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    aria-label={labels?.selectRow ?? t('ui:widgets.tables.dataGrid.selectRowLabel', 'Select row')}
                    checked={isSelected}
                    onCheckedChange={() => row.toggleSelected()}
                  />
                </div>
              )}
              {row.getVisibleCells().map((cell) => {
                const spec = visibleSpecs.find((candidate) => candidate.name === cell.column.id) as GridColumnSpec;
                return (
                  <div
                    key={cell.id}
                    role="cell"
                    data-column={spec.name}
                    /* The key-field weight: both comps set the primary display
                       column at 700 and leave every other cell at regular, which
                       is what gives a row its anchor. `isDisplay` was already on
                       the spec ("key field" highlight, 09 §8.3) but nothing in
                       the list read it, so every column rendered identically. */
                    className={`flex min-w-0 flex-1 items-center text-[length:var(--cell-fs)] text-fg ${
                      spec.isDisplay ? 'font-bold' : ''
                    } ${gridPad} py-[var(--row-py)] ${cellAlignClass(spec)}`}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                );
              })}
              {rowEnd !== undefined && (
                <div role="cell" className="flex w-11 shrink-0 items-center justify-center" onClick={(event) => event.stopPropagation()}>
                  {rowEnd(row.original)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
