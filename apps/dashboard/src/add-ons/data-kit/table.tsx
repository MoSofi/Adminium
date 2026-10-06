// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The data kit's table: the project kit's — the dashboard's own grid — which
 * below a width the page names (`cardsBelow`) draws each row as a card
 * instead: a label and its value to a line, where a grid of eight columns
 * would be read by scrolling sideways.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card as UiCard } from '@adminium/ui';
import type { AnyRecord, DataTableColumn, DataTableProps as ProjectDataTableProps } from '@adminium/server/ui';

import { DataTable as ProjectDataTable } from '../../project/kit/data.js';

export interface DataTableProps<R extends AnyRecord = AnyRecord> extends ProjectDataTableProps<R> {
  /** Draw rows as cards while the table's own box is narrower than this many pixels. */
  cardsBelow?: number;
}

/** A value with no `render` of its own, as a card line reads it. */
function plain(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function keyOf<R extends AnyRecord>(rowKey: ProjectDataTableProps<R>['rowKey'], row: R): string {
  if (typeof rowKey === 'function') return rowKey(row);
  const value = row[rowKey ?? 'id'];
  return value === undefined || value === null ? JSON.stringify(row) : String(value);
}

export function DataTable<R extends AnyRecord = AnyRecord>({ cardsBelow, ...table }: DataTableProps<R>): ReactNode {
  const box = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const node = box.current;
    if (cardsBelow === undefined || node === null) return;
    const measure = (): void => setNarrow(node.getBoundingClientRect().width < cardsBelow);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [cardsBelow]);

  if (cardsBelow === undefined) return <ProjectDataTable {...table} />;
  const rows = table.rows;
  const asCards = narrow && table.loading !== true && rows !== undefined && rows.length > 0;
  return (
    <div ref={box} className="min-w-0" data-part="kit-table" data-layout={asCards ? 'cards' : 'grid'}>
      {asCards ? (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const open = table.onRowClick;
            return (
              <li key={keyOf(table.rowKey, row)}>
                <UiCard>
                  <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5">
                    {(table.columns as readonly DataTableColumn<R>[]).map((column, index) => {
                      const value = column.render === undefined ? plain(row[column.key]) : column.render(row);
                      return (
                        <div key={column.key} className="contents">
                          <dt className="text-body-sm text-fg-muted">{column.label}</dt>
                          <dd className="min-w-0 break-words text-body-sm text-fg">
                            {/* A row that opens is opened from its first line: a card holds too much to be one button. */}
                            {index === 0 && open !== undefined ? (
                              <button type="button" className="min-h-6 text-start font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => open(row)}>
                                {value}
                              </button>
                            ) : (
                              value
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </UiCard>
              </li>
            );
          })}
        </ul>
      ) : (
        <ProjectDataTable {...table} />
      )}
    </div>
  );
}
