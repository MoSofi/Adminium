// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

export interface StepRailStep {
  /** The step's name: 12.5 / 700 (comp 366). */
  label: ReactNode;
  /** The second line, 10.5 subtle — what this step is for (comp 367). */
  hint?: ReactNode | undefined;
}

export interface StepRailProps extends Omit<ComponentPropsWithRef<'nav'>, 'children'> {
  steps: readonly StepRailStep[];
  /** Zero-based. Everything before it is DONE, and looks the same. */
  current: number;
  /** Accessible name for the rail itself (i18n: no default). */
  label: string;
  /** Jump to a step; absent ⇒ the rail is a display, not a control. */
  onStep?: ((index: number) => void) | undefined;
}

/**
 * StepRail — the wizard's progress band (`designs/Create Dialogs.dc.html`
 * 365–372, 660–667).
 *
 * ─── The number stays ──────────────────────────────────────────────────────
 *
 * A done step keeps its NUMBER and takes the accent, rather than turning into a
 * tick: the comp draws it that way, and it means a person can still say "I am
 * on three of four" when they look back. A tick would also collide with the
 * check the third step's own rows draw.
 *
 * ─── Below 640px, badges only ──────────────────────────────────────────────
 *
 * The labels go and the numbered badges stay (DP11): three labels with hints do
 * not fit a phone-width dialog, and a rail that wraps to three lines is a rail
 * that has eaten the form. `aria-current="step"` carries the same information
 * to a screen reader at every width.
 */
export function StepRail({ steps, current, label, onStep, className, ...props }: StepRailProps) {
  return (
    <nav
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-5 border-b border-border bg-surface-2 px-[22px] py-3.5', className)}
      {...props}
    >
      <ol className="flex flex-wrap items-center gap-5">
        {steps.map((step, index) => {
          const done = index <= current;
          const inner = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold',
                  done ? 'bg-accent text-accent-fg' : 'bg-surface text-fg-subtle ring-1 ring-border',
                )}
              >
                {index + 1}
              </span>
              <span className="hidden min-w-0 flex-col sm:flex">
                <span className="text-[12.5px] font-bold text-fg">{step.label}</span>
                {step.hint === undefined ? null : (
                  <span className="text-[10.5px] text-fg-subtle">{step.hint}</span>
                )}
              </span>
            </>
          );
          return (
            <li key={index} {...(index === current ? { 'aria-current': 'step' as const } : {})}>
              {onStep === undefined ? (
                <span className="flex items-center gap-2">{inner}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onStep(index)}
                  className="nb-ib flex items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
