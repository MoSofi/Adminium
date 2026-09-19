// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sheet's shared pieces (comp CSS 51-53; C2, C5): the borderless inline
 * input and textarea (`.nb-in`), the light palette's literals, and the
 * image-file reader every upload label shares.
 *
 * THE SHEET IS ALWAYS LIGHT (D10): the paper has one palette whatever the
 * theme, so the greys here are light literals like the invoice `PaperShell`'s
 * and the accent is the DOCUMENT's, riding `--adm-report-accent` (and its
 * 10 % soft) from `PaperShell` — never the theme's `--accent`.
 *
 * MUTED IS `#6b6b76`, NOT THE COMP'S `#9a9aa5` (34 DEP-16, kept): on white
 * the comp's grey is 2.78:1 and fails WCAG AA; `#6b6b76` is 5.3:1 and the
 * comp's own `--fg-muted` fallback. The positive green is `#0a6b4c`, one step
 * darker than `--pos`, for the same reason on the accent wash (34 DEP-30).
 *
 * A11Y additions invisible at rest: every inline field carries an
 * `aria-label`, and every upload `<input type=file>` is wrapped by its label.
 *
 * READ-ONLY IS A CONTEXT, not a prop threaded through the blocks. The sheet
 * is drawn by the same components in a preview as in the editor, and the
 * difference is only ever "can this be operated" — so the two field
 * primitives answer that themselves and a block with an affordance of its
 * own wraps it in {@link EditOnly}. A rule a block author has to remember at
 * a call site survives until the next block; a field that asks does not need
 * remembering.
 */
import { createContext, use, type ChangeEvent, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { fileFromInput, readImageFile, type ImageReadResult } from '../images.js';

export type ImageRejection = Extract<ImageReadResult, { ok: false }>;

/**
 * Is this sheet a preview? Default `false`, so the editor needs no provider
 * and an unwrapped block behaves as it always has.
 */
const ReadOnlyContext = createContext(false);

/** Wraps the sheet in read-only mode; `ReportCanvas readOnly` is its one caller. */
export function ReadOnlySheet({ children }: { children: ReactNode }) {
  return <ReadOnlyContext value={true}>{children}</ReadOnlyContext>;
}

/** True when this sheet is drawn as a preview and nothing on it may be operated. */
export function useSheetReadOnly(): boolean {
  return use(ReadOnlyContext);
}

/**
 * An affordance that exists only while the sheet can be edited: the grip, the
 * head-row actions, a select button. In a preview it renders nothing rather
 * than a disabled control, because a preview is not a form somebody is
 * locked out of.
 */
export function EditOnly({ children }: { children: ReactNode }) {
  return useSheetReadOnly() ? null : children;
}

/** The sheet's three greys, as the comp paints them minus DEP-16's lift. */
export const SHEET_FG = 'text-[#191920]';
export const SHEET_MUTED = 'text-[#6b6b76]';
/** The comp's `--fg-subtle` on the sheet, lifted to the same WCAG-passing grey (34 DEP-16). */
export const SHEET_SUBTLE = 'text-[#6b6b76]';
export const SHEET_BORDER = 'border-[#ececef]';
export const SHEET_BORDER_STRONG = 'border-[#e2e2e8]';
export const SHEET_SURFACE_2 = 'bg-[#fafafa]';
export const SHEET_SURFACE_3 = 'bg-[#f1f1f4]';

/**
 * The sheet's positive green, one step darker than the theme's `--pos`
 * (`#12805c`) — 34 DEP-30: on the document's 10 % accent wash `--pos`
 * measures 4.42:1 and fails WCAG AA, while this reads 5.3:1 on the lightest
 * wash and 5.2:1 on the darkest (the black accent's). Same hue, 14 % darker.
 */
export const POS_TEXT = 'text-[#0a6b4c]';

/**
 * The warn and danger inks, one step darker than the comp's `--warn`
 * (`#b25e09`) and `--danger` (`#d1293d`) — the same departure the green above
 * is, measured the same way (sweep found both):
 *
 *   `#b25e09` on the warn wash `#fbf0e2` is 4.14:1 and FAILS WCAG AA — it is
 *   the late-fee callout's title (328) and the *Pending* approval pill (326).
 *   `#9c5208` is 5.15:1 on the wash and 5.8:1 on the sheet.
 *
 *   `#d1293d` on the danger wash `#fdecec` is 4.49:1 — under the bar by a
 *   hundredth, which axe's own rounding lets through. `#c02133` is 5.24:1
 *   there and 6.0:1 on the sheet; it carries the *Rejected* pill (326), the
 *   *Failed* payment badge (334) and a negative KPI delta (622).
 *
 * Same hues, one step down. The soft washes are the comp's, unchanged.
 */
export const DANGER_TEXT = 'text-[#c02133]';
export const WARN_TEXT = 'text-[#9c5208]';
export const WARN_SOFT_BG = 'bg-[#fbf0e2]';
export const POS_SOFT_BG = 'bg-[#e6f5ee]';
export const DANGER_SOFT_BG = 'bg-[#fdecec]';

/** The document's accent and its 10 % soft, as the classes read them. */
export const ACCENT_TEXT = 'text-[var(--adm-report-accent)]';
export const ACCENT_BG = 'bg-[var(--adm-report-accent)]';
export const ACCENT_SOFT_BG = 'bg-[var(--adm-report-accent-soft)]';

/** `.nb-in` (comp 51-52): transparent, borderless, inherits the font; focus → the soft accent wash and a 3 px ring. */
const INLINE =
  'w-full min-w-0 rounded-md border-0 bg-transparent p-0 text-[#191920] outline-none placeholder:text-[#6b6b76] focus:bg-[var(--adm-report-accent-soft)] focus:shadow-[0_0_0_3px_var(--adm-report-accent-soft)]';

export interface InlineInputProps extends Omit<ComponentPropsWithoutRef<'input'>, 'onChange' | 'onFocus' | 'value' | 'style' | 'aria-label'> {
  /** The accessible name — every field on the sheet has one. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The comp's `beginEdit` on focus (523). */
  onFocus: () => void;
  mono?: boolean | undefined;
}

export function InlineInput({ label, value, onChange, onFocus, mono = false, className, ...rest }: InlineInputProps) {
  // A borderless input reads as text already; what it must not be in a
  // preview is a focus stop that invites typing into a document nobody can
  // save. `min-h` keeps an empty field's line box so the sheet does not
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
      onClick={(event) => event.stopPropagation()}
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
  /** The comp's `resize:none` on the heading block (315); everything else resizes vertically. */
  fixed?: boolean | undefined;
}

export function InlineTextarea({ label, value, onChange, onFocus, className, rows = 3, fixed = false, ...rest }: InlineTextareaProps) {
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
      onClick={(event) => event.stopPropagation()}
      className={cn(INLINE, fixed ? 'resize-none' : 'resize-y', className)}
      {...rest}
    />
  );
}

/** The comp's `readBg` (534) with the cap: the data URL to `onImage`, a refusal to `onRejected`. */
export async function pickImage(event: ChangeEvent<HTMLInputElement>, onImage: (dataUrl: string) => void, onRejected: (result: ImageRejection) => void): Promise<void> {
  const file = fileFromInput(event);
  if (file === null) return;
  const result = await readImageFile(file);
  if (result.ok) onImage(result.dataUrl);
  else onRejected(result);
}
