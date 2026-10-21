// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Telling the people who manage payments: one notice per thing, in each
 * reader's own language.
 *
 * Every payment manager (each role granting `payments.manage`, and every
 * Super Admin) is told, through the notifications system and its email leg.
 * The words are chosen per reader, from the `payments` words, when the
 * notice is written: the notification centre shows what is stored.
 *
 * TOLD ONCE. Each notice names what it is about (`landed:<attempt>`,
 * `key-refused:<service>:<mode>:<check time>`); the first writer claims that
 * name in the payment settings, in every process, and the others stay
 * quiet. The claims are dropped after 90 days.
 *
 * Kinds (the notice's `kind`, which is also what a person's notification
 * settings switch on and off):
 *   - `payments.landed`      a payment arrived and was recorded (a late SEPA success too);
 *   - `payments.needs-look`  a payment arrived and something did not follow:
 *                            not recorded, not the amount asked, after a void, twice,
 *                            in the other mode, or its recorded row went missing;
 *   - `payments.key-refused` a service refused its key: payments are paused;
 *   - `payments.webhook`     a service's webhook has gone quiet;
 *   - `payments.reads`       the sweep slowed: half the provider's read allowance is used;
 *   - `payments.keys-removed` a person removed a service's keys (Disconnect);
 *   - `payments.refund-failed`, `payments.dispute` (refunds and disputes say these).
 */
import { paymentSettingsRepo, permissionsRepo, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { translatorFor } from '../i18n/server-i18n.js';
import { notify, type NotificationPublisher } from '../notifications/notify.js';

export const NOTICE_KINDS = ['payments.landed', 'payments.needs-look', 'payments.key-refused', 'payments.webhook', 'payments.reads', 'payments.keys-removed', 'payments.refund-failed', 'payments.dispute'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** The words of a notice: a key under `payments:notice.` for the title and one for the body, with their values. */
export interface NoticeWords {
  title: { key: string; fallback: string };
  body: { key: string; fallback: string };
  values: Record<string, string>;
}

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

/** How long a "told once" claim is kept. */
export const NOTICE_CLAIM_DAYS = 90;
export const NOTICE_CLAIM_PREFIX = 'notice:';

const claimSchema = z.object({ at: z.number() }).strict();

export interface NoticeDeps {
  meta: MetaDb;
  hub?: NotificationPublisher;
  now?: () => number;
}

/** A provider's name as a reader sees it. */
export function providerName(key: string): string {
  if (key === 'payments-stripe') return 'Stripe';
  if (key === 'payments-paypal') return 'PayPal';
  if (key === 'demo') return 'Demo';
  return key.replace(/^payments-/, '');
}

/** An amount in the reader's language, Latin digits, at the amount's own decimals. */
export function noticeMoney(amount: string, currency: string, locale: string): string {
  const decimals = (amount.split('.')[1] ?? '').length;
  try {
    // The decimal string itself: exact, where a Number would round past 15 digits.
    return new Intl.NumberFormat(`${locale.replace('_', '-')}-u-nu-latn`, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount as `${number}`);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** A day in the reader's language ("14 Nov"), Latin digits. */
export function noticeDay(at: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(`${locale.replace('_', '-')}-u-nu-latn`, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/**
 * Tells every payment manager once about `about`. `words` is built per
 * reader (amounts and days are in their language). Best effort: a notice
 * that cannot be written never undoes what it reports. Returns how many were
 * told (0 when it was told before).
 */
export async function tellPaymentManagers(
  deps: NoticeDeps,
  notice: { kind: NoticeKind | 'payments.money-redirect'; about: string; urgent?: boolean; actionUrl?: string; actorLabel?: string | null; words: (locale: string) => NoticeWords },
): Promise<number> {
  const at = (deps.now ?? Date.now)();
  const docs = paymentSettingsRepo(deps.meta);
  const claimName = `${NOTICE_CLAIM_PREFIX}${notice.about}`;
  // Who to tell first: a notice claimed and then told to nobody (the lookup failed) would be lost for good.
  let managers: string[];
  try {
    managers = await paymentManagers(deps.meta);
  } catch {
    return 0;
  }
  if (managers.length === 0) return 0;
  try {
    if (!(await docs.claim(claimName, claimSchema, { at }, at))) return 0;
  } catch {
    return 0;
  }
  let told = 0;
  for (const userId of managers) {
    try {
      const i18n = await translatorFor(deps.meta, userId);
      const locale = String(i18n.language || 'en-US');
      const words = notice.words(locale);
      // i18n-dynamic-key: each notice names its own words under `payments:notice.`, with the English beside them (a test holds the two together).
      const say = (part: { key: string; fallback: string }) => i18n.t(`payments:notice.${part.key}`, { defaultValue: part.fallback, ...words.values });
      await notify(
        deps.meta,
        { userId, kind: notice.kind, ...(notice.actorLabel == null ? {} : { actorLabel: notice.actorLabel }), title: say(words.title), body: say(words.body), actionUrl: notice.actionUrl ?? '/studio/payments' },
        { urgent: notice.urgent === true, at, ...(deps.hub === undefined ? {} : { hub: deps.hub }) },
      );
      told += 1;
    } catch {
      // One person's notice failing never stops the others'.
    }
  }
  // Told to nobody: let the claim go, so the next run tries again.
  if (told === 0) await docs.remove(claimName).catch(() => undefined);
  return told;
}

/** Which of these notices were told already: one read, so a run does not try hundreds of claims it would lose. */
export async function toldAlready(meta: MetaDb, abouts: readonly string[]): Promise<Set<string>> {
  const names = await paymentSettingsRepo(meta).existing(abouts.map((about) => `${NOTICE_CLAIM_PREFIX}${about}`));
  return new Set([...names].map((name) => name.slice(NOTICE_CLAIM_PREFIX.length)));
}

/** Drops "told once" claims older than the keep: the same thing is not told twice within it. */
export async function gcNoticeClaims(meta: MetaDb, at: number): Promise<number> {
  return paymentSettingsRepo(meta).gcPrefix(NOTICE_CLAIM_PREFIX, at - NOTICE_CLAIM_DAYS * 86_400_000);
}
