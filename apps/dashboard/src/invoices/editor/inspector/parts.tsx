// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector's shared parts (the comp's 729-1033): the 11
 * px uppercase eyebrow the comp repeats ~40 times, the divider, the option
 * pill (`statusList` 1579, `recurOptions` 1726, `apprOptions` 1685,
 * `langOptions` 1641), the 30 px swatch (1577), the dashed *Add …* row
 * (`addSecStyle` 1729), the 38×22 toggle (`trackStyle` / `knob` 1582-1583),
 * the boxed `.nb-fld` input (61-62) as text, textarea and unit-suffixed
 * fields, the file-input label every upload affordance is, the bordered
 * *Remove section* footer every optional panel ends with (879 etc., `hideSec`
 * 1361) and the surface-2 hint card (779, 839, 887, 922).
 *
 * The email inspector's `parts.tsx` is the precedent; these carry no `email:`
 * key. Native inputs styled as the comp's `.nb-fld`, not `@adminium/ui`'s
 * `Input` (its own chrome, and it rejects the classes the comp needs).
 *
 * A11y, invisible at rest: every control has an accessible name, native
 * buttons get the design system's `focus-visible` outline, a file label shows
 * the accent border while its hidden input holds focus.
 */
import { EyeOff, Minus, type LucideIcon } from 'lucide-react';
import { useId, type ChangeEvent, type ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { OptionalFlag, SectionKey } from '../../model/blocks.js';
import type { DocumentEdits } from '../../model/edits.js';

export const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** The comp's eyebrow (753 etc.): `<label>` when it names a control, a `<div>` when it heads a group. */
export function PanelLabel({ children, className, id, htmlFor }: { children: ReactNode; className?: string | undefined; id?: string | undefined; htmlFor?: string | undefined }) {
  const classes = cn('mb-[7px] block text-[11px] font-bold uppercase tracking-[.04em] text-fg-subtle', className);
  if (htmlFor !== undefined) {
    return (
      <label id={id} htmlFor={htmlFor} className={classes}>
        {children}
      </label>
    );
  }
  return (
    <div id={id} className={classes}>
      {children}
    </div>
  );
}

/** The comp's 1 px rule (789, 793). */
export function Divider() {
  return <div className="h-px bg-border" aria-hidden="true" />;
}

/** The tinted "on" state of an option pill: the comp's `statusMeta` (1393) and `apprOptions` (1685) colours. */
export type OptionTone = 'accent' | 'neutral' | 'pos' | 'warn' | 'danger';

const ON_TONE: Readonly<Record<OptionTone, string>> = {
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-surface-3 text-fg-muted',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

/**
 * The comp's option pill (1579, 1685, 1726): `px-3 py-[7px] rounded-lg
 * text-[11.5px] font-bold`; on = tinted background + coloured text with a
 * transparent border (`outlined` keeps the accent border the currency,
 * topic and language pills draw, 1578, 1637, 1642); off = surface-2 + border.
 */
export function OptionButton({
  on,
  label,
  onClick,
  tone = 'accent',
  outlined = false,
  className,
  testId = 'invoices-option',
  value,
  children,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  tone?: OptionTone;
  outlined?: boolean;
  className?: string | undefined;
  testId?: string | undefined;
  value?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testId}
      data-value={value}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center rounded-lg border px-3 py-[7px] text-[11.5px] font-bold transition-colors',
        FOCUS,
        on ? cn(ON_TONE[tone], outlined ? 'border-accent' : 'border-transparent') : 'border-border bg-surface-2 text-fg-muted hover:border-border-strong',
        className,
      )}
    >
      {children ?? label}
    </button>
  );
}

/** The comp's swatch (1577): a 30 px tile, `border-2`, dark ring when on. The hex is data → a custom property. */
export function Swatch({ on, hex, onClick, testId = 'invoices-swatch' }: { on: boolean; hex: string; onClick: () => void; testId?: string | undefined }) {
  return (
    <button
      type="button"
      title={hex}
      aria-label={hex}
      aria-pressed={on}
      data-testid={testId}
      data-value={hex}
      onClick={onClick}
      style={{ '--adm-swatch': hex }}
      className={cn('size-[30px] shrink-0 rounded-[9px] border-2 bg-[var(--adm-swatch)] transition-shadow', FOCUS, on ? 'border-fg shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-border')}
    />
  );
}

/** The comp's dashed *Add …* row (811, 1729): `1.5px dashed border-strong`, transparent, 11.5/700 muted. */
export const DASHED = 'flex items-center justify-center gap-[6px] rounded-[9px] border-[1.5px] border-dashed border-border-strong bg-transparent p-2 text-[11.5px] font-bold text-fg-muted transition-colors hover:border-accent hover:text-fg';

export function DashedButton({ onClick, children, className, testId }: { onClick: () => void; children: ReactNode; className?: string | undefined; testId?: string | undefined }) {
  return (
    <button type="button" data-testid={testId} onClick={onClick} className={cn(DASHED, FOCUS, className)}>
      {children}
    </button>
  );
}

/**
 * A `<label>` wrapping a hidden `accept="image/*"` file input — the comp's
 * every upload affordance (737, 744, 758, 776, 797, 802). The visible copy
 * names the input; `ariaLabel` overrides it for an icon-only slot.
 */
export function FileLabel({
  children,
  className,
  onFile,
  ariaLabel,
  testId,
}: {
  children: ReactNode;
  className: string;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  ariaLabel?: string | undefined;
  testId?: string | undefined;
}) {
  return (
    <label className={cn('cursor-pointer transition-colors focus-within:border-accent', className)}>
      {children}
      <input type="file" accept="image/*" className="sr-only" aria-label={ariaLabel} data-testid={testId} onChange={onFile} />
    </label>
  );
}

/** The comp's toggle (`trackStyle` / `knob`, 1582-1583): a 38×22 pill, accent when on, an 18 px white knob that slides. */
export function Toggle({ on, onClick, labelledBy, testId = 'invoices-toggle' }: { on: boolean; onClick: () => void; labelledBy: string; testId?: string | undefined }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      data-testid={testId}
      onClick={onClick}
      className={cn('flex h-[22px] w-[38px] shrink-0 rounded-[20px] border-0 p-0.5 transition-all duration-150', FOCUS, on ? 'justify-end bg-accent' : 'justify-start bg-surface-3')}
    >
      <span className="block size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.3)]" aria-hidden="true" />
    </button>
  );
}

/** The comp's `.nb-fld` boxed input (753, 61-62): surface-2, 9 px radius, the accent border on focus. */
export const FIELD = 'w-full rounded-[9px] border border-border bg-surface-2 px-[11px] py-[9px] text-[13px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent';

interface FieldBaseProps {
  id?: string | undefined;
  /** The eyebrow above the control; without it `ariaLabel` names the control. */
  label?: string | undefined;
  ariaLabel?: string | undefined;
  labelClassName?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  /** `edits.beginEdit` — one history step per run of keystrokes (comp 1343). */
  onFocus: () => void;
  placeholder?: string | undefined;
  className?: string | undefined;
  testId?: string | undefined;
}

export function TextField({ id, label, ariaLabel, labelClassName, value, onChange, onFocus, placeholder, className, testId }: FieldBaseProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const input = (
    <input
      id={inputId}
      type="text"
      aria-label={label === undefined ? ariaLabel : undefined}
      data-testid={testId}
      value={value}
      placeholder={placeholder}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      className={cn(FIELD, className)}
    />
  );
  if (label === undefined) return input;
  return (
    <div>
      <PanelLabel htmlFor={inputId} className={labelClassName}>
        {label}
      </PanelLabel>
      {input}
    </div>
  );
}

export function TextAreaField({ id, label, ariaLabel, labelClassName, value, onChange, onFocus, placeholder, className, testId, rows }: FieldBaseProps & { rows: number }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const area = (
    <textarea
      id={inputId}
      rows={rows}
      aria-label={label === undefined ? ariaLabel : undefined}
      data-testid={testId}
      value={value}
      placeholder={placeholder}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      className={cn(FIELD, 'resize-y px-[11px] py-[10px] text-[12.5px] leading-[1.6]', className)}
    />
  );
  if (label === undefined) return area;
  return (
    <div>
      <PanelLabel htmlFor={inputId} className={labelClassName}>
        {label}
      </PanelLabel>
      {area}
    </div>
  );
}

/** The comp's boxed input with a trailing unit (845-846, 929-930; `compact` = the tax-component row's 76 px box, 974). */
export function SuffixField({ id, label, ariaLabel, labelClassName, value, onChange, onFocus, suffix, compact = false, className, testId }: FieldBaseProps & { suffix: string; compact?: boolean }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const box = (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[9px] border border-border bg-surface-2 px-3 transition-colors focus-within:border-accent',
        compact && 'w-[76px] shrink-0 gap-1 px-[10px]',
        className,
      )}
    >
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        aria-label={label === undefined ? ariaLabel : undefined}
        data-testid={testId}
        value={value}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        className={cn('min-w-0 flex-1 border-0 bg-transparent py-[9px] font-mono text-[13px] font-bold text-fg outline-none', compact && 'py-2 text-[12.5px]')}
      />
      <span className={cn('text-[13px] font-bold text-fg-subtle', compact && 'text-[12px] font-normal')}>{suffix}</span>
    </div>
  );
  if (label === undefined) return box;
  return (
    <div>
      <PanelLabel htmlFor={inputId} className={labelClassName}>
        {label}
      </PanelLabel>
      {box}
    </div>
  );
}

/** The comp's per-row `minus` button (811 `rmStyle` 1562: 32×34; 903 etc.: 30×34; 946 etc.: 30×32). */
export function RowRemoveButton({ label, onClick, className, iconClassName, testId = 'invoices-row-remove' }: { label: string; onClick: () => void; className?: string | undefined; iconClassName?: string | undefined; testId?: string | undefined }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      className={cn('flex h-[34px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-fg-subtle transition-colors hover:border-border-strong', FOCUS, className)}
    >
      <Minus className={cn('size-[13px]', iconClassName)} aria-hidden="true" />
    </button>
  );
}

/** The comp's *Remove section* footer (879 etc.): flips the flag (`hideSec`, 1361) and falls back to the items panel. */
export function RemoveSectionButton({ flag, edits, onSelect, className }: { flag: OptionalFlag; edits: DocumentEdits; onSelect: (section: SectionKey) => void; className?: string | undefined }) {
  return (
    <button
      type="button"
      data-testid="invoices-remove-section"
      data-flag={flag}
      onClick={() => {
        edits.hideSection(flag);
        onSelect('items');
      }}
      className={cn('flex items-center justify-center gap-[6px] rounded-[9px] border border-border bg-transparent p-[9px] text-[11.5px] font-bold text-fg-muted transition-colors hover:border-border-strong', FOCUS, className)}
    >
      <EyeOff className="size-3.5" aria-hidden="true" />
      {t('invoices:inspector.removeSection', 'Remove section')}
    </button>
  );
}

/** The comp's hint card (779, 839, 887, 922): surface-2, 11 px radius, an icon and 11.5 px muted copy. */
export function Hint({ icon: Icon, children, testId }: { icon: LucideIcon; children: ReactNode; testId?: string | undefined }) {
  return (
    <div data-testid={testId} className="flex items-start gap-[9px] rounded-[11px] bg-surface-2 px-3 py-[11px]">
      <Icon className="mt-px size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
      <span className="text-[11.5px] leading-[1.5] text-fg-muted">{children}</span>
    </div>
  );
}

/** The comp's small note under a control (777, 792, 799, 949, 976, 1030). */
export function Note({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <span className={cn('block text-[10.5px] leading-[1.5] text-fg-subtle', className)}>{children}</span>;
}

/** The comp's range input (768, 797): `accent-color: var(--accent)`, flex-1. */
export function RangeInput({
  value,
  min,
  max,
  ariaLabel,
  onChange,
  onBegin,
  testId,
}: {
  value: number;
  min: number;
  max: number;
  ariaLabel: string;
  onChange: (value: number) => void;
  /** A history step before the drag (comp 1343). */
  onBegin: () => void;
  testId?: string | undefined;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      aria-label={ariaLabel}
      data-testid={testId}
      onFocus={onBegin}
      onPointerDown={onBegin}
      onChange={(event) => onChange(Number(event.target.value))}
      className={cn('min-w-0 flex-1 accent-accent', FOCUS)}
    />
  );
}
