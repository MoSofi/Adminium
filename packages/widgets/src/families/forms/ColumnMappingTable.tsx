// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `column-mapping-table` (annex) — a 3-column grid mapping source columns →
 * target fields, with sample values and a target picker per row (including
 * "Don't import"). Evidence: Import Wizard — the page the annex says always
 * composes `upload-dropzone` + this + `validation-issues-list` +
 * `progress-bar`.
 *
 * PRESENTATIONAL: the mapping lives in local state and every change is a
 * `mutate` intent. The widget never imports a row. The table itself is
 * `MappingTable.tsx`, which knows no config; this file is the registry's way
 * in to it.
 *
 * Binds `record-list`: the ROWS are the source columns, so a payload with no
 * columns really is an empty widget (unlike the builders, which start empty by
 * design) and the frame's empty state is the right answer.
 */

import { DEFAULT_MAPPING_TARGETS, columnMappingTableConfigSchema, columnMappingTableDemoData } from './forms-config.js';
import type { ColumnMappingTableConfig } from './forms-config.js';
import { autoMatchTarget } from './forms-builders.js';
import { MappingTable, type MappingRow } from './MappingTable.js';
import { recordRowsOf, stringField } from './forms-lib.js';
import { bindingTargetOf } from './forms-state.js';
import type { WidgetProps } from '../../registry/types.js';

export { columnMappingTableConfigSchema, columnMappingTableDemoData };
export type { ColumnMappingTableConfig };

export type { MappingRow };

/**
 * Project the `record-list` payload onto mapping rows, applying `autoMatch` to
 * columns the payload leaves unmapped.
 *
 * An EXPLICIT target in the payload always wins over a suggestion — including
 * `SKIP_TARGET`. That is the whole reason skip is a sentinel rather than an
 * empty string: "the user said don't import this" must survive a re-render that
 * auto-match would otherwise helpfully undo.
 */
export function mappingRowsOf(data: unknown, config: ColumnMappingTableConfig): MappingRow[] {
  const rows = recordRowsOf(data);
  const targets = config.targets ?? DEFAULT_MAPPING_TARGETS;
  const out: MappingRow[] = [];
  for (const [index, row] of rows.entries()) {
    const column = stringField(row, config.columnField);
    if (column === undefined) continue;
    const explicit = stringField(row, config.targetField);
    const suggested = config.autoMatch ? autoMatchTarget(column, targets) : null;
    out.push({
      key: `${column}-${index}`,
      column,
      sample: stringField(row, config.sampleField),
      target: explicit ?? suggested ?? '',
    });
  }
  return out;
}

export function ColumnMappingTableWidget({ config, data, onEvent }: WidgetProps<ColumnMappingTableConfig>) {
  const target = bindingTargetOf(config.binding);
  return (
    <MappingTable
      rows={mappingRowsOf(data, config)}
      targets={config.targets ?? DEFAULT_MAPPING_TARGETS}
      {...(config.sourceHeader === undefined ? {} : { sourceHeader: config.sourceHeader })}
      {...(config.sampleHeader === undefined ? {} : { sampleHeader: config.sampleHeader })}
      {...(config.targetHeader === undefined ? {} : { targetHeader: config.targetHeader })}
      {...(config.skipLabel === undefined ? {} : { skipLabel: config.skipLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      // Unbound (demo/story/palette): nothing is told to anybody.
      {...(target === null
        ? {}
        : {
            onMapping: (mapping: Record<string, string>) =>
              onEvent({ type: 'mutate', intent: 'update', connectionId: target.connectionId, table: target.table, values: { mapping } }),
          })}
    />
  );
}
