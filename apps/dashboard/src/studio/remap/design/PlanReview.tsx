// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Review step.
 *
 * Every step, with its hazard, the reason for that hazard, the facts preflight
 * found, and the exact SQL that will run.
 *
 * ─── Why the SQL is read-only ──────────────────────────────────────────────
 *
 * D14. The moment a user can hand-edit the statement, every guard behind it —
 * the closed type vocabulary, the identifier rules, the refusal catalogue, the
 * privilege preflight — becomes advisory. So it renders as text, not a field.
 *
 * ─── Why the rationale is server copy ──────────────────────────────────────
 *
 * The hazard and its explanation are computed once, per dialect and per server
 * version, in the planner. Re-deriving "this rewrites the table" in the UI
 * would be a second implementation that disagrees the first time a version gate
 * moves. The screen renders what the plan says.
 */
import { Badge, Banner, MonoText } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { Hazard, PlanStep, SchemaPlan } from './types.js';

/** D4's six classes → the tone each is drawn in. */
const HAZARD_TONE: Readonly<Record<Hazard, 'neutral' | 'info' | 'warn' | 'danger'>> = {
  safe: 'neutral',
  locking: 'info',
  rewrite: 'warn',
  lossy: 'danger',
  irreversible: 'danger',
  refused: 'danger',
};

function hazardLabel(hazard: Hazard): string {
  switch (hazard) {
    case 'safe':
      return t('studio:design.hazard.safe', 'Safe');
    case 'locking':
      return t('studio:design.hazard.locking', 'Holds a lock');
    case 'rewrite':
      return t('studio:design.hazard.rewrite', 'Rewrites the table');
    case 'lossy':
      return t('studio:design.hazard.lossy', 'Discards data');
    case 'irreversible':
      return t('studio:design.hazard.irreversible', 'Cannot be undone');
    case 'refused':
      return t('studio:design.hazard.refused', 'Refused');
  }
}

export interface PlanReviewProps {
  plan: SchemaPlan;
}

export function PlanReview({ plan }: PlanReviewProps) {
  if (plan.steps.length === 0 && plan.refusals.length === 0) {
    return (
      <p className="text-body-sm text-fg-muted">
        {t('studio:design.review.noChanges', 'No schema changes yet.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {plan.unfinished !== null ? (
        <Banner tone="warn" role="alert">
          {t(
            'studio:design.review.unfinished',
            'A previous apply on this connection never reported an outcome. Its schema may be part-way between two shapes — check the change history before applying more.',
          )}
        </Banner>
      ) : null}

      {plan.refusals.length > 0 ? (
        <Banner tone="danger" role="alert">
          <span className="flex flex-col gap-1">
            {plan.refusals.map((refusal, index) => (
              <span key={`${refusal.code}-${index}`}>{refusal.message}</span>
            ))}
          </span>
        </Banner>
      ) : null}

      {plan.warnings.map((warning, index) => (
        <Banner key={index} tone="info">
          {warning.message}
        </Banner>
      ))}

      <ol className="flex flex-col gap-3" aria-label={t('studio:design.review.steps', 'Planned steps')}>
        {plan.steps.map((step, index) => (
          <StepCard key={step.id} step={step} index={index + 1} />
        ))}
      </ol>
    </div>
  );
}

function StepCard({ step, index }: { step: PlanStep; index: number }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm text-fg-muted">{index}</span>
        <span className="text-body font-medium text-fg">{step.summary}</span>
        <Badge tone={HAZARD_TONE[step.hazard]}>{hazardLabel(step.hazard)}</Badge>
        {step.requiresSuperAdmin ? (
          <Badge tone="danger">
            {t('studio:design.review.superAdmin', 'Super Admin')}
          </Badge>
        ) : null}
      </div>

      <p className="mt-1 text-body-sm text-fg-muted">{step.rationale}</p>

      {step.consequences.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {step.consequences.map((consequence, i) => (
            <li key={i} className="text-body-sm text-fg">
              {consequence.message}
              {consequence.refs.length > 0 ? (
                <span className="text-fg-muted"> — {consequence.refs.join(', ')}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {step.sql.length > 0 ? (
        <div className="mt-2">
          {/* Read-only by design (D14): an editable statement makes every guard
              behind it advisory. This is also the exact text that will run — the
              plan compiles it with the same function the apply executes. */}
          <MonoText className="block whitespace-pre-wrap break-all text-body-sm">
            {step.sql.join(';\n')}
          </MonoText>
        </div>
      ) : null}
    </li>
  );
}
