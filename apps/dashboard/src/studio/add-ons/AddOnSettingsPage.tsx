// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE ADD-ON'S SETTINGS, FOR WHOEVER KEEPS THEM: `/add-on-settings/<key>` (or `<key>~<slug>`).
 *
 * The add-ons page is for who installs and removes add-ons
 * (`manifests.manage`). A shop's owner who only keeps an add-on's settings
 * current — the days the business is closed — holds the per-add-on grant
 * `addOn:<key>:settings` instead (an app's role carries it), and the rail
 * links this screen for each add-on the bootstrap says they keep
 * (`addOnSettings`). It draws the same form the add-ons page does: the
 * add-on's own control first, where it ships one, then the generated
 * fields. The server asks the grant again on every save.
 *
 * WHICH COPY. An add-on installed on two databases has two sets of
 * settings. The address names the copy as every per-copy address does:
 * `<key>` for the first, `<key>~<slug>` for a later one (the rail links each
 * copy the reader keeps). While the screen is open, its calls to the
 * add-on's routes, and its saves, name that copy. With one copy, the plain
 * key opens it, whatever its slug.
 */
import { Suspense, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { EmptyState, Spinner } from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { studioMessagesReady } from '../studioMessages.js';
import { InstallScoped } from '../../add-ons/InstallScoped.js';
import { splitAddress } from '../../apps/installAddress.js';
import { addOnsQuery, type AddOnDto } from './addOnsApi.js';
import { SettingsForm } from './AddOnsPage.js';

/**
 * The copy an address names: the one with that slug; with one copy of the
 * key, the plain key names it too. A row from a server that does not say its
 * slug is the bare one.
 */
export function copyAtAddress(addOns: readonly AddOnDto[] | undefined, address: string): AddOnDto | undefined {
  const { key, slug } = splitAddress(address);
  const copies = (addOns ?? []).filter((one) => one.key === key);
  if (slug === '' && copies.length === 1) return copies[0];
  return copies.find((one) => (one.slug ?? '') === slug);
}

const loading = (
  <div className="flex justify-center py-16">
    <Spinner />
  </div>
);

/** The words are Studio's, fetched with its chunk: awaited before a sentence is drawn. */
export function AddOnSettingsPage() {
  return (
    <Suspense fallback={loading}>
      <AddOnSettingsWords />
    </Suspense>
  );
}

function AddOnSettingsWords() {
  use(studioMessagesReady());
  return <AddOnSettingsScreen />;
}

function AddOnSettingsScreen() {
  // `invoices~kiln`: a later copy's address.
  const { key: address } = useParams({ from: '/app/add-on-settings/$key' });
  const addOns = useQuery(addOnsQuery);
  const addOn = copyAtAddress(addOns.data, address);
  // With several copies, the title also says whose database these settings are for (as the rail row does).
  const bootstrap = useQuery(bootstrapQuery());
  const several = addOn !== undefined && (addOns.data ?? []).filter((one) => one.key === addOn.key).length > 1;
  const database = several ? (bootstrap.data?.addOnSettings?.find((one) => one.key === address)?.connectionName ?? undefined) : undefined;
  const title = addOn === undefined ? t('studio:addOns.settings.pageTitle', 'Add-on settings') : t('studio:addOns.settings.pageNamed', '{name} settings', { name: addOn.name });

  return (
    <PageSurface>
      <PageActions title={title} {...(database === undefined || database === null ? {} : { subtitle: database })} />
      {addOns.isPending ? (
        loading
      ) : addOn === undefined ? (
        <EmptyState
          title={t('studio:addOns.settings.notHere', 'This add-on is not installed')}
          body={t('studio:addOns.settings.notHereBody', 'This add-on is not installed here, or its settings are not yours to keep. An administrator can install it, or give your role its settings.')}
        />
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          <InstallScoped key={addOn.installId ?? addOn.key} addOnKey={addOn.key} installId={addOn.installId ?? null}>
            <SettingsForm addOn={addOn} busy={false} />
          </InstallScoped>
        </div>
      )}
    </PageSurface>
  );
}
