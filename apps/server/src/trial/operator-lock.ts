// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Set by the operator": a setting the environment decides, shown read-only
 * and refused on save (the `designer.live` pattern).
 *
 * Never hidden, always explained (F45): a locked setting stays in its reply
 * and on its page, with `{ allowed: false, reason }` beside it, and the
 * dashboard draws it read-only with the chip "Set by the operator"
 * (`apps/dashboard/src/components/SetByOperator.tsx`). A save that would
 * change it is refused with {@link SetByOperatorError}: 409
 * `SET_BY_OPERATOR`, `details: { setting, reason }`. A save that sends the
 * value it is locked to is no change and passes, so a page that writes a
 * whole section at once keeps working.
 *
 * TO LOCK ANOTHER SETTING (T11, T13, T30 …):
 *
 *   1. add it to {@link LOCKED_SETTINGS}: the policy question that locks it,
 *      and the value it holds while locked;
 *   2. in its route: put `settingLock(policy, key)` in the reply (beside the
 *      value, which reads {@link lockedValue} while locked), and call
 *      `refuseLockedChange(policy, key, next)` before writing;
 *   3. where the setting takes effect, read the locked value too (the setting
 *      itself may hold anything a Super Admin saved before the lock);
 *   4. in the dashboard, read the lock from the reply and draw the field with
 *      `SetByOperator` (read-only, `aria-disabled`, the chip);
 *   5. one test each way: refused and read-only under the profile, as before
 *      without it.
 */
import { z } from 'zod';

import { AppError } from '../errors.js';
import { POLICY_REASONS, type PolicyQuestion, type PolicyReason, type TrialPolicy } from './policy.js';

/**
 * Why a setting is locked: a profile's reason (`trial/policy.ts`), or
 * `not-allowed`, an operator's own variable outside any profile
 * (`ADMINIUM_LOCAL_DATABASES=off`).
 */
export type LockReason = PolicyReason | 'not-allowed';

export const LOCK_REASONS: readonly LockReason[] = [...POLICY_REASONS, 'not-allowed'];

export interface SettingLock {
  /** The setting can be changed here. */
  allowed: boolean;
  /** Why it cannot; null when it can. */
  reason: LockReason | null;
}

/** The lock as it travels in a reply. */
export const settingLockSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum(LOCK_REASONS as [LockReason, ...LockReason[]]).nullable(),
});

/** The settings an operator can lock: the question that locks each, and the value it holds while locked. */
export const LOCKED_SETTINGS = {
  'telemetry.enabled': { question: 'telemetry', value: false },
  'updates.checkEnabled': { question: 'updateCheck', value: false },
  'connections.allowLocalDatabases': { question: 'localDatabases', value: false },
  // The address in email links. Its locked value is the operator's origin, which the environment decides
  // (`trial/operator-hosts.ts`), so `value` is only a placeholder here: the route compares with
  // `heldOperatorOrigin` and the boot writes the row (`security/public-origin.ts`).
  'system.publicOrigin': { question: 'publicOriginSetting', value: null },
  // A1, A2 (connections, outgoing traffic): a user-typed AI address.
  'llm.baseUrl': { question: 'aiBaseUrl', value: null },
  // A2: the user's own mail server. On a trial all mail goes through the operator's relay (`email/trial-relay.ts`).
  'email.smtp': { question: 'ownSmtp', value: null },
} as const satisfies Record<string, { question: PolicyQuestion; value: unknown }>;

export type LockableSetting = keyof typeof LOCKED_SETTINGS;

export interface LockOptions {
  /** An operator's variable that locks it outside a profile too (`ADMINIUM_LOCAL_DATABASES=off`). */
  envLocked?: boolean;
}

/** Whether `key` can be changed here, and why not. A profile's reason comes first: it is the more specific one. */
export function settingLock(policy: Pick<TrialPolicy, 'allows'>, key: LockableSetting, opts: LockOptions = {}): SettingLock {
  const answer = policy.allows(LOCKED_SETTINGS[key].question);
  if (!answer.allowed) return { allowed: false, reason: answer.reason };
  if (opts.envLocked === true) return { allowed: false, reason: 'not-allowed' };
  return { allowed: true, reason: null };
}

/** The value `key` holds while locked. */
export function lockedValue<K extends LockableSetting>(key: K): (typeof LOCKED_SETTINGS)[K]['value'] {
  return LOCKED_SETTINGS[key].value;
}

/** `stored`, or the locked value while `lock` holds. */
export function effectiveValue<K extends LockableSetting, V>(key: K, lock: SettingLock, stored: V): V | (typeof LOCKED_SETTINGS)[K]['value'] {
  return lock.allowed ? stored : lockedValue(key);
}

/** 409: the operator set this, so it cannot be changed here. */
export class SetByOperatorError extends AppError {
  override readonly name = 'SetByOperatorError';

  constructor(setting: LockableSetting, reason: LockReason) {
    super(409, 'SET_BY_OPERATOR', `The server's operator has set ${setting}, so it cannot be changed here.`, { setting, reason });
  }
}

/** Throws {@link SetByOperatorError} when `key` is locked and `next` is not the value it is locked to. */
export function refuseLockedChange(policy: Pick<TrialPolicy, 'allows'>, key: LockableSetting, next: unknown, opts: LockOptions = {}): void {
  const lock = settingLock(policy, key, opts);
  if (!lock.allowed && next !== lockedValue(key)) throw new SetByOperatorError(key, lock.reason ?? 'not-allowed');
}
