import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Children, isValidElement, type ComponentPropsWithRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { IconTile, type Tone } from '../icon-tile/index.js';

export type DrawerSize = 'sm' | 'md' | 'lg';

/** Size → inline size (380/480/640, research/design-system.md §3 Tier 3). */
const drawerSizeClasses: Record<DrawerSize, string> = {
  sm: 'w-[380px]',
  md: 'w-[480px]',
  lg: 'w-[640px]',
};

/** Optional trigger (`asChild` friendly Radix trigger). */
export const DrawerTrigger = DialogPrimitive.Trigger;
/** Close wrapper for footer buttons (`asChild` supported). */
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerProps extends ComponentPropsWithRef<typeof DialogPrimitive.Root> {
  /** Inline size: sm 380 / md 480 / lg 640. */
  size?: DrawerSize | undefined;
  /** Extra classes for the sheet panel. */
  className?: string | undefined;
  /** Extra classes for the scrim overlay. */
  overlayClassName?: string | undefined;
  children?: ReactNode;
}

/**
 * Drawer — side sheet on Radix Dialog sliding in from `inset-inline-end`
 * (logical → mirrors in RTL); `nb-slide` entrance, same scrim as Modal;
 * compose with `DrawerHeader` / `DrawerBody` / `DrawerFooter`
 * (research/design-system.md §3 Tier 3).
 */
export function Drawer({ size = 'md', className, overlayClassName, children, ...rootProps }: DrawerProps) {
  // Triggers must stay outside the Portal (unmounted while closed) — same
  // pattern as Modal.
  const childArray = Children.toArray(children);
  const triggers = childArray.filter((c) => isValidElement(c) && c.type === DrawerTrigger);
  const content = childArray.filter((c) => !(isValidElement(c) && c.type === DrawerTrigger));
  return (
    <DialogPrimitive.Root {...rootProps}>
      {triggers}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[3px]',
            'animate-[nb-fade_.2s_cubic-bezier(.2,.7,.3,1)]',
            overlayClassName,
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-y-0 end-0 z-50 flex h-full max-w-[calc(100vw-32px)] flex-col',
            'border-s border-border bg-surface shadow-modal outline-none',
            // nb-slide translates from --nb-slide-from (24px); flip for RTL.
            'animate-[nb-slide_.22s_cubic-bezier(.2,.7,.3,1)] rtl:[--nb-slide-from:-24px]',
            drawerSizeClasses[size],
            className,
          )}
        >
          {content}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface DrawerHeaderProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Lucide icon rendered in a tinted IconTile next to the title. */
  icon?: ReactNode;
  tone?: Tone | undefined;
  /** Sheet title (wired to `aria-labelledby` via Radix `Dialog.Title`). */
  title: ReactNode;
  /** Optional subtitle (wired to `aria-describedby`). */
  subtitle?: ReactNode;
  /** Accessible label for the close icon-button (required — i18n). */
  closeLabel: string;
}

/** Drawer header: tinted icon tile + title/subtitle + close, bottom hairline. */
export function DrawerHeader({
  icon,
  tone = 'accent',
  title,
  subtitle,
  closeLabel,
  className,
  children,
  ...props
}: DrawerHeaderProps) {
  return (
    <div className={cn('flex shrink-0 items-start gap-3 border-b border-border px-5 py-4', className)} {...props}>
      {icon === undefined || icon === null ? null : <IconTile tone={tone} size="md" icon={icon} />}
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="text-section text-fg">{title}</DialogPrimitive.Title>
        {subtitle === undefined || subtitle === null ? null : (
          <DialogPrimitive.Description className="mt-0.5 text-body-sm text-fg-muted">
            {subtitle}
          </DialogPrimitive.Description>
        )}
        {children}
      </div>
      <DialogPrimitive.Close
        aria-label={closeLabel}
        className={cn(
          'nb-ib -me-1.5 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        )}
      >
        <X className="size-4" aria-hidden="true" />
      </DialogPrimitive.Close>
    </div>
  );
}

export type DrawerBodyProps = ComponentPropsWithRef<'div'>;

/** Scrollable drawer body. */
export function DrawerBody({ className, ...props }: DrawerBodyProps) {
  return (
    <div
      className={cn('nb-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 text-body text-fg', className)}
      {...props}
    />
  );
}

export type DrawerFooterProps = ComponentPropsWithRef<'div'>;

/** Drawer footer on `--surface-2` with a top hairline; actions end-aligned. */
export function DrawerFooter({ className, ...props }: DrawerFooterProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}
