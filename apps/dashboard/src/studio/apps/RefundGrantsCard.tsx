// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install check's word on the app's roles that may give back the money
 * paid online for its own records (`payments:@:refund`). Each role starts
 * ticked; the installer unticks one that should not refund, and an update
 * never gives it back unasked. The app's right refunds its own payments only,
 * never those of another app or of the Invoices page.
 */
import { Checkbox } from '@adminium/ui';
import { RotateCcw } from 'lucide-react';

import { t } from '../../i18n/t.js';

export function RefundGrantsCard({
  grants,
  unticked,
  onTick,
}: {
  grants: readonly { role: string; roleName: string }[];
  /** The roles (by slug) unticked so far. */
  unticked: ReadonlySet<string>;
  onTick: (role: string, given: boolean) => void;
}) {
  if (grants.length === 0) return null;
  return (
    <section className="rounded-[14px] border border-border bg-surface p-[14px]" data-testid="refund-grants">
      <h3 className="flex items-center gap-[9px] text-[13px] font-extrabold">
        <RotateCcw aria-hidden className="size-4 text-fg-muted" />
        {t('studio:hostedApps.install.refundGrants.title', 'Who may refund online payments')}
      </h3>
      <p className="mt-1 text-[12px] leading-[1.5] text-fg-muted">
        {t('studio:hostedApps.install.refundGrants.body', 'These roles may give back money customers paid online for this app’s records. Untick a role that should not.')}
      </p>
      <ul className="mt-2 flex flex-col gap-[6px]">
        {grants.map((grant) => (
          <li key={grant.role}>
            <label className="flex cursor-pointer items-center gap-[9px]">
              <Checkbox checked={!unticked.has(grant.role)} onCheckedChange={(next) => onTick(grant.role, next === true)} data-testid={`refund-grant-${grant.role}`} />
              <span className="text-[12.5px] font-bold">{grant.roleName}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
