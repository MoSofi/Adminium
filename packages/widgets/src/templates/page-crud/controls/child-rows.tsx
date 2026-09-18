// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LINE-ITEMS REPEATER — the comp's bordered table of child rows
 * (comp 284–314).
 *
 * ─── A line is a record, and this is a form for several of them ────────────
 *
 * Each row edits real columns of a real table: the controls are the ordinary
 * ones, chosen by the ordinary rule, so a `qty` here behaves exactly as a `qty`
 * on its own page does. What this component owns is the arrangement — the
 * header, the grid, Add line, the bin — and the running total, which is
 * arithmetic over values nobody has saved yet and which therefore no database
 * can do.
 *
 * ─── Nothing computed is stored unless a column holds it ───────────────────
 *
 * A line's total is written into the child row only when the field names a
 * column for it AND that column is not marked read-only. The block underneath
 * is never stored at all: it is a reading of the lines.
 *
 * ─── Removing a line is removing it, not blanking it ───────────────────────
 *
 * The bin drops the row from the list; the save's DIFF turns that into a
 * delete of a row that exists, or into nothing at all for a row that was added
 * in this dialog and never written.
 */
import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, MonoText } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { computeTotals } from '../../../page-config/child-totals.js';
import type {
  CrudFormChildColumn,
  CrudFormChildTotals,
  CrudFormRelationField,
} from '../../../page-config/index.js';
import type { GridColumnSpec } from '../../../families/tables/column-spec.js';
import { CONTROL_COMPONENTS } from './index.js';
import { controlForColumn, type ColumnFacts } from '../field-mapping.js';
import type { ControlOption } from './types.js';

/** One row as the form holds it. */
export interface ChildRowValue {
  key?: Record<string, unknown> | undefined;
  values: Record<string, unknown>;
}

export interface ChildRowsControlProps {
  field: CrudFormRelationField;
  /** The child table's columns, as the page reply describes them. */
  columns: readonly GridColumnSpec[];
  facts?: ColumnFacts | undefined;
  rows: readonly ChildRowValue[];
  onChange: (rows: ChildRowValue[]) => void;
  label: string;
  disabled?: boolean | undefined;
  currency?: string | undefined;
  locale?: string | undefined;
}

export function ChildRowsControl({
  field,
  columns,
  facts,
  rows,
  onChange,
  label,
  disabled,
  currency,
  locale,
}: ChildRowsControlProps) {
  const t = useMaybeT();
  const byName = useMemo(() => new Map(columns.map((column) => [column.name, column])), [columns]);
  const specs: CrudFormChildColumn[] = field.columns ?? [];
  const totals: CrudFormChildTotals | undefined = field.totals;

  const computed = useMemo(
    () => (totals === undefined ? null : computeTotals(totals, rows.map((row) => row.values))),
    [totals, rows],
  );

  /** The comp's `1fr 70px 96px 92px 34px` (289), plus the bin. */
  const template = `${specs.map((spec) => spec.width ?? '1fr').join(' ')} 34px`;
  const atMax = field.max !== undefined && rows.length >= field.max;

  const setCell = (index: number, column: string, next: unknown): void => {
    onChange(
      rows.map((row, at) =>
        at === index ? { ...row, values: { ...row.values, [column]: next } } : { ...row },
      ),
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="child-rows">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-fg">{label}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled === true || atMax}
          onClick={() => onChange([...rows.map((row) => ({ ...row })), { values: {} }])}
          data-testid="child-add"
          className="text-accent"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {t('ui:formDialog.lines.add', 'Add line')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        {/* 10.5 / 700 uppercase on `surface-2`, the comp's header row (290–295). */}
        <div
          className="grid grid-cols-[var(--adm-lines-grid)] gap-2.5 border-b border-border bg-surface-2 px-3 py-2.5"
          style={{ '--adm-lines-grid': template }}
          data-testid="child-head"
        >
          {specs.map((spec) => (
            <span
              key={spec.column}
              className={`text-[10.5px] font-bold uppercase tracking-[0.04em] text-fg-subtle${
                spec.readOnly === true ? ' text-end' : ''
              }`}
            >
              {spec.label ?? byName.get(spec.column)?.label ?? spec.column}
            </span>
          ))}
          <span />
        </div>

        {rows.map((row, index) => (
          <div
            key={index}
            className="grid grid-cols-[var(--adm-lines-grid)] items-center gap-2.5 border-b border-border px-3 py-2.5"
            style={{ '--adm-lines-grid': template }}
            data-testid="child-row"
          >
            {specs.map((spec) => {
              const column = byName.get(spec.column);
              if (column === undefined) return <span key={spec.column} />;
              if (spec.readOnly === true) {
                return (
                  <MonoText
                    key={spec.column}
                    className="text-end text-[12.5px] font-bold text-fg"
                    data-testid={`child-total-${String(index)}`}
                  >
                    {computed?.lines[index] ?? ''}
                  </MonoText>
                );
              }
              const control = spec.control ?? controlForColumn(column, facts?.[column.name]);
              const entry =
                CONTROL_COMPONENTS[control as keyof typeof CONTROL_COMPONENTS] ??
                CONTROL_COMPONENTS.text;
              const Control = entry.component;
              return (
                <Control
                  key={spec.column}
                  column={column}
                  value={row.values[spec.column]}
                  onChange={(next: unknown) => setCell(index, spec.column, next)}
                  options={optionsOf(column)}
                  mode="create"
                  aria-label={`${spec.label ?? column.label ?? spec.column} ${String(index + 1)}`}
                  {...(disabled === true ? { disabled: true } : {})}
                  {...(currency === undefined ? {} : { currency })}
                  {...(locale === undefined ? {} : { locale })}
                />
              );
            })}
            <IconButton
              variant="ghost"
              size="sm"
              tooltip
              label={t('ui:formDialog.lines.remove', 'Remove line {n}', { n: index + 1 })}
              disabled={disabled === true}
              onClick={() => onChange(rows.filter((_, at) => at !== index).map((other) => ({ ...other })))}
              data-testid="child-remove"
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        ))}

        {computed === null ? null : (
          /* The comp's 220px block, right-aligned under the table (306–312). */
          <div className="flex justify-end p-3">
            <div className="flex w-[220px] flex-col gap-1.5" data-testid="child-totals">
              {computed.rows.map((row) => (
                <div
                  key={row.label}
                  className={
                    row.emphasis
                      ? 'flex justify-between border-t border-border pt-1.5'
                      : 'flex justify-between'
                  }
                >
                  <span
                    className={
                      row.emphasis ? 'text-[13px] font-extrabold text-fg' : 'text-[12.5px] text-fg-muted'
                    }
                  >
                    {row.label}
                  </span>
                  <MonoText
                    className={
                      row.emphasis ? 'text-[14px] font-extrabold text-fg' : 'text-[12.5px] font-semibold text-fg'
                    }
                    data-testid={`child-total-${row.of}`}
                  >
                    {row.value}
                  </MonoText>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A child column's own answers — its enum, which is all a line needs. */
function optionsOf(column: GridColumnSpec): ControlOption[] {
  return (column.enumValues ?? []).map((value) => ({
    value,
    ...(column.enumTones?.[value] === undefined ? {} : { tone: column.enumTones[value] }),
  }));
}
