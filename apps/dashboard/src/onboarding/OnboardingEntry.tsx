/**
 * Onboarding entry (M5-T06): the proactive surfacing of the setup checklist
 * for admins. Mounted by StudioSettingsPage (/studio/settings) only — not
 * shell-global — so it never competes for attention on other routes.
 *
 * - Incomplete & not dismissed → a dismissible Banner ("Finish setting up…"),
 *   the "shows it for admins until complete" surface. Dismissal persists per
 *   user (server writes it to user prefs).
 * - Dismissed, complete, or non-admin → nothing, permanently (no fallback
 *   "way back" affordance once dismissed).
 */

import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Compass } from 'lucide-react';
import { Banner, Button } from '@adminium/ui';

import type { BootstrapData } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { useOnboarding } from './useOnboarding.js';

export function OnboardingEntry({ bootstrap }: { bootstrap: BootstrapData }): ReactNode {
  const navigate = useNavigate();
  const { state, dismiss } = useOnboarding(bootstrap);

  // Nothing to surface: not an admin (query disabled → no data), still
  // loading, already complete, or dismissed.
  if (state === undefined || state.checklist.complete || state.dismissed) {
    return null;
  }

  const { doneCount, totalCount } = state.checklist;

  return (
    <Banner
      tone="info"
      icon={<Compass />}
      onDismiss={() => dismiss(true)}
      dismissLabel={t('onboarding.entry.dismiss', 'Dismiss setup checklist')}
      action={
        <Button size="sm" variant="secondary" onClick={() => void navigate({ to: '/welcome' })}>
          {t('onboarding.entry.continue', 'Continue setup')}
        </Button>
      }
    >
      {t('onboarding.entry.banner', 'Finish setting up your workspace — {done} of {total} steps done.', {
        done: doneCount,
        total: totalCount,
      })}
    </Banner>
  );
}
