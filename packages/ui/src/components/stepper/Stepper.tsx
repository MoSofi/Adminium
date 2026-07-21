import { Check, X } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { MonoText } from '../mono-text/MonoText.js';
import { Spinner } from '../spinner/Spinner.js';

export type StepState = 'pending' | 'active' | 'loading' | 'done' | 'error';

export interface Step {
  id: string;
  label: ReactNode;
  /** Secondary line (vertical/timeline variant). */
  description?: ReactNode;
  /** Explicit state — otherwise derived from `activeIndex`. */
  state?: StepState | undefined;
}

export interface StepperProps extends ComponentPropsWithRef<'ol'> {
  steps: readonly Step[];
  /** Index of the active step; earlier steps derive `done`, later `pending`. */
  activeIndex?: number | undefined;
  orientation?: 'horizontal' | 'vertical' | undefined;
  /**
   * Makes completed/active steps clickable buttons (wizard back-navigation).
   * Pending steps stay non-interactive.
   */
  onStepClick?: ((index: number) => void) | undefined;
  /** Accessible name for the step list (e.g. "Setup progress"). */
  label?: string | undefined;
}

function deriveState(step: Step, index: number, activeIndex: number): StepState {
  if (step.state !== undefined) return step.state;
  if (index < activeIndex) return 'done';
  if (index === activeIndex) return 'active';
  return 'pending';
}

const circleClasses: Record<StepState, string> = {
  pending: 'border border-border-strong bg-surface text-fg-subtle',
  active: 'border-2 border-accent bg-surface text-accent',
  loading: 'border border-border-strong bg-surface text-accent',
  done: 'border border-transparent bg-accent text-accent-fg',
  // text-accent-fg matches the `done` row above: one inverted foreground per
  // theme for every solid fill (white on the dark --danger is only 2.78:1).
  error: 'border border-transparent bg-danger text-accent-fg',
};

const labelClasses: Record<StepState, string> = {
  pending: 'text-fg-subtle',
  active: 'text-fg font-bold',
  loading: 'text-fg font-bold',
  done: 'text-fg-muted',
  error: 'text-danger font-bold',
};

function StepCircle({ state, index }: { state: StepState; index: number }) {
  return (
    <span
      data-part="step-circle"
      data-state={state}
      aria-hidden="true"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-bold transition-colors duration-150',
        circleClasses[state],
      )}
    >
      {state === 'done' ? (
        <Check className="size-3.5 stroke-[2.5]" />
      ) : state === 'error' ? (
        <X className="size-3.5 stroke-[2.5]" />
      ) : state === 'loading' ? (
        <Spinner size="sm" />
      ) : (
        <MonoText>{index + 1}</MonoText>
      )}
    </span>
  );
}

/**
 * Stepper — wizard progress: numbered/spinner/check circles + connectors in
 * `horizontal` (wizard header) and `vertical` (timeline) variants; states
 * pending/active/loading/done/error (research/design-system.md §3 Tier 3).
 * `<ol>` semantics with `aria-current="step"` on the active item.
 */
export function Stepper({
  steps,
  activeIndex = 0,
  orientation = 'horizontal',
  onStepClick,
  label,
  className,
  ...props
}: StepperProps) {
  const vertical = orientation === 'vertical';
  return (
    <ol
      aria-label={label}
      data-orientation={orientation}
      className={cn(vertical ? 'flex flex-col' : 'flex items-center', className)}
      {...props}
    >
      {steps.map((step, index) => {
        const state = deriveState(step, index, activeIndex);
        const clickable = onStepClick !== undefined && state !== 'pending';
        const isLast = index === steps.length - 1;
        const connectorDone = index < activeIndex;

        const content = (
          <>
            <StepCircle state={state} index={index} />
            <span className={cn('min-w-0', vertical ? 'pt-1' : undefined)}>
              <span className={cn('block truncate text-body-sm transition-colors duration-150', labelClasses[state])}>
                {step.label}
              </span>
              {vertical && step.description !== undefined && step.description !== null ? (
                <span className="mt-0.5 block text-caption text-fg-subtle">{step.description}</span>
              ) : null}
            </span>
          </>
        );

        return (
          <li
            key={step.id}
            aria-current={state === 'active' ? 'step' : undefined}
            data-state={state}
            className={cn(
              vertical ? 'relative flex gap-3 pb-6 last:pb-0' : 'flex min-w-0 items-center',
              !vertical && !isLast ? 'flex-1' : undefined,
            )}
          >
            {/* vertical connector */}
            {vertical && !isLast ? (
              <span
                aria-hidden="true"
                data-part="connector"
                className={cn(
                  'absolute bottom-0 start-[13px] top-8 w-px',
                  connectorDone ? 'bg-accent' : 'bg-border',
                )}
              />
            ) : null}
            {clickable ? (
              <button
                type="button"
                onClick={() => onStepClick(index)}
                className={cn(
                  'flex min-w-0 items-center gap-2.5 rounded-md text-start',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                )}
              >
                {content}
              </button>
            ) : (
              <span className={cn('flex min-w-0 gap-2.5', vertical ? undefined : 'items-center')}>{content}</span>
            )}
            {/* horizontal connector */}
            {!vertical && !isLast ? (
              <span
                aria-hidden="true"
                data-part="connector"
                className={cn('mx-3 h-px min-w-4 flex-1', connectorDone ? 'bg-accent' : 'bg-border')}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
