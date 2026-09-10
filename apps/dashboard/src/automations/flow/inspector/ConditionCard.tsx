// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Condition card (`designs/Automation Rules.dc.html` 124-137;
 * 42-automations-and-workflow-logs.md D18, FILL F5).
 *
 * The comp's three controls — Field, operator, Value — with two changes it
 * could not have drawn:
 *
 *  - **Field is a Select.** A typed column name cannot be resolved against a
 *    schema; the server refuses it with a 422 the person sees only on save.
 *  - **A "Look at" segmented control.** "This record" is the comp's own
 *    condition. "Related records" is FILL F5 — a COUNT over another table,
 *    which both of the owner's examples need and no field comparison can
 *    express.
 *
 * The operator list changes with the column: the comp's five plus emptiness
 * everywhere, and the four relative-time operators ONLY on a date column,
 * because only a date column has bounds to compute (D5). A count compares
 * with four (`is`, `is not`, greater, less) — `contains` on a number is
 * nonsense and the relative ones have nothing to compare against.
 */

import { Combobox, Input, Select } from '@adminium/ui';
import { useId, type ReactNode } from 'react';

import { t } from '../../../i18n/t.js';
import type { SourceColumn, SourceTable } from '../../api.js';
import type { Condition, ConditionOp, DurationUnit, RelativeOperand } from '../../model/graph.js';
import {
  COUNT_OPS,
  DATE_OPS,
  OP_LABELS,
  VALUE_OPS,
  isRelativeOp,
  opNeedsOperand,
} from '../../model/vocabulary.js';
import { Card } from './primitives.js';

export interface ConditionCardProps {
  condition: Condition;
  /** The columns of the record this condition is about. */
  columns: readonly SourceColumn[];
  /**
   * The tables of the rule's OWN connection — the count form's first field.
   * Not every connection's: `related-count.ts` counts inside the view of the
   * connection the event came from (`register.ts` `countRelated`), so a
   * table from another one is a run-time "unknown table".
   */
  tables: readonly SourceTable[];
  onChange: (condition: Condition) => void;
}

const UNITS: DurationUnit[] = ['minutes', 'hours', 'days'];

function unitLabel(unit: DurationUnit, count: number): string {
  if (unit === 'minutes') {
    return t('automations:unit.minutes', '{count, plural, one {minute} other {minutes}}', { count });
  }
  if (unit === 'hours') {
    return t('automations:unit.hours', '{count, plural, one {hour} other {hours}}', { count });
  }
  return t('automations:unit.days', '{count, plural, one {day} other {days}}', { count });
}

export function ConditionCard({ condition, columns, tables, onChange }: ConditionCardProps): ReactNode {
  const left = condition.left;
  const isCount = 'count' in left;
  const field = 'count' in left ? '' : left.field;
  const column = columns.find((candidate) => candidate.name === field);
  const ops: readonly ConditionOp[] = isCount
    ? COUNT_OPS
    : column?.dateLike === true
      ? [...VALUE_OPS, ...DATE_OPS]
      : VALUE_OPS;

  const relative = isRelativeOp(condition.op);
  const operand = condition.right;
  const amount =
    relative && typeof operand === 'object' && operand !== null ? (operand as RelativeOperand).amount : 1;
  const unit: DurationUnit =
    relative && typeof operand === 'object' && operand !== null
      ? (operand as RelativeOperand).unit
      : 'hours';

  return (
    <Card title={t('automations:insp.condition', 'Condition')}>
      {/* FILL F5 — the comp has one shape; this switches to the second. */}
      <div className="flex rounded-[9px] border border-border-strong bg-surface p-0.5" role="group">
        <Tab
          active={!isCount}
          label={t('automations:insp.thisRecord', 'This record')}
          onClick={() => {
            onChange({ left: { field: '' }, op: 'is', right: '' });
          }}
          testId="cond-this-record"
        />
        <Tab
          active={isCount}
          label={t('automations:insp.related', 'Related records')}
          onClick={() => {
            onChange({
              left: { count: { table: '', matchColumn: '', equalsField: '' } },
              op: 'gt',
              right: 0,
            });
          }}
          testId="cond-related"
        />
      </div>

      {isCount ? (
        <CountForm condition={condition} columns={columns} tables={tables} onChange={onChange} />
      ) : (
        <Select
          value={field}
          aria-label={t('automations:insp.field', 'Field')}
          onChange={(event) => {
            onChange({ ...condition, left: { field: event.target.value } });
          }}
          data-testid="cond-field"
        >
          <option value="">{t('automations:insp.field', 'Field')}</option>
          {columns.map((candidate) => (
            <option key={candidate.name} value={candidate.name}>
              {candidate.label}
            </option>
          ))}
        </Select>
      )}

      <Select
        value={condition.op}
        aria-label={t('automations:insp.condition', 'Condition')}
        onChange={(event) => {
          const op = event.target.value as ConditionOp;
          const next: Condition = { ...condition, op };
          if (!opNeedsOperand(op)) delete next.right;
          else if (isRelativeOp(op)) next.right = { amount, unit };
          else if (typeof next.right !== 'string' && typeof next.right !== 'number') next.right = '';
          onChange(next);
        }}
        data-testid="cond-op"
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {t(OP_LABELS[op].key, OP_LABELS[op].fallback)}
          </option>
        ))}
      </Select>

      {!opNeedsOperand(condition.op) ? null : relative ? (
        <div className="flex gap-2.5">
          <Input
            type="number"
            min={1}
            value={String(amount)}
            aria-label={t('automations:insp.value', 'Value')}
            onChange={(event) => {
              onChange({ ...condition, right: { amount: Math.max(1, Number(event.target.value) || 1), unit } });
            }}
            data-testid="cond-amount"
          />
          <Select
            value={unit}
            aria-label={t('automations:wait.unit', 'Unit')}
            onChange={(event) => {
              onChange({ ...condition, right: { amount, unit: event.target.value as DurationUnit } });
            }}
            data-testid="cond-unit"
          >
            {UNITS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {unitLabel(candidate, amount)}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <Input
          value={typeof operand === 'object' ? '' : String(operand ?? '')}
          placeholder={t('automations:insp.value', 'Value')}
          aria-label={t('automations:insp.value', 'Value')}
          onChange={(event) => {
            onChange({ ...condition, right: event.target.value });
          }}
          data-testid="cond-value"
        />
      )}
    </Card>
  );
}

function CountForm({
  condition,
  columns,
  tables,
  onChange,
}: ConditionCardProps): ReactNode {
  const tableId = `${useId()}-count-table`;
  if (!('count' in condition.left)) return null;
  const count = condition.left.count;
  const counted = tables.find((table) => table.id === count.table);
  return (
    <div className="flex flex-col gap-2.5">
      {/* Searchable, like every other table picker in this feature (D25). */}
      <Row label={t('automations:insp.countOf', 'Count of')} htmlFor={tableId}>
        <Combobox
          id={tableId}
          value={count.table === '' ? null : count.table}
          onValueChange={(next) => {
            if (next === null || next === '') return;
            onChange({
              ...condition,
              // The match column named the OLD table's columns.
              left: { count: { ...count, table: next, matchColumn: '' } },
            });
          }}
          options={tables.map((table) => ({ value: table.id, label: table.label }))}
          placeholder={t('automations:modal.tablePlaceholder', 'Search tables…')}
          emptyText={t('automations:modal.tableEmpty', 'No matching table')}
        />
      </Row>
      <Row label={t('automations:insp.where', 'where')}>
        <Select
          value={count.matchColumn}
          aria-label={t('automations:insp.where', 'where')}
          onChange={(event) => {
            onChange({ ...condition, left: { count: { ...count, matchColumn: event.target.value } } });
          }}
          data-testid="cond-count-match"
        >
          <option value="">{t('automations:rec.column', 'Column')}</option>
          {(counted?.columns ?? []).map((candidate) => (
            <option key={candidate.name} value={candidate.name}>
              {candidate.label}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t('automations:insp.isThisRecords', "is this record's")}>
        <Select
          value={count.equalsField}
          aria-label={t('automations:insp.isThisRecords', "is this record's")}
          onChange={(event) => {
            onChange({ ...condition, left: { count: { ...count, equalsField: event.target.value } } });
          }}
          data-testid="cond-count-equals"
        >
          <option value="">{t('automations:rec.column', 'Column')}</option>
          {columns.map((candidate) => (
            <option key={candidate.name} value={candidate.name}>
              {candidate.label}
            </option>
          ))}
        </Select>
      </Row>
    </div>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  /** For a COMPOSITE control (`Combobox`), which a wrapping label cannot name. */
  htmlFor?: string | undefined;
  children: ReactNode;
}): ReactNode {
  if (htmlFor !== undefined) {
    return (
      <div className="block">
        <label htmlFor={htmlFor} className="mb-1 block text-[11px] text-fg-subtle">
          {label}
        </label>
        {children}
      </div>
    );
  }
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-fg-subtle">{label}</span>
      {children}
    </label>
  );
}

function Tab({
  active,
  label,
  onClick,
  testId,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId: string;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={`flex-1 rounded-[7px] px-2 py-1.5 text-[11.5px] font-bold ${
        active ? 'bg-accent text-accent-fg' : 'text-fg-muted'
      }`}
    >
      {label}
    </button>
  );
}
