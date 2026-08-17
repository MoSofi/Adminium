/**
 * /welcome — the first-run workspace-onboarding surface (M5-T06; ports
 * Onboarding.dc.html + Workspace Onboarding.dc.html). Keepers:
 * the REACTIVE checklist (each step's ✓ comes from real workspace state, server
 * -derived) and the progress ring. Personalized welcome + per-task minute
 * estimates are the sample-domain microcopy keepers (research/ia-mapping.md §4).
 *
 * Admin-only: the server guards the state with `system:connections:manage`;
 * this mirrors that client-side and renders the 403 state for anyone else.
 */

import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Icon, IconTile, Spinner } from '@adminium/ui';

import { bootstrapQuery, type BootstrapData } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { StatePage } from '../states/StatePage.js';
import { ProgressRing } from './ProgressRing.js';
import { isOnboardingAdmin, useOnboarding } from './useOnboarding.js';
import { stepMeta, type OnboardingStepMeta } from './steps.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import type { OnboardingStep } from './api.js';

function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first === undefined || first === '' ? fullName : first;
}

function StepRow({
  step,
  meta,
  onAction,
}: {
  step: OnboardingStep;
  meta: OnboardingStepMeta;
  onAction: (target: OnboardingStepMeta['target']) => void;
}): ReactNode {
  return (
    <li
      data-part="onboarding-step"
      data-step={meta.key}
      data-done={step.done}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5"
    >
      <IconTile
        tone={step.done ? 'pos' : 'accent'}
        size="md"
        icon={<Icon name={step.done ? 'Check' : meta.icon} aria-hidden />}
      />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-fg">{t(meta.titleKey, meta.titleFallback)}</p>
        <p className="truncate text-body-sm text-fg-muted">{t(meta.descKey, meta.descFallback)}</p>
      </div>
      {step.done ? (
        <Badge tone="pos">
          <Check aria-hidden className="me-1 size-3" />
          {t('onboarding.done', 'Done')}
        </Badge>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-caption text-fg-subtle">{t(meta.timeKey, meta.timeFallback)}</span>
          {meta.target !== undefined ? (
            <Button size="sm" variant="secondary" onClick={() => onAction(meta.target)}>
              {t(meta.actionKey, meta.actionFallback)}
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

function OnboardingBody({ bootstrap }: { bootstrap: BootstrapData }): ReactNode {
  const navigate = useNavigate();
  const { state, isLoading, dismiss, isDismissing } = useOnboarding(bootstrap);

  const goTo = (target: OnboardingStepMeta['target']): void => {
    if (target !== undefined) void navigate({ to: target });
  };

  const skip = (): void => {
    dismiss(true);
    void navigate({ to: '/' });
  };

  if (isLoading || state === undefined) {
    return (
      <div className="flex items-center justify-center p-16">
        <Spinner label={t('onboarding.loading', 'Loading your setup checklist…')} />
      </div>
    );
  }

  const { checklist } = state;

  return (
    <PageSurface width="narrow" className="flex flex-col gap-6">
      <PageActions
        title={t('onboarding.title', 'Getting started')}
        subtitle={t('onboarding.subtitle', 'A few steps to get your workspace ready.')}
      />

      <Card>
        <CardHeader className="flex items-center gap-5">
          <ProgressRing
            done={checklist.doneCount}
            total={checklist.totalCount}
            locale={bootstrap.prefs.locale}
            ariaLabel={t('onboarding.ringLabel', '{done} of {total} steps complete', {
              done: checklist.doneCount,
              total: checklist.totalCount,
            })}
          />
          <div className="min-w-0">
            <h3 className="text-section text-fg">
              {t('onboarding.welcome', 'Welcome to Adminium, {name} 👋', {
                name: firstName(bootstrap.user.name),
              })}
            </h3>
            <p className="mt-1 text-body-sm text-fg-muted">
              {checklist.complete
                ? t('onboarding.completeBody', "You're all set — your workspace is fully configured.")
                : t(
                    'onboarding.progressBody',
                    "You've completed {done} of {total} setup steps. Finish the rest to unlock the full workspace.",
                    { done: checklist.doneCount, total: checklist.totalCount },
                  )}
            </p>
          </div>
        </CardHeader>
        <CardBody>
          <ul className="flex flex-col gap-2.5">
            {checklist.steps.map((step) => {
              const meta = stepMeta(step.key);
              if (meta === undefined) return null;
              return <StepRow key={step.key} step={step} meta={meta} onAction={goTo} />;
            })}
          </ul>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-body font-semibold text-fg">{t('onboarding.help.title', 'Need a hand?')}</p>
          <p className="text-body-sm text-fg-muted">
            {t('onboarding.help.body', "We're here to help you get set up fast.")}
          </p>
        </div>
        {checklist.complete ? (
          <Button onClick={() => void navigate({ to: '/' })}>
            {t('onboarding.goToWorkspace', 'Go to workspace')}
          </Button>
        ) : (
          <Button variant="ghost" onClick={skip} loading={isDismissing}>
            {t('onboarding.skip', 'Skip for now')}
          </Button>
        )}
      </div>
    </PageSurface>
  );
}

export function OnboardingChecklist(): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  if (!isOnboardingAdmin(bootstrap.roles)) {
    return <StatePage stateId="forbidden" fullPage={false} />;
  }
  return <OnboardingBody bootstrap={bootstrap} />;
}
