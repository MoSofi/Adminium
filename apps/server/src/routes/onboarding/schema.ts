// SPDX-License-Identifier: AGPL-3.0-only
/** Zod schemas for the onboarding-state resource (M5-T06). */

import { z } from 'zod';

const onboardingStepView = z.object({
  key: z.string(),
  done: z.boolean(),
});

export const onboardingReply = z.object({
  data: z.object({
    checklist: z.object({
      steps: z.array(onboardingStepView),
      doneCount: z.number().int().min(0),
      totalCount: z.number().int().min(0),
      complete: z.boolean(),
    }),
    /** Per-user dismissal of the proactive surface (persisted in user prefs). */
    dismissed: z.boolean(),
  }),
});
export type OnboardingReply = z.infer<typeof onboardingReply>;

export const onboardingDismissBody = z.object({
  dismissed: z.boolean().default(true),
});
export type OnboardingDismissBody = z.infer<typeof onboardingDismissBody>;
