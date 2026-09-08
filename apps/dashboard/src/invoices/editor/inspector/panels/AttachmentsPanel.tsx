// SPDX-License-Identifier: AGPL-3.0-only
/** The Attachments panel (comp 900-906; `attachEdit` 1681, `addAttach` 1682): name + 60 px mono size per file, *Add file*, *Remove section* (`attachShow`). */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { FIELD, PanelLabel, RemoveSectionButton } from '../parts.js';
import type { PanelProps } from '../panelProps.js';
import { RowsEditor } from '../RowsEditor.js';

export function AttachmentsPanel({ draft, edits, onSelect }: PanelProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      <PanelLabel className="mb-0">{t('invoices:inspector.attachments.files', 'Files')}</PanelLabel>
      <RowsEditor
        rows={draft.body.attachments}
        addLabel={t('invoices:inspector.attachments.add', 'Add file')}
        removeLabel={(index) => t('invoices:inspector.attachments.removeRow', 'Remove file {n}', { n: index + 1 })}
        onAdd={() => edits.addRow('attachments', { name: t('invoices:inspector.attachments.seedName', 'New file.pdf'), size: '—' })}
        onRemove={(index) => edits.removeRow('attachments', index)}
        renderRow={(file, index, remove) => (
          <div key={index} data-testid="invoices-row" className="flex gap-[6px]">
            <input
              type="text"
              aria-label={t('invoices:inspector.attachments.name', 'File {n} name', { n: index + 1 })}
              value={file.name}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateRow('attachments', index, { name: event.target.value })}
              className={cn(FIELD, 'min-w-0 flex-1 px-[10px] py-2 text-[12px]')}
            />
            <input
              type="text"
              aria-label={t('invoices:inspector.attachments.size', 'File {n} size', { n: index + 1 })}
              value={file.size}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateRow('attachments', index, { size: event.target.value })}
              className={cn(FIELD, 'w-[60px] shrink-0 px-[7px] py-2 font-mono text-[11px]')}
            />
            {remove}
          </div>
        )}
      />
      <RemoveSectionButton flag="attachShow" edits={edits} onSelect={onSelect} className="mt-[5px]" />
    </div>
  );
}
