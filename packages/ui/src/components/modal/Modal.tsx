import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Children, isValidElement, type ComponentPropsWithRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { IconTile, type Tone } from '../icon-tile/index.js';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

/** Size → max inline size (~410/480/720/940, research/design-system.md §3 Tier 3). */
const modalSizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-[410px]',
  md: 'max-w-[480px]',
  lg: 'max-w-[720px]',
  xl: 'max-w-[940px]',
};

/** Optional trigger; renders `asChild` friendly Radix trigger. */
export const ModalTrigger = DialogPrimitive.Trigger;
/** Close wrapper for footer buttons (`asChild` supported). */
export const ModalClose = DialogPrimitive.Close;

export interface ModalProps extends ComponentPropsWithRef<typeof DialogPrimitive.Root> {
  /** Max width: sm 410 / md 480 / lg 720 / xl 940. */
  size?: ModalSize | undefined;
  /** Extra classes for the dialog panel. */
  className?: string | undefined;
  /** Extra classes for the scrim overlay. */
  overlayClassName?: string | undefined;
  children?: ReactNode;
}

/**
 * Modal — Radix dialog: radius 20, `--shadow-lg` (shadow-modal), `--scrim` +
 * 3px backdrop blur, `nb-modal` entrance; focus trap, Esc and overlay close
 * are Radix built-ins (research/design-system.md §3 Tier 3). Compose with
 * `ModalHeader` / `ModalBody` / `ModalFooter`. Pass `modal={false}` +
 * `defaultOpen` in VRT stories to render inline.
 */
export function Modal({ size = 'md', className, overlayClassName, children, ...rootProps }: ModalProps) {
  // ModalTrigger children must render as direct Root children — the Portal/Content
  // subtree is unmounted while the dialog is closed, so a trigger placed inside it
  // would never appear.
  const childArray = Children.toArray(children);
  const triggers = childArray.filter((c) => isValidElement(c) && c.type === ModalTrigger);
  const content = childArray.filter((c) => !(isValidElement(c) && c.type === ModalTrigger));
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
            // inset-0 + m-auto + h-fit centers without transforms — RTL-safe.
            'fixed inset-0 z-50 m-auto flex h-fit max-h-[85vh] w-[calc(100%-32px)] flex-col',
            'overflow-hidden rounded-xl border border-border bg-surface shadow-modal outline-none',
            'animate-[nb-modal_.22s_cubic-bezier(.2,.8,.2,1)]',
            modalSizeClasses[size],
            className,
          )}
        >
          {content}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface ModalHeaderProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Lucide icon rendered in a tinted IconTile next to the title. */
  icon?: ReactNode;
  /** Tone of the icon tile. */
  tone?: Tone | undefined;
  /** Dialog title (wired to `aria-labelledby` via Radix `Dialog.Title`). */
  title: ReactNode;
  /** Optional subtitle (wired to `aria-describedby` via `Dialog.Description`). */
  subtitle?: ReactNode;
  /** Accessible label for the close icon-button (required — i18n). */
  closeLabel: string;
  /** Hide the close icon-button (e.g. forced-choice flows). */
  hideClose?: boolean | undefined;
}

/** Modal header: tinted icon tile + title/subtitle + close icon-button. */
export function ModalHeader({
  icon,
  tone = 'accent',
  title,
  subtitle,
  closeLabel,
  hideClose,
  className,
  children,
  ...props
}: ModalHeaderProps) {
  return (
    <div className={cn('flex shrink-0 items-start gap-3 px-5 pb-4 pt-5', className)} {...props}>
      {icon === undefined || icon === null ? null : <IconTile tone={tone} size="md" icon={icon} />}
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="text-modal text-fg">{title}</DialogPrimitive.Title>
        {subtitle === undefined || subtitle === null ? null : (
          <DialogPrimitive.Description className="mt-0.5 text-body-sm text-fg-muted">
            {subtitle}
          </DialogPrimitive.Description>
        )}
        {children}
      </div>
      {hideClose ? null : (
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className={cn(
            'nb-ib -me-1.5 -mt-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

export type ModalBodyProps = ComponentPropsWithRef<'div'>;

/** Scrollable modal body (tokens `.nb-scroll` scrollbar). */
export function ModalBody({ className, ...props }: ModalBodyProps) {
  return (
    <div
      className={cn('nb-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 text-body text-fg', className)}
      {...props}
    />
  );
}

export type ModalFooterProps = ComponentPropsWithRef<'div'>;

/** Modal footer on `--surface-2` with a top hairline; actions end-aligned. */
export function ModalFooter({ className, ...props }: ModalFooterProps) {
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
