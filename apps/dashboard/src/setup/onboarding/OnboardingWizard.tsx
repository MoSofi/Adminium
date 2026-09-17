// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-run wizard's chrome,: a 300px rail carrying the step list and a
 * progress bar, and a centred 560px column carrying kicker, title,
 * description, the step's own body and the Back / Skip / Continue row.
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
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, cn, ProgressBar } from '@adminium/ui';

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
      <div className="hidden w-[300px] shrink-0 flex-col border-e border-border bg-surface px-7 py-[34px] md:flex">
        <BrandMark className="mb-[38px] gap-[11px]" />

        {/*
          The rail, drawn to the comp (34-45): 30px dots, a 13px label over an
          11px second line, 2px between rows. `<ol>` + `aria-current="step"` is
          the kit `Stepper`'s contract, kept — what is not kept is its geometry,
          which is a header stepper's and half a size down from this.
        */}
        <ol
          aria-label={t('onboarding:progressLabel', 'Setup progress')}
          className="flex flex-col gap-0.5"
        >
          {defs.map((entry, position) => {
            const done = position < index;
            const current = position === index;
            const selectable = onStepSelect !== undefined && !busy && (done || current);
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-[30px] shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold',
                    done
                      ? 'bg-accent text-accent-fg'
                      : current
                        ? 'border-[1.5px] border-accent bg-accent-soft text-accent'
                        : 'bg-surface-3 text-fg-subtle',
                  )}
                >
                  {done ? <Check className="size-3.5 stroke-[2.5]" /> : position + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      'truncate text-[13px]',
                      current ? 'font-bold text-fg' : done ? 'font-semibold text-fg' : 'font-semibold text-fg-muted',
                    )}
                  >
                    {entry.label}
                  </span>
                  <span className="truncate text-[11px] text-fg-subtle">{entry.description}</span>
                </span>
              </>
            );
            return (
              <li key={entry.id} {...(current ? { 'aria-current': 'step' as const } : {})}>
                {selectable ? (
                  <button
                    type="button"
                    onClick={() => onStepSelect(entry.id)}
                    className="flex w-full cursor-pointer items-center gap-[13px] rounded-[10px] px-2 py-[11px] text-start transition-colors hover:bg-surface-2"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-[13px] px-2 py-[11px]">{body}</div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-auto flex flex-col gap-2 pt-6">
          <ProgressBar
            className="h-1.5"
            value={percent}
            label={t('onboarding:progressLabel', 'Setup progress')}
          />
          <span className="text-[11.5px] text-fg-subtle">
            {t('onboarding:progressComplete', '{percent}% complete', { percent })}
          </span>
        </div>
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="absolute end-6 top-6 z-[2]">
          <ThemeToggleButton className="size-[38px] rounded-[10px] [&_svg]:size-[17px]" />
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto p-10">
          {/* Keyed on the step so each screen fades in as the comp's does. */}
          <div
            key={step}
            className="w-full max-w-[560px] animate-[nb-fade_.3s_cubic-bezier(.2,.7,.3,1)]"
          >
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-accent">
              {def.kicker}
            </p>
            <h1 className="text-[26px] font-extrabold tracking-[-0.02em] text-fg">{def.title}</h1>
            {def.body === '' ? null : (
              <p className="mt-1.5 text-[14px] leading-[1.55] text-fg-muted">{def.body}</p>
            )}

            {error === null || error === undefined ? null : (
              <Alert className="mt-5" tone="danger" role="alert" title={error} />
            )}

            <div className="mt-[26px]">{children}</div>

            <div className="mt-8 flex items-center gap-3">
              {stepBefore(step) === null ? null : (
                <Button
                  variant="outline"
                  className="h-auto rounded-[11px] px-5 py-3 text-[13.5px] font-bold"
                  onClick={onBack}
                  disabled={busy}
                >
                  {t('onboarding:back', 'Back')}
                </Button>
              )}
              <div className="ms-auto flex items-center gap-3">
                {def.skippable ? (
                  <Button
                    variant="ghost"
                    className="h-auto px-1 py-0 text-[13px] font-bold text-fg-muted"
                    onClick={onSkip}
                    disabled={busy}
                  >
                    {t('onboarding:skip', 'Skip')}
                  </Button>
                ) : null}
                <Button
                  className={cn(
                    'h-auto gap-[7px] rounded-[11px] px-[22px] py-3 text-[13.5px] font-bold',
                    'shadow-[0_2px_10px_color-mix(in_srgb,var(--color-accent)_40%,transparent)]',
                  )}
                  onClick={onNext}
                  loading={busy}
                  disabled={nextDisabled}
                >
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
