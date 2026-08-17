// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The generated-field renderer shared by `modal-wizard` and `drawer-form`
 * (annex §10 auto-instantiation: "column type → control (text/varchar→input,
 * text long→textarea, enum→segmented-control or select, bool→switch,
 * timestamp→date picker, numeric→number input with unit, email/url/phone via
 * name+check heuristics)").
 *
 * Both form widgets render the SAME field set — only their chrome differs (a
 * modal vs a drawer) — so the control mapping lives here once. A second copy
 * would be a second place for the kind→control mapping to drift.
 *
 * ACCESSIBILITY: `FormField` injects `id` / `aria-describedby` / `aria-invalid` /
 * `aria-required` into its SINGLE child through a Radix `Slot`, so each control
 * is passed bare — wrapping one in a `<div>` would hand the div the id and
 * silently unlink the label from the input.
 */

import { DateInput, FormField, Input, Select, Switch, Tag, Textarea } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import type { ReactElement } from 'react';

import type { FormFieldConfig } from './forms-config.js';

export interface FormFieldsProps {
  fields: readonly FormFieldConfig[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  /** Field names that failed the required check on submit. */
  invalid?: readonly string[] | undefined;
  requiredHint?: string | undefined;
  idPrefix: string;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** The control for one generated field (annex §10's column-type → control map). */
function control(field: FormFieldConfig, value: unknown, onChange: (value: unknown) => void): ReactElement {
  switch (field.kind) {
    case 'textarea':
      return (
        <Textarea
          rows={3}
          value={stringValue(value)}
          placeholder={field.placeholder ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'switch':
      return <Switch checked={value === true} onCheckedChange={(checked) => onChange(checked)} />;
    case 'select':
      return (
        <Select value={stringValue(value)} onChange={(event) => onChange(event.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label ?? option.value}
            </option>
          ))}
        </Select>
      );
    case 'date':
      return <DateInput value={stringValue(value)} onChange={(event) => onChange(event.target.value)} />;
    case 'number':
      return (
        <Input
          type="number"
          mono
          value={stringValue(value)}
          placeholder={field.placeholder ?? ''}
          // The RAW string stays in state: coercing per keystroke makes "1." and
          // a lone "-" impossible to type. The host coerces on commit.
          onChange={(event) => onChange(event.target.value)}
        />
      );
    default:
      return (
        <Input
          // email/url get the real input types: mobile keyboards and the
          // browser's own validation both key off them.
          type={field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text'}
          value={stringValue(value)}
          placeholder={field.placeholder ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

export function FormFields({ fields, values, onChange, invalid, requiredHint, idPrefix }: FormFieldsProps) {
  const t = useMaybeT();
  const invalidSet = new Set(invalid ?? []);
  // Shared by `modal-wizard` and `drawer-form` — the bundle carries ONE key for
  // the shared required-field message, under the modal-wizard's namespace.
  const resolvedRequiredHint = requiredHint ?? t('ui:widgets.forms.modalWizard.required', 'This field is required.');

  return (
    <div data-part="form-fields" className="flex flex-col gap-3.5">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const isInvalid = invalidSet.has(field.name);
        return (
          <FormField
            key={field.name}
            controlId={id}
            data-part="form-field"
            data-field={field.name}
            label={field.label ?? field.name}
            required={field.required}
            // `error` and `helper` are the same caption slot — `error` wins and
            // also flips `aria-invalid` on the control.
            {...(isInvalid ? { error: resolvedRequiredHint } : {})}
            {...(!isInvalid && field.helpText !== undefined ? { helper: field.helpText } : {})}
            // The unit annotates the label (annex §10 "number input with unit").
            {...(field.unit === undefined ? {} : { tag: <Tag mono>{field.unit}</Tag> })}
          >
            {control(field, values[field.name], (next) => onChange(field.name, next))}
          </FormField>
        );
      })}
    </div>
  );
}
