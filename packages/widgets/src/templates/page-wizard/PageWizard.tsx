// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-wizard` template (04 §10 archetype 12; 09-generated-app.md §11.1) —
 * the stepped-flow shell the Import Wizard (and future guided flows) mounts
 * in: a numbered step rail, the active step's content region, and a footer
 * slot for the host's Back/Next controls.
 *
 * PRESENTATIONAL AND HOST-DRIVEN, the PageCrud discipline: the template owns
 * layout and step affordances only. Which step is active, what each step
 * renders (upload-dropzone, column-mapping-table, validation-issues-list,
 * progress-bar — the §11.1 composition), and whether Next is allowed are the
 * HOST's decisions, flowing in as props; the template never fetches, never
 * validates, never imports. Step states derive from order (before active =
 * done) unless the host overrides one (`error` on a failed run).
 *
 * RTL-safe by construction: logical properties only (ms/me/ps/pe, start/end);
 * tones come from the design tokens (zero hex).
 */
import { cn } from '@adminium/ui';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

export const PAGE_WIZARD_TEMPLATE_ID = 'page-wizard';

export interface WizardStepDef {
  id: string;
  label: string;
  description?: string | undefined;
}

export type WizardStepState = 'todo' | 'active' | 'done' | 'error';

export interface PageWizardProps {
  steps: readonly WizardStepDef[];
  activeStepId: string;
  /** Host overrides per step id (e.g. `error` after a failed run). */
  stepStates?: Readonly<Partial<Record<string, WizardStepState>>> | undefined;
  /**
   * Revisit handler — DONE steps render as buttons wired here; todo steps are
   * never clickable (a wizard cannot be fast-forwarded).
   */
  onSelectStep?: ((stepId: string) => void) | undefined;
  /** The active step's content (the host composes the §11.1 widgets here). */
  children?: ReactNode;
  /** Host-owned navigation (Back / Next / Run import…). */
  footer?: ReactNode;
  testId?: string | undefined;
}

/** Order-derived state with host override (exported for the host + tests). */
export function wizardStepState(
  steps: readonly WizardStepDef[],
  activeStepId: string,
  stepId: string,
  overrides?: Readonly<Partial<Record<string, WizardStepState>>>,
): WizardStepState {
  const override = overrides?.[stepId];
  if (override !== undefined) return override;
  const activeIndex = steps.findIndex((step) => step.id === activeStepId);
  const index = steps.findIndex((step) => step.id === stepId);
  if (index === -1) return 'todo';
  if (index === activeIndex) return 'active';
  return index < activeIndex ? 'done' : 'todo';
}

const BUBBLE_TONE: Record<WizardStepState, string> = {
  done: 'border-accent bg-accent text-accent-fg',
  active: 'border-accent bg-accent-soft text-accent',
  todo: 'border-border bg-surface text-fg-subtle',
  error: 'border-danger bg-danger-soft text-danger',
};

export function PageWizard({
  steps,
  activeStepId,
  stepStates,
  onSelectStep,
  children,
  footer,
  testId,
}: PageWizardProps) {
  return (
    <div data-template="page-wizard" data-testid={testId} className="flex h-full flex-col gap-4">
      {/* --- step rail ------------------------------------------------------- */}
      <ol data-part="wizard-rail" className="flex flex-wrap items-center gap-2" role="list">
        {steps.map((step, index) => {
          const state = wizardStepState(steps, activeStepId, step.id, stepStates);
          const clickable = state === 'done' && onSelectStep !== undefined;
          const bubble = (
            <span
              aria-hidden
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-bold',
                BUBBLE_TONE[state],
              )}
            >
              {state === 'done' ? <Check className="size-3.5" /> : index + 1}
            </span>
          );
          const label = (
            <span
              className={cn(
                'text-body-sm font-medium',
                state === 'active' ? 'text-fg' : state === 'error' ? 'text-danger' : 'text-fg-muted',
              )}
            >
              {step.label}
            </span>
          );
          return (
            <li
              key={step.id}
              data-part="wizard-step"
              data-step={step.id}
              data-state={state}
              aria-current={state === 'active' ? 'step' : undefined}
              className="flex items-center gap-2"
            >
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onSelectStep(step.id)}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-surface-2"
                >
                  {bubble}
                  {label}
                </button>
              ) : (
                <span className="flex items-center gap-2 px-1.5 py-1">
                  {bubble}
                  {label}
                </span>
              )}
              {index < steps.length - 1 ? (
                <span aria-hidden className="h-px w-6 shrink-0 bg-border" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* --- active step ------------------------------------------------------ */}
      {((): ReactNode => {
        const active = steps.find((step) => step.id === activeStepId);
        if (active?.description === undefined) return null;
        return (
          <p data-part="wizard-description" className="text-body-sm text-fg-muted">
            {active.description}
          </p>
        );
      })()}
      <div data-part="wizard-body" className="min-h-0 flex-1">
        {children}
      </div>

      {/* --- host navigation --------------------------------------------------- */}
      {footer !== undefined ? (
        <div data-part="wizard-footer" className="flex items-center justify-end gap-2 border-t border-border pt-3">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
