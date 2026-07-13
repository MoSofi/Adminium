import { X } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { MonoText } from '../mono-text/MonoText.js';

export interface BulkActionBarProps extends ComponentPropsWithRef<'div'> {
  /** Number of selected rows (mono). */
  count: number;
  /** Text after the count ("selected"). Required — i18n. */
  countLabel: ReactNode;
  /** Action buttons (use `BulkActionButton`). */
  children?: ReactNode;
  /** Clear-selection handler. */
  onClear: () => void;
  /** Accessible label for the clear button (required — i18n). */
  clearLabel: string;
  /** Accessible name for the toolbar (e.g. "Bulk actions"). */
  label?: string | undefined;
  /**
   * Pin to the bottom-center of the viewport (default). Set false to
   * position it yourself (e.g. sticky inside a table container).
   */
  floating?: boolean | undefined;
}

/**
 * BulkActionBar — dark floating bar (`fg` background) shown while rows are
 * selected: mono count + actions + clear; appears via `nb-fade`
 * (research/design-system.md §3 Tier 3).
 */
export function BulkActionBar({
  count,
  countLabel,
  children,
  onClear,
  clearLabel,
  label,
  floating = true,
  className,
  ...props
}: BulkActionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn(
        'flex w-fit max-w-[calc(100vw-32px)] items-center gap-1 rounded-lg bg-fg p-1.5 ps-3.5 text-bg shadow-menu',
        'animate-[nb-fade_.24s_cubic-bezier(.2,.7,.3,1)]',
        floating ? 'fixed bottom-6 inset-x-0 z-[80] mx-auto' : undefined,
        className,
      )}
      {...props}
    >
      <span className="me-2 flex items-baseline gap-1.5 text-body-sm font-bold">
        <MonoText>{count}</MonoText>
        <span className="font-semibold text-bg/70">{countLabel}</span>
      </span>
      {children}
      <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-bg/20" />
      <button
        type="button"
        aria-label={clearLabel}
        onClick={onClear}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-bg/70 hover:bg-bg/15 hover:text-bg',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bg',
        )}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export interface BulkActionButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'style'> {
  /** Leading Lucide icon. */
  icon?: ReactNode;
  /** Danger styling (Delete). */
  destructive?: boolean | undefined;
}

/** Inverted button for `BulkActionBar` (light-on-dark, danger option). */
export function BulkActionButton({
  icon,
  destructive = false,
  className,
  children,
  ...props
}: BulkActionButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-bold',
        destructive ? 'text-danger hover:bg-danger/15' : 'text-bg/90 hover:bg-bg/15 hover:text-bg',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bg',
        'disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
