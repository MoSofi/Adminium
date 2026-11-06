// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The review of an app file before it is installed, card by card, and the
 * upload's choice when the app is installed already (drawn from notes). Nothing
 * asks a server: each card is fed its plan, and the bootstrap that says who may
 * apply the look and languages is written into the page's cache.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { makeBootstrap } from '../../test/fixtures.js';
import type { AppInstallPlan, InstancePart, PageClash, StagedApp } from './appsApi.js';
import { UploadRoute } from './InstallAppWizard.js';
import {
  AfterInstallCard,
  ExistingTablesCard,
  InstanceCard,
  NO_INSTANCE_ANSWERS,
  OutsideAddressesCard,
  PageClashesCard,
  RefusalCard,
  ScreensWarning,
  WhereItCameFrom,
  type InstanceAnswers,
  type PageAnswer,
} from './installReview.js';

function Frame({ children, settings = true }: { children: ReactNode; settings?: boolean }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['bootstrap'], makeBootstrap({ systemActions: settings ? ['settings.manage', 'manifests.manage'] : ['manifests.manage'] }));
  return (
    <QueryClientProvider client={client}>
      <div className="flex max-w-[860px] flex-col gap-4 p-6 leading-[normal]">{children}</div>
    </QueryClientProvider>
  );
}

const FINGERPRINT = 'sha512-9f3A7c1eQ2bR8kLmN0pXyZ4vW6tU5sD3fG1hJ2kL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF3gH4iJ5kL6mN7oP8qRw==';
const MADE_AT = { label: 'Fernhill main', savedAt: '2026-11-01T10:00:00.000Z', adminiumVersion: '0.3.49' };

function Source({ typed = '' }: { typed?: string }) {
  const [fingerprint, setFingerprint] = useState(typed);
  return (
    <WhereItCameFrom
      name="Fernhill Ops"
      version="1.0.0"
      madeAt={MADE_AT}
      integrity={FINGERPRINT}
      fingerprint={fingerprint}
      onFingerprint={setFingerprint}
    />
  );
}

/** A plan with 30 tables already here, as a copy of the source database has them. */
function existingPlan(used: boolean, unusable = false): AppInstallPlan {
  const tables = Array.from({ length: 30 }, (_, index) => ({
    ref: `t${String(index)}`,
    table: index === 0 ? 'orders' : `table_${String(index)}`,
    class: 'taken' as const,
    action: used && !(unusable && index === 0) ? ('reuse' as const) : ('undecided' as const),
    offers: ['reuse' as const, 'rename-existing' as const],
    edits: [],
    blocked: [],
    columns: [{ ref: 'id', type: 'int' }],
  }));
  return {
    key: 'fernhill-ops',
    version: '1.0.0',
    installable: !unusable,
    touchesData: true,
    create: [],
    reuse: [],
    references: [],
    problems: unusable
      ? [{ code: 'EXISTING_TABLE_UNUSABLE', table: 't0', message: '"orders" is here already and cannot be used as it is: its column channel is required, and the app never fills it.' }]
      : [],
    requiresSchemaChange: false,
    tables,
  };
}

const CLASHES: PageClash[] = [
  { page: 'orders', title: 'Orders', holder: 'generated', untouched: true, offers: ['replace', 'rename-existing', 'skip'], action: 'undecided' },
  { page: 'customers', title: 'Customers', holder: 'yours', untouched: false, offers: ['rename-existing', 'skip'], action: 'undecided' },
  { page: 'roastery-board', title: 'Roastery board', holder: 'yours', untouched: false, offers: ['rename-existing', 'skip'], action: 'rename-existing', renameTo: 'roastery-board-old' },
];

function Clashes() {
  const [answers, setAnswers] = useState<Record<string, PageAnswer>>({ 'roastery-board': { action: 'rename-existing', to: 'roastery-board-old' } });
  return (
    <PageClashesCard
      clashes={CLASHES}
      answers={answers}
      busy={false}
      onAnswer={(page, answer) =>
        setAnswers((all) => {
          const next = { ...all };
          if (answer === undefined) delete next[page];
          else next[page] = answer;
          return next;
        })
      }
      onRenameTo={(page, to) => setAnswers((all) => ({ ...all, [page]: { action: 'rename-existing', to } }))}
    />
  );
}

const AFTER = [
  { kind: 'webhook' as const, item: 'post-wholesale-orders', field: 'url' },
  { kind: 'address' as const, item: 'weekly-overdue-invoices', field: 'to.addresses' },
  ...['order-confirmed', 'invoice', 'receipt', 'shipped', 'welcome', 'reminder', 'thanks', 'cupping-invite'].map((item) => ({ kind: 'sender' as const, item, field: 'brand.fromEmail' })),
  ...['daily-roasts', 'weekly-sales', 'monthly-stock'].map((item) => ({ kind: 'recipients' as const, item, field: 'recipients' })),
  { kind: 'system-grant' as const, item: 'finance', field: 'system:audit:read' },
  { kind: 'outbound' as const, item: 'thank-new-customers', field: 'mail' },
];

const PART: InstancePart = {
  needs: 'system:settings:manage',
  settings: [{ key: 'branding.accent', from: '#4f46e5', to: '#6b3e26' }],
  files: [{ setting: 'branding.logo', file: 'files/logo.svg', replaces: true }],
  languages: { on: ['en-US', 'de-DE'], off: [] },
  wording: { changed: 12, same: 0 },
  systemEmails: [
    {
      id: 'password-reset/en_US',
      key: 'password-reset',
      locale: 'en-US',
      subject: { from: 'Reset your password', to: 'Reset your Fernhill password' },
      preheaderChanged: false,
      footerChanged: true,
      blocks: { added: ['logo'], removed: [], changed: ['body', 'button'] },
      hosts: ['fernhill.coffee', 'help.fernhill.coffee'],
    },
    {
      id: 'invitation/en_US',
      key: 'invitation',
      locale: 'en-US',
      subject: { from: 'You are invited', to: 'Join Fernhill Coffee Roasters' },
      preheaderChanged: true,
      footerChanged: false,
      blocks: { added: [], removed: [], changed: ['body'] },
      hosts: ['fernhill.coffee'],
    },
  ],
  left: [],
};

function Instance({ settings = true }: { settings?: boolean }) {
  const [answers, setAnswers] = useState<InstanceAnswers>(NO_INSTANCE_ANSWERS);
  return (
    <Frame settings={settings}>
      <InstanceCard part={PART} answers={answers} onAnswers={setAnswers} />
    </Frame>
  );
}

const STAGED: StagedApp = {
  key: 'invoices',
  version: '1.0.17',
  name: 'Invoices & Receipts',
  files: 40,
  integrity: FINGERPRINT,
  sides: ['staff'],
  route: 'update',
  installs: [
    { installId: 'i1', connectionId: 'c1', connectionName: 'fernhill', slug: '', version: '1.0.16', status: 'installed' },
    { installId: 'i2', connectionId: 'c2', connectionName: 'kiln', slug: 'kiln', version: '1.0.16', status: 'installed' },
  ],
  databasesFree: 2,
};

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Studio/Apps/Install review' };
export default meta;

export const WhereItCameFromNotChecked = { tags: ['vrt'], render: () => <Frame><Source /></Frame> };
export const WhereItCameFromTyped = { tags: ['vrt'], render: () => <Frame><Source typed={FINGERPRINT} /></Frame> };
export const UseTheExistingTables = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <ExistingTablesCard plan={existingPlan(false)} used={false} busy={false} onUse={() => undefined} onChange={() => undefined} />
    </Frame>
  ),
};
export const ExistingTablesUsed = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <ExistingTablesCard plan={existingPlan(true)} used busy={false} onUse={() => undefined} onChange={() => undefined} />
    </Frame>
  ),
};
export const ExistingTableCannotBeUsed = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <ExistingTablesCard plan={existingPlan(true, true)} used busy={false} onUse={() => undefined} onChange={() => undefined} />
    </Frame>
  ),
};
export const PageAddressesTaken = { tags: ['vrt'], render: () => <Frame><Clashes /></Frame> };
export const RulesThatSendDataOut = { tags: ['vrt'], render: () => <Frame><OutsideAddressesCard items={AFTER} /></Frame> };
export const TheLookAndLanguages = { tags: ['vrt'], render: () => <Instance /> };
export const TheLookAndLanguagesWithoutSettings = { tags: ['vrt'], render: () => <Instance settings={false} /> };
export const Screens = { tags: ['vrt'], render: () => <Frame><ScreensWarning /></Frame> };
export const AfterYouInstall = { tags: ['vrt'], render: () => <Frame><AfterInstallCard items={AFTER} /></Frame> };
export const RefusedAsOlder = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <RefusalCard title="An older file" onBack={() => undefined}>
        fernhill has Fernhill Ops 1.1.0. The file is the older 1.0.0.
      </RefusalCard>
    </Frame>
  ),
};
export const UploadUpdatesEveryCopy = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <UploadRoute staged={STAGED} route="update" copies={STAGED.installs ?? []} updatedIds={['i1']} onBack={() => undefined} busy={false} />
    </Frame>
  ),
};
export const UploadInstallsOnAnotherDatabase = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <UploadRoute
        staged={{ ...STAGED, version: '1.0.16', route: 'install-another' }}
        route="install-another"
        copies={STAGED.installs ?? []}
        updatedIds={[]}
        onBack={() => undefined}
        busy={false}
      />
    </Frame>
  ),
};
