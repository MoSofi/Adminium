// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The data kit's form parts that are new: a field for a decimal quantity or
 * a price, a single on/off chip, and the labelled field under the kit's name.
 */
import { useId, type ReactElement, type ReactNode } from 'react';
import { FormField, Input as UiInput, cn } from '@adminium/ui';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** The one control the field labels. */
  children: ReactElement;
}

/** A label, the control, and a hint or an error under it: the dashboard's own field. */
export function Field({ label, hint, error, required, children }: FieldProps): ReactNode {
  return (
    <FormField label={label} helper={hint} error={error} {...(required === undefined ? {} : { required })}>
      {children}
    </FormField>
  );
}

/**
 * What a decimal field keeps of what was typed, or null to refuse the
 * keystroke. TEXT in and text out: a quantity or a price is never a JS
 * number on its way through a form (`0.1 + 0.2`).
 *
 * A comma is read as the point (a numeric keypad's, a locale's). `whole`
 * takes no point at all; `decimals` is how many digits may follow one.
 */
export function decimalText(typed: string, options: { decimals?: number; whole?: boolean; negative?: boolean } = {}): string | null {
  const decimals = options.whole === true ? 0 : Math.min(4, Math.max(0, options.decimals ?? 0));
  const text = typed.replace(/\s+/g, '').replace(',', '.');
  if (text === '') return '';
  const pattern = new RegExp(`^${options.negative === true ? '-?' : ''}\\d*${decimals === 0 ? '' : `(?:\\.\\d{0,${String(decimals)}})?`}$`);
  return pattern.test(text) ? text : null;
}

/** The text as it is kept once the field is left: no bare point, no bare sign, a leading zero before a point. */
export function settledDecimal(text: string): string {
  if (text === '' || text === '-' || text === '.' || text === '-.') return '';
  let out = text.endsWith('.') ? text.slice(0, -1) : text;
  if (out.startsWith('.')) out = `0${out}`;
  if (out.startsWith('-.')) out = `-0${out.slice(1)}`;
  return out;
}

export interface NumberInputProps {
  /** The figure as text, exactly as the row holds it. */
  value: string;
  onChange: (value: string) => void;
  /** Digits after the point, 0 to 4. A quantity has up to three; a unit cost four. */
  decimals?: number;
  /** Whole numbers only (a count of packs): a point is refused as it is typed. */
  whole?: boolean;
  /** Take a minus sign (a correction). Off: only what is zero or more can be typed. */
  negative?: boolean;
  /** The unit after the figure (`kg`, `each`). */
  unit?: ReactNode;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
  onBlur?: () => void;
}

/** A decimal figure, end-aligned in the mono face, with its unit beside it. */
export function NumberInput({ value, onChange, decimals, whole, negative, unit, label, hint, error, required, disabled, placeholder, id, onBlur, ...aria }: NumberInputProps): ReactNode {
  const generated = useId();
  const controlId = id ?? generated;
  const invalid = error !== undefined && error !== null && error !== false;
  const options = { ...(decimals === undefined ? {} : { decimals }), ...(whole === undefined ? {} : { whole }), ...(negative === undefined ? {} : { negative }) };
  const control = (
    <UiInput
      id={controlId}
      type="text"
      inputMode={whole === true || (decimals ?? 0) === 0 ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      error={invalid}
      className={cn('text-end font-mono tabular-nums', unit === undefined ? null : 'min-w-0 flex-1')}
      onChange={(event) => {
        const next = decimalText(event.target.value, options);
        // A keystroke that would make it no figure is not taken: the field keeps what it held.
        if (next !== null && next !== value) onChange(next);
      }}
      onBlur={() => {
        const settled = settledDecimal(value);
        if (settled !== value) onChange(settled);
        onBlur?.();
      }}
      {...aria}
    />
  );
  const withUnit =
    unit === undefined ? (
      control
    ) : (
      <span className="flex min-w-0 items-center gap-2">
        {control}
        <span className="shrink-0 text-body-sm text-fg-muted">{unit}</span>
      </span>
    );
  if (label === undefined) return withUnit;
  return (
    <FormField label={label} helper={hint} error={error} controlId={controlId} {...(required === undefined ? {} : { required })}>
      {unit === undefined ? control : <span className="flex min-w-0 items-center gap-2">{control}<span className="shrink-0 text-body-sm text-fg-muted">{unit}</span></span>}
    </FormField>
  );
}

export interface ToggleChipProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  'aria-label'?: string;
}

/** One on/off chip (a weekday, a tag): a button that says whether it is pressed. */
export function ToggleChip({ pressed, onPressedChange, disabled, children, ...aria }: ToggleChipProps): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-selected={pressed ? '' : undefined}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      className={
        'inline-flex h-7 select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-border-strong bg-surface px-3 text-[12px] font-semibold text-fg-muted ' +
        'transition-colors duration-150 hover:text-fg ' +
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
        'disabled:pointer-events-none disabled:opacity-40 ' +
        'data-[selected]:border-accent data-[selected]:bg-accent-soft data-[selected]:text-accent [&_svg]:size-3.5 [&_svg]:shrink-0'
      }
      {...aria}
    >
      {children}
    </button>
  );
}
