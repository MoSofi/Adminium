// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-run wizard's chrome, from `designs/Onboarding.dc.html`
 * (45-onboarding.md §2): a 300px rail carrying the step list and a progress
 * bar, and a centred 560px column carrying kicker, title, description, the
 * step's own body and the Back / Skip / Continue row.
 *
 * PRESENTATIONAL ON PURPOSE. It owns no step state and no submit: which step
 * is showing, what "Continue" does and whether it may be pressed all belong to
 * the container, because from step 3 onward those answers depend on a session
 * this component knows nothing about (45 R1). Everything here is the frame.
 *
 * WHY NOT `AuthScreenLayout`. That layout is the brand panel plus a 380px form
 * column, which is right for `/login` and cannot hold a rail. This is the one
 * screen that earns its own composition — but it keeps the same document-title
 * rule (the product name alone: at first run there is nothing to tell apart)
 * and the same theme control, in the corner the comp draws it in.
 */
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, ProgressBar, Stepper } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { BrandMark } from '../../shell/BrandMark.js';
import { ThemeToggleButton } from '../../auth/AuthScreenLayout.js';
import { useDocumentPageTitle } from '../../shell/documentTitle.js';
import {
  onboardingStepDefs,
  progressPercent,
  stepBefore,
  stepIndexOf,
  type OnboardingStepId,
} from './wizardState.js';

export interface OnboardingWizardProps {
  step: OnboardingStepId;
  /**
   * Rail navigation. The kit's `Stepper` only makes done and active rows
   * clickable, so this can never jump FORWARD past an unanswered step.
   */
  onStepSelect?: ((step: OnboardingStepId) => void) | undefined;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
  /** Overrides the default Continue / Go to dashboard label. */
  nextLabel?: string | undefined;
  nextDisabled?: boolean | undefined;
  /** Continue shows a spinner and the rail stops responding. */
  busy?: boolean | undefined;
  /** Rendered above the step body, in the comp's own error slot. */
  error?: string | null | undefined;
  /** The step's own body. */
  children: ReactNode;
}

export function OnboardingWizard({
  step,
  onStepSelect,
  onBack,
  onSkip,
  onNext,
  nextLabel,
  nextDisabled = false,
  busy = false,
  error = null,
  children,
}: OnboardingWizardProps) {
  // The product name alone — see the module note.
  useDocumentPageTitle(null);

  const defs = onboardingStepDefs();
  const index = stepIndexOf(step);
  const def = defs[index];
  if (def === undefined) throw new Error(`unknown onboarding step: ${step}`);

  const last = index === defs.length - 1;
  const percent = progressPercent(step);

  return (
    <div className="flex min-h-screen w-full bg-bg text-fg">
      {/*
        The comp draws one viewport: a 300px rail beside a 560px column, which
        needs ~900px and has nothing below it. Hiding the rail under `md` is the
        minimal answer: the column keeps the whole width, and the kicker already
        reads "Step 3 of 6" — the same fact the bar carries — so a narrow screen
        loses the step LIST without ever losing where it is. A second progress
        bar down here would only put two of them in the accessibility tree.
      */}
      <div className="hidden w-[300px] shrink-0 flex-col border-e border-border bg-surface px-7 py-8 md:flex">
        <BrandMark className="mb-9" />

        <Stepper
          orientation="vertical"
          label={t('onboarding:progressLabel', 'Setup progress')}
          activeIndex={index}
          steps={defs.map((entry) => ({
            id: entry.id,
            label: entry.label,
            description: entry.description,
          }))}
          {...(onStepSelect === undefined || busy
            ? {}
            : {
                onStepClick: (clicked: number) => {
                  const target = defs[clicked];
                  if (target !== undefined) onStepSelect(target.id);
                },
              })}
        />

        <div className="mt-auto flex flex-col gap-2 pt-6">
          <ProgressBar
            value={percent}
            label={t('onboarding:progressLabel', 'Setup progress')}
          />
          <span className="text-caption text-fg-subtle">
            {t('onboarding:progressComplete', '{percent}% complete', { percent })}
          </span>
        </div>
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="absolute end-6 top-6 z-[2]">
          <ThemeToggleButton />
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto p-10">
          {/* Keyed on the step so each screen fades in as the comp's does. */}
          <div
            key={step}
            className="w-full max-w-[560px] animate-[nb-fade_.3s_cubic-bezier(.2,.7,.3,1)]"
          >
            <p className="text-micro uppercase text-accent">{def.kicker}</p>
            <h1 className="mt-2 text-title text-fg">{def.title}</h1>
            {def.body === '' ? null : (
              <p className="mt-1.5 text-body leading-[1.55] text-fg-muted">{def.body}</p>
            )}

            {error === null || error === undefined ? null : (
              <Alert className="mt-5" tone="danger" role="alert" title={error} />
            )}

            <div className="mt-6">{children}</div>

            <div className="mt-8 flex items-center gap-3">
              {stepBefore(step) === null ? null : (
                <Button variant="outline" size="lg" onClick={onBack} disabled={busy}>
                  {t('onboarding:back', 'Back')}
                </Button>
              )}
              <div className="ms-auto flex items-center gap-3">
                {def.skippable ? (
                  <Button variant="ghost" size="lg" onClick={onSkip} disabled={busy}>
                    {t('onboarding:skip', 'Skip')}
                  </Button>
                ) : null}
                <Button size="lg" onClick={onNext} loading={busy} disabled={nextDisabled}>
                  {nextLabel ??
                    (last
                      ? t('onboarding:finish', 'Go to dashboard')
                      : t('onboarding:continue', 'Continue'))}
                  {last ? (
                    <ArrowUpRight className="size-4" />
                  ) : (
                    <ArrowRight className="size-4 rtl:-scale-x-100" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
