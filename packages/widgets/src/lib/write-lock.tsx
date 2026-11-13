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
import { Tooltip } from '@adminium/ui';
import type { ReactElement, ReactNode } from 'react';

import { LockedControl, LockTipContext, ScopeContext, useWriteLock, type WriteAction } from './write-lock-core.js';

export { LockedControl, setDatabaseWriteLock, setWriteLock, useWriteLock, WRITE_LOCKED_LOOK, type WriteAction } from './write-lock-core.js';

/** The database the write controls inside write to (a template's source), and the Tooltip they say why in. */
export function WriteLockScope({ connectionId, children }: { connectionId: string | null | undefined; children: ReactNode }): ReactNode {
  return (
    <LockTipContext.Provider value={Tooltip}>
      <ScopeContext.Provider value={connectionId ?? null}>{children}</ScopeContext.Provider>
    </LockTipContext.Provider>
  );
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
  children: ReactElement<{ className?: string | undefined }>;
}): ReactNode {
  return (
    <LockTipContext.Provider value={Tooltip}>
      <LockedControl reason={useWriteLock(action, connectionId)}>{children}</LockedControl>
    </LockTipContext.Provider>
  );
}
