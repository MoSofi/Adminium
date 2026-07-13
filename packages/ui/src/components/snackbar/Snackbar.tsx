import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import type { ToastActionSpec } from '../toast/Toast.js';

export interface SnackbarProps extends ComponentPropsWithRef<'div'> {
  /** Message text. */
  children: ReactNode;
  /** Optional action (Undo). */
  action?: ToastActionSpec | undefined;
  /**
   * Pin to the bottom / inline-center of the viewport (default). Set false
   * to position it yourself.
   */
  floating?: boolean | undefined;
}

/**
 * Snackbar — inverted dark pill (`fg` background / `bg` text) with an inline
 * Undo action (research/design-system.md §3 Tier 3). For queued, tonal
 * notifications use `Toast`/`useToastQueue`; Snackbar is the single
 * lightweight confirmation.
 */
export function Snackbar({ children, action, floating = true, className, ...props }: SnackbarProps) {
  return (
    <div
      role="status"
      className={cn(
        'inline-flex w-fit max-w-[calc(100vw-32px)] items-center gap-3 rounded-full bg-fg py-2.5 text-body-sm font-semibold text-bg shadow-menu',
        action === undefined ? 'px-4' : 'ps-4 pe-2',
        floating ? 'fixed bottom-6 inset-x-0 z-[90] mx-auto animate-[nb-fade_.24s_cubic-bezier(.2,.7,.3,1)]' : undefined,
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      {action === undefined ? null : (
        <button
          type="button"
          onClick={action.onAction}
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-bold text-bg/90 hover:bg-bg/15 hover:text-bg',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bg',
          )}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
