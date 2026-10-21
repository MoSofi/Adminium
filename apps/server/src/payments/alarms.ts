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
import { randomBytes } from 'node:crypto';

import type { MetaDb } from '@adminium/meta';

import type { NotificationPublisher } from '../notifications/notify.js';
import { paymentManagers, providerName, tellPaymentManagers } from './notices.js';

export { paymentManagers };

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

/**
 * Tells every payment manager. Best effort: the change it reports has
 * already been made and audited, and a notice that cannot be written must
 * never undo it.
 */
export async function raiseMoneyRedirect(
  meta: MetaDb,
  change: MoneyRedirect,
  opts: { hub?: NotificationPublisher; at?: number } = {},
): Promise<number> {
  const at = opts.at ?? Date.now();
  return tellPaymentManagers(
    { meta, now: () => at, ...(opts.hub === undefined ? {} : { hub: opts.hub }) },
    {
      kind: MONEY_REDIRECT_KIND,
      // Every change is told: each is its own thing.
      about: `redirect:${change.what}:${String(at)}:${randomBytes(4).toString('hex')}`,
      urgent: true,
      actorLabel: change.by,
      words: () => ({
        title: { key: `redirect.${change.what === 'pay-address' ? 'payAddress' : change.what}`, fallback: TITLES[change.what] },
        body: {
          key: change.from === null && change.to === null ? 'redirect.byOnly' : change.from === null ? 'redirect.byTo' : 'redirect.body',
          fallback: change.from === null && change.to === null ? 'By {by}' : change.from === null ? 'Now {to} · by {by}' : 'Was {from} · now {to} · by {by}',
        },
        values: { by: change.by, from: change.from ?? '', to: change.to ?? '', service: change.service === null ? '' : providerName(change.service) },
      }),
    },
  );
}

/** The alarms of the last 30 days, newest first, from the audit log. */
export async function recentAlarms(meta: MetaDb, at: number): Promise<(MoneyRedirect & { at: number })[]> {
  // Asked of the database by action and age, so a busy month of other payment rows never pushes one out.
  const rows = await meta.db
    .selectFrom('adminium_audit_log')
    .select(['action', 'actorLabel', 'changes', 'createdAt'])
    .where('category', '=', 'payments')
    .where('action', 'in', Object.keys(ALARM_ACTIONS))
    .where('createdAt', '>=', at - ALARM_SHOWN_MS)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .execute();
  const out: (MoneyRedirect & { at: number })[] = [];
  for (const row of rows) {
    const what = (ALARM_ACTIONS as Record<string, AlarmKind | undefined>)[row.action];
    if (what === undefined) continue;
    const changes = (typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes) as Record<string, unknown> | null;
    const before = (changes?.['before'] ?? null) as Record<string, unknown> | null;
    const after = (changes?.['after'] ?? null) as Record<string, unknown> | null;
    // Choosing the first pay address, or saving the same one, moves nothing.
    if (what === 'pay-address' && (before?.['origin'] == null || before['origin'] === after?.['origin'])) continue;
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
