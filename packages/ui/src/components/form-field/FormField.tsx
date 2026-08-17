// SPDX-License-Identifier: AGPL-3.0-only
import { Slot } from '@radix-ui/react-slot';
import { createContext, useContext, useId } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { Label } from '../label/index.js';

export interface FormFieldContextValue {
  /** id assigned to the control (label `htmlFor` target). */
  id: string;
  /** id of the helper/error caption (value of `aria-describedby`), if rendered. */
  descriptionId: string | undefined;
  /** True while the field shows an `error` caption. */
  invalid: boolean;
  /** Mirrors the `required` prop. */
  required: boolean;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

/**
 * Read the enclosing `FormField` wiring (id / describedby / invalid /
 * required). Composite controls that cannot receive Slot-injected props on a
 * single root element (e.g. `Combobox` triggers) use this to self-wire.
 * Returns `null` outside a `FormField`.
 */
export function useFormField(): FormFieldContextValue | null {
  return useContext(FormFieldContext);
}

export interface FormFieldProps extends Omit<React.ComponentPropsWithRef<'div'>, 'style'> {
  /** Field label text (rendered in a `Label` wired via `htmlFor`). */
  label: React.ReactNode;
  /** Appends a danger asterisk (decorative) and sets `aria-required` on the control. */
  required?: boolean | undefined;
  /** Muted caption under the control; replaced by `error` when both are set. */
  helper?: React.ReactNode | undefined;
  /**
   * Danger caption under the control. When set, the control also gets
   * `aria-invalid="true"` — token-styled controls (`Input`, `Select`,
   * `Textarea`, …) restyle themselves from that attribute alone.
   */
  error?: React.ReactNode | undefined;
  /** Type-annotation slot next to the label — typically a mono `Tag` (`varchar`, `int8`). */
  tag?: React.ReactNode | undefined;
  /** Explicit control id (defaults to a generated one). */
  controlId?: string | undefined;
  /**
   * The single form control. Receives `id`, `aria-describedby`,
   * `aria-invalid` and `aria-required` through a Radix `Slot`.
   */
  children: React.ReactElement;
}

/**
 * FormField — label + control + helper/error caption
 * (research/design-system.md §3 Tier 2). Accessibility wiring (`htmlFor`,
 * `aria-describedby`, `aria-invalid`, `aria-required`) is injected into the
 * child control via Slot and also exposed through `useFormField()` context.
 * RHF-agnostic: pass `error` from any form library.
 */
export function FormField({
  label,
  required = false,
  helper,
  error,
  tag,
  controlId,
  className,
  children,
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const id = controlId ?? generatedId;
  const invalid = error !== undefined && error !== null && error !== false;
  const caption = invalid ? error : helper;
  const descriptionId = caption !== undefined && caption !== null ? `${id}-caption` : undefined;

  return (
    <FormFieldContext.Provider value={{ id, descriptionId, invalid, required }}>
      <div className={cn('flex w-full flex-col gap-1.5', className)} {...props}>
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>
            {label}
            {required ? (
              <span aria-hidden="true" className="ms-0.5 text-danger">
                *
              </span>
            ) : null}
          </Label>
          {tag ? <span className="ms-auto flex items-center">{tag}</span> : null}
        </div>
        <Slot
          id={id}
          {...(descriptionId ? { 'aria-describedby': descriptionId } : {})}
          {...(invalid ? { 'aria-invalid': true as const } : {})}
          {...(required ? { 'aria-required': true as const } : {})}
        >
          {children}
        </Slot>
        {descriptionId ? (
          <p
            id={descriptionId}
            className={cn('text-[11.5px] leading-4', invalid ? 'font-medium text-danger' : 'text-fg-muted')}
          >
            {caption}
          </p>
        ) : null}
      </div>
    </FormFieldContext.Provider>
  );
}
