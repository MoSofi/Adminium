// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The wizard: one section per step, with the comp's rail above them
 * (comp 362–412, 660–667).
 *
 * ─── What a step IS ────────────────────────────────────────────────────────
 *
 * A section. Nothing else changes: the same fields, the same grid, the same
 * controls — the document just draws one section at a time and the rail says
 * which. That is what keeps "wizard" a LAYOUT rather than a second form
 * engine, and it is why turning the preset off gives back the sectioned form
 * with nothing lost.
 *
 * ─── Continue checks before it advances ────────────────────────────────────
 *
 * A wizard that walks a person to the last step and only then says "the second
 * one was wrong" has wasted the walk. Each step's own fields are checked as
 * Continue is pressed, and a refusal that arrives from the SERVER jumps back to
 * the first step holding an error (`RecordForm` owns both, because it owns the
 * values).
 */
import { StepRail } from '@adminium/ui';
import type { ReactNode } from 'react';

export interface WizardLayoutProps {
  steps: { id: string; label?: string | undefined; hint?: string | undefined; intro?: string | undefined; content: ReactNode }[];
  current: number;
  /** Accessible name for the rail (i18n: the caller's). */
  railLabel: string;
  /** Jump straight to a step. Only backwards: forward is Continue's business. */
  onStep: (index: number) => void;
}

export function WizardLayout({ steps, current, railLabel, onStep }: WizardLayoutProps) {
  const step = steps[current];
  return (
    <div className="flex flex-col" data-part="wizard">
      <StepRail
        // The rail sits above the body's padding, edge to edge, as the comp
        // draws it — hence the negative insets against `FormDialogBody`.
        className="-mx-[22px] -mt-5 mb-5"
        steps={steps.map((entry, index) => ({
          label: entry.label ?? String(index + 1),
          ...(entry.hint === undefined ? {} : { hint: entry.hint }),
        }))}
        current={current}
        label={railLabel}
        // Backwards only: a step ahead has not been checked yet, and the rail
        // must not be a way around Continue.
        onStep={(index) => {
          if (index < current) onStep(index);
        }}
      />
      {step === undefined ? null : (
        <section className="flex flex-col gap-3" data-part="wizard-step" data-step={String(current)}>
          {step.intro === undefined ? null : <p className="text-body-sm text-fg-muted">{step.intro}</p>}
          {step.content}
        </section>
      )}
    </div>
  );
}
