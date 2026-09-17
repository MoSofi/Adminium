// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The UI kit's controls (49-developer-projects.md §6.2): `Button`, `Input`,
 * `Select` and `Switch`, on the design system's own components. A `label`
 * wraps the control in a `FormField`, which names it for screen readers.
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

/** Wraps a control in a labelled field when the caller gave a label. */
function field({ label, hint, error }: FieldProps, control: ReactElement): ReactNode {
  if (label === undefined) return control;
  return (
    <FormField label={label} helper={hint} error={error}>
      {control}
    </FormField>
  );
}

export function Input({ label, hint, error, ...props }: InputProps): ReactNode {
  const invalid = error !== undefined && error !== null && error !== false;
  return field({ label, hint, error }, <UiInput {...props} error={invalid} />);
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
