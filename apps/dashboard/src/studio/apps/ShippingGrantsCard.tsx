// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install check's word on what the app's roles may do with its shipping
 * labels (`shipping:@:book`, `:cancel`, `:customs`). Each right of each role
 * starts ticked; the installer unticks one on its own, so a packer can keep
 * booking and never cancel, and an update never gives it back unasked. Drawn
 * from the check's real grants, never from what a role is called.
 */
import { Checkbox } from '@adminium/ui';
import { Truck } from 'lucide-react';
import { useId } from 'react';

import { t } from '../../i18n/t.js';

type ShippingRight = 'book' | 'cancel' | 'customs';

function rightWords(action: ShippingRight): string {
  if (action === 'book') return t('studio:hostedApps.install.shippingGrants.book', 'Buy labels, within the limits you set');
  if (action === 'cancel') return t('studio:hostedApps.install.shippingGrants.cancel', 'Ask for a label’s refund');
  return t('studio:hostedApps.install.shippingGrants.customs', 'Declare customs');
}

function RoleRights({
  roleName,
  role,
  actions,
  unticked,
  onTick,
}: {
  roleName: string;
  role: string;
  actions: readonly ShippingRight[];
  unticked: readonly { role: string; action: ShippingRight }[];
  onTick: (role: string, action: ShippingRight, given: boolean) => void;
}) {
  const nameId = useId();
  return (
    <li>
      <span id={nameId} className="text-[12.5px] font-bold">
        {roleName}
      </span>
      <div role="group" aria-labelledby={nameId} className="mt-1 flex flex-wrap gap-x-4 gap-y-[6px]">
        {actions.map((action) => (
          <label key={action} className="flex cursor-pointer items-center gap-[9px]">
            <Checkbox
              checked={!unticked.some((one) => one.role === role && one.action === action)}
              onCheckedChange={(next) => onTick(role, action, next === true)}
              data-testid={`shipping-grant-${role}-${action}`}
            />
            <span className="text-[12.5px]">{rightWords(action)}</span>
          </label>
        ))}
      </div>
    </li>
  );
}

export function ShippingGrantsCard({
  grants,
  unticked,
  onTick,
}: {
  /** One entry per role and right, as the check step sends them. */
  grants: readonly { role: string; roleName: string; action: ShippingRight }[];
  /** The rights unticked so far. */
  unticked: readonly { role: string; action: ShippingRight }[];
  onTick: (role: string, action: ShippingRight, given: boolean) => void;
}) {
  if (grants.length === 0) return null;
  const roles = [...new Set(grants.map((grant) => grant.role))];
  return (
    <section className="rounded-[14px] border border-border bg-surface p-[14px]" data-testid="shipping-grants">
      <h3 className="flex items-center gap-[9px] text-[13px] font-extrabold">
        <Truck aria-hidden className="size-4 text-fg-muted" />
        {t('studio:hostedApps.install.shippingGrants.title', 'Who may handle shipping labels')}
      </h3>
      <p className="mt-1 text-[12px] leading-[1.5] text-fg-muted">
        {t('studio:hostedApps.install.shippingGrants.body', 'These roles may do the following with this app’s shipping labels. Untick anything a role should not do.')}
      </p>
      <ul className="mt-2 flex flex-col gap-[10px]">
        {roles.map((role) => {
          const held = grants.filter((grant) => grant.role === role);
          return <RoleRights key={role} role={role} roleName={held[0]!.roleName} actions={held.map((grant) => grant.action)} unticked={unticked} onTick={onTick} />;
        })}
      </ul>
    </section>
  );
}
