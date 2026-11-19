// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The UI kit's controls: `Button`, `Input`, `Select` and `Switch`, on the
 * design system's own components. A `label` wraps the control in a
 * `FormField`, which names it for screen readers.
 */

import { createElement, useId, type ReactElement, type ReactNode } from 'react';
import {
  Button as UiButton,
  FormField,
  Input as UiInput,
  Label,
  Select as UiSelect,
  Switch as UiSwitch,
} from '@adminium/ui';
import type { ButtonProps, FieldProps, InputProps, SelectProps, SwitchProps } from '@adminium/server/ui';

import { lucideByName } from '../../lib/lucide.js';

const VARIANT = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'ghost',
  destructive: 'destructive',
} as const;

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  type = 'button',
  onClick,
  'aria-label': ariaLabel,
}: ButtonProps): ReactNode {
  return (
    <UiButton
      variant={VARIANT[variant]}
      size={size}
      loading={loading}
      disabled={disabled}
      type={type}
      {...(onClick === undefined ? {} : { onClick })}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      {...(icon === undefined ? {} : { iconLeft: createElement(lucideByName(icon), { 'aria-hidden': true }) })}
    >
      {children}
    </UiButton>
  );
}

/**
 * Wraps a control in a labelled field when the caller gave a label. The
 * control's own `id`, when the caller gave one, is the one the label points
 * at: the field would otherwise point at an id of its own that the control,
 * keeping the caller's, does not carry, and the control would have no name.
 */
function field({ label, hint, error }: FieldProps, control: ReactElement, id: string | undefined): ReactNode {
  if (label === undefined) return control;
  return (
    <FormField label={label} helper={hint} error={error} controlId={id}>
      {control}
    </FormField>
  );
}

export function Input({ label, hint, error, ...props }: InputProps): ReactNode {
  const invalid = error !== undefined && error !== null && error !== false;
  return field({ label, hint, error }, <UiInput {...props} error={invalid} />, props.id);
}

export function Select({ label, hint, error, options, children, ...props }: SelectProps): ReactNode {
  const invalid = error !== undefined && error !== null && error !== false;
  return field(
    { label, hint, error },
    <UiSelect {...props} error={invalid}>
      {options?.map((option) =>
        typeof option === 'string' ? (
          <option key={option} value={option}>
            {option}
          </option>
        ) : (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ),
      )}
      {children}
    </UiSelect>,
    props.id,
  );
}

export function Switch({ label, id, ...props }: SwitchProps): ReactNode {
  const generated = useId();
  const controlId = id ?? generated;
  const control = <UiSwitch id={controlId} {...props} />;
  if (label === undefined) return control;
  return (
    <span className="inline-flex items-center gap-2">
      {control}
      <Label htmlFor={controlId}>{label}</Label>
    </span>
  );
}
