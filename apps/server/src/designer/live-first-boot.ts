// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial's Designer, switched on by the operator at its first boot.
 *
 * On an ordinary server the live Designer is three hands away (`designer/live.ts`): the operator allows it, a Super
 * Admin switches it on with their password, a person with the right uses it. A trial's Super Admin is the visitor who
 * asked for it to be built, and their idea or notes are already waiting (the start prompt): so where the operator
 * allows it (`ADMINIUM_DESIGNER=live`) a trial's FIRST boot switches it on for them, once, recorded in the audit log
 * as the operator's doing.
 *
 * Once: an operator tally (`adminium_operator_tallies`, which no settings route, import or archive writes) is claimed
 * before the switch, so a Super Admin who switches it off later finds it off after every restart. A switch that could
 * not go on (no bundler, no project folder, a folder that cannot be written) gives the claim back, so a later boot
 * that can tries again. Trial mode only; it runs after `checkAtBoot`, so a switch that boot turned off for a folder
 * that was not kept is not turned on again.
 */
import { auditRepo, operatorTalliesRepo, type MetaDb } from '@adminium/meta';

import { OPERATOR_ACTOR_LABEL } from '../operator/endpoint.js';
import type { Profile } from '../trial/policy.js';
import type { Live, LiveReason } from './live.js';

/** The tally that says a trial's first boot switched the Designer on. */
export const LIVE_FIRST_BOOT_TALLY = 'designer-live-first-boot';

export type FirstBootLive =
  /** Switched on now. */
  | { kind: 'switched-on' }
  /** Was on already: the claim is kept, nothing switched. */
  | { kind: 'already-on' }
  /** Not a trial, not allowed, or claimed by an earlier boot: nothing done. */
  | { kind: 'skipped' }
  /** Could not go on: the claim was given back. */
  | { kind: 'refused'; reason: LiveReason };

export async function switchLiveOnFirstBoot(deps: { live: Live; meta: MetaDb; profile: Profile; now?: number }): Promise<FirstBootLive> {
  if (deps.profile !== 'trial') return { kind: 'skipped' };
  const state = await deps.live.state();
  if (!state.allowed) return { kind: 'skipped' };
  const tallies = operatorTalliesRepo(deps.meta);
  const at = deps.now ?? Date.now();
  if (!(await tallies.claim(LIVE_FIRST_BOOT_TALLY, at))) return { kind: 'skipped' };
  if (state.on) return { kind: 'already-on' };
  const reason = await deps.live.set(true);
  if (reason !== null) {
    await tallies.release(LIVE_FIRST_BOOT_TALLY);
    return { kind: 'refused', reason };
  }
  await auditRepo(deps.meta).append({
    actorKind: 'system',
    actorId: null,
    actorLabel: OPERATOR_ACTOR_LABEL,
    category: 'settings',
    action: 'designer.live.on',
    changes: { after: { on: true, reason: 'trial-first-boot' } },
  });
  return { kind: 'switched-on' };
}
