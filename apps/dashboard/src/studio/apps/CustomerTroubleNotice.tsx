// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Customers cannot use this app yet" — said at the top of an app's page
 * when its customer screens are switched on and cannot answer.
 *
 * The switch on the customer row says the PAGES are served. What they read
 * and save goes through the public API, by the access the install made. With
 * the API off, a shop at its own domain opened and showed customers an
 * error, while the page read "Customer screens · On"; the only word of it was
 * one line inside that row, which an owner who had just installed the app
 * and attached a domain did not see. So it is said here, first, with the
 * addresses customers use, and with the switch where the reader may flip it.
 */
import { Alert, Button } from '@adminium/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { holdsSystemAction, type BootstrapData } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { PUBLIC_API_QUERY_KEY, setPublicApiEnabled } from '../public-api/publicSurfaceApi.js';
import type { AppSettingsView, InstalledApp } from './appsApi.js';

/** The addresses customers open: the domains given to the customer side, else the side's own address. */
export function customerAddresses(app: InstalledApp, settings: AppSettingsView): string[] {
  const hosts = Object.entries(settings.domains)
    .filter(([, target]) => target.side === 'customer')
    .map(([host]) => host);
  if (hosts.length > 0) return hosts;
  const side = app.sides.find((candidate) => candidate.side === 'customer');
  const url = side?.openUrl ?? (side === undefined ? undefined : `${side.prefix}/`);
  return url === undefined ? [] : [url];
}

/** Why a customer side that is on cannot answer, or null when it can (or the app asks for no public access). */
export function customerTrouble(access: AppSettingsView['publicAccess'], appKey = ''): string | null {
  if (access === undefined) return null;
  if (!access.granted) {
    // An app of the project folder is never updated from here: each says the place where its access is allowed.
    if (access.decides === 'person') {
      return t(
        'studio:appSettings.customerNotAllowed',
        'These pages open, but they cannot read or save anything: nobody has allowed the app’s public access yet. Allow it under “Public access” on this page.',
      );
    }
    if (access.decides === 'config') {
      return t(
        'studio:appSettings.customerConfigDecides',
        'These pages open, but they cannot read or save anything: this server’s adminium.config.ts does not allow the app’s public access. Set apps.{key}.publicAccess to true there, and restart.',
        { key: appKey },
      );
    }
    return t(
      'studio:appSettings.customerNoAccess',
      'These pages open, but they cannot read or save anything: the app was installed without its public access. Update the app and allow it.',
    );
  }
  if (!access.apiOn) {
    return t(
      'studio:appSettings.customerApiOff',
      'These pages open, but they cannot read or save anything: the public API is switched off. Switch it on under Studio › API keys.',
    );
  }
  return null;
}

export function CustomerTroubleNotice({
  app,
  settings,
  bootstrap,
  onChanged,
  onNotice,
}: {
  app: InstalledApp;
  settings: AppSettingsView;
  bootstrap: BootstrapData;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const side = app.sides.find((candidate) => candidate.side === 'customer');
  if (side === undefined || app.status === 'disabled' || settings.off.includes('customer')) return null;
  const why = customerTrouble(settings.publicAccess, app.key);
  if (why === null) return null;

  const apiOff = settings.publicAccess?.granted === true && !settings.publicAccess.apiOn;
  const mayFlip = holdsSystemAction(bootstrap, 'api-keys.manage');
  const addresses = customerAddresses(app, settings);

  const switchOn = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      const state = await setPublicApiEnabled(true);
      await queryClient.invalidateQueries({ queryKey: PUBLIC_API_QUERY_KEY });
      if (!state.registered) {
        // Switched on, and still not served: this server was started without a public API at all.
        setFailed(
          t(
            'studio:appSettings.customerTrouble.notRegistered',
            'The switch is on, but this server was started without a public API, so nothing is served yet. Open API keys to see what it needs.',
          ),
        );
      } else {
        onNotice(t('studio:appSettings.customerTrouble.switchedOn', 'The public API is on. Customers can use this app now.'));
      }
      await onChanged();
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Alert
      tone="warn"
      data-testid="app-customer-trouble"
      title={t('studio:appSettings.customerTrouble.title', 'Customers cannot use this app yet')}
      body={
        <>
          {addresses.length === 0 ? null : (
            <p>
              {t(
                'studio:appSettings.customerTrouble.at',
                'Customers who open {addresses} see an error.',
                { addresses: addresses.join(', ') },
              )}
            </p>
          )}
          <p>{why}</p>
          {apiOff && !mayFlip ? (
            <p>
              {t('studio:appSettings.customerTrouble.askAdmin', 'Ask someone who manages API keys on this server to switch it on.')}
            </p>
          ) : null}
          {failed === null ? null : (
            <p role="alert" className="text-danger">
              {failed}
            </p>
          )}
        </>
      }
      action={
        apiOff && mayFlip ? (
          <div className="flex flex-wrap items-center gap-[9px]">
            <Button size="sm" disabled={busy} onClick={() => void switchOn()}>
              {busy
                ? t('studio:appSettings.customerTrouble.switching', 'Switching on…')
                : t('studio:appSettings.customerTrouble.switchOn', 'Switch on the public API')}
            </Button>
            <Link to="/studio/public-api" className="text-[13px] font-bold text-accent hover:underline">
              {t('studio:appSettings.customerTrouble.openApiKeys', 'Open API keys')}
            </Link>
          </div>
        ) : null
      }
    />
  );
}
