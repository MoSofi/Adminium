// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The string-list editor (comp 810-811, 820-821, 859-860, 877-878; `mkLines`
 * 1562): one boxed input per line with a 32×34 `minus` beside it, then the
 * dashed *Add line* — over `from`, `customer`, `ship` and `payment`.
 */
import { Plus } from 'lucide-react';

import { t } from '../../../i18n/t.js';
import type { DocumentEdits } from '../../model/edits.js';
import type { LineListField } from '../../model/envelope.js';
import { DashedButton, FIELD, RowRemoveButton } from './parts.js';
import { cn } from '@adminium/ui';

export function LineListEditor({ field, lines, label, edits }: { field: LineListField; lines: readonly string[]; label: string; edits: DocumentEdits }) {
  return (
    <>
      {lines.map((line, index) => {
        const name = t('invoices:inspector.line', '{label} {n}', { label, n: index + 1 });
        return (
          <div key={index} data-testid="invoices-line" className="flex gap-[6px]">
            <input
              type="text"
              aria-label={name}
              value={line}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateLine(field, index, event.target.value)}
              className={cn(FIELD, 'min-w-0 flex-1 px-[10px] py-2 text-[12.5px]')}
            />
            <RowRemoveButton label={t('invoices:inspector.removeLine', 'Remove {label} {n}', { label, n: index + 1 })} onClick={() => edits.removeLine(field, index)} className="w-[32px] rounded-[9px]" iconClassName="size-3.5" />
          </div>
        );
      })}
      <DashedButton onClick={() => edits.addLine(field)} testId="invoices-rows-add">
        <Plus className="size-3.5" aria-hidden="true" />
        {t('invoices:inspector.addLine', 'Add line')}
      </DashedButton>
    </>
  );
}
