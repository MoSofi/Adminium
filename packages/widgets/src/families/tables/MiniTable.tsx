// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '@adminium/i18n/react';
import { ArrowRight } from 'lucide-react';

import { CellValue, cellAlignClass } from './cells.js';
import type { CellContext } from './cells.js';
import { rowIdOf } from './column-spec.js';
import type { GridColumnSpec, GridRow } from './column-spec.js';
import type { WidgetEvent } from '../../registry/types.js';

/**
 * `mini-table` (annex) — borderless compact row list inside a dashboard
 * card ("Recent orders"): 2–3 mapped columns (name · status pill · mono
 * amount), LIMIT 3–6 rows, optional "View all" drill-through. A row may
 * carry a muted second line under its first column (`secondary`).
 */

export interface MiniTableProps {
  /** 2–3 column mapping (annex config). Extra specs are ignored beyond 3. */
  columns: readonly GridColumnSpec[];
  rows: readonly GridRow[];
  /** Row click → record-open through the host (dashboard drill-through). */
  onRowOpen?: ((row: GridRow) => void) | undefined;
  /** Drill-through target for the "View all" footer link. */
  viewAllHref?: string | undefined;
  viewAllLabel?: string | undefined;
  onEvent?: ((event: WidgetEvent) => void) | undefined;
  cellContext?: CellContext | undefined;
  /** Rows rendered (annex: LIMIT 3–6). */
  limit?: number | undefined;
  /** A muted second line under the first column, these columns joined by " · "; not drawn on the first line. */
  secondary?: readonly GridColumnSpec[] | undefined;
  testId?: string | undefined;
}

export function MiniTable({
  columns,
  rows,
  onRowOpen,
  viewAllHref,
  viewAllLabel,
  onEvent,
  cellContext,
  limit = 6,
  secondary = [],
  testId,
}: MiniTableProps) {
  const t = useMaybeT();
  const below = new Set(secondary.map((column) => column.name));
  const visible = columns.filter((column) => !column.hidden && !below.has(column.name)).slice(0, 3);
  const slice = rows.slice(0, limit);
  // The second line: each column's cell as the first line would draw it, the empty ones left out.
  const secondLine = (row: GridRow) => {
    const parts = secondary.filter((column) => row[column.name] !== null && row[column.name] !== undefined && row[column.name] !== '');
    if (parts.length === 0) return null;
    return (
      <div data-part="mini-table-secondary" className="flex min-w-0 items-center gap-1 truncate text-caption font-normal text-fg-muted">
        {parts.map((column, index) => (
          <span key={column.name} data-column={column.name} className="inline-flex min-w-0 items-center gap-1">
            {index === 0 ? null : <span aria-hidden="true">·</span>}
            <CellValue column={column} row={row} context={cellContext ?? {}} />
          </span>
        ))}
      </div>
    );
  };
  return (
    <div data-part="mini-table" data-testid={testId} className="flex h-full flex-col">
      <div className="flex-1 divide-y divide-border/60">
        {slice.map((row) => {
          const id = rowIdOf(columns, row);
          const content = visible.map((column, index) =>
            index === 0 && secondary.length > 0 ? (
              <div key={column.name} className="flex min-w-0 flex-1 flex-col">
                <div data-column={column.name} className={`flex min-w-0 items-center font-semibold ${cellAlignClass(column)} text-body-sm text-fg`}>
                  <CellValue column={column} row={row} context={cellContext ?? {}} />
                </div>
                {secondLine(row)}
              </div>
            ) : (
              <div
                key={column.name}
                data-column={column.name}
                className={`flex min-w-0 items-center ${index === 0 ? 'flex-1 font-semibold' : 'shrink-0'} ${cellAlignClass(column)} text-body-sm text-fg`}
              >
                <CellValue column={column} row={row} context={cellContext ?? {}} />
              </div>
            ),
          );
          return onRowOpen === undefined ? (
            <div key={id} className="flex items-center gap-3 px-4 py-2">
              {content}
            </div>
          ) : (
            <button
              key={id}
              type="button"
              onClick={() => onRowOpen(row)}
              className="flex w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              {content}
            </button>
          );
        })}
      </div>
      {viewAllHref !== undefined && (
        <button
          type="button"
          data-part="mini-table-view-all"
          onClick={() => onEvent?.({ type: 'drill-through', href: viewAllHref })}
          className="flex items-center gap-1 px-4 py-2.5 text-caption font-bold text-accent hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          {viewAllLabel ?? t('ui:widgets.tables.miniTable.viewAllLabel', 'View all')}
          <ArrowRight className="size-3 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
