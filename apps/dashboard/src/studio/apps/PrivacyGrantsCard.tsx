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
