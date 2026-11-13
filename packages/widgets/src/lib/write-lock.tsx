// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The write locks: while the host holds one, the create, edit, delete and save
 * controls the templates draw are off, and say why.
 *
 * Two locks, set apart and never lifted by each other:
 *  - the installation's ({@link setWriteLock}): every write, deletes too, the
 *    way a trial that has ended makes the installation read-only;
 *  - a database's ({@link setDatabaseWriteLock}): creates and edits of that
 *    one database, while deletes stay open, the way a trial database over its
 *    size limit is held until rows are deleted.
 * The installation's reason wins where both hold. The server refuses the write
 * itself; this is what a person sees rather than the guard.
 *
 * A control names what it does (`create`, `update`, `delete`) and the database
 * it writes to, by prop or from the nearest {@link WriteLockScope} (a template
 * wraps itself in one for its source). A control outside any database (a file
 * kept with a record is the installation's own data) follows the
 * installation's lock alone.
 *
 * A locked control stays in the tab order with `aria-disabled` (a native
 * `disabled` would take it out of reach of a keyboard and of the tooltip),
 * ignores a click, and shows the reason in the shared Tooltip on hover and on
 * keyboard focus; a tap focuses it, so touch reaches the reason too.
 */
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useSyncExternalStore,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Tooltip } from '@adminium/ui';

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

const ScopeContext = createContext<string | null>(null);

/** The database the write controls inside write to (a template's source). */
export function WriteLockScope({ connectionId, children }: { connectionId: string | null | undefined; children: ReactNode }): ReactNode {
  return <ScopeContext.Provider value={connectionId ?? null}>{children}</ScopeContext.Provider>;
}

/**
 * The reason `action` is locked, or null while it is open. The database is
 * `connectionId`, else the nearest {@link WriteLockScope}'s.
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
}

/** A control locked with `reason` (as it is when null): `aria-disabled`, inert, the reason in the Tooltip. */
export function LockedControl({ reason, children }: { reason: string | null; children: ReactElement<LockableProps> }): ReactNode {
  if (reason === null || !isValidElement(children)) return children;
  const locked = cloneElement(children, {
    'aria-disabled': true,
    className: [children.props.className, WRITE_LOCKED_LOOK].filter(Boolean).join(' '),
    onClick: (event: MouseEvent<HTMLElement>) => {
      // A submit button too: the form is not sent. A menu item is not chosen.
      event.preventDefault();
    },
    'data-write-locked': '',
  } as LockableProps);
  return <Tooltip content={reason}>{locked}</Tooltip>;
}

/**
 * A create, edit, delete or save control: as it is while its write is open;
 * `aria-disabled`, inert and explained while a lock holds it.
 */
export function WriteControl({
  action,
  connectionId,
  children,
}: {
  action: WriteAction;
  /** The database written to; the nearest {@link WriteLockScope}'s when left out. */
  connectionId?: string | null | undefined;
  children: ReactElement<LockableProps>;
}): ReactNode {
  return <LockedControl reason={useWriteLock(action, connectionId)}>{children}</LockedControl>;
}
