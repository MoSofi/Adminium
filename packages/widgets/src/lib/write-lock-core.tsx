// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The write locks' state and the locked look, without the Tooltip: what the
 * widget families import (a board's "+", a calendar's "New event", a
 * dropzone), so a host that draws them outside a page template, like the
 * embeddable kit, does not take the Tooltip in with them. A locked control
 * here shows its reason in the Tooltip the nearest `WriteLockScope` gives
 * (`write-lock.tsx`, around every page template), and in `title` without one.
 * The locks themselves are described in `write-lock.tsx`.
 */
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useSyncExternalStore,
  type ComponentType,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

/** What a write control does. */
export type WriteAction = 'create' | 'update' | 'delete';

let installation: string | null = null;
const databases = new Map<string, string>();
/** Moves on every change: the snapshot `useSyncExternalStore` compares. */
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Lock every write of the installation with `reason`, or release them with null. */
export function setWriteLock(reason: string | null): void {
  if (reason === installation) return;
  installation = reason;
  changed();
}

/** Lock the creates and edits of one database with `reason` (its deletes stay open), or release it with null. */
export function setDatabaseWriteLock(connectionId: string, reason: string | null): void {
  if ((databases.get(connectionId) ?? null) === reason) return;
  if (reason === null) databases.delete(connectionId);
  else databases.set(connectionId, reason);
  changed();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const current = (): number => version;

/** The database the write controls inside write to (a template's source); null: none. */
export const ScopeContext = createContext<string | null>(null);

/** The Tooltip a locked control says its reason in, given by `WriteLockScope`. */
export const LockTipContext = createContext<ComponentType<{ content: ReactNode; children: ReactElement }> | null>(null);

/**
 * The reason `action` is locked, or null while it is open. The database is
 * `connectionId`, else the nearest scope's.
 */
export function useWriteLock(action: WriteAction = 'update', connectionId?: string | null): string | null {
  useSyncExternalStore(subscribe, current, current);
  const scoped = useContext(ScopeContext);
  if (installation !== null) return installation;
  const database = connectionId === undefined ? scoped : connectionId;
  return action === 'delete' || database === null ? null : (databases.get(database) ?? null);
}

/** How a locked control looks: the disabled look, still focusable. */
export const WRITE_LOCKED_LOOK = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

interface LockableProps {
  className?: string | undefined;
  onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  title?: string | undefined;
}

/** A control locked with `reason` (as it is when null): `aria-disabled`, inert, the reason in the Tooltip. */
export function LockedControl({ reason, children }: { reason: string | null; children: ReactElement<LockableProps> }): ReactNode {
  const Tip = useContext(LockTipContext);
  if (reason === null || !isValidElement(children)) return children;
  const locked = cloneElement(children, {
    'aria-disabled': true,
    className: [children.props.className, WRITE_LOCKED_LOOK].filter(Boolean).join(' '),
    onClick: (event: MouseEvent<HTMLElement>) => {
      // A submit button too: the form is not sent. A menu item is not chosen.
      event.preventDefault();
    },
    'data-write-locked': '',
    ...(Tip === null ? { title: reason } : {}),
  } as LockableProps);
  return Tip === null ? locked : <Tip content={reason}>{locked}</Tip>;
}
