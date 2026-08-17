/**
 * `column-mapping-table` (annex §10) — a 3-column grid mapping source columns →
 * target fields, with sample values and a target picker per row (including
 * "Don't import"). Evidence: Import Wizard — the page the annex says always
 * composes `upload-dropzone` + this + `validation-issues-list` + `progress-bar`.
 *
 * PRESENTATIONAL: the mapping lives in local state and every change is a
 * `mutate` intent (04 §2.1). The widget never imports a row.
 *
 * Binds §3 `record-list`: the ROWS are the source columns, so a payload with no
 * columns really is an empty widget (unlike the builders, which start empty by
 * design) and the frame's empty state is the right answer.
 */

import { MonoText, Select, cn } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useState } from 'react';

import { DEFAULT_MAPPING_TARGETS, columnMappingTableConfigSchema, columnMappingTableDemoData } from './forms-config.js';
import type { ColumnMappingTableConfig } from './forms-config.js';
import { SKIP_TARGET, autoMatchTarget } from './forms-builders.js';
import { recordRowsOf, stringField } from './forms-lib.js';
import { bindingTargetOf } from './forms-state.js';
import type { WidgetProps } from '../../registry/types.js';

export { columnMappingTableConfigSchema, columnMappingTableDemoData };
export type { ColumnMappingTableConfig };

export interface MappingRow {
  key: string;
  column: string;
  sample?: string | undefined;
  /** `''` = undecided, `SKIP_TARGET` = explicitly not imported. */
  target: string;
}

/**
 * Project the §3 `record-list` payload onto mapping rows, applying `autoMatch`
 * to columns the payload leaves unmapped.
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
  const t = useMaybeT();
  const targets = config.targets ?? DEFAULT_MAPPING_TARGETS;
  const [rows, setRows] = useState<MappingRow[]>(() => mappingRowsOf(data, config));
  const target = bindingTargetOf(config.binding);
  // Used by the column header AND each row picker's aria-label — resolve once.
  const targetHeader = config.targetHeader ?? t('ui:widgets.forms.columnMappingTable.targetHeader', 'Target field');

  const setTarget = (index: number, next: string) => {
    const updated = rows.map((row, i) => (i === index ? { ...row, target: next } : row));
    setRows(updated);
    if (target === null) return; // unbound (demo/story/palette)
    const mapping: Record<string, string> = {};
    for (const row of updated) {
      // Undecided columns are omitted, not sent as `''`: the host's importer
      // must be able to tell "skip this" from "nobody has said yet".
      if (row.target !== '') mapping[row.column] = row.target;
    }
    onEvent({
      type: 'mutate',
      intent: 'update',
      connectionId: target.connectionId,
      table: target.table,
      values: { mapping },
    });
  };

  return (
    <div
      data-widget="column-mapping-table"
      data-testid={config.testId}
      className="flex h-full flex-col overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <div role="table" className="min-w-full">
        <div
          role="row"
          className="grid grid-cols-[minmax(6rem,1fr)_minmax(6rem,1fr)_minmax(8rem,1fr)] gap-2 border-b border-border pb-1.5"
        >
          <span role="columnheader" className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
            {config.sourceHeader ?? t('ui:widgets.forms.columnMappingTable.sourceHeader', 'Source column')}
          </span>
          <span role="columnheader" className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
            {config.sampleHeader ?? t('ui:widgets.forms.columnMappingTable.sampleHeader', 'Sample')}
          </span>
          <span role="columnheader" className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
            {targetHeader}
          </span>
        </div>

        {rows.map((row, index) => (
          <div
            key={row.key}
            role="row"
            data-part="mapping-row"
            data-column={row.column}
            data-target={row.target === '' ? undefined : row.target}
            className="grid grid-cols-[minmax(6rem,1fr)_minmax(6rem,1fr)_minmax(8rem,1fr)] items-center gap-2 border-b border-border/50 py-1.5"
          >
            <MonoText role="cell" className="min-w-0 truncate text-body-sm text-fg">
              {row.column}
            </MonoText>
            <MonoText role="cell" data-part="mapping-sample" className="min-w-0 truncate text-caption text-fg-muted">
              {row.sample ?? '—'}
            </MonoText>
            <span role="cell" className="min-w-0">
              <Select
                aria-label={`${targetHeader} — ${row.column}`}
                data-part="mapping-target"
                value={row.target}
                onChange={(event) => setTarget(index, event.currentTarget.value)}
                className={cn(row.target === SKIP_TARGET && 'text-fg-subtle')}
              >
                <option value="" />
                {targets.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label ?? entry.key}
                  </option>
                ))}
                <option value={SKIP_TARGET}>
                  {config.skipLabel ?? t('ui:widgets.forms.columnMappingTable.skip', "Don't import")}
                </option>
              </Select>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
