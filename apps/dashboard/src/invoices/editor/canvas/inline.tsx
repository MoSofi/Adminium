// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sheet's shared pieces (comp CSS 47-53): the selectable region
 * (`.nb-sec`), the borderless inline input and textarea (`.nb-in`), the
 * kicker, the status pill, and the image-file reader every upload label
 * shares.
 *
 * THE SHEET IS ALWAYS LIGHT (S6): the paper has one palette whatever the
 * theme, so the greys here are light literals like the email `MailShell`'s
 * and the accent is the DOCUMENT's, riding `--adm-invoice-accent` (and its
 * 10 % soft) from `PaperShell` — never the theme's `--accent`.
 *
 * MUTED IS `#6b6b76`, NOT THE COMP'S `#9a9aa5` (39's departure, kept): on
 * white the comp's grey is 2.78:1 and fails WCAG AA; `#6b6b76` is 5.3:1 and
 * the comp's own `--fg-muted` fallback.
 *
 * A11Y additions invisible at rest: every region carries a visually-hidden
 * *Edit {label}* button so a keyboard selects what a click does; every
 * inline field carries an `aria-label`; every upload `<input type=file>` is
 * wrapped by its label.
 *
 * READ-ONLY IS A CONTEXT, not a prop threaded through thirty blocks. The
 * sheet is drawn by the same components in a preview as in the editor, and
 * the difference between the two is only ever "can this be operated" — so
 * the three primitives every block is built from answer that question
 * themselves, and a block that renders an affordance of its own wraps it in
 * {@link EditOnly}. Nothing a block author has to remember at a call site is
 * a rule that survives; a field that asks the context is.
 */
import { createContext, use, type ChangeEvent, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { InvoiceStatus } from '../../model/envelope.js';
import { customIdOf, type FixedSectionKey, type SectionKey } from '../../model/blocks.js';
import { fileFromInput, readImageFile, type ImageReadResult } from '../images.js';
import { fixedSectionHeader } from '../sectionText.js';

export type ImageRejection = Extract<ImageReadResult, { ok: false }>;

/**
 * Is this sheet a preview? Default `false`, so the editor needs no provider
 * and an unwrapped block behaves as it always has.
 */
const ReadOnlyContext = createContext(false);

/** Wraps the sheet in read-only mode; `InvoiceCanvas readOnly` is its one caller. */
export function ReadOnlySheet({ children }: { children: ReactNode }) {
  return <ReadOnlyContext value={true}>{children}</ReadOnlyContext>;
}

/** True when this sheet is drawn as a preview and nothing on it may be operated. */
export function useSheetReadOnly(): boolean {
  return use(ReadOnlyContext);
}

/**
 * An affordance that exists only while the sheet can be edited: a remove
 * button, an upload drop, an add-a-row control. In a preview it renders
 * nothing at all rather than a disabled control, because a preview is not a
 * form somebody is locked out of.
 *
 * `placeholder` is for an affordance that occupies a GRID CELL — the line
 * items' grip and remove columns, a key/value row's remove column. Dropping
 * the element there would shift every cell after it into the wrong column,
 * so those pass an empty span and the layout holds.
 */
export function EditOnly({ children, placeholder = null }: { children: ReactNode; placeholder?: ReactNode }) {
  return useSheetReadOnly() ? placeholder : children;
}

/** The empty cell an `EditOnly` grid column leaves behind. */
export const CELL = <span aria-hidden="true" />;

/** The comp's kicker (10.5 px / 700, uppercase, .05em), in the WCAG-passing muted. */
export const KICKER = 'text-[10.5px] font-bold uppercase tracking-[.05em] text-[#6b6b76]';

/**
 * The sheet's positive green, one step darker than the theme's `--pos`
 * (`#0b7d59`) — the same departure the muted grey above is (39's), for the
 * same reason: on the document's 10 % accent wash `--pos` measures 4.42:1
 * and fails WCAG AA, while this reads 5.3:1 on the lightest wash and 5.2:1
 * on the darkest (the black accent's). Same hue, 14 % darker.
 */
export const POS_TEXT = 'text-[#0a6b4c]';

/** The document's accent and its 10 % soft, as the classes read them. */
export const ACCENT_TEXT = 'text-[var(--adm-invoice-accent)]';
export const ACCENT_BG = 'bg-[var(--adm-invoice-accent)]';
export const ACCENT_SOFT_BG = 'bg-[var(--adm-invoice-accent-soft)]';

/** `.nb-in` (comp 52-53): transparent, borderless, inherits the font; focus → the soft accent wash and a 3 px ring. */
const INLINE =
  'w-full min-w-0 rounded-md border-0 bg-transparent p-0 text-[#191920] outline-none placeholder:text-[#6b6b76] focus:bg-[var(--adm-invoice-accent-soft)] focus:shadow-[0_0_0_3px_var(--adm-invoice-accent-soft)]';

export interface InlineInputProps extends Omit<ComponentPropsWithoutRef<'input'>, 'onChange' | 'onFocus' | 'value' | 'style' | 'aria-label'> {
  /** The accessible name — every field on the sheet has one. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The comp's `beginEdit` on focus (1343). */
  onFocus: () => void;
  mono?: boolean | undefined;
}

export function InlineInput({ label, value, onChange, onFocus, mono = false, className, ...rest }: InlineInputProps) {
  // A borderless input reads as text already; what it must not be in a
  // preview is a focus stop that invites typing into a document nobody can
  // save. `min-h` keeps an empty field's line box, so the sheet does not
  // reflow between the editor and the preview.
  if (useSheetReadOnly()) {
    return (
      <span aria-label={label} className={cn('block min-h-[1em] w-full min-w-0 truncate text-[#191920]', mono && 'font-mono', className)}>
        {value}
      </span>
    );
  }
  return (
    <input
      aria-label={label}
      value={value}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      className={cn(INLINE, mono && 'font-mono', className)}
      {...rest}
    />
  );
}

export interface InlineTextareaProps extends Omit<ComponentPropsWithoutRef<'textarea'>, 'onChange' | 'onFocus' | 'value' | 'style' | 'aria-label'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
}

export function InlineTextarea({ label, value, onChange, onFocus, className, rows = 3, ...rest }: InlineTextareaProps) {
  if (useSheetReadOnly()) {
    return (
      <span aria-label={label} className={cn('block min-h-[1em] w-full min-w-0 whitespace-pre-wrap text-[#191920]', className)}>
        {value}
      </span>
    );
  }
  return (
    <textarea
      aria-label={label}
      value={value}
      rows={rows}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      className={cn(INLINE, 'resize-y', className)}
      {...rest}
    />
  );
}

/** The hidden-until-focused selector every region carries. */
export function SelectButton({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className="sr-only start-0 top-0 z-[2] focus:not-sr-only focus:absolute focus:rounded-md focus:bg-white focus:px-2 focus:py-0.5 focus:text-[10.5px] focus:font-bold focus:text-[var(--adm-invoice-accent)] focus:shadow-[0_0_0_2px_var(--adm-invoice-accent)] focus:outline-none"
    >
      {t('invoices:canvas.select', 'Edit {label}', { label })}
    </button>
  );
}

export interface RegionProps {
  section: SectionKey;
  selected: SectionKey;
  onSelect: (section: SectionKey) => void;
  /** A custom section's own title; a fixed section's label comes from `sectionText`. */
  label?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * `.nb-sec` (comp 47-48; `secStyle` 1488): a 1.5 px outline offset 4 px —
 * transparent at rest, 50 % accent on hover, solid accent when selected.
 */
export function Region({ section, selected, onSelect, label, className, children }: RegionProps) {
  const name = label ?? (customIdOf(section) === null ? fixedSectionHeader(section as FixedSectionKey).title : t('invoices:section.custom.title', 'Custom section'));
  const readOnly = useSheetReadOnly();
  const isSelected = !readOnly && selected === section;
  // The ring is the affordance for an inspector that is not on screen, and
  // the selector button opens the same one. The group keeps its NAME: a
  // preview still has a *Customer* region for anybody reading it aloud.
  if (readOnly) {
    return (
      <div role="group" aria-label={name} data-testid="invoices-section" data-section={section} className={cn('relative rounded-[9px]', className)}>
        {children}
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-label={name}
      data-testid="invoices-section"
      data-section={section}
      data-selected={isSelected ? '' : undefined}
      onClick={() => onSelect(section)}
      className={cn(
        'relative cursor-pointer rounded-[9px] outline outline-[1.5px] outline-offset-4 outline-transparent transition-[outline-color] duration-150',
        'hover:outline-[color:color-mix(in_srgb,var(--adm-invoice-accent)_50%,transparent)]',
        isSelected && 'outline-[color:var(--adm-invoice-accent)] hover:outline-[color:var(--adm-invoice-accent)]',
        className,
      )}
    >
      <SelectButton label={name} onSelect={() => onSelect(section)} />
      {children}
    </div>
  );
}

/** The comp's `statusMeta` (1393) as light classes; `sent` wears the document's accent. */
export const STATUS_TONE: Readonly<Record<InvoiceStatus, string>> = {
  draft: 'bg-[#f1f1f4] text-[#6b6b76]',
  live: 'bg-pos-soft text-pos',
  sent: 'bg-[var(--adm-invoice-accent-soft)] text-[var(--adm-invoice-accent)]',
  paid: 'bg-pos-soft text-pos',
  overdue: 'bg-danger-soft text-danger',
};

export function statusText(status: InvoiceStatus): string {
  switch (status) {
    case 'draft':
      return t('invoices:status.draft', 'Draft');
    case 'live':
      return t('invoices:status.live', 'Live');
    case 'sent':
      return t('invoices:status.sent', 'Sent');
    case 'paid':
      return t('invoices:status.paid', 'Paid');
    case 'overdue':
      return t('invoices:status.overdue', 'Overdue');
  }
}

/** The comp's `readImg` (1324-1328) with the cap: the data URL to `onImage`, a refusal to `onRejected`. */
export async function pickImage(event: ChangeEvent<HTMLInputElement>, onImage: (dataUrl: string) => void, onRejected: (result: ImageRejection) => void): Promise<void> {
  const file = fileFromInput(event);
  if (file === null) return;
  const result = await readImageFile(file);
  if (result.ok) onImage(result.dataUrl);
  else onRejected(result);
}

/** The comp's dashed upload drop (1521, 1527): a hatched, dashed label wrapping its hidden file input. */
export const DROP_LABEL =
  'flex cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-dashed border-[#e2e2e8] bg-[repeating-linear-gradient(135deg,#fafafa_0_9px,#f1f1f4_9px_18px)] text-[#6b6b76] focus-within:shadow-[0_0_0_3px_var(--adm-invoice-accent-soft)]';

/** A "one line of an address block" name — *From line 2*, *Customer line 1* — so every repeated input is distinct to a reader. */
export function lineLabel(kind: 'from' | 'customer' | 'ship' | 'payment', index: number): string {
  const n = index + 1;
  switch (kind) {
    case 'from':
      return t('invoices:canvas.lines.from', 'From line {n}', { n });
    case 'customer':
      return t('invoices:canvas.lines.customer', 'Customer line {n}', { n });
    case 'ship':
      return t('invoices:canvas.lines.ship', 'Shipping line {n}', { n });
    case 'payment':
      return t('invoices:canvas.lines.payment', 'Payment line {n}', { n });
  }
}
