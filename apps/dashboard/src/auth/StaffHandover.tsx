// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Opening {app}…" — what a staff address shows between a successful sign-in
 * and the app's own screens loading (`App Address Pages.dc.html`, handover):
 * the next document is a full page load, and until it arrives the form would
 * otherwise sit there looking unsubmitted.
 */
import { Spinner } from '@adminium/ui';

import { t } from '../i18n/t.js';

export function StaffHandover({ appName, userName }: { appName: string | null; userName: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-[18px] text-center" data-part="staff-handover">
      <Spinner size="lg" />
      <div>
        <div className="text-[17px] font-extrabold tracking-[-0.02em]">
          {appName === null
            ? t('auth.staff.openingApp', 'Opening the app…')
            : t('auth.staff.opening', 'Opening {app}…', { app: appName })}
        </div>
        <div className="mt-1.5 text-[13.5px] text-fg-muted">
          {t('auth.staff.signedInAs', 'Signed in as {name}', { name: userName })}
        </div>
      </div>
    </div>
  );
}
