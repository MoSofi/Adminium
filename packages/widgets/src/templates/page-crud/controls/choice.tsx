// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The choice family (Appendix C, comp 194, 209, 419–421, 423–431, 456).
 *
 * One set of answers, four ways to show it, and the default is decided by arity
 * and by whether the column may be left empty (D18): four or fewer and required
 * is a segmented tray, everything else is a select — because a select is the
 * one control with somewhere for "no answer" to live.
 *
 * ─── F15: a stored value outside the list survives ─────────────────────────
 *
 * A row written before the list was narrowed still holds its old value, and an
 * edit dialog that silently dropped it would rewrite that row the moment
 * anybody saved anything else. Every control here keeps the current value
 * selectable, marked as no longer offered.
 */
import { ChoiceChips, RadioCard, RadioGroup, SegmentedControl, Select } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { uiToneOf } from '../../../families/tables/column-spec.js';
import type { ControlOption, ControlProps } from './types.js';

/** The tone words a dot can be drawn in (the spec's own vocabulary). */
const TONES = new Set(['neutral', 'accent', 'pos', 'warn', 'danger', 'info', 'muted']);

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The options, plus the current value when the list no longer offers it (F15).
 */
function withCurrent(options: readonly ControlOption[], value: unknown): ControlOption[] {
  const current = asText(value);
  if (current === '' || options.some((option) => option.value === current)) return [...options];
  return [...options, { value: current }];
}

const labelOf = (option: ControlOption): string => option.label ?? option.value;

export function SelectControl(props: ControlProps) {
  const t = useMaybeT();
  const options = withCurrent(props.options, props.value);
  return (
    <Select
      {...(props.id === undefined ? {} : { id: props.id })}
      {...(props['aria-describedby'] === undefined ? {} : { 'aria-describedby': props['aria-describedby'] })}
      {...(props['aria-invalid'] === undefined ? {} : { 'aria-invalid': props['aria-invalid'] })}
      {...(props['aria-required'] === undefined ? {} : { 'aria-required': props['aria-required'] })}
      {...(props.error === true ? { error: true as const } : {})}
      {...(props.disabled === true ? { disabled: true } : {})}
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value === '' ? null : event.target.value)}
    >
      <option value="">
        {props.column.nullable ? '—' : t('ui:combobox.placeholder', 'Select…')}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {labelOf(option)}
        </option>
      ))}
    </Select>
  );
}

/** The tray with coloured dots (comp 194, 456). */
export function SegmentedChoiceControl(props: ControlProps) {
  const options = withCurrent(props.options, props.value);
  return (
    <SegmentedControl
      {...(props.id === undefined ? {} : { id: props.id })}
      aria-label={props.field?.label ?? props.column.label}
      options={options.map((option) => {
        const tone = option.tone ?? props.column.enumTones?.[option.value];
        return {
          value: option.value,
          label: labelOf(option),
          // `uiToneOf` maps the SPEC's tone vocabulary; a tone an admin typed
          // into a rule is a free string, so an unknown one draws no dot rather
          // than a colour nobody chose.
          ...(tone === undefined || !TONES.has(tone) ? {} : { dot: uiToneOf(tone as never) }),
        };
      })}
      {...(asText(props.value) === '' ? {} : { value: asText(props.value) })}
      {...(props.disabled === true ? { disabled: true } : {})}
      onValueChange={(next) => props.onChange(next)}
    />
  );
}

/** Two or three answers as pills (comp 419–421). Never a default. */
export function PillSwitchControl(props: ControlProps) {
  const options = withCurrent(props.options, props.value);
  return (
    <ChoiceChips
      aria-label={props.field?.label ?? props.column.label}
      options={options.map((option) => ({ value: option.value, label: labelOf(option) }))}
      value={asText(props.value) === '' ? null : asText(props.value)}
      {...(props.disabled === true ? { disabled: true } : {})}
      onValueChange={(next) => props.onChange(next)}
    />
  );
}

/**
 * Cards with a radio dot, a big mono line and a sentence (comp 423–431).
 *
 * The big line is the option's own `description`'s first job — it is what the
 * person compares across the cards ("Next day", "3–5 days"), and the sentence
 * under it is the detail.
 */
export function ChoiceCardsControl(props: ControlProps) {
  const options = withCurrent(props.options, props.value);
  return (
    <RadioGroup
      aria-label={props.field?.label ?? props.column.label}
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
      value={asText(props.value)}
      {...(props.disabled === true ? { disabled: true } : {})}
      onValueChange={(next) => props.onChange(next)}
    >
      {options.map((option) => (
        <RadioCard
          key={option.value}
          layout="tile"
          value={option.value}
          title={labelOf(option)}
          {...(option.description === undefined ? {} : { description: option.description })}
        />
      ))}
    </RadioGroup>
  );
}
