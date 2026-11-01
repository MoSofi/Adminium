// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Can visitors reach your public pages?" — the first thing on the "Privacy
 * notice" and "Your websites" tabs (comp `Privacy And Public Pages.dc.html`,
 * boards 3a-3d).
 *
 * The server answers with the forms door's own check (`GET
 * /api/v1/privacy/reach`), so this never says reachable while a form is
 * refused. Reachable: one line. Otherwise the shared reach card, worded for
 * this page:
 *
 *  - a proxy that hides visitors' addresses: what to set, and who sets it;
 *  - no public https address (not set, this computer, a private or `.local`
 *    address, plain http): the address seen and "Set it", to the Senders
 *    card's "Address in email links";
 *  - network features off, the desktop app: the Payments card's own words.
 *
 * "Check again" reads the facts again; it never changes a setting.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Globe, Link2Off, RefreshCw, ShieldQuestion } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, Skeleton } from '@adminium/ui';
import { formatRelativeTime } from '@adminium/widgets';

import { bootstrapQuery, holdsSystemAction } from '../../app/bootstrap.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { ORIGIN_MARK, ReachCard, ReachStrip, reachToneOf } from '../reach/ReachCard.js';
import type { ReachabilityState } from '../payments/paymentsApi.js';
import { reachQuery, type PublicReach as Reach } from './privacyApi.js';

/** The states that mean "no public https address": one card, with the address seen. */
const NO_ADDRESS: ReadonlySet<ReachabilityState> = new Set(['not-set', 'this-computer', 'private-network', 'dot-local', 'not-https']);

function locale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

function heading(): string {
  return t('studio:privacy.websites.reach.heading', 'Can visitors reach your public pages?');
}

export function PublicReach(): ReactNode {
  const reach = useQuery(reachQuery());
  if (reach.isError) return <Alert tone="danger" title={t('studio:privacy.websites.reach.loadFailed', 'Whether visitors can reach this server could not be checked. Try again.')} />;
  if (reach.data === undefined) return <Skeleton className="h-[52px] w-full" />;
  const data = reach.data;
  if (data.state === 'reachable' && data.origin !== null) {
    return (
      <ReachStrip
        testId="privacy-reach"
        heading={heading()}
        sentence={t('studio:privacy.websites.reach.ok', 'Visitors can reach {origin}', { origin: ORIGIN_MARK })}
        origin={data.origin}
        badge={t('studio:privacy.websites.reach.badge.reachable', 'Reachable')}
      />
    );
  }
  return <ReachProblem reach={data} checking={reach.isFetching} onCheckAgain={() => void reach.refetch()} />;
}

function ReachProblem({ reach, checking, onCheckAgain }: { reach: Reach; checking: boolean; onCheckAgain: () => void }): ReactNode {
  const bootstrap = useQuery(bootstrapQuery()).data;
  // "Set it" opens the Senders card: only for someone who may change it.
  const canSet = bootstrap !== undefined && holdsSystemAction(bootstrap, 'settings.manage');
  const caption = t('studio:privacy.websites.reach.checked', 'Checked {when}', { when: formatRelativeTime(new Date(reach.checkedAt).toISOString(), { locale: locale() }) });
  const checkAgain = (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={checking} iconLeft={<RefreshCw className="size-3.5" />} onClick={onCheckAgain} data-testid="privacy-reach-check">
        {t('studio:privacy.websites.reach.checkAgain', 'Check again')}
      </Button>
    </div>
  );

  if (reach.state === 'proxy-hidden') {
    const setting = 'ADMINIUM_TRUST_PROXY=on';
    const [before = '', after = ''] = t('studio:privacy.websites.reach.proxy', "This server is behind a proxy that hides visitors' addresses, so limits on forms can't work. Set {setting}.", { setting: ORIGIN_MARK }).split(ORIGIN_MARK);
    return (
      <ReachCard testId="privacy-reach" state={reach.state} tone="warn" icon={<ShieldQuestion />} heading={heading()} caption={caption} badge={t('studio:privacy.websites.reach.badge.proxy', 'Proxy setting')}>
        <p className="font-bold leading-normal" data-testid="privacy-reach-problem">
          {before}
          <span dir="ltr" className="font-mono text-[12.5px]">
            {setting}
          </span>
          {after}
        </p>
        <p className="text-[12.5px] text-fg-muted">{t('studio:privacy.websites.reach.ask', 'Ask whoever runs this server to set it and restart.')}</p>
        {checkAgain}
      </ReachCard>
    );
  }

  if (NO_ADDRESS.has(reach.state)) {
    return (
      <ReachCard testId="privacy-reach" state={reach.state} tone="warn" icon={<Link2Off />} heading={heading()} caption={caption} badge={t('studio:privacy.websites.reach.badge.noAddress', 'No address')}>
        <p className="font-bold leading-normal" data-testid="privacy-reach-problem">
          {t('studio:privacy.websites.reach.noAddress', 'This server has no public https address. Forms, chat and unsubscribe links need one.')}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
          {t('studio:privacy.websites.reach.address', "This server's public address:")}{' '}
          {/* Both in mono, as the comp; an address reads left to right, "(not set)" in the page's own direction. */}
          {reach.origin === null ? (
            <span className="font-mono text-fg" data-testid="privacy-reach-address">
              {t('studio:privacy.websites.reach.notSet', '(not set)')}
            </span>
          ) : (
            <span dir="ltr" className="font-mono text-fg" data-testid="privacy-reach-address">
              {reach.origin}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {canSet ? (
            <Link to="/studio/settings" hash="email-link-origin" className="inline-flex min-h-[var(--hit,36px)] items-center gap-[7px] rounded-[10px] bg-accent px-3.5 py-[7px] text-[12.5px] font-bold text-accent-fg" data-testid="privacy-reach-set">
              {t('studio:privacy.websites.reach.setIt', 'Set it')}
              <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
            </Link>
          ) : null}
          <Button variant="secondary" disabled={checking} iconLeft={<RefreshCw className="size-3.5" />} onClick={onCheckAgain} data-testid="privacy-reach-check">
            {t('studio:privacy.websites.reach.checkAgain', 'Check again')}
          </Button>
        </div>
      </ReachCard>
    );
  }

  // Network features off, or the desktop app: the Payments card's own words, which say the same of this server.
  const off = reach.state === 'network-off';
  return (
    <ReachCard
      testId="privacy-reach"
      state={reach.state}
      tone={reachToneOf(reach.state)}
      icon={<Globe />}
      heading={heading()}
      caption={caption}
      badge={off ? t('studio:payments.reach.badge.networkOff', 'Works offline') : t('studio:payments.reach.badge.thisComputer', 'This computer only')}
    >
      <p className="font-bold leading-normal" data-testid="privacy-reach-problem">
        {off
          ? t('studio:payments.reach.problem.networkOff', 'This server is set to work without the internet, so it cannot take online payments.')
          : t('studio:payments.reach.problem.thisComputer', 'This server runs on this computer only. Customers cannot reach it.')}
      </p>
      <p>
        <span className="font-semibold">{t('studio:payments.reach.fixLabel', 'Fix:')}</span>{' '}
        {off
          ? t('studio:payments.reach.fix.networkOff', 'Set ADMINIUM_NETWORK_FEATURES=on on the server, restart it, then check again.')
          : t('studio:payments.reach.fix.thisComputer', 'Run Adminium on a server with a public https address, then set up payments there.')}
      </p>
      {checkAgain}
    </ReachCard>
  );
}
