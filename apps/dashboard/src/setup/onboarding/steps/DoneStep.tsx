// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 6 — you're all set (45-onboarding.md §2, comp step "All set").
 *
 * THE COMP CLAIMS MORE THAN THIS WIZARD DOES. It ends on "We generated 6
 * dashboards from your schema", and generation has not run: 45 R4 hands tables,
 * enrich and generate to the Studio's connect wizard, which is the next thing
 * this person sees. So the summary states what actually happened and what is
 * about to — anything else would be a wizard congratulating itself for work it
 * has not done (DEP-22).
 *
 * The consent answers live here (DEP-5). The comp leaves this screen nearly
 * empty and today's `FirstRunWizard` asks for them on a screen of their own;
 * dropping them because a mock has no box for them would quietly remove a
 * question this product asks on purpose.
 */
import { PartyPopper } from 'lucide-react';
import { CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '../../../i18n/t.js';
import { TelemetryConsent } from '../../TelemetryConsent.js';
import type { SetupConsent } from '../../setupApi.js';
import type { LandedConnection } from '../submitHeldAnswers.js';
import type { StorageChoice } from './StorageStep.js';
import type { OnboardingStart } from '../heldAnswers.js';

export interface DoneStepProps {
  connection: LandedConnection | null;
  storage: StorageChoice;
  start: OnboardingStart;
  invitedCount: number;
  consent: SetupConsent;
  onConsentChange: (consent: SetupConsent) => void;
}

function storageLine(storage: StorageChoice): string {
  switch (storage) {
    case 'same-db':
      return t(
        'onboarding:done.storage.sameDb',
        'Adminium keeps its own data in the database you connected.',
      );
    case 'separate':
      return t(
        'onboarding:done.storage.separate',
        'Adminium keeps its own data in the database you gave it.',
      );
    default:
      return t(
        'onboarding:done.storage.local',
        'Adminium keeps its own data in a file on this machine.',
      );
  }
}

export function DoneStep({
  connection,
  storage,
  start,
  invitedCount,
  consent,
  onConsentChange,
}: DoneStepProps): ReactNode {
  const lines: string[] = [];

  if (connection !== null) {
    lines.push(
      connection.tableCount === null
        ? t(
            'onboarding:done.connected.reading',
            'Connected — Adminium is reading your schema now.',
          )
        : t(
            'onboarding:done.connected.tables',
            'Connected · {count, plural, one {# table} other {# tables}} found.',
            { count: connection.tableCount },
          ),
    );
  }

  lines.push(storageLine(storage));

  if (invitedCount > 0) {
    lines.push(
      t(
        'onboarding:done.invited',
        '{count, plural, one {# invitation} other {# invitations}} created.',
        { count: invitedCount },
      ),
    );
  }

  const generating = connection !== null && start !== 'blank';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-[18px] bg-pos-soft text-pos">
          <PartyPopper className="size-8" />
        </span>
        <p className="max-w-[40ch] text-body text-fg-muted">
          {generating
            ? t(
                'onboarding:done.next.generate',
                'Your workspace is ready. Next we will pick the tables to include and generate your pages.',
              )
            : t(
                'onboarding:done.next.blank',
                'Your workspace is ready. Add a page whenever you are — nothing was generated, exactly as you asked.',
              )}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2 text-body-sm text-fg-muted">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-pos" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <TelemetryConsent value={consent} onChange={onConsentChange} />
    </div>
  );
}
