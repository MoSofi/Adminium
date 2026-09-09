// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The generic "rows + Add + per-row remove" shape (43-report-builder.md
 * Appendix A I10) the comp draws for eight repeaters: metrics 383, data
 * points 385, table rows 387, files 393, currencies 403, discount codes 407,
 * tax lines 409, payments 411 and delivery steps 421. The field group owns
 * each row's markup (`renderRow`) and the per-repeater seed (`onAdd`); this
 * owns the list, the remove buttons and the dashed *Add …* row.
 *
 * A copy of the invoice inspector's file (43 D7).
 */
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

import { DashedButton, RowRemoveButton } from './parts.js';

export interface RowsEditorProps<Row> {
  rows: readonly Row[];
  /** The row's cells; `remove` is the comp's `minus` button, placed where the row draws it. */
  renderRow: (row: Row, index: number, remove: ReactNode) => ReactNode;
  addLabel: string;
  /** "Remove {noun} {n}" — the remove button's accessible name. */
  removeLabel: (index: number) => string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** The comp's 30×32 (946) versus 30×34 (903) variants. */
  removeClassName?: string | undefined;
}

export function RowsEditor<Row>({ rows, renderRow, addLabel, removeLabel, onAdd, onRemove, removeClassName }: RowsEditorProps<Row>) {
  return (
    <>
      {rows.map((row, index) => renderRow(row, index, <RowRemoveButton label={removeLabel(index)} onClick={() => onRemove(index)} className={removeClassName} />))}
      <DashedButton onClick={onAdd} testId="report-rows-add">
        <Plus className="size-3.5" aria-hidden="true" />
        {addLabel}
      </DashedButton>
    </>
  );
}
