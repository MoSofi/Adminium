/**
 * Static presentation metadata for the onboarding steps (M5-T06). The server
 * owns each step's `done` (reactive derivation); this owns its icon, copy keys
 * and CTA target. Keyed by the server `OnboardingStepKey`. Microcopy keepers
 * per research/ia-mapping.md §4 (per-task minute estimates, sample-domain tone).
 */

import type { IconName } from '@adminium/ui';

/** Known in-app CTA destinations (typed for TanStack navigate). */
export type OnboardingStepTarget =
  | '/studio/connect'
  | '/studio'
  | '/settings/defaults'
  | '/settings/team';

export interface OnboardingStepMeta {
  key: string;
  icon: IconName;
  titleKey: string;
  titleFallback: string;
  descKey: string;
  descFallback: string;
  timeKey: string;
  timeFallback: string;
  actionKey: string;
  actionFallback: string;
  /** CTA route; omitted steps have no destination yet. */
  target?: OnboardingStepTarget;
}

export const ONBOARDING_STEP_META: readonly OnboardingStepMeta[] = [
  {
    key: 'connect-database',
    icon: 'Database',
    titleKey: 'onboarding.steps.connectDatabase.title',
    titleFallback: 'Connect a database',
    descKey: 'onboarding.steps.connectDatabase.desc',
    descFallback: 'Point Adminium at your Postgres, MySQL or SQLite — read-only role welcome.',
    timeKey: 'onboarding.steps.connectDatabase.time',
    timeFallback: '5 min',
    actionKey: 'onboarding.steps.connectDatabase.action',
    actionFallback: 'Connect',
    target: '/studio/connect',
  },
  {
    key: 'choose-tables',
    icon: 'Table2',
    titleKey: 'onboarding.steps.chooseTables.title',
    titleFallback: 'Choose your tables',
    descKey: 'onboarding.steps.chooseTables.desc',
    descFallback: 'Pick which tables become pages — PII is masked by default.',
    timeKey: 'onboarding.steps.chooseTables.time',
    timeFallback: '2 min',
    actionKey: 'onboarding.steps.chooseTables.action',
    actionFallback: 'Choose',
    target: '/studio',
  },
  {
    key: 'invite-teammates',
    icon: 'UserPlus',
    titleKey: 'onboarding.steps.inviteTeammates.title',
    titleFallback: 'Invite teammates',
    descKey: 'onboarding.steps.inviteTeammates.desc',
    descFallback: 'Bring your team in to explore and collaborate.',
    timeKey: 'onboarding.steps.inviteTeammates.time',
    timeFallback: '2 min',
    actionKey: 'onboarding.steps.inviteTeammates.action',
    actionFallback: 'Invite',
    // Landed with the team directory — until then this step's CTA had nowhere
    // to go, because the product had no way to create a second account at all.
    target: '/settings/team',
  },
  {
    key: 'workspace-defaults',
    icon: 'SlidersHorizontal',
    titleKey: 'onboarding.steps.workspaceDefaults.title',
    titleFallback: 'Set workspace defaults',
    descKey: 'onboarding.steps.workspaceDefaults.desc',
    descFallback: 'Theme, accent, density and locale everyone starts with.',
    timeKey: 'onboarding.steps.workspaceDefaults.time',
    timeFallback: '1 min',
    actionKey: 'onboarding.steps.workspaceDefaults.action',
    actionFallback: 'Set defaults',
    target: '/settings/defaults',
  },
];

export function stepMeta(key: string): OnboardingStepMeta | undefined {
  return ONBOARDING_STEP_META.find((step) => step.key === key);
}
