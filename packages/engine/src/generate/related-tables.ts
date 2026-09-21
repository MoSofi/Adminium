// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Remedy 2's offer — which related tables can carry the calendar the operator
 * asked for, titled through the FK. Its own module because it COMPOSES each
 * candidate (`recompose.ts`), and `recompose.ts` in turn uses
 * `title-through.ts`: kept apart, the three form no import cycle.
 */

import { buildCandidateView, dateRangeStart, eventDate } from '@adminium/widgets/generate';

import type { DatabaseModel } from '../schema-model.js';
import { bindableSet } from './fit.js';
import { composeRequestedPage } from './recompose.js';
import { TITLE_THROUGH_TEMPLATES, titleThroughEntry } from './title-through.js';

/* ------------------------------------------------------------ the offer */

/** One related table offered in place of the picked one (remedy 2). */
export interface RelatedTable {
  /** The table the calendar would be bound to. */
  tableId: string;
  label: string | null;
  /** Its FK column pointing at the picked table. */
  via: string;
  /** The picked table's column each event would be titled with. */
  titleColumn: string;
  /** The related table's date column. */
  dateColumn: string | null;
}

/**
 * Tables one FK hop away from `tableId` that can back `template` when titled
 * through that FK — each one PROVED by composing it, the same way the create
 * route will.
 *
 * Only INBOUND keys qualify: `appointments.patient_id → patients` lets each
 * appointment carry one patient's name. An outbound key runs the other way —
 * one row of the picked table would title many related rows — and has no
 * single title to pull back.
 */
export function relatedDateTables(
  model: DatabaseModel,
  tableId: string,
  template: string,
): RelatedTable[] {
  if (!TITLE_THROUGH_TEMPLATES.includes(template)) return [];
  const set = bindableSet(model);
  if (!set.tables.some((t) => t.id === tableId)) return [];

  const out: RelatedTable[] = [];
  for (const entry of set.candidateModel) {
    if (entry.table.id === tableId) continue;
    for (const column of entry.table.columns) {
      if (column.references?.tableId !== tableId) continue;
      const built = composeRequestedPage(model, entry.table.id, template, {
        connectionId: 'fit',
        slug: 'fit',
        id: 'fit',
        navGroup: 'planning',
        navIcon: 'calendar',
        navOrder: 0,
        titleThrough: column.name,
      });
      if (built.envelope === null) continue;
      const through = titleThroughEntry(entry, set.candidateModel, column.name, 'fit');
      if ('reason' in through) continue;
      const view = buildCandidateView(entry.table, entry.classified);
      out.push({
        tableId: entry.table.id,
        label: entry.table.label ?? null,
        via: column.name,
        titleColumn: through.lookup.labelColumn,
        dateColumn: (eventDate(view) ?? dateRangeStart(view))?.name ?? null,
      });
    }
  }
  return out.sort((a, b) => a.tableId.localeCompare(b.tableId) || a.via.localeCompare(b.via));
}
