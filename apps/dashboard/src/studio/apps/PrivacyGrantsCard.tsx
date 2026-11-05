// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install check's word on the app's roles that may find, download and
 * erase a person's data (`privacy:@:people`). That right reaches everything
 * the workspace keeps about one address, past every role's limits, so it is
 * said before anyone agrees, by role name.
 */
import { ShieldAlert } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { namesList } from './addOnWords.js';

export function PrivacyGrantsCard({ grants }: { grants: readonly { role: string; roleName: string }[] }) {
  if (grants.length === 0) return null;
  return (
    <section className="rounded-[14px] border border-warn/30 bg-warn-soft p-[14px]" data-testid="privacy-grants">
      <h3 className="flex items-center gap-[9px] text-[13px] font-extrabold">
        <ShieldAlert aria-hidden className="size-4 text-warn" />
        {t('studio:hostedApps.install.privacyGrants.title', 'A role can erase people')}
      </h3>
      <p className="mt-1 text-[12px] leading-[1.5] text-fg-muted">
        {t('studio:hostedApps.install.privacyGrants.body', '{roles} can find, download and erase everything this workspace keeps about a person, on the privacy page.', {
          roles: namesList(grants.map((grant) => grant.roleName)),
        })}
      </p>
    </section>
  );
}

/**
 * An update's word on the grants its roles are given that the running
 * version's were not: finding and erasing people's data, or an add-on's
 * settings that every app it serves shares. Each is given once, so the update
 * would hand it over unasked; pressing Update is the say (`roleGrants`).
 */
export function RoleGrantsAddedCard({
  privacy,
  addOn,
}: {
  privacy: readonly { role: string; roleName: string }[];
  addOn: readonly { role: string; roleName: string; addOn: string }[];
}) {
  if (privacy.length === 0 && addOn.length === 0) return null;
  const addOns = [...new Set(addOn.map((grant) => grant.addOn))];
  return (
    <section className="rounded-[14px] border border-warn/30 bg-warn-soft p-[14px]" data-testid="role-grants-added">
      <h3 className="flex items-center gap-[9px] text-[13px] font-extrabold">
        <ShieldAlert aria-hidden className="size-4 text-warn" />
        {t('studio:hostedApps.update.grantsAdded.title', 'This version gives its roles more')}
      </h3>
      {privacy.length === 0 ? null : (
        <p className="mt-1 text-[12px] leading-[1.5] text-fg-muted">
          {t('studio:hostedApps.install.privacyGrants.body', '{roles} can find, download and erase everything this workspace keeps about a person, on the privacy page.', {
            roles: namesList(privacy.map((grant) => grant.roleName)),
          })}
        </p>
      )}
      {addOns.map((key) => (
        <p key={key} className="mt-1 text-[12px] leading-[1.5] text-fg-muted">
          {t('studio:hostedApps.update.grantsAdded.addOnSettings', '{roles} can change the settings of {addOn}, which every app it serves shares.', {
            roles: namesList(addOn.filter((grant) => grant.addOn === key).map((grant) => grant.roleName)),
            addOn: key,
          })}
        </p>
      ))}
    </section>
  );
}
