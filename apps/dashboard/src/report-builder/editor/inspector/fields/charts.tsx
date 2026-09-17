// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The four data field groups (comp 383-387): the KPI metrics, the bar/line
 * data points, and the table's rows — all three through one `RowsEditor`.
 *
 * THE KPI ROW GAINS A THIRD FIELD. The comp renders a delta on the canvas
 * (317, 622) and its Metrics rows carry Label + Value only (383), so a metric
 * added in the app can never show one — `onAddKpi` even seeds `delta: ''`
 * (646). *Delta* is the Value field's own shape at 64 px, and the canvas
 * colour rule (`−`/`-` red, else green) is unchanged.
 */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { rowSeeds } from '../../blockText.js';
import { rowFieldLabel } from './rowFieldLabel.js';
import { RowsEditor } from '../RowsEditor.js';
import { FIELD, PanelLabel, TextField } from '../parts.js';
import type { FieldsProps } from './types.js';

/** 383 + D27: Label · Value (72 px mono) · Delta (64 px mono) · remove; *Add metric*. */
export function KpiFields({ block, edits }: FieldsProps<'kpi'>) {
  return (
    <div className="flex flex-col gap-2">
      <PanelLabel className="mb-0">{t('reportBuilder:inspector.metrics', 'Metrics')}</PanelLabel>
      <RowsEditor
        rows={block.kpis}
        addLabel={t('reportBuilder:inspector.addMetric', 'Add metric')}
        removeLabel={(index) => t('reportBuilder:inspector.remove', 'Remove {noun} {n}', { noun: t('reportBuilder:inspector.metric.label', 'Label'), n: index + 1 })}
        onAdd={() => edits.addArrayItem(block.id, 'kpis', rowSeeds.kpi())}
        onRemove={(index) => edits.removeArrayItem(block.id, 'kpis', index)}
        removeClassName="h-[34px]"
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="report-kpi-row" className="flex items-center gap-1.5">
            <TextField
              ariaLabel={rowFieldLabel(t('reportBuilder:inspector.metric.label', 'Label'), index)}
              value={row.label}
              onFocus={edits.beginEdit}
              onChange={(value) => edits.updateArrayItem(block.id, 'kpis', index, { label: value })}
              className="min-w-0 flex-1 py-2 text-[12.5px]"
            />
            <input
              type="text"
              aria-label={rowFieldLabel(t('reportBuilder:inspector.metric.value', 'Value'), index)}
              value={row.value}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateArrayItem(block.id, 'kpis', index, { value: event.target.value })}
              className={cn(FIELD, 'w-[72px] shrink-0 px-2 py-2 font-mono text-[12.5px]')}
            />
            <input
              type="text"
              data-testid="report-kpi-delta"
              aria-label={rowFieldLabel(t('reportBuilder:inspector.metric.delta', 'Delta'), index)}
              value={row.delta}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateArrayItem(block.id, 'kpis', index, { delta: event.target.value })}
              className={cn(FIELD, 'w-16 shrink-0 px-2 py-2 font-mono text-[12.5px]')}
            />
            {remove}
          </div>
        )}
      />
    </div>
  );
}

/** 385: Label · Value (64 px mono, parsed as a number) · remove; *Add point*. */
export function SeriesFields({ block, edits }: FieldsProps<'bar' | 'line'>) {
  return (
    <div className="flex flex-col gap-2">
      <PanelLabel className="mb-0">{t('reportBuilder:inspector.dataPoints', 'Data points')}</PanelLabel>
      <RowsEditor
        rows={block.series}
        addLabel={t('reportBuilder:inspector.addPoint', 'Add point')}
        removeLabel={(index) => t('reportBuilder:inspector.remove', 'Remove {noun} {n}', { noun: t('reportBuilder:inspector.metric.label', 'Label'), n: index + 1 })}
        onAdd={() => edits.addArrayItem(block.id, 'series', rowSeeds.series())}
        onRemove={(index) => edits.removeArrayItem(block.id, 'series', index)}
        removeClassName="h-[34px]"
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="report-series-row" className="flex items-center gap-1.5">
            <TextField
              ariaLabel={rowFieldLabel(t('reportBuilder:inspector.metric.label', 'Label'), index)}
              value={row.label}
              onFocus={edits.beginEdit}
              onChange={(value) => edits.updateArrayItem(block.id, 'series', index, { label: value })}
              className="min-w-0 flex-1 py-2 text-[12.5px]"
            />
            <input
              type="text"
              inputMode="decimal"
              aria-label={rowFieldLabel(t('reportBuilder:inspector.metric.value', 'Value'), index)}
              value={String(row.value)}
              onFocus={edits.beginEdit}
              // The comp's `parseFloat(e.target.value) || 0` (648): chart geometry
              // is a number, and an unparseable keystroke reads as zero rather
              // than making the bar disappear.
              onChange={(event) => edits.updateArrayItem(block.id, 'series', index, { value: Number.parseFloat(event.target.value) || 0 })}
              className={cn(FIELD, 'w-16 shrink-0 px-2 py-2 font-mono text-[12.5px]')}
            />
            {remove}
          </div>
        )}
      />
    </div>
  );
}

/** 387: A · B (76 px mono) · remove; *Add row*. Row 0 is the header and is editable like any other. */
export function TableFields({ block, edits }: FieldsProps<'table'>) {
  return (
    <div className="flex flex-col gap-2">
      <PanelLabel className="mb-0">{t('reportBuilder:inspector.rows', 'Rows')}</PanelLabel>
      <RowsEditor
        rows={block.rows}
        addLabel={t('reportBuilder:inspector.addRow', 'Add row')}
        removeLabel={(index) => t('reportBuilder:inspector.remove', 'Remove {noun} {n}', { noun: t('reportBuilder:inspector.rows', 'Rows'), n: index + 1 })}
        onAdd={() => edits.addRow(block.id, rowSeeds.tableRow())}
        onRemove={(index) => edits.removeRow(block.id, index)}
        removeClassName="h-[34px]"
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="report-table-row" className="flex items-center gap-1.5">
            <TextField
              ariaLabel={t('reportBuilder:inspector.rowCellA', 'Row {n}, first column', { n: index + 1 })}
              value={row[0]}
              onFocus={edits.beginEdit}
              onChange={(value) => edits.updateRow(block.id, index, 0, value)}
              className="min-w-0 flex-1 py-2 text-[12.5px]"
            />
            <input
              type="text"
              aria-label={t('reportBuilder:inspector.rowCellB', 'Row {n}, second column', { n: index + 1 })}
              value={row[1]}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateRow(block.id, index, 1, event.target.value)}
              className={cn(FIELD, 'w-[76px] shrink-0 px-2 py-2 font-mono text-[12.5px]')}
            />
            {remove}
          </div>
        )}
      />
    </div>
  );
}
