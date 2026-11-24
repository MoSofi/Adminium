// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/texts`: Workspace settings → Texts (comps `Texts Setup`, `Text
 * Templates`, `Texts Activity`; no comp is drawn yet, so the design prompts
 * are the spec and the console's shared parts the look).
 *
 * WHO. `sms.manage` (through `holdsSystemAction`, never a role's name) opens
 * Setup, Templates, Activity and the do-not-text list, and each app's replies
 * switch. A desk's `privacy.people` opens Activity and the do-not-text list,
 * where staff record a stop someone asked for in person, and sees Setup as a
 * plain "ask the owner". Conversations open to whoever reads customers'
 * texts: the console-wide `texts.read` / `texts.reply`, or an app role's
 * rights to one app's (the bootstrap's `textApps`). Marketing opens to
 * `settings.manage`, the right the server's marketing routes require, held
 * with `sms.manage`, because a run spends the provider account's money. Anyone
 * else gets a notice that says who to ask, so this route carries no
 * `StudioGuard`.
 *
 * Tabs: Setup, Templates, Activity, Do-not-text list, Conversations,
 * Marketing. `?tab=` opens one directly. Conversations and Marketing are
 * chunks of their own, fetched when first opened.
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Card, IconTile, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';

import { bootstrapQuery, holdsSystemAction } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { ActivityTab } from './ActivityTab.js';
import { readsAnyTexts, textReaderOf, type TextReader } from './conversationsApi.js';
import { SetupTab } from './SetupTab.js';
import { StopListTab } from './StopListTab.js';
import { TemplatesTab } from './TemplatesTab.js';
import { notAffiliated } from './textsWords.js';

const SUPER_ADMIN_ROLE = 'super-admin';
type TabName = 'setup' | 'templates' | 'activity' | 'stop' | 'conversations' | 'marketing';

const ConversationsTab = lazy(async () => ({ default: (await import('./ConversationsTab.js')).ConversationsTab }));
const MarketingTab = lazy(async () => ({ default: (await import('./MarketingTab.js')).MarketingTab }));

interface Rights {
  canManage: boolean;
  canDesk: boolean;
  canMarket: boolean;
  reader: TextReader;
  isSuperAdmin: boolean;
}

/** The tabs this person may open, in the page's order. */
function tabsFor(rights: Rights): TabName[] {
  const tabs: TabName[] = [];
  if (rights.canManage || rights.canDesk) tabs.push('setup');
  if (rights.canManage) tabs.push('templates');
  if (rights.canManage || rights.canDesk) tabs.push('activity', 'stop');
  if (rights.canManage || readsAnyTexts(rights.reader)) tabs.push('conversations');
  if (rights.canMarket) tabs.push('marketing');
  return tabs;
}

const Loading = () => <Skeleton className="h-[240px] w-full" />;

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
  const rights: Rights = {
    canManage: holdsSystemAction(bootstrap, 'sms.manage'),
    canDesk: holdsSystemAction(bootstrap, 'privacy.people'),
    // The server's marketing routes require `settings.manage`, as e-mail campaigns do; a run spends the provider account's money, so the tab is also the Texts set-up holder's.
    canMarket: holdsSystemAction(bootstrap, 'settings.manage') && holdsSystemAction(bootstrap, 'sms.manage'),
    reader: textReaderOf(bootstrap),
    isSuperAdmin: bootstrap.roles.includes(SUPER_ADMIN_ROLE),
  };
  const allowed = tabsFor(rights);
  if (allowed.length === 0) {
    return (
      <Frame>
        <AskTheOwner testId="texts-no-access" body={t('studio:texts.noAccess', 'Ask whoever runs this server to give you the “Set up text messages” permission.')} />
      </Frame>
    );
  }
  return <TextsConsole rights={rights} allowed={allowed} />;
}

function TextsConsole({ rights, allowed }: { rights: Rights; allowed: readonly TabName[] }) {
  const { canManage, isSuperAdmin } = rights;
  const [tab, setTab] = useState<TabName>(() => asked(allowed));
  const has = (name: TabName) => allowed.includes(name);
  return (
    <Frame>
      <Tabs value={tab} onValueChange={(next) => setTab(next as TabName)}>
        <TabsList aria-label={t('studio:texts.title', 'Texts')} className="max-w-full overflow-x-auto">
          {has('setup') ? <TabsTrigger value="setup">{t('studio:texts.tab.setup', 'Setup')}</TabsTrigger> : null}
          {has('templates') ? <TabsTrigger value="templates">{t('studio:texts.tab.templates', 'Templates')}</TabsTrigger> : null}
          {has('activity') ? <TabsTrigger value="activity">{t('studio:texts.tab.activity', 'Activity')}</TabsTrigger> : null}
          {has('stop') ? <TabsTrigger value="stop">{t('studio:texts.tab.stop', 'Do-not-text list')}</TabsTrigger> : null}
          {has('conversations') ? <TabsTrigger value="conversations">{t('studio:texts.tab.conversations', 'Conversations')}</TabsTrigger> : null}
          {has('marketing') ? <TabsTrigger value="marketing">{t('studio:texts.tab.marketing', 'Marketing')}</TabsTrigger> : null}
        </TabsList>
        {has('setup') ? (
          <TabsContent value="setup" className="flex flex-col gap-[18px] pt-4">
            {canManage ? <SetupTab /> : <AskTheOwner testId="texts-setup-readonly" />}
          </TabsContent>
        ) : null}
        {has('templates') ? (
          <TabsContent value="templates" className="pt-4">
            <TemplatesTab onOpenSetup={() => setTab('setup')} />
          </TabsContent>
        ) : null}
        {has('activity') ? (
          <TabsContent value="activity" className="pt-4">
            <ActivityTab canManage={canManage} />
          </TabsContent>
        ) : null}
        {has('stop') ? (
          <TabsContent value="stop" className="pt-4">
            <StopListTab isSuperAdmin={isSuperAdmin} />
          </TabsContent>
        ) : null}
        {has('conversations') ? (
          <TabsContent value="conversations" className="pt-4">
            <Suspense fallback={<Loading />}>
              <ConversationsTab reader={rights.reader} canManage={canManage} />
            </Suspense>
          </TabsContent>
        ) : null}
        {has('marketing') ? (
          <TabsContent value="marketing" className="pt-4">
            <Suspense fallback={<Loading />}>
              <MarketingTab />
            </Suspense>
          </TabsContent>
        ) : null}
      </Tabs>
    </Frame>
  );
}
