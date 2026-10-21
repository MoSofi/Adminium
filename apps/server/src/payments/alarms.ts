// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The alarms on the settings that send money somewhere else.
 *
 * Three changes move where a shop's money goes: a payment key that now
 * belongs to another provider account, new bank details on the bank-transfer
 * way, and a new pay address (every link, and the webhooks, now point there).
 * Each is already audited where it is made. This also tells every person who
 * may manage payments (each Super Admin included) at once, quiet hours or
 * not, in the app and by email: someone who did not make the change has to
 * learn about it before the next payment does.
 *
 * The notice's words are English fallbacks; its `kind` is the key the
 * notification centre words it by, in the reader's language, when shown.
 * The setup page reads the same changes back from the audit log (the last
 * 30 days), so the alarm stays on screen after the notice is read.
 */
import { auditRepo, permissionsRepo, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { notify, type NotificationPublisher } from '../notifications/notify.js';

export const MONEY_REDIRECT_KIND = 'payments.money-redirect';

/** The audit actions an alarm is raised for, and what each is about. */
export const ALARM_ACTIONS = {
  'payments.account.changed': 'account',
  'payments.bank.changed': 'bank',
  'payments.pay-address.changed': 'pay-address',
} as const;
export type AlarmKind = (typeof ALARM_ACTIONS)[keyof typeof ALARM_ACTIONS];

/** How long the setup page keeps showing an alarm. */
export const ALARM_SHOWN_MS = 30 * 24 * 3_600_000;

export interface MoneyRedirect {
  what: AlarmKind;
  /** The service it is about (`payments-stripe`), for an account change. */
  service: string | null;
  from: string | null;
  to: string | null;
  /** Who made the change, as the audit log names them. */
  by: string;
}

const TITLES: Record<AlarmKind, string> = {
  account: 'A payment key now belongs to another account',
  bank: 'The bank details for bank transfers changed',
  'pay-address': 'The pay address changed',
};

/** Everyone who may manage payments: each role granting `payments.manage`, and every Super Admin. */
export async function paymentManagers(meta: MetaDb): Promise<string[]> {
  const roles = rolesRepo(meta);
  const roleIds = new Set<string>();
  const superAdmin = await roles.findBySlug('super-admin');
  if (superAdmin !== null) roleIds.add(superAdmin.id);
  for (const grant of await permissionsRepo(meta).listForResource('system', 'payments.manage')) {
    if ((grant.actions as { allowed?: boolean }).allowed === true) roleIds.add(grant.roleId);
  }
  const people = new Set<string>();
  for (const roleId of roleIds) for (const userId of await roles.usersInRole(roleId)) people.add(userId);
  const active: string[] = [];
  for (const userId of people) {
    const user = await usersRepo(meta).findById(userId);
    if (user !== null && user.status === 'active') active.push(userId);
  }
  return active.sort();
}

/**
 * Tells every payment manager. Best effort: the change it reports has
 * already been made and audited, and a notice that cannot be written must
 * never undo it.
 */
export async function raiseMoneyRedirect(
  meta: MetaDb,
  change: MoneyRedirect,
  opts: { hub?: NotificationPublisher; origin?: string; at?: number } = {},
): Promise<number> {
  let told = 0;
  const body = [change.service, change.from === null ? null : `was ${change.from}`, change.to === null ? null : `now ${change.to}`, `by ${change.by}`].filter((part) => part !== null).join(' · ');
  for (const userId of await paymentManagers(meta).catch(() => [])) {
    try {
      await notify(
        meta,
        { userId, kind: MONEY_REDIRECT_KIND, actorLabel: change.by, title: TITLES[change.what], body, actionUrl: '/studio/payments' },
        { urgent: true, ...(opts.hub === undefined ? {} : { hub: opts.hub }), ...(opts.origin === undefined ? {} : { origin: opts.origin }), ...(opts.at === undefined ? {} : { at: opts.at }) },
      );
      told += 1;
    } catch {
      // One person's notice failing never stops the others'.
    }
  }
  return told;
}

/** The alarms of the last 30 days, newest first, from the audit log. */
export async function recentAlarms(meta: MetaDb, at: number): Promise<(MoneyRedirect & { at: number })[]> {
  const rows = await auditRepo(meta).list({ category: 'payments', limit: 200 });
  const out: (MoneyRedirect & { at: number })[] = [];
  for (const row of rows) {
    const what = (ALARM_ACTIONS as Record<string, AlarmKind | undefined>)[row.action];
    if (what === undefined || at - Number(row.createdAt) > ALARM_SHOWN_MS) continue;
    const before = (row.changes?.['before'] ?? null) as Record<string, unknown> | null;
    const after = (row.changes?.['after'] ?? null) as Record<string, unknown> | null;
    const field = what === 'account' ? 'accountId' : what === 'pay-address' ? 'origin' : null;
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    out.push({
      what,
      service: text(after?.['key']),
      from: field === null ? null : text(before?.[field]),
      to: field === null ? null : text(after?.[field]),
      by: row.actorLabel,
      at: Number(row.createdAt),
    });
  }
  return out;
}
