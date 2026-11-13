// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Set by the operator": a setting the server's environment
 * decides. The server sends `{ allowed, reason }` beside such a setting and
 * refuses a save that would change it (`SET_BY_OPERATOR`,
 * `apps/server/src/trial/operator-lock.ts`); a page draws it READ-ONLY, never
 * hidden ("never hide, always explain", F45):
 *
 *   - the control stays in the tab order with `aria-disabled` (not `disabled`,
 *     which a keyboard and a screen reader skip) and ignores a change;
 *   - this chip sits beside its label;
 *   - a line says what the operator decided, and the control's
 *     `aria-describedby` points at it.
 *
 * The chip is drawn as the trial mode design has it: lock 12 px, 11.5 px
 * bold, muted on surface-3, fully rounded, one line. `LocalDatabasesCard` and
 * the first-run consent use it; the trial's switched-off choices, its public
 * origin and its mail relay draw their locked settings the same way.
 */
import { Lock } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import { ApiError } from '../app/api.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';

/** A lock as the server sends it beside a setting. `reason` is a code: the chip says the same whatever it is. */
export interface SettingLock {
  allowed: boolean;
  reason: string | null;
}

/** The setting is set by the operator. A reply from a server older than the lock carries none: not locked. */
export function isLocked(lock: SettingLock | undefined): boolean {
  return lock !== undefined && !lock.allowed;
}

/** A save refused because the operator set it. */
export function isSetByOperator(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'SET_BY_OPERATOR';
}

export function SetByOperatorChip({ className, ...rest }: HTMLAttributes<HTMLSpanElement>): ReactNode {
  // Its words are a deferred group of `common` (`operatorLock`): out of every first load, in before it paints.
  useCommonWords();
  return (
    <span
      {...rest}
      className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-surface-3 px-[9px] py-0.5 text-[11.5px] font-bold text-fg-muted${className === undefined ? '' : ` ${className}`}`}
    >
      <Lock aria-hidden="true" className="size-3" />
      {t('operatorLock.chip', 'Set by the operator')}
    </span>
  );
}
