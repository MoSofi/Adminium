// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/texts`: Workspace settings → Texts (comps `Texts Setup`, `Text
 * Templates`, `Texts Activity`; no comp is drawn yet, so the design prompts
 * are the spec and the console's shared parts the look).
 *
 * WHO. `sms.manage` (through `holdsSystemAction`, never a role's name) opens
 * every tab. A desk's `privacy.people` opens Activity and the do-not-text
 * list, where staff record a stop someone asked for in person, and sees Setup
 * as a plain "ask the owner". Anyone else gets a notice that says who to ask,
 * so this route carries no `StudioGuard`.
 *
 * Tabs: Setup, Templates, Activity, Do-not-text list. `?tab=` opens one
 * directly. Conversations and Marketing join them in the second release.
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Card, IconTile, Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';

import { bootstrapQuery, holdsSystemAction } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { ActivityTab } from './ActivityTab.js';
import { SetupTab } from './SetupTab.js';
import { StopListTab } from './StopListTab.js';
import { TemplatesTab } from './TemplatesTab.js';
import { notAffiliated } from './textsWords.js';

const SUPER_ADMIN_ROLE = 'super-admin';
type TabName = 'setup' | 'templates' | 'activity' | 'stop';
const TABS: readonly TabName[] = ['setup', 'templates', 'activity', 'stop'];

function Frame({ children }: { children: ReactNode }) {
  return (
    <PageSurface width="page" className="mx-auto flex w-full max-w-[976px] flex-col gap-[18px] leading-[normal]">
      <PageActions title={t('studio:texts.title', 'Texts')} subtitle={t('studio:texts.intro', 'Short messages to your customers, sent from your own provider account. Adminium never holds the account or the money.')} />
      {children}
      <p className="text-[11px] text-fg-subtle" data-testid="texts-not-affiliated">
        {notAffiliated()}
      </p>
    </PageSurface>
  );
}

/** A plain card that says who to ask: the console's own words for a right someone does not hold. */
export function AskTheOwner({ testId, body }: { testId: string; body?: string | undefined }) {
  return (
    <Card data-testid={testId}>
      <div className="flex items-start gap-3">
        <IconTile tone="neutral" icon={<Lock />} />
        <div>
          <h2 className="text-[14.5px] font-bold">{t('studio:texts.askOwner.title', 'Ask the owner to change this')}</h2>
          <p className="mt-[3px] text-[12.5px] text-fg-muted">{body ?? t('studio:texts.askOwner.body', 'Texts are set up by whoever holds the “Set up text messages” permission.')}</p>
        </div>
      </div>
    </Card>
  );
}

function asked(allowed: readonly TabName[]): TabName {
  const wanted = new URLSearchParams(window.location.search).get('tab');
  const found = allowed.find((tab) => tab === wanted);
  return found ?? allowed[0] ?? 'setup';
}

export function TextsPage(): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const canManage = holdsSystemAction(bootstrap, 'sms.manage');
  const canDesk = holdsSystemAction(bootstrap, 'privacy.people');
  const isSuperAdmin = bootstrap.roles.includes(SUPER_ADMIN_ROLE);
  if (!canManage && !canDesk) {
    return (
      <Frame>
        <AskTheOwner testId="texts-no-access" body={t('studio:texts.noAccess', 'Ask whoever runs this server to give you the “Set up text messages” permission.')} />
      </Frame>
    );
  }
  return <TextsConsole canManage={canManage} isSuperAdmin={isSuperAdmin} />;
}

function TextsConsole({ canManage, isSuperAdmin }: { canManage: boolean; isSuperAdmin: boolean }) {
  const allowed = canManage ? TABS : TABS.filter((tab) => tab !== 'templates');
  const [tab, setTab] = useState<TabName>(() => asked(allowed));
  return (
    <Frame>
      <Tabs value={tab} onValueChange={(next) => setTab(next as TabName)}>
        <TabsList aria-label={t('studio:texts.title', 'Texts')} className="max-w-full overflow-x-auto">
          <TabsTrigger value="setup">{t('studio:texts.tab.setup', 'Setup')}</TabsTrigger>
          {canManage ? <TabsTrigger value="templates">{t('studio:texts.tab.templates', 'Templates')}</TabsTrigger> : null}
          <TabsTrigger value="activity">{t('studio:texts.tab.activity', 'Activity')}</TabsTrigger>
          <TabsTrigger value="stop">{t('studio:texts.tab.stop', 'Do-not-text list')}</TabsTrigger>
        </TabsList>
        <TabsContent value="setup" className="flex flex-col gap-[18px] pt-4">
          {canManage ? <SetupTab /> : <AskTheOwner testId="texts-setup-readonly" />}
        </TabsContent>
        {canManage ? (
          <TabsContent value="templates" className="pt-4">
            <TemplatesTab onOpenSetup={() => setTab('setup')} />
          </TabsContent>
        ) : null}
        <TabsContent value="activity" className="pt-4">
          <ActivityTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="stop" className="pt-4">
          <StopListTab isSuperAdmin={isSuperAdmin} />
        </TabsContent>
      </Tabs>
    </Frame>
  );
}
