// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The table that maps a file's columns to a table's fields: a row for each
 * source column, a sample of what it holds, and a picker of where it goes
 * (including "Don't import").
 *
 * The component alone. As the registry places it (a `record-list` payload
 * and a config, whose schema is zod's) it is `ColumnMappingTable.tsx`. The
 * import wizard draws this one, on the dashboard and on an app's own screen,
 * and hands it plain rows and targets.
 *
 * The mapping lives here, in local state, and every change is handed to
 * `onMapping` whole. Nothing here imports a row.
 */
import { MonoText, Select, cn } from '@adminium/ui';
import { useState } from 'react';

import { useMaybeT } from '../../lib/i18n.js';

import { SKIP_TARGET, autoMatchTarget } from './forms-builders.js';

export interface MappingRow {
  key: string;
  column: string;
  sample?: string | undefined;
  /** `''` = undecided, `SKIP_TARGET` = explicitly not imported. */
  target: string;
}

export interface MappingTarget {
  key: string;
  label?: string | undefined;
}

/**
 * A file's columns as mapping rows, each matched to the target its name
 * suggests where `autoMatch` is on. A target a column already carries always
 * wins over a suggestion, `SKIP_TARGET` included: "don't import this" must
 * survive a second look.
 */
export function mappingRowsFor(columns: readonly { column: string; sample?: string | undefined; target?: string | undefined }[], targets: readonly MappingTarget[], autoMatch: boolean): MappingRow[] {
  return columns.map(({ column, sample, target }, index) => ({
    key: `${column}-${String(index)}`,
    column,
    sample,
    target: target ?? (autoMatch ? autoMatchTarget(column, targets) : null) ?? '',
  }));
}

export interface MappingTableProps {
  /** The rows the table starts from; what the person then picks is kept here. */
  rows: readonly MappingRow[];
  targets: readonly MappingTarget[];
  /**
   * Called with the whole mapping, source column to target, after every
   * pick. A column nobody has decided is left out, so "skip this"
   * (`SKIP_TARGET`) can be told from "nobody has said yet".
   */
  onMapping?: ((mapping: Record<string, string>) => void) | undefined;
  sourceHeader?: string | undefined;
  sampleHeader?: string | undefined;
  targetHeader?: string | undefined;
  skipLabel?: string | undefined;
  testId?: string | undefined;
}

export function MappingTable({ rows: initial, targets, onMapping, sourceHeader, sampleHeader, targetHeader: targetHeaderProp, skipLabel, testId }: MappingTableProps) {
  const t = useMaybeT();
  const [rows, setRows] = useState<MappingRow[]>(() => [...initial]);
  // Used by the column header AND each row picker's aria-label — resolve once.
  const targetHeader = targetHeaderProp ?? t('ui:widgets.forms.columnMappingTable.targetHeader', 'Target field');

  const setTarget = (index: number, next: string) => {
    const updated = rows.map((row, i) => (i === index ? { ...row, target: next } : row));
    setRows(updated);
    if (onMapping === undefined) return;
    const mapping: Record<string, string> = {};
    for (const row of updated) {
      // Undecided columns are omitted, not sent as `''`: the host's importer
      // must be able to tell "skip this" from "nobody has said yet".
      if (row.target !== '') mapping[row.column] = row.target;
    }
    onMapping(mapping);
  };

  return (
    <div
      data-widget="column-mapping-table"
      data-testid={testId}
      className="flex h-full flex-col overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <div role="table" className="min-w-full">
        <div
          role="row"
          className="grid grid-cols-[minmax(6rem,1fr)_minmax(6rem,1fr)_minmax(8rem,1fr)] gap-2 border-b border-border pb-1.5"
        >
          <span role="columnheader" className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
            {sourceHeader ?? t('ui:widgets.forms.columnMappingTable.sourceHeader', 'Source column')}
          </span>
          <span role="columnheader" className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
            {sampleHeader ?? t('ui:widgets.forms.columnMappingTable.sampleHeader', 'Sample')}
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
                  {skipLabel ?? t('ui:widgets.forms.columnMappingTable.skip', "Don't import")}
                </option>
              </Select>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
