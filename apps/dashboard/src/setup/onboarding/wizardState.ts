// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The six-step first-run model.
 *
 * WHY SIX, AND IN THIS ORDER. `Onboarding.dc.html` draws five, opening on a
 * profile step this product has no field for (45 DEP-1). What replaced it is
 * the question the owner actually hit on a fresh `npx` install: Adminium keeps
 * a little state of its own, and until now browser mode never asked where it
 * should live — the choice existed only five steps into the connect wizard,
 * behind a source connection (`studio/connect/steps/MetaStep.tsx`).
 *
 * WHY THE ACCOUNT IS THIRD AND NOT FIRST. `start` and `connect` are answered
 * before any account exists, and nothing they collect is written until it does
 * (45 R1): the answers are held in the browser and submitted the moment
 * `POST /setup/super-admin` mints the session it already mints today
 * (`server/src/routes/setup/index.ts:145` — "Land the wizard signed in"). No
 * unauthenticated endpoint is added, which matters on a server that binds
 * 0.0.0.0 by default.
 *
 * This module is pure and holds no React: the order, what may be skipped and
 * what each step is called are decisions, and they are asserted directly.
 */
import { t } from '../../i18n/t.js';

export const ONBOARDING_STEP_IDS = [
  'start',
  'connect',
  'account',
  'meta',
  'team',
  'done',
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

/**
 * Steps a person may pass without answering.
 *
 * `account` is never skippable — it is the hinge the three steps after it need
 * a session from. Nor is `meta`: it opens on the local file that every install
 * already gets, so continuing IS the answer, and offering "Skip" next to a
 * chosen default would imply the default were not one. `done` has nothing to
 * skip past.
 */
const SKIPPABLE: ReadonlySet<OnboardingStepId> = new Set<OnboardingStepId>([
  'start',
  'connect',
  'team',
]);

export interface OnboardingStepDef {
  id: OnboardingStepId;
  /** Rail row. */
  label: string;
  /** Rail row, second line. */
  description: string;
  /** Above the title, e.g. "Step 3 of 6". */
  kicker: string;
  title: string;
  /** Under the title. Empty on `done`, where the body carries the message. */
  body: string;
  skippable: boolean;
}

/**
 * Built per call, never hoisted to a module constant: every string here comes
 * from `t()`, and a constant would freeze the locale that happened to be active
 * when this module was first imported.
 */
export function onboardingStepDefs(): readonly OnboardingStepDef[] {
  const total = ONBOARDING_STEP_IDS.length;
  const kicker = (n: number): string =>
    t('onboarding:kicker', 'Step {n} of {total}', { n, total });

  return [
    {
      id: 'start',
      label: t('onboarding:start.label', 'Starting point'),
      description: t('onboarding:start.sub', 'Pick a shape'),
      kicker: kicker(1),
      title: t('onboarding:start.title', 'What will you build first?'),
      body: t(
        'onboarding:start.body',
        'This only shapes the pages we generate for you. You can change any of it later, or start from nothing.',
      ),
      skippable: SKIPPABLE.has('start'),
    },
    {
      id: 'connect',
      label: t('onboarding:connect.label', 'Connect data'),
      description: t('onboarding:connect.sub', 'Link a database'),
      kicker: kicker(2),
      title: t('onboarding:connect.title', 'Connect your database'),
      body: t(
        'onboarding:connect.body',
        'Point Adminium at a data source. We read the schema and never write to it unless you ask.',
      ),
      skippable: SKIPPABLE.has('connect'),
    },
    {
      id: 'account',
      label: t('onboarding:account.label', 'Your account'),
      description: t('onboarding:account.sub', 'Sign in details'),
      kicker: kicker(3),
      title: t('onboarding:account.title', 'Create your account'),
      body: t(
        'onboarding:account.body',
        'The first administrator. This happens once, and you stay signed in afterwards.',
      ),
      skippable: SKIPPABLE.has('account'),
    },
    {
      id: 'meta',
      label: t('onboarding:meta.label', 'Adminium’s data'),
      description: t('onboarding:meta.sub', 'Where it lives'),
      kicker: kicker(4),
      title: t('onboarding:meta.title', 'Where Adminium keeps its own data'),
      body: t(
        'onboarding:meta.body',
        'Your login, the pages you generate and your saved settings. That is separate from the database you just connected, which Adminium only reads.',
      ),
      skippable: SKIPPABLE.has('meta'),
    },
    {
      id: 'team',
      label: t('onboarding:team.label', 'Your team'),
      description: t('onboarding:team.sub', 'Add people'),
      kicker: kicker(5),
      title: t('onboarding:team.title', 'Bring your team'),
      body: t(
        'onboarding:team.body',
        'Invite the people you work with. You can always add more later.',
      ),
      skippable: SKIPPABLE.has('team'),
    },
    {
      id: 'done',
      label: t('onboarding:done.label', 'All set'),
      description: t('onboarding:done.sub', 'Start building'),
      kicker: kicker(6),
      title: t('onboarding:done.title', 'You’re all set! 🎉'),
      body: '',
      skippable: SKIPPABLE.has('done'),
    },
  ];
}

export function stepIndexOf(step: OnboardingStepId): number {
  return ONBOARDING_STEP_IDS.indexOf(step);
}

/** The next step, or `null` on the last one — the caller leaves the wizard there. */
export function stepAfter(step: OnboardingStepId): OnboardingStepId | null {
  return ONBOARDING_STEP_IDS[stepIndexOf(step) + 1] ?? null;
}

/** The previous step, or `null` on the first one. */
export function stepBefore(step: OnboardingStepId): OnboardingStepId | null {
  const index = stepIndexOf(step);
  return index <= 0 ? null : (ONBOARDING_STEP_IDS[index - 1] ?? null);
}

export function isSkippable(step: OnboardingStepId): boolean {
  return SKIPPABLE.has(step);
}

/**
 * How full the rail's bar is, 0–100.
 *
 * The step you are ON counts as reached — the comp's `(step + 1) / total`. On
 * the first screen that reads 17%, not 0%, which is the honest number: opening
 * the wizard is progress, and a bar pinned at zero while a person answers the
 * first question reads as broken.
 */
export function progressPercent(step: OnboardingStepId): number {
  return Math.round(((stepIndexOf(step) + 1) / ONBOARDING_STEP_IDS.length) * 100);
}
