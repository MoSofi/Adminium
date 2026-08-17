import { X } from 'lucide-react';
import { createContext, useContext } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { MonoText } from '../mono-text/MonoText.js';

/**
 * Which of the two treatments the surrounding bar is using, so
 * `BulkActionButton` can dress itself to match without every call site
 * repeating the flag. Defaults to the floating (dark) bar, which is what a
 * bare `BulkActionButton` outside a bar would belong to.
 */
const BulkActionFloatingContext = createContext(true);

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
 * BulkActionBar — the selection bar shown while rows are checked: mono count +
 * actions + clear, appearing via `nb-fade` (research/design-system.md §3
 * Tier 3). Two treatments, chosen by `floating`:
 *
 *  - `floating` (default): the dark `--fg` slab pinned bottom-centre over the
 *    page. It reads as an overlay because it *is* one.
 *  - docked (`floating={false}`): the CRUD Admin comp's inline rail — no
 *    chrome at all, just an accent count, a hairline, and ordinary light
 *    buttons, sitting directly in the host toolbar's own surface. The dark
 *    slab was previously used here too, which dropped a black box into the
 *    middle of a white toolbar card.
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
    <BulkActionFloatingContext.Provider value={floating}>
      <div
        role="toolbar"
        aria-label={label}
        className={cn(
          'flex w-fit max-w-[calc(100vw-32px)] items-center gap-1',
          'animate-[nb-fade_.24s_cubic-bezier(.2,.7,.3,1)]',
          floating
            ? 'fixed inset-x-0 bottom-6 z-[80] mx-auto rounded-lg bg-fg p-1.5 ps-3.5 text-bg shadow-menu'
            : // Chrome-less on purpose: the comp's docked rail inherits the
              // toolbar's surface rather than drawing a second box inside it.
              'gap-2',
          className,
        )}
        {...props}
      >
        <span className="me-1 flex items-baseline gap-1.5 text-body-sm font-bold">
          <MonoText className={floating ? undefined : 'text-accent'}>{count}</MonoText>
          <span className={cn('font-semibold', floating ? 'text-bg/70' : 'text-fg-muted')}>{countLabel}</span>
        </span>
        {children}
        <span
          aria-hidden="true"
          className={cn('h-[18px] w-px shrink-0', floating ? 'mx-1.5 bg-bg/20' : 'bg-border')}
        />
        <button
          type="button"
          aria-label={clearLabel}
          onClick={onClear}
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md',
            floating
              ? 'text-bg/70 hover:bg-bg/15 hover:text-bg focus-visible:outline-bg'
              : 'text-fg-subtle hover:bg-surface-3 hover:text-fg focus-visible:outline-accent',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
          )}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </BulkActionFloatingContext.Provider>
  );
}

export interface BulkActionButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'style'> {
  /** Leading Lucide icon. */
  icon?: ReactNode;
  /** Danger styling (Delete). */
  destructive?: boolean | undefined;
}

/**
 * Action button for `BulkActionBar`. Reads the bar's treatment from context:
 * light-on-dark inside the floating slab, and the comp's outlined light button
 * (danger-tinted when destructive) inside the docked rail.
 */
export function BulkActionButton({
  icon,
  destructive = false,
  className,
  children,
  ...props
}: BulkActionButtonProps) {
  const floating = useContext(BulkActionFloatingContext);
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-[30px] items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-bold',
        floating
          ? cn(
              destructive ? 'text-danger hover:bg-danger/15' : 'text-bg/90 hover:bg-bg/15 hover:text-bg',
              'focus-visible:outline-bg',
            )
          : cn(
              'border',
              destructive
                ? 'border-danger/25 bg-danger-soft text-danger hover:brightness-97'
                : 'border-border-strong bg-surface font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg',
              'focus-visible:outline-accent',
            ),
        'focus-visible:outline-2 focus-visible:outline-offset-2',
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
