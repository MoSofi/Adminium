// SPDX-License-Identifier: AGPL-3.0-only
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Children, isValidElement, type ComponentPropsWithRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { IconTile, type Tone } from '../icon-tile/index.js';

/**
 * FormDialog — the shell every create and edit form lives in
 * (comp 117–138, 510–521).
 *
 * ─── Why this is not `Modal` ───────────────────────────────────────────────
 *
 * They are different anatomies, and the difference is not decoration:
 *
 *                      Modal            FormDialog
 *   radius             20               **16** (a comp dimension, DP1)
 *   height             85vh             88vh
 *   scrim blur         3px              4px
 *   width              4 named sizes    the dialog's own, 440…820
 *   footer             actions only     a FOOTNOTE on the left, then the actions
 *
 * A form dialog is a working surface — nine of them in the comp, each a
 * different width because the fields inside it are a different shape. `Modal`
 * stays exactly as it is and keeps every confirmation in the product; teaching
 * it a fifth size and a footnote slot would have made one component answer to
 * two comps, which is how both end up slightly wrong.
 *
 * Radix gives the focus trap, the Escape close, the outside-click close and the
 * aria wiring; the comp asks for all four (D30).
 */

/** Optional trigger; renders `asChild`-friendly. */
export const FormDialogTrigger = DialogPrimitive.Trigger;
/** Close wrapper for footer buttons (`asChild` supported). */
export const FormDialogClose = DialogPrimitive.Close;

export interface FormDialogProps extends ComponentPropsWithRef<typeof DialogPrimitive.Root> {
  /**
   * The panel's width in pixels, as the comp draws it per dialog: 440 quick ·
   * 560 multi-entry · 580 segmented-files · 640 sectioned and wizard · 660
   * choice-cards · 680 upload-chips. Capped at 94vw so a narrow viewport keeps
   * its 20px gutter.
   */
  width?: number | undefined;
  className?: string | undefined;
  overlayClassName?: string | undefined;
  children?: ReactNode;
}

export function FormDialog({
  width = 640,
  className,
  overlayClassName,
  children,
  ...rootProps
}: FormDialogProps) {
  // A trigger has to be a direct Root child: the Portal subtree is unmounted
  // while the dialog is closed, so a trigger inside it would never appear.
  const childArray = Children.toArray(children);
  const triggers = childArray.filter((child) => isValidElement(child) && child.type === FormDialogTrigger);
  const content = childArray.filter((child) => !(isValidElement(child) && child.type === FormDialogTrigger));
  return (
    <DialogPrimitive.Root {...rootProps}>
      {triggers}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[4px]',
            'animate-[nb-fade_.14s_cubic-bezier(.2,.7,.3,1)]',
            overlayClassName,
          )}
        />
        <DialogPrimitive.Content
          // The dialog's own width is a NUMBER per dialog (440…820), so it
          // reaches the class through a custom property — the one shape the
          // tokens-only rule allows, and the same one the sortable rows use.
          style={{ '--adm-dialog-width': `min(${String(width)}px, 94vw)` }}
          className={cn(
            'fixed inset-0 z-50 m-auto flex h-fit max-h-[88vh] w-[calc(100%-40px)] flex-col',
            'max-w-[var(--adm-dialog-width)]',
            'overflow-hidden rounded-[16px] border border-border bg-surface shadow-modal outline-none',
            'animate-[nb-modal_.18s_cubic-bezier(.2,.8,.2,1)]',
            className,
          )}
        >
          {content}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface FormDialogHeaderProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Lucide icon for the 36px tile (comp 123–131); one per dialog. */
  icon?: ReactNode;
  tone?: Tone | undefined;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Accessible label for the close button (required — i18n). */
  closeLabel: string;
  hideClose?: boolean | undefined;
}

/**
 * Header: the tile, the words, the close — with the bottom rule the comp draws
 * (121–138). `Modal`'s header has no rule, which is right for a confirmation
 * and wrong for a form: the rule is what separates "what this is" from the
 * fields you are about to fill in.
 */
export function FormDialogHeader({
  icon,
  tone = 'accent',
  title,
  subtitle,
  closeLabel,
  hideClose,
  className,
  children,
  ...props
}: FormDialogHeaderProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-start gap-3 border-b border-border px-[22px] py-[18px]',
        className,
      )}
      {...props}
    >
      {icon === undefined || icon === null ? null : (
        <IconTile tone={tone} size="md" icon={icon} className="[&_svg]:size-[18px]" />
      )}
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="text-modal text-fg">{title}</DialogPrimitive.Title>
        {subtitle === undefined || subtitle === null ? null : (
          // `asChild` over a div for the same reason `Modal` does it: a subtitle
          // is a ReactNode, and a div inside a <p> is invalid HTML.
          <DialogPrimitive.Description asChild>
            <div className="mt-0.5 text-caption text-fg-subtle">{subtitle}</div>
          </DialogPrimitive.Description>
        )}
        {children}
      </div>
      {hideClose ? null : (
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className={cn(
            'nb-ib inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-border',
            'text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

export type FormDialogBodyProps = ComponentPropsWithRef<'div'>;

/** The scrolling body (comp 140): 20 × 22 padding, `nb-scroll`'s scrollbar. */
export function FormDialogBody({ className, ...props }: FormDialogBodyProps) {
  return (
    <div
      className={cn('nb-scroll min-h-0 flex-1 overflow-y-auto px-[22px] py-5 text-body text-fg', className)}
      {...props}
    />
  );
}

export interface FormDialogFooterProps extends ComponentPropsWithRef<'div'> {
  /**
   * The line on the left of the footer band (comp 510–511) — "Required fields
   * marked *", "Saves to Invoices". Generated footnotes are only ever the true
   * ones (DP7); an admin may type any.
   */
  footnote?: ReactNode;
}

/**
 * Footer: a `surface-2` band with a top rule, the footnote on the left and the
 * actions on the right (510–521). The footnote is the reason this is its own
 * component rather than `ModalFooter` with a class.
 */
export function FormDialogFooter({ footnote, className, children, ...props }: FormDialogFooterProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-[22px] py-3.5',
        className,
      )}
      {...props}
    >
      {footnote === undefined || footnote === null || footnote === false ? null : (
        <p className="min-w-0 text-[11.5px] leading-4 text-fg-subtle">{footnote}</p>
      )}
      {/* `ms-auto` rather than `justify-end`: the footnote keeps its place at
          the start of the band, and the actions sit at the end — which is the
          correct side in RTL without a second rule. */}
      <div className="ms-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
