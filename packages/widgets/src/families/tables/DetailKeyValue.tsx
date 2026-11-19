// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { KeyValueList, KeyValueRow, Tag } from '@adminium/ui';

import { CellValue } from './cells.js';
import type { CellContext } from './cells.js';
import type { GridColumnSpec, GridRow } from './column-spec.js';

/**
 * `detail-key-value` (annex) — record fields as label/value rows driven by
 * column specs: mono per-field, FK values as chips (via the shared cell
 * renderers), key-field emphasis, optional column-type tags so the generated
 * UI explains itself (form keeper, reused on detail).
 */

export interface DetailKeyValueProps {
  columns: readonly GridColumnSpec[];
  record: GridRow;
  cellContext?: CellContext | undefined;
  /** Show mono type tags (`varchar`, `enum`, `→ public.team_members`). */
  showTypeTags?: boolean | undefined;
  /**
   * A line the host draws under a field's value, by column name (where the
   * value came from: "From Companies House · 28 Jul"). Absent: none.
   */
  notes?: Readonly<Record<string, ReactNode>> | undefined;
  testId?: string | undefined;
}

function typeTagText(column: GridColumnSpec): string {
  if (column.fk !== undefined) return `→ ${column.fk.label ?? column.fk.table}`;
  if (column.logicalType === 'enum') return 'enum';
  return column.logicalType;
}

export function DetailKeyValue({
  columns,
  record,
  cellContext,
  showTypeTags = false,
  notes,
  testId,
}: DetailKeyValueProps) {
  return (
    <KeyValueList data-testid={testId} data-part="detail-key-value">
      {columns.map((column) => (
        <KeyValueRow
          key={column.name}
          data-column={column.name}
          label={
            showTypeTags ? (
              <span className="inline-flex items-center gap-1.5">
                {column.label}
                <Tag mono>{typeTagText(column)}</Tag>
              </span>
            ) : (
              column.label
            )
          }
          className={column.isDisplay ? 'bg-surface-2/50' : undefined}
        >
          {notes?.[column.name] === undefined ? (
            <CellValue column={column} row={record} context={cellContext ?? {}} />
          ) : (
            <span className="flex min-w-0 flex-col items-start">
              <CellValue column={column} row={record} context={cellContext ?? {}} />
              {notes[column.name]}
            </span>
          )}
        </KeyValueRow>
      ))}
    </KeyValueList>
  );
}
