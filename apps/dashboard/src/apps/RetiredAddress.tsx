// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A plain address whose copy is gone, while other copies of the app stay
 * (the first install was uninstalled; later ones keep their own addresses).
 * It opens no other copy by itself: a bookmark of the first business's app
 * would otherwise land on another business's. It says where the app is now,
 * with a link to each copy. The server's own page for a side says the same
 * (`APP_ADDRESS_RETIRED`).
 */
import { Link } from '@tanstack/react-router';
import { EmptyState, MonoText } from '@adminium/ui';
import { ArrowRight } from 'lucide-react';

import { t } from '../i18n/t.js';
import { addressOf } from './installAddress.js';

export interface RetiredCopy {
  key: string;
  slug?: string;
  address?: string;
  connectionName?: string | null;
}

/** "Invoices & Receipts is installed on kiln", or "… on kiln and suppliers". */
export function retiredTitle(appName: string, copies: readonly RetiredCopy[]): string {
  const names = copies.map((copy) => copy.connectionName ?? addressOf(copy));
  const list = new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' }).format(names);
  return t('appCopies.retired.title', '{app} is installed on {databases}', { app: appName, databases: list });
}

/**
 * `to` makes each copy's link: the app's page in Studio, an add-on's page,
 * or an app's screens.
 */
export function RetiredAddress({
  appName,
  copies,
  linkTo = 'studio',
  rest = '',
}: {
  appName: string;
  copies: readonly RetiredCopy[];
  linkTo?: 'studio' | 'add-on' | 'surface';
  /** The rest of the address (an add-on page's ref), kept on each link. */
  rest?: string;
}) {
  return (
    <EmptyState
      data-testid="retired-address"
      title={retiredTitle(appName, copies)}
      body={t('appCopies.retired.body', 'It is no longer at this address. Open the copy you meant:')}
      actions={
        <ul className="flex flex-col items-center gap-2">
          {copies.map((copy) => {
            const address = addressOf(copy);
            const label = (
              <>
                {t('appCopies.retired.open', 'Open it on {database}', { database: copy.connectionName ?? address })}
                <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
              </>
            );
            const className = 'inline-flex items-center gap-1.5 text-sm font-bold text-accent hover:underline';
            return (
              <li key={address}>
                {linkTo === 'add-on' ? (
                  <Link to="/add-ons/$key/$" params={{ key: address, _splat: rest }} className={className}>
                    {label}
                  </Link>
                ) : linkTo === 'surface' ? (
                  <Link to="/a/$appKey/$" params={{ appKey: address, _splat: rest }} className={className}>
                    {label}
                  </Link>
                ) : (
                  <Link to="/studio/apps/$key" params={{ key: address }} className={className}>
                    {label}
                  </Link>
                )}
                <MonoText className="sr-only">{address}</MonoText>
              </li>
            );
          })}
        </ul>
      }
    />
  );
}
