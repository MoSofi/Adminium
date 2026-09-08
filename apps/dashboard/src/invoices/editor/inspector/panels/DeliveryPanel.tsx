// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Delivery timeline panel (comp 1024-1031; `delEdit` 1722, `addDel`
 * 1723): label · a 96 px status button that cycles todo → current → done ·
 * remove per step, *Add step*, the note, *Remove section* (`delShow`).
 */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import type { DeliveryStepStatus } from '../../../model/envelope.js';
import { FIELD, FOCUS, Note, PanelLabel, RemoveSectionButton } from '../parts.js';
import type { PanelProps } from '../panelProps.js';
import { RowsEditor } from '../RowsEditor.js';

const CYCLE: readonly DeliveryStepStatus[] = ['todo', 'current', 'done'];

export function stepStatusLabel(status: DeliveryStepStatus): string {
  switch (status) {
    case 'todo':
      return t('invoices:inspector.delivery.status.todo', 'Pending');
    case 'current':
      return t('invoices:inspector.delivery.status.current', 'In progress');
    case 'done':
      return t('invoices:inspector.delivery.status.done', 'Done');
  }
}

export function nextStepStatus(status: DeliveryStepStatus): DeliveryStepStatus {
  return CYCLE[(CYCLE.indexOf(status) + 1) % CYCLE.length] ?? 'todo';
}

export function DeliveryPanel({ draft, edits, onSelect }: PanelProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      <PanelLabel className="mb-0">{t('invoices:inspector.delivery.steps', 'Steps')}</PanelLabel>
      <RowsEditor
        rows={draft.body.delSteps}
        addLabel={t('invoices:inspector.delivery.add', 'Add step')}
        removeLabel={(index) => t('invoices:inspector.delivery.removeRow', 'Remove step {n}', { n: index + 1 })}
        onAdd={() => edits.addRow('delSteps', { label: t('invoices:inspector.delivery.seedLabel', 'New step'), status: 'todo' })}
        onRemove={(index) => edits.removeRow('delSteps', index)}
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="invoices-row" className="flex items-center gap-[6px]">
            <input
              type="text"
              aria-label={t('invoices:inspector.delivery.label', 'Step {n}', { n: index + 1 })}
              value={row.label}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateRow('delSteps', index, { label: event.target.value })}
              className={cn(FIELD, 'min-w-0 flex-1 px-[10px] py-2 text-[12.5px]')}
            />
            <button
              type="button"
              data-testid="invoices-cycle"
              data-value={row.status}
              aria-label={t('invoices:inspector.delivery.cycle', 'Step {n} status: {status}', { n: index + 1, status: stepStatusLabel(row.status) })}
              onClick={() => edits.updateRow('delSteps', index, { status: nextStepStatus(row.status) })}
              className={cn('w-24 shrink-0 rounded-[9px] border border-border bg-surface px-[6px] py-2 text-[11px] font-bold text-fg-muted transition-colors hover:border-border-strong', FOCUS)}
            >
              {stepStatusLabel(row.status)}
            </button>
            {remove}
          </div>
        )}
      />
      <Note>{t('invoices:inspector.delivery.note', 'Tap the status to cycle Pending → In progress → Done.')}</Note>
      <RemoveSectionButton flag="delShow" edits={edits} onSelect={onSelect} className="mt-[2px]" />
    </div>
  );
}
