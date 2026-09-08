// SPDX-License-Identifier: AGPL-3.0-only
/** The Ship-to panel (comp 872-880): the ship-to name, the `ship` line editor, *Remove section* (`shipShow`). */
import { t } from '../../../../i18n/t.js';
import { LineListEditor } from '../LineListEditor.js';
import { PanelLabel, RemoveSectionButton, TextField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function ShipToPanel({ draft, edits, onSelect }: PanelProps) {
  const lines = t('invoices:inspector.shipto.addressLines', 'Address lines');
  return (
    <div className="flex flex-col gap-[9px]">
      <TextField label={t('invoices:inspector.shipto.name', 'Ship-to name')} labelClassName="mb-[9px]" value={draft.body.shipName} onFocus={edits.beginEdit} onChange={(value) => edits.set('shipName', value)} className="font-bold" testId="invoices-ship-name" />
      <PanelLabel className="mb-0 mt-[5px]">{lines}</PanelLabel>
      <LineListEditor field="ship" lines={draft.body.ship} label={lines} edits={edits} />
      <RemoveSectionButton flag="shipShow" edits={edits} onSelect={onSelect} className="mt-[5px]" />
    </div>
  );
}
