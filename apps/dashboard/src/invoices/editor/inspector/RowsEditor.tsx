// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The generic "rows + Add + per-row remove" shape (34 Appendix E §I3) the
 * comp draws for attachments 903, currencies 946, discount codes 965, tax
 * components 974, payments 984 and delivery steps 1027. The panel owns each
 * row's markup (`renderRow`) and the per-repeater seed (`onAdd`); this owns
 * the list, the remove buttons and the dashed *Add …* row.
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
      <DashedButton onClick={onAdd} testId="invoices-rows-add">
        <Plus className="size-3.5" aria-hidden="true" />
        {addLabel}
      </DashedButton>
    </>
  );
}
