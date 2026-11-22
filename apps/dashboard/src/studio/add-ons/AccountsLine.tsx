// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE INSTALLED ROW OF AN ADD-ON WHOSE PEOPLE EACH CONNECT THEIR OWN ACCOUNT.
 *
 * One registration serves everyone, so the row's "Connected" would say only
 * that an app was saved, and its "Disconnect" would offer to remove it from
 * under them. Instead the row says how many people are connected and opens the
 * add-on's own page, where each of them, and the setup, are kept.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { Button } from '@adminium/ui';

import { api, installOptions } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import type { AddOnDto } from './addOnsApi.js';

interface AccountsSummary {
  registered: boolean;
  counts: { connected: number; reconnect: number };
}

/** What the row says of its people. */
export function accountsWords(summary: AccountsSummary): string {
  if (!summary.registered) return t('studio:addOns.installed.accountsNotSetUp', 'Not set up');
  const { connected, reconnect } = summary.counts;
  return reconnect > 0
    ? t('studio:addOns.installed.accountsBoth', '{connected} connected · {reconnect} to reconnect', { connected, reconnect })
    : t('studio:addOns.installed.accountsCount', '{connected} connected', { connected });
}

export function AccountsLine({ addOn }: { addOn: AddOnDto }) {
  const navigate = useNavigate();
  const address = addOn.slug === undefined || addOn.slug === '' ? addOn.key : `${addOn.key}~${addOn.slug}`;
  const { data } = useQuery({
    queryKey: ['add-ons', address, 'connect-accounts'],
    queryFn: () => api.get<AccountsSummary>(`/api/v1/add-ons/${addOn.key}/connect/accounts`, installOptions(addOn.installId)),
  });
  return (
    <div className="flex flex-wrap items-center gap-3">
      {data === undefined ? null : (
        <span className="text-[12.5px] text-fg-muted" data-testid={`add-on-${addOn.key}-accounts`}>
          {accountsWords(data)}
        </span>
      )}
      <Button
        size="sm"
        variant="secondary"
        iconRight={<ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />}
        onClick={() => void navigate({ to: '/add-ons/$key/$', params: { key: address, _splat: '' } })}
        data-testid={`add-on-${addOn.key}-open`}
      >
        {t('studio:addOns.installed.accountsOpen', 'Open')}
      </Button>
    </div>
  );
}
