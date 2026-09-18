// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Default control (D23, plan 50 F2).
 *
 * ─── Why this is a filter and not a list ───────────────────────────────────
 *
 * The wire vocabulary has four default kinds and every one of them is refused
 * on some column: `now` on a text column, `uuid` anywhere but postgres,
 * `autoincrement` on anything that is not the table's whole key. Offering all
 * four and letting the route say no produces a 422 at Review, four clicks after
 * the mistake, phrased in the wire's words. So the kinds come from
 * {@link offerableDefaultKinds} — the SAME predicate the server validates with,
 * imported rather than re-stated, because a copy of a rule is a rule that
 * drifts.
 *
 * ─── Why the value editor follows the type ─────────────────────────────────
 *
 * A literal default is text on the wire and a value to the person typing it.
 * `INVALID_DEFAULT_LITERAL` is the refusal for "2026-13-45" in a date column,
 * and a date input cannot produce one. Each type gets the control that can only
 * produce what its own validator accepts: a date picker for dates, a number
 * field for numbers, the value list for an enum, yes/no for a boolean.
 */
import { DateInput, FormField, Input, Select } from '@adminium/ui';
import { offerableDefaultKinds } from '@adminium/engine';

import { t } from '../../../i18n/t.js';
import type { AuthorableType, DesiredColumn, DesiredDefault } from './types.js';

export interface DefaultControlProps {
  column: DesiredColumn;
  dialect: string;
  /** True when this column IS the table's whole primary key. */
  isSoleKey: boolean;
  /** The column's allowed values, when it is an enum. */
  enumValues?: readonly string[];
  onChange: (next: DesiredDefault) => void;
}

/** The `<select>`'s value — the four kinds plus the absence of one. */
type Choice = 'none' | NonNullable<DesiredDefault>['kind'];

const LABELS: Record<Choice, () => string> = {
  none: () => t('studio:design.default.none', 'Nothing'),
  literal: () => t('studio:design.default.literal', 'A value'),
  now: () => t('studio:design.default.now', 'The current date and time'),
  uuid: () => t('studio:design.default.uuid', 'A new unique id'),
  autoincrement: () => t('studio:design.default.autoincrement', 'Count up from the last row'),
};

/** The literal a newly chosen "A value" starts from, per type. */
function blankLiteral(type: AuthorableType, enumValues: readonly string[]): string {
  switch (type) {
    case 'boolean':
      return 'false';
    case 'integer':
    case 'bigint':
      return '0';
    case 'decimal':
    case 'float':
      return '0';
    case 'json':
      return '{}';
    case 'enum':
      return enumValues[0] ?? '';
    default:
      return '';
  }
}

export function DefaultControl({
  column,
  dialect,
  isSoleKey,
  enumValues = [],
  onChange,
}: DefaultControlProps) {
  const kinds = offerableDefaultKinds({
    logicalType: column.logicalType,
    dialect: dialect as never,
    isSoleKey,
  });
  const choice: Choice = column.default?.kind ?? 'none';
  const literal = column.default?.kind === 'literal' ? column.default.text : '';

  const pick = (next: Choice): void => {
    if (next === 'none') {
      onChange(null);
      return;
    }
    if (next === 'literal') {
      onChange({ kind: 'literal', text: blankLiteral(column.logicalType, enumValues) });
      return;
    }
    onChange({ kind: next });
  };

  return (
    <>
      <FormField className="w-48 shrink-0" label={t('studio:design.column.default', 'Starts as')}>
        <Select value={choice} onChange={(event) => pick(event.target.value as Choice)}>
          <option value="none">{LABELS.none()}</option>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {LABELS[kind]()}
            </option>
          ))}
          {/*
            * A kind the snapshot already carries but this column cannot be
            * offered — a `now` default on a column being retyped to text, say —
            * stays selectable until the person changes it. Dropping it from the
            * list silently would restate the column WITHOUT the default and
            * plan a `drop-default` nobody asked for.
            */}
          {choice !== 'none' && !kinds.includes(choice) ? (
            <option value={choice}>{LABELS[choice]()}</option>
          ) : null}
        </Select>
      </FormField>

      {choice === 'literal' ? (
        <FormField className="w-44 shrink-0" label={t('studio:design.column.defaultValue', 'Value')}>
          <LiteralEditor
            // A column with a value list takes one of its own answers, whether
            // the engine calls it `enum` or the `varchar(64)` a CHECK-backed
            // choice column really is (D32).
            type={enumValues.length > 0 ? 'enum' : column.logicalType}
            value={literal}
            enumValues={enumValues}
            onChange={(text) => onChange({ kind: 'literal', text })}
          />
        </FormField>
      ) : null}
    </>
  );
}

/** Exactly what `FormField`'s Slot passes down — nothing wider, so no control's own props collide. */
interface SlotInjected {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}

/**
 * `FormField` injects `id` and the aria wiring through a Radix `Slot`, and a
 * Slot hands them to its child ELEMENT — which here is this component, not the
 * control it renders. Without forwarding, the label's `htmlFor` points at an id
 * nothing carries, and the field has no accessible name at all. Caught by a
 * test that asked for the control by its label.
 */
function LiteralEditor({
  type,
  value,
  enumValues,
  onChange,
  ...injected
}: {
  type: AuthorableType;
  value: string;
  enumValues: readonly string[];
  onChange: (text: string) => void;
} & SlotInjected) {
  switch (type) {
    case 'boolean':
      return (
        <Select {...injected} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="true">{t('studio:design.default.true', 'Yes')}</option>
          <option value="false">{t('studio:design.default.false', 'No')}</option>
        </Select>
      );
    case 'integer':
    case 'bigint':
    case 'decimal':
    case 'float':
      return (
        <Input
          {...injected}
          type="number"
          inputMode={type === 'integer' || type === 'bigint' ? 'numeric' : 'decimal'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'date':
      return <DateInput {...injected} value={value} onChange={(event) => onChange(event.target.value)} />;
    case 'time':
      return (
        <DateInput {...injected} type="time" value={value} onChange={(event) => onChange(event.target.value)} />
      );
    case 'timestamp':
    case 'timestamptz':
      return (
        <DateInput
          {...injected}
          type="datetime-local"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'enum':
      return (
        <Select {...injected} value={value} onChange={(event) => onChange(event.target.value)}>
          {enumValues.length === 0 ? <option value="">—</option> : null}
          {enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    default:
      return <Input {...injected} value={value} onChange={(event) => onChange(event.target.value)} />;
  }
}
