// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page-wide write lock: while the host holds one, every create, edit,
 * delete and save control the templates draw is off, and says why.
 *
 * The host sets it ({@link setWriteLock}) with the sentence to show, the way
 * a trial that has ended makes the installation read-only; the server refuses
 * the write itself, so this is what a person sees rather than the guard.
 *
 * A locked control stays in the tab order with `aria-disabled` (a native
 * `disabled` would take it out of reach of a keyboard and of the tooltip),
 * ignores a click, and shows the reason in the shared Tooltip on hover and on
 * keyboard focus; a tap focuses it, so touch reaches the reason too.
 */
import { cloneElement, isValidElement, useSyncExternalStore, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { Tooltip } from '@adminium/ui';

let held: string | null = null;
const listeners = new Set<() => void>();

/** Lock every write control with `reason`, or release them with null. */
export function setWriteLock(reason: string | null): void {
  if (reason === held) return;
  held = reason;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const current = (): string | null => held;

/** The lock's reason, or null while writes are open. */
export function useWriteLock(): string | null {
  return useSyncExternalStore(subscribe, current, current);
}

/** How a locked control looks: the disabled look, still focusable. */
export const WRITE_LOCKED_LOOK = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

interface LockableProps {
  className?: string | undefined;
  onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
}

/**
 * A create, edit, delete or save control: as it is while writes are open;
 * `aria-disabled`, inert and explained while the host holds a lock.
 */
export function WriteControl({ children }: { children: ReactElement<LockableProps> }): ReactNode {
  const reason = useWriteLock();
  if (reason === null || !isValidElement(children)) return children;
  const locked = cloneElement(children, {
    'aria-disabled': true,
    className: [children.props.className, WRITE_LOCKED_LOOK].filter(Boolean).join(' '),
    onClick: (event: MouseEvent<HTMLElement>) => {
      // A submit button too: the form is not sent.
      event.preventDefault();
    },
    'data-write-locked': '',
  } as LockableProps);
  return <Tooltip content={reason}>{locked}</Tooltip>;
}
