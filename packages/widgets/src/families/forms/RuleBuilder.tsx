/**
 * `rule-builder` (annex §10) — condition rows (field, operator, accent value)
 * joined by ALL/ANY pill dividers, removable, with a dashed add button; feeds
 * segment/filter definitions. Evidence: Audience Segments.
 *
 * PRESENTATIONAL: the condition list lives in local state and every change is
 * reported as a `mutate` intent (04 §2.1). The widget never compiles the rule to
 * SQL and never persists it — the host owns both, because a WHERE clause built
 * in the browser is a WHERE clause the server must re-derive anyway.
 *
 * Binds the §3 `form-state` shape. Not `record-list`, even though the payload
 * carries a list: an EMPTY rule-builder is not an empty widget — it is a builder
 * waiting for its first condition, and it must show the dashed add button rather
 * than the frame's "no data" state (`form-state` is never empty by §3).
 */

import { DateInput, IconButton, Input, Select, cn } from '@adminium/ui';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { DEFAULT_RULE_FIELDS, DEFAULT_OPERATOR_LABELS, ruleBuilderConfigSchema, ruleBuilderDemoData } from './forms-config.js';
import type { RuleBuilderConfig, RuleFieldConfig } from './forms-config.js';
import {
  RULE_MATCH_MODES,
  RULE_OPERATORS,
  operatorTakesValue,
  operatorsForType,
  repairOperator,
} from './forms-builders.js';
import type { RuleFieldType, RuleMatchMode, RuleOperator } from './forms-builders.js';
import { oneOf, stringField } from './forms-lib.js';
import { bindingTargetOf, formValuesOf } from './forms-state.js';
import type { WidgetProps } from '../../registry/types.js';

export { ruleBuilderConfigSchema, ruleBuilderDemoData };
export type { RuleBuilderConfig };

export interface RuleCondition {
  key: string;
  field: string;
  op: RuleOperator;
  value: string;
}

type Rec = Record<string, unknown>;

/** The field def for a condition, or `null` when the catalog has no such column. */
function fieldDefOf(catalog: readonly RuleFieldConfig[], name: string): RuleFieldConfig | null {
  return catalog.find((field) => field.name === name) ?? null;
}

/**
 * Project the §3 `form-state` payload onto conditions.
 *
 * A condition naming a column the catalog no longer has is KEPT (typed as
 * `string`, the most permissive operator set), not dropped. Dropping it would
 * silently widen the rule: a saved segment that read "plan is pro AND region is
 * EU" would quietly become "plan is pro" the first time someone renamed the
 * region column, and the next save would persist the wider rule as if the user
 * had asked for it.
 */
export function conditionsOf(data: unknown, config: RuleBuilderConfig): RuleCondition[] {
  const values = formValuesOf(data);
  const raw = values['conditions'];
  if (!Array.isArray(raw)) return [];
  const catalog = config.fieldCatalog ?? DEFAULT_RULE_FIELDS;
  const out: RuleCondition[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const row = entry as Rec;
    const field = stringField(row, 'field');
    if (field === undefined) continue;
    const type: RuleFieldType = fieldDefOf(catalog, field)?.type ?? 'string';
    out.push({
      key: `${field}-${index}`,
      field,
      op: repairOperator(oneOf(row['op'], RULE_OPERATORS, 'eq'), type, config.operatorsByType),
      value: stringField(row, 'value') ?? '',
    });
  }
  return out;
}

/** Config's `matchMode` is the generated default; the payload's `match` overrides it. */
export function matchModeOf(data: unknown, config: RuleBuilderConfig): RuleMatchMode {
  const values = formValuesOf(data);
  return oneOf(values['match'], RULE_MATCH_MODES, config.matchMode);
}

export function RuleBuilderWidget({ config, data, onEvent }: WidgetProps<RuleBuilderConfig>) {
  const catalog = config.fieldCatalog ?? DEFAULT_RULE_FIELDS;
  const [conditions, setConditions] = useState<RuleCondition[]>(() => conditionsOf(data, config));
  const [match, setMatch] = useState<RuleMatchMode>(() => matchModeOf(data, config));
  const target = bindingTargetOf(config.binding);

  const emit = (nextConditions: readonly RuleCondition[], nextMatch: RuleMatchMode) => {
    if (target === null) return; // unbound (demo/story/palette) — nowhere to send it
    onEvent({
      type: 'mutate',
      intent: 'update',
      connectionId: target.connectionId,
      table: target.table,
      values: {
        conditions: nextConditions.map((condition) => ({
          field: condition.field,
          op: condition.op,
          // A value-less operator carries no value: sending the stale text the
          // user typed before switching to "is empty" would compile into the
          // WHERE clause as a condition they cannot see.
          ...(operatorTakesValue(condition.op) ? { value: condition.value } : {}),
        })),
        match: nextMatch,
      },
    });
  };

  const commit = (next: RuleCondition[]) => {
    setConditions(next);
    emit(next, match);
  };

  const patch = (index: number, partial: Partial<RuleCondition>) => {
    commit(conditions.map((condition, i) => (i === index ? { ...condition, ...partial } : condition)));
  };

  const onFieldChange = (index: number, name: string) => {
    const current = conditions[index];
    if (current === undefined) return;
    const type: RuleFieldType = fieldDefOf(catalog, name)?.type ?? 'string';
    // Re-point the operator at one the NEW column's type supports, and drop a
    // value that belonged to the old column — `mrr >= 500` must not survive a
    // switch to `country` as `country >= 500`.
    patch(index, { field: name, op: repairOperator(current.op, type, config.operatorsByType), value: '' });
  };

  const addCondition = () => {
    const first = catalog[0];
    if (first === undefined || conditions.length >= config.maxConditions) return;
    const allowed = operatorsForType(first.type, config.operatorsByType);
    commit([
      ...conditions,
      { key: `new-${conditions.length}-${first.name}`, field: first.name, op: allowed[0] ?? 'eq', value: '' },
    ]);
  };

  const toggleMatch = () => {
    const next: RuleMatchMode = match === 'all' ? 'any' : 'all';
    setMatch(next);
    emit(conditions, next);
  };

  const matchLabel = match === 'all' ? (config.allLabel ?? 'ALL') : (config.anyLabel ?? 'ANY');

  return (
    <div
      data-widget="rule-builder"
      data-match={match}
      data-testid={config.testId}
      className="flex h-full flex-col gap-2 overflow-auto px-4 pb-4"
    >
      {conditions.length === 0 && (
        <p className="text-body-sm text-fg-muted" data-part="rule-empty">
          {config.emptyBody ?? 'No conditions yet — add one to define this segment.'}
        </p>
      )}

      {conditions.map((condition, index) => {
        const def = fieldDefOf(catalog, condition.field);
        const type: RuleFieldType = def?.type ?? 'string';
        const operators = operatorsForType(type, config.operatorsByType);
        const unknownField = def === null;
        return (
          <div key={condition.key} className="flex flex-col gap-2">
            {index > 0 && (
              <button
                type="button"
                data-part="match-divider"
                onClick={toggleMatch}
                aria-label={matchLabel}
                className={
                  'w-fit rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 text-caption font-bold text-accent ' +
                  'transition-colors duration-150 hover:bg-accent hover:text-accent-fg ' +
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
                }
              >
                {matchLabel}
              </button>
            )}
            <div
              data-part="condition-row"
              data-field={condition.field}
              data-op={condition.op}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2"
            >
              <Select
                aria-label={config.fieldLabel ?? 'Field'}
                data-part="condition-field"
                mono
                value={condition.field}
                onChange={(event) => onFieldChange(index, event.currentTarget.value)}
                wrapperClassName="w-auto min-w-[8rem]"
              >
                {catalog.map((field) => (
                  <option key={field.name} value={field.name}>
                    {field.label ?? field.name}
                  </option>
                ))}
                {/* Keeps an orphaned condition round-trippable — see `conditionsOf`. */}
                {unknownField && <option value={condition.field}>{condition.field}</option>}
              </Select>

              <Select
                aria-label={config.operatorLabel ?? 'Operator'}
                data-part="condition-operator"
                value={condition.op}
                onChange={(event) => patch(index, { op: oneOf(event.currentTarget.value, RULE_OPERATORS, 'eq') })}
                wrapperClassName="w-auto min-w-[8rem]"
              >
                {operators.map((operator) => (
                  <option key={operator} value={operator}>
                    {config.operatorLabels?.[operator] ?? DEFAULT_OPERATOR_LABELS[operator] ?? operator}
                  </option>
                ))}
              </Select>

              {operatorTakesValue(condition.op) && (
                <ValueControl
                  type={type}
                  def={def}
                  value={condition.value}
                  label={config.valueLabel ?? 'Value'}
                  placeholder={config.valuePlaceholder ?? ''}
                  onChange={(next) => patch(index, { value: next })}
                />
              )}

              <IconButton
                label={`${config.removeLabel ?? 'Remove condition'} — ${condition.field}`}
                data-part="condition-remove"
                variant="ghost"
                size="sm"
                className="ms-auto"
                onClick={() => commit(conditions.filter((_, i) => i !== index))}
              >
                <X className="size-4" />
              </IconButton>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        data-part="add-condition"
        onClick={addCondition}
        disabled={conditions.length >= config.maxConditions || catalog.length === 0}
        className={cn(
          'flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5',
          'text-caption font-semibold text-fg-muted transition-colors duration-150',
          'hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        )}
      >
        <Plus aria-hidden="true" className="size-3.5" />
        {config.addLabel ?? 'Add condition'}
      </button>
    </div>
  );
}

/** The value control for a condition, chosen by the field's column type. */
function ValueControl({
  type,
  def,
  value,
  label,
  placeholder,
  onChange,
}: {
  type: RuleFieldType;
  def: RuleFieldConfig | null;
  value: string;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  if (type === 'enum' && def?.options !== undefined && def.options.length > 0) {
    return (
      <Select
        aria-label={label}
        data-part="condition-value"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        wrapperClassName="w-auto min-w-[8rem]"
      >
        <option value="" />
        {def.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label ?? option.value}
          </option>
        ))}
      </Select>
    );
  }
  if (type === 'boolean') {
    return (
      <Select
        aria-label={label}
        data-part="condition-value"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        wrapperClassName="w-auto min-w-[6rem]"
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </Select>
    );
  }
  if (type === 'date') {
    return (
      <DateInput
        aria-label={label}
        data-part="condition-value"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="w-auto"
      />
    );
  }
  return (
    <Input
      aria-label={label}
      data-part="condition-value"
      mono
      // The RAW string stays in state even for `number`: coercing per keystroke
      // makes "1." and a lone "-" impossible to type (same note as `FormFields`).
      {...(type === 'number' ? { inputMode: 'decimal' as const } : {})}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="w-auto min-w-[8rem] flex-1 text-accent"
    />
  );
}
