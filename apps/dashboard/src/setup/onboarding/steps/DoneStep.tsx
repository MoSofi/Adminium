// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 6 — you're all set (comp step "All set").
 *
 * THE COMP CLAIMS MORE THAN THIS WIZARD DOES. It ends on "We generated 6
 * dashboards from your schema", and generation has not run: 45 R4 hands tables,
 * enrich and generate to the Studio's connect wizard, which is the next thing
 * this person sees. So the summary states what actually happened and what is
 * about to — anything else would be a wizard congratulating itself for work it
 * has not done (DEP-22).
 *
 * ON AN INSTANCE THAT WAS ALREADY CONNECTED it is the other way round: the
 * server connected the project's database and generated its pages on boot,
 * before the wizard opened (walkthrough finding V7). The summary then reads
 * what is there, from the connections list, rather than saying nothing was
 * generated.
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

/** A database that was connected before the wizard opened, as the hub lists it. */
export interface ConnectedDatabase {
  name: string;
  status: string;
  /** `null` before its schema was read. */
  tableCount: number | null;
  pageCount: number;
}

export interface DoneStepProps {
  connection: LandedConnection | null;
  /**
   * Set only when the wizard opened on an instance that already had a database
   * (empty while the list loads); absent on every other path.
   */
  connectedDatabases?: readonly ConnectedDatabase[] | undefined;
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

function databaseLines(database: ConnectedDatabase): string[] {
  const name = database.name;
  if (database.status !== 'connected') {
    return [
      t(
        'onboarding:done.database.failed',
        '“{name}” could not be reached. Fix its address and restart Adminium.',
        { name },
      ),
    ];
  }
  const lines = [
    database.tableCount === null
      ? t('onboarding:done.database.connected', '“{name}” connected.', { name })
      : t(
          'onboarding:done.database.tables',
          '“{name}” connected · {count, plural, one {# table} other {# tables}}.',
          { name, count: database.tableCount },
        ),
  ];
  if (database.pageCount > 0) {
    lines.push(
      t(
        'onboarding:done.database.pages',
        '{count, plural, one {# page} other {# pages}} generated from “{name}”.',
        { name, count: database.pageCount },
      ),
    );
  }
  return lines;
}

export function DoneStep({
  connection,
  connectedDatabases,
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

  for (const database of connectedDatabases ?? []) lines.push(...databaseLines(database));

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
  const generated = (connectedDatabases ?? []).some((database) => database.pageCount > 0);

  let next: string;
  if (connectedDatabases !== undefined && connectedDatabases.length === 0) {
    // The list is still loading (or could not be read): claim nothing either way.
    next = t('onboarding:done.next.ready', 'Your workspace is ready.');
  } else if (connectedDatabases !== undefined) {
    next = generated
      ? t(
          'onboarding:done.next.connected',
          'Your workspace is ready. The pages made from your database are on the dashboard.',
        )
      : t(
          'onboarding:done.next.connectedNoPages',
          'Your workspace is ready. Your database is connected; add pages from Studio whenever you are.',
        );
  } else if (generating) {
    next = t(
      'onboarding:done.next.generate',
      'Your workspace is ready. Next we will pick the tables to include and generate your pages.',
    );
  } else {
    next = t(
      'onboarding:done.next.blank',
      'Your workspace is ready. Add a page whenever you are — nothing was generated, exactly as you asked.',
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center text-center">
        {/* The comp's hero (84): a 64px tile, 18px radius, 18px beneath it. */}
        <span className="mb-[18px] flex size-16 items-center justify-center rounded-[18px] bg-pos-soft text-pos">
          <PartyPopper className="size-8" />
        </span>
        <p className="max-w-[40ch] text-[15px] leading-[1.6] text-fg-muted">{next}</p>
      </div>

      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2 text-[13px] text-fg-muted">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-pos" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <TelemetryConsent value={consent} onChange={onConsentChange} />
    </div>
  );
}
