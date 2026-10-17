// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Onboarding entry: the proactive surfacing of the setup checklist for
 * admins. Mounted by StudioSettingsPage (/studio/settings) only — not
 * shell-global — so it never competes for attention on other routes.
 *
 * - Incomplete & not dismissed → a dismissible Banner ("Finish setting up…"),
 *   the "shows it for admins until complete" surface. Dismissal persists per
 *   user (server writes it to user prefs).
 * - Dismissed, complete, or non-admin → nothing, permanently (no fallback
 *   "way back" affordance once dismissed).
 */

import { useNavigate } from '@tanstack/react-router';
import { Suspense, type ReactNode } from 'react';
import { Compass } from 'lucide-react';
import { Banner, Button } from '@adminium/ui';

import type { BootstrapData } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { useOnboarding } from './useOnboarding.js';

export function OnboardingEntry({ bootstrap }: { bootstrap: BootstrapData }): ReactNode {
  const navigate = useNavigate();
  const { state, dismiss } = useOnboarding(bootstrap);

  // Nothing to surface: not an admin (query disabled → no data), still
  // loading, already complete, or dismissed.
  if (state === undefined || state.checklist.complete || state.dismissed) {
    return null;
  }

  // The banner's words load when there is a banner to draw, not with the first paint and not with a
  // settings page that shows none: the page round it is drawn meanwhile.
  return (
    <Suspense fallback={null}>
      <EntryBanner done={state.checklist.doneCount} total={state.checklist.totalCount} onDismiss={() => dismiss(true)} onContinue={() => void navigate({ to: '/welcome' })} />
    </Suspense>
  );
}

function EntryBanner({ done, total, onDismiss, onContinue }: { done: number; total: number; onDismiss: () => void; onContinue: () => void }): ReactNode {
  useCommonWords();
  return (
    <Banner
      tone="info"
      icon={<Compass />}
      onDismiss={onDismiss}
      dismissLabel={t('onboarding.entry.dismiss', 'Dismiss setup checklist')}
      action={
        <Button size="sm" variant="secondary" onClick={onContinue}>
          {t('onboarding.entry.continue', 'Continue setup')}
        </Button>
      }
    >
      {t('onboarding.entry.banner', 'Finish setting up your workspace — {done} of {total} steps done.', {
        done,
        total,
      })}
    </Banner>
  );
}
