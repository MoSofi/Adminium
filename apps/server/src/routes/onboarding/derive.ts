// SPDX-License-Identifier: AGPL-3.0-only
/**
 * First-run onboarding checklist derivation (M5-T06, 09-generated-app.md).
 *
 * The checklist is REACTIVE: each step's `done` is computed from real
 * workspace state at request time, never from a boolean stored when the user
 * clicked something. This pure function takes the gathered facts and produces
 * the step list + progress — kept separate from the route so it is unit-tested
 * in isolation.
 */

export const ONBOARDING_STEP_KEYS = [
  'connect-database',
  'choose-tables',
  'invite-teammates',
  'workspace-defaults',
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

/** Real state the derivation reads (all gathered from existing repos). */
export interface OnboardingFacts {
  /** Rows in adminium_connections. */
  connectionCount: number;
  /** Any connection has a persisted `settings.includedTables` selection. */
  hasIncludedTables: boolean;
  /** Rows in adminium_users (> 1 ⇒ at least one teammate invited). */
  userCount: number;
  /** A workspace-default appearance/locale override was ever saved. */
  hasWorkspaceDefaults: boolean;
  /**
   * Whether the requester may manage workspace defaults (`system:settings:manage`,
   * i.e. super admin). The "workspace-defaults" step links to `/settings/defaults`,
   * which is super-admin-only, so it is omitted for plain admins — otherwise its
   * CTA is a forbidden dead-end and a step they can never complete.
   */
  canManageWorkspaceDefaults: boolean;
}

export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
}

export interface OnboardingChecklist {
  steps: OnboardingStep[];
  doneCount: number;
  totalCount: number;
  complete: boolean;
}

export function deriveChecklist(facts: OnboardingFacts): OnboardingChecklist {
  const steps: OnboardingStep[] = [
    { key: 'connect-database', done: facts.connectionCount > 0 },
    { key: 'choose-tables', done: facts.hasIncludedTables },
    { key: 'invite-teammates', done: facts.userCount > 1 },
  ];
  // Only super admins can reach /settings/defaults, so the step (and its count)
  // is scoped to them — a plain admin's checklist neither shows nor waits on it.
  if (facts.canManageWorkspaceDefaults) {
    steps.push({ key: 'workspace-defaults', done: facts.hasWorkspaceDefaults });
  }
  const doneCount = steps.reduce((n, step) => (step.done ? n + 1 : n), 0);
  return { steps, doneCount, totalCount: steps.length, complete: doneCount === steps.length };
}
