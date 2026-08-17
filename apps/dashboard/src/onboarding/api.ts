// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Onboarding client (M5-T06) — thin typed wrappers over the onboarding-state
 * endpoints. Shapes mirror the server Zod reply
 * (`apps/server/src/routes/onboarding/schema.ts`); the copied-mirror
 * convention from app/bootstrap.ts applies — change both together.
 */

import { api } from '../app/api.js';

export interface OnboardingStep {
  /** Stable step id (matches the server `OnboardingStepKey`). */
  key: string;
  done: boolean;
}

export interface OnboardingChecklist {
  steps: OnboardingStep[];
  doneCount: number;
  totalCount: number;
  complete: boolean;
}

export interface OnboardingState {
  checklist: OnboardingChecklist;
  /** Per-user dismissal of the proactive surface. */
  dismissed: boolean;
}

export const onboardingApi = {
  get: async (): Promise<OnboardingState> =>
    (await api.get<{ data: OnboardingState }>('/api/v1/onboarding')).data,

  dismiss: async (dismissed = true): Promise<OnboardingState> =>
    (await api.post<{ data: OnboardingState }>('/api/v1/onboarding/dismiss', { dismissed })).data,
};
