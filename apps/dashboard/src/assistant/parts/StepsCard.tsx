// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the assistant actually did, while it is doing it.
 *
 * Each row is one tool call: it appears when the call is issued and completes
 * when the executor returns. The tables a step read are chips on the row, so
 * "where did this number come from" is answered on the screen rather than in
 * a log — that is most of why this card exists at all.
 *
 * DEP: the comp's badge reads *step N of M*. The total is not knowable while
 * the work runs — the model decides how many tools to call as it goes — so
 * the badge reads *step N* until the turn stops, then *done* or *failed*.
 * Claiming a total we do not have would be a progress bar that lies.
 */
import { cn } from '@adminium/ui';
import { Check } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { AssistantContext } from '../api.js';
import { pageReadStep } from '../contexts.js';
import { stepIcon } from '../icons.js';
import type { LiveStep } from '../useTurnProgress.js';

export interface StepsCardProps {
  /** The card's title: *Working on it* while it runs, the work's name after. */
  title: string;
  steps: readonly LiveStep[];
  state: 'working' | 'done' | 'failed';
  /** Which page this turn ran on — the page-read step's sentence is per-page. */
  context: AssistantContext;
}

export function StepsCard({ title, steps, state, context }: StepsCardProps) {
  const working = state === 'working';
  return (
    <div data-testid="assistant-steps" data-state={state}>
      <div className="mb-[13px] flex items-center gap-[9px]">
        <span className="text-body-sm font-extrabold text-fg">{title}</span>
        <span
          className={cn(
            'rounded-[20px] px-2 py-[3px] font-mono text-[10.5px] font-bold',
            working && 'bg-accent-soft text-accent',
            state === 'done' && 'bg-pos-soft text-pos',
            state === 'failed' && 'bg-danger-soft text-danger',
          )}
        >
          {working
            ? t('assistant:steps.step', 'step {n}', { n: Math.max(steps.length, 1) })
            : state === 'done'
              ? t('assistant:steps.done', 'done')
              : t('assistant:steps.failed', 'failed')}
        </span>
      </div>
      <ol className="flex list-none flex-col gap-px">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} context={context} />
        ))}
      </ol>
    </div>
  );
}

function StepRow({ step, context }: { step: LiveStep; context: AssistantContext }) {
  const done = step.state === 'done';
  const failed = step.state === 'failed';
  const active = !done && !failed;
  // A finished step is a tick whatever glyph the model chose: what it means is
  // "this happened", and the model's icon described the intention.
  const Icon = done ? Check : stepIcon(step.icon);
  // The page-read step arrives with facts and no sentence; every other step's
  // words are the model's, already in the operator's language.
  const worded = step.facts === undefined ? null : pageReadStep(context, step.facts);
  const label = worded?.label ?? step.label;
  const detail = worded?.detail ?? step.detail;
  return (
    <li className={cn('flex items-start gap-2.5 border-b border-border py-[9px]', active && 'opacity-[.38]')}>
      <span
        className={cn(
          'mt-px flex size-[22px] shrink-0 items-center justify-center rounded-[7px]',
          done && 'bg-pos-soft text-pos',
          failed && 'bg-danger-soft text-danger',
          active && 'bg-accent-soft text-accent',
        )}
      >
        <Icon className={cn('size-[13px]', active && 'animate-pulse')} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-bold leading-[1.35] text-fg">{label}</span>
        {detail === '' ? null : (
          <span className="mt-0.5 block text-caption leading-[1.5] text-fg-muted">{detail}</span>
        )}
        {step.tables.length === 0 ? null : (
          <span className="mt-[7px] flex flex-wrap gap-[5px]">
            {step.tables.map((table) => (
              <span
                key={table}
                className="rounded-sm bg-surface-3 px-2 py-[3px] font-mono text-[10.5px] font-medium text-fg-muted"
              >
                {table}
              </span>
            ))}
          </span>
        )}
      </span>
      {step.note === null ? null : (
        <span
          className={cn(
            'shrink-0 rounded-[20px] px-2 py-[3px] text-[10.5px] font-bold',
            step.note.kind === 'ready' ? 'bg-pos-soft text-pos' : 'bg-warn-soft text-warn',
          )}
        >
          {step.note.kind === 'ready'
            ? t('assistant:steps.note.ready', 'ready')
            : t('assistant:steps.note.warning', '{n, plural, one {# warning} other {# warnings}}', {
                n: step.note.count,
              })}
        </span>
      )}
    </li>
  );
}
