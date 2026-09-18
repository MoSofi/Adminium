// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The number family (Appendix C, comp 243–244, 249, 348–354, 433–437).
 *
 * Every numeric control is MONO (comp 210, 245, 249, 300–301, 441): a column of
 * numbers that do not line up is a column nobody can scan, and the design
 * system's mono face is tabular.
 */
import { DateInput, Input, InputGroup, NumberStepper, Slider } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { dateOnlyValue } from '../../../families/tables/column-spec.js';
import type { ControlProps } from './types.js';

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shared(props: ControlProps) {
  return {
    ...(props.id === undefined ? {} : { id: props.id }),
    ...(props['aria-label'] === undefined ? {} : { 'aria-label': props['aria-label'] }),
    ...(props['aria-describedby'] === undefined ? {} : { 'aria-describedby': props['aria-describedby'] }),
    ...(props['aria-invalid'] === undefined ? {} : { 'aria-invalid': props['aria-invalid'] }),
    ...(props['aria-required'] === undefined ? {} : { 'aria-required': props['aria-required'] }),
    ...(props.error === true ? { error: true as const } : {}),
    ...(props.disabled === true ? { disabled: true as const } : {}),
  };
}

/** Bounds: the field's own, else nothing. A control invents no limits. */
function bounds(props: ControlProps) {
  return {
    ...(props.field?.min === undefined ? {} : { min: props.field.min }),
    ...(props.field?.max === undefined ? {} : { max: props.field.max }),
    ...(props.field?.step === undefined ? {} : { step: props.field.step }),
  };
}

export function NumberControl(props: ControlProps) {
  return (
    <Input
      {...shared(props)}
      {...bounds(props)}
      type="number"
      mono
      // Without this, a number input defaults to step=1 and any fractional
      // value is step-invalid — native validation then silently blocks submit.
      {...(props.field?.step === undefined ? { step: 'any' } : {})}
      value={asText(props.value)}
      {...(props.field?.placeholder === undefined ? {} : { placeholder: props.field.placeholder })}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

/**
 * Money: the same number with the currency in the chrome (comp 243–244).
 *
 * The symbol is a PREFIX, never part of the value — the column holds a number,
 * and a string with a symbol in it is a number nothing can sum.
 */
export function CurrencyControl(props: ControlProps) {
  const symbol = props.field?.prefix ?? currencySymbol(props.currency);
  return (
    <InputGroup
      {...shared(props)}
      {...bounds(props)}
      type="number"
      mono
      prefix={symbol}
      {...(props.field?.step === undefined ? { step: 'any' } : {})}
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

/**
 * The currency's symbol, from `Intl` rather than a table of our own.
 *
 * `formatToParts` asks the runtime what this currency looks like in this
 * locale, which is the only source that stays right as currencies are added.
 * An unknown code falls back to the code itself — "XYZ 12" is honest, where a
 * hard-coded "$" would be a lie.
 */
function currencySymbol(currency: string | undefined): string {
  if (currency === undefined || currency === '') return '';
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** −/＋ with a unit beside them (comp 348–354). Whole numbers only. */
export function StepperControl(props: ControlProps) {
  const t = useMaybeT();
  return (
    <NumberStepper
      {...shared(props)}
      {...bounds(props)}
      layout="buttons"
      {...(props.field?.unit === undefined ? {} : { unit: props.field.unit })}
      value={asNumber(props.value)}
      onValueChange={(next) => props.onChange(next)}
      incrementLabel={t('ui:formDialog.control.more', 'One more')}
      decrementLabel={t('ui:formDialog.control.fewer', 'One fewer')}
    />
  );
}

/**
 * A slider with its value read out beside it (comp 433–437).
 *
 * Offered only where BOTH bounds are known (Appendix C): a slider with no scale
 * is a control that cannot say what dragging it means.
 */
export function SliderControl(props: ControlProps) {
  const min = props.field?.min ?? 0;
  const max = props.field?.max ?? 100;
  const current = asNumber(props.value) ?? min;
  return (
    <div className="flex items-center gap-3">
      <Slider
        {...(props.id === undefined ? {} : { id: props.id })}
        className="flex-1"
        min={min}
        max={max}
        {...(props.field?.step === undefined ? {} : { step: props.field.step })}
        value={[current]}
        thumbLabels={[props.field?.label ?? props.column.label]}
        {...(props.disabled === true ? { disabled: true } : {})}
        onValueChange={(next) => props.onChange(next[0] ?? min)}
      />
      <span className="min-w-[3ch] font-mono text-body-sm font-bold tabular-nums text-fg">
        {current}
        {props.field?.unit === undefined ? null : (
          <span className="ms-1 font-sans text-caption font-normal text-fg-subtle">
            {props.field.unit}
          </span>
        )}
      </span>
    </div>
  );
}

/** date · time · datetime — the native picker in the shared chrome (comp 192). */
export function DateControl(props: ControlProps) {
  return (
    /*
     * `dateOnlyValue`, never a `slice(0, 10)`: postgres serializes a DATE as
     * the host's local midnight, so on a UTC+2 server "2026-05-29" arrives as
     * `2026-05-28T22:00:00Z` and slicing it shows the day before. The audited
     * recovery lives in the tables family because the cell renderer needs the
     * same one — this is the client-portal audit's own repro.
     */
    <DateInput
      {...shared(props)}
      value={dateOnlyValue(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

export function TimeControl(props: ControlProps) {
  return (
    <DateInput
      {...shared(props)}
      type="time"
      value={asText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

export function DateTimeControl(props: ControlProps) {
  return (
    <DateInput
      {...shared(props)}
      type="datetime-local"
      value={datetimeLocalValue(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

/** `YYYY-MM-DDTHH:mm` — what a `datetime-local` input accepts. */
function datetimeLocalValue(value: unknown): string {
  const raw = asText(value);
  if (raw === '') return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
