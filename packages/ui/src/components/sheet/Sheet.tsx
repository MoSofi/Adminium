// SPDX-License-Identifier: AGPL-3.0-only
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useSyncExternalStore, type ComponentPropsWithRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/*
 * ── THE STACK ─────────────────────────────────────────────────────────────
 * Sheets stack: the endpoint builder opens OVER the create-key sheet (z-index
 * 60 under 70). Radix keeps Escape and focus on the top layer, but the
 * sheet underneath keeps its focusable controls, and axe's
 * `aria-hidden-focus` fires on exactly that shape unless the lower layer is
 * inerted. So every open sheet registers here, and every sheet that is not
 * the top one renders `inert`: out of the tab order and the accessibility
 * tree until the one above it closes. A module store rather than React
 * context, because the two sheets need not be nested in the React tree.
 */
const stack: string[] = [];
const listeners = new Set<() => void>();
const emit = (): void => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const topOf = (): string | null => stack.at(-1) ?? null;

function useSheetLayer(open: boolean): boolean {
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    stack.push(id);
    emit();
    return () => {
      const at = stack.lastIndexOf(id);
      if (at !== -1) stack.splice(at, 1);
      emit();
    };
  }, [open, id]);
  const top = useSyncExternalStore(subscribe, topOf, () => null);
  return open && top !== null && top !== id;
}

export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetProps extends Omit<ComponentPropsWithRef<typeof DialogPrimitive.Root>, 'open'> {
  open: boolean;
  /** The panel's max width in px; the comp's is 1180. */
  maxWidth?: number | undefined;
  /** Extra classes for the panel. */
  className?: string | undefined;
  /** Hand-wired description id, when the header's subtitle is not the description. */
  'aria-describedby'?: string | undefined;
  children?: ReactNode;
}

/**
 * Sheet — a full-height dialog panel, as the API Keys comp draws its create
 * and builder sheets: a `--scrim` veil with a 3 px blur and 22 px
 * of padding, holding a panel that grows to `maxWidth` and the full height,
 * `--bg`, 1 px border, 18 px radius, the modal shadow, clipped.
 *
 * Compose `SheetHeader` / `SheetBar` / `SheetBody` / `SheetFooter`. Line-height
 * is reset to `normal` on the panel: it is portalled out of the page, so the
 * page root's reset does not reach it.
 */
export function Sheet({ open, maxWidth = 1180, className, children, 'aria-describedby': describedBy, ...rootProps }: SheetProps) {
  const covered = useSheetLayer(open);
  /*
   * FOCUS RETURNS TO THE OPENER. Radix returns it only to a `Dialog.Trigger`,
   * and these sheets are opened by ordinary buttons (a toolbar's "New
   * endpoint", a row's edit icon), so the element focused when the sheet
   * opened is remembered and focused again when it closes.
   */
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && typeof document !== 'undefined') {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
  }, [open]);
  return (
    <DialogPrimitive.Root open={open} {...rootProps}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[60] bg-[var(--scrim)] backdrop-blur-[3px]',
            'animate-[nb-veil_.18s_ease]',
          )}
        />
        {/* The veil's padding is a positioned frame, not the overlay's own: Radix renders the
            content as the overlay's SIBLING, so the frame is what centres and pads it. */}
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-stretch justify-center p-[22px]">
          <DialogPrimitive.Content
            {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
            {...(covered ? { inert: true } : {})}
            data-covered={covered ? '' : undefined}
            onCloseAutoFocus={(event) => {
              const target = opener.current;
              if (target !== null && target.isConnected) {
                event.preventDefault();
                target.focus();
              }
            }}
            // A custom property is the one inline style the kit allows; the
            // width is a prop, so it cannot be a class.
            style={{ '--adm-sheet-max': `${String(maxWidth)}px` }}
            className={cn(
              'pointer-events-auto flex min-h-0 max-w-[var(--adm-sheet-max)] flex-1 flex-col overflow-hidden',
              'rounded-[18px] border border-border bg-bg text-fg shadow-modal outline-none',
              'leading-[normal]',
              'animate-[nb-sheet_.26s_cubic-bezier(.2,.7,.3,1)]',
              className,
            )}
          >
            {children}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface SheetHeaderProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** The glyph in the 34 px accent tile. */
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Controls between the title and the close button (the layout tray). */
  actions?: ReactNode;
  /** Accessible name of the close button (i18n). */
  closeLabel: string;
}

/**
 * Header: gap 14, padding 16/20, `--surface`, a hairline below;
 * the 34 px `accent-soft` tile (r10, glyph 17), title 16 / 800 / −.02em,
 * subtitle 12 `fg-muted` 1 px below; actions and close at the end, gap 10.
 */
export function SheetHeader({ icon, title, subtitle, actions, closeLabel, className, ...props }: SheetHeaderProps) {
  return (
    <div
      className={cn('flex shrink-0 items-center gap-3.5 border-b border-border bg-surface px-5 py-4', className)}
      {...props}
    >
      <div
        aria-hidden="true"
        className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent [&_svg]:size-[17px]"
      >
        {icon}
      </div>
      <div className="min-w-0">
        <DialogPrimitive.Title className="text-[16px] font-extrabold leading-[normal] tracking-[-.02em] text-fg">
          {title}
        </DialogPrimitive.Title>
        {subtitle === undefined || subtitle === null ? (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description asChild>
            <div className="mt-px text-[12px] leading-[normal] text-fg-muted">{subtitle}</div>
          </DialogPrimitive.Description>
        )}
      </div>
      <div className="ms-auto flex items-center gap-2.5">
        {actions}
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className={cn(
            'nb-ib flex size-[34px] items-center justify-center rounded-[9px] border border-border bg-surface text-fg-muted hover:text-fg',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <X aria-hidden="true" className="size-4" />
        </DialogPrimitive.Close>
      </div>
    </div>
  );
}

export interface SheetBarProps extends ComponentPropsWithRef<'div'> {
  /**
   * `fields`: bottom-aligned, gap 14, padding 16/20, `--surface`.
   * `tools`: centred, gap 9, padding 12/20, `--surface-2`, wraps.
   */
  variant?: 'fields' | 'tools';
}

/** A full-width band under the header, with a hairline below. */
export function SheetBar({ variant = 'tools', className, ...props }: SheetBarProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 border-b border-border px-5',
        variant === 'fields' ? 'items-end gap-3.5 bg-surface py-4' : 'flex-wrap items-center gap-[9px] bg-surface-2 py-3',
        className,
      )}
      {...props}
    />
  );
}

/** The sheet's working area: fills what is left, and scrolls in its own panes. */
export function SheetBody({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div className={cn('flex min-h-0 flex-1 overflow-hidden', className)} {...props} />;
}

/** Footer: gap 12, padding 14/20, `--surface`, a hairline above. */
export function SheetFooter({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      className={cn('flex shrink-0 items-center gap-3 border-t border-border bg-surface px-5 py-3.5', className)}
      {...props}
    />
  );
}
