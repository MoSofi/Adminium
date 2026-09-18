// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Booleans and any-of lists (Appendix C, comp 258–261, 402–407, 494–500).
 *
 * Both of these OWN THEIR LABEL: the comp draws a bordered row with the
 * question inside it, so the renderer must not wrap them in a `FormField` —
 * that would print the label twice, once above the row and once in it.
 */
import { CheckRow, ToggleRow } from '@adminium/ui';

import type { ControlProps } from './types.js';

/** The default for a boolean column (D18). */
export function ToggleRowControl(props: ControlProps) {
  return (
    <ToggleRow
      {...(props.id === undefined ? {} : { controlId: props.id })}
      label={props.field?.label ?? props.column.label}
      {...(props.field?.help === undefined ? {} : { description: props.field.help })}
      checked={props.value === true || props.value === 'true' || props.value === 1}
      {...(props.disabled === true ? { disabled: true } : {})}
      onCheckedChange={(checked) => props.onChange(checked)}
    />
  );
}

/**
 * A check row over a BOOLEAN — one row, on or off (comp 402–407).
 *
 * The any-of form (a check row per option over a list-valued column) is
 * {@link CheckRowsControl}, which is a different control because it holds a
 * different kind of value: a list, not a flag.
 */
export function CheckRowControl(props: ControlProps) {
  return (
    <CheckRow
      label={props.field?.label ?? props.column.label}
      {...(props.field?.help === undefined ? {} : { detail: props.field.help })}
      checked={props.value === true || props.value === 'true' || props.value === 1}
      {...(props.disabled === true ? { disabled: true } : {})}
      onCheckedChange={(checked) => props.onChange(checked)}
    />
  );
}

/**
 * ANY-OF: a check row per option, over a list-valued column (D19, comp 494–500).
 *
 * The value is the list of the values that are on. Order follows the OPTIONS,
 * not the clicks — a list whose order depends on the order somebody happened to
 * tick things in reads differently on every row.
 */
export function CheckRowsControl(props: ControlProps) {
  const current = Array.isArray(props.value) ? props.value.map(String) : [];
  const toggle = (value: string, on: boolean): void => {
    const next = props.options
      .map((option) => option.value)
      .filter((option) => (option === value ? on : current.includes(option)));
    props.onChange(next);
  };
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={props.field?.label ?? props.column.label}>
      {props.options.map((option) => (
        <CheckRow
          key={option.value}
          label={option.label ?? option.value}
          {...(option.description === undefined ? {} : { detail: option.description })}
          checked={current.includes(option.value)}
          {...(props.disabled === true ? { disabled: true } : {})}
          onCheckedChange={(checked) => toggle(option.value, checked)}
        />
      ))}
    </div>
  );
}
