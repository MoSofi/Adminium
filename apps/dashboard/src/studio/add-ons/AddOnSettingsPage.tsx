// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE ADD-ON'S SETTINGS, FOR WHOEVER KEEPS THEM: `/add-on-settings/<key>`.
 *
 * The add-ons page is for who installs and removes add-ons
 * (`manifests.manage`). A shop's owner who only keeps an add-on's settings
 * current — the days the business is closed — holds the per-add-on grant
 * `addOn:<key>:settings` instead (an app's role carries it), and the rail
 * links this screen for each add-on the bootstrap says they keep
 * (`addOnSettings`). It draws the same form the add-ons page does: the
 * add-on's own control first, where it ships one, then the generated
 * fields. The server asks the grant again on every save.
 */
import { Suspense, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { EmptyState, Spinner } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { studioMessagesReady } from '../studioMessages.js';
import { addOnsQuery } from './addOnsApi.js';
import { SettingsForm } from './AddOnsPage.js';

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
  const { key } = useParams({ from: '/app/add-on-settings/$key' });
  const addOns = useQuery(addOnsQuery);
  const addOn = addOns.data?.find((one) => one.key === key);
  const title = addOn === undefined ? t('studio:addOns.settings.pageTitle', 'Add-on settings') : t('studio:addOns.settings.pageNamed', '{name} settings', { name: addOn.name });

  return (
    <PageSurface>
      <PageActions title={title} />
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
          <SettingsForm addOn={addOn} busy={false} />
        </div>
      )}
    </PageSurface>
  );
}
