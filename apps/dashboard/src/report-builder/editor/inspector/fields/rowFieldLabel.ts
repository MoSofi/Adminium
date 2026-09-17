// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The accessible name of one cell of one repeater row (I10).
 *
 * The comp gives these inputs no label at all — its Metrics rows are two bare
 * boxes under one *Metrics* eyebrow (383). Naming them all *Label* and
 * *Value* would be worse than nothing for a screen reader: three rows read as
 * "Label, Value, Label, Value, Label, Value" with no way to tell which metric
 * is being edited. The eyebrow names the GROUP; this names the cell, and it
 * is invisible on screen, so the comp's picture is unchanged.
 *
 * One key, composed from the labels the panel already carries, rather than a
 * numbered key per cell: the same shape `inspector.remove` uses.
 */
import { t } from '../../../../i18n/t.js';

export function rowFieldLabel(label: string, index: number): string {
  return t('reportBuilder:inspector.rowField', '{label} {n}', { label, n: index + 1 });
}
