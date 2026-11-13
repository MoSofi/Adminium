// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Address in email links" when the server's operator decides it
 * (`ADMINIUM_PUBLIC_ORIGIN` / `ADMINIUM_OPERATOR_DOMAINS`, the server's
 * `trial/operator-hosts.ts`): drawn read-only, never hidden. The label, the
 * chip beside it, the address in a field that stays in the tab order with
 * `aria-disabled` and ignores typing, and one line saying who set it, which
 * the field's `aria-describedby` names (`settings/SetByOperator.tsx`).
 *
 * Only Studio's settings page imports it, a page loaded on its own: nothing of
 * it is in the dashboard's first load.
 */
import { Input, Label } from '@adminium/ui';
import { useId, type ReactNode } from 'react';

import { SetByOperatorChip } from '../../settings/SetByOperator.js';
import { t } from '../../i18n/t.js';

export function LinkOriginLocked({ origin }: { origin: string | null }): ReactNode {
  const id = useId();
  const lineId = `${id}-line`;
  return (
    <div className="flex w-full flex-col gap-1.5" data-testid="link-origin-locked">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{t('studio:settingsHub.email.linkOrigin.label', 'Address in email links')}</Label>
        <SetByOperatorChip />
      </div>
      <Input id={id} readOnly aria-disabled="true" aria-describedby={lineId} value={origin ?? ''} className="font-mono" />
      <p id={lineId} className="m-0 text-[12.5px] text-fg-muted">
        {t('studio:settingsHub.email.linkOrigin.operator', 'The server’s operator set this address. Password-reset and invitation links always open it.')}
      </p>
    </div>
  );
}
