// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who hears about a connected account, and what they read.
 *
 *  - The connect link goes to the address on the row, and nowhere else.
 *  - Every new connection tells the person, at the address on file, which
 *    account was connected, and tells whoever manages the app's connections.
 *    That is how a wrong or hostile connect gets noticed.
 *  - A provider refusing the install's client is one notice to those managers.
 *    It is never six people being told to reconnect.
 *
 * Everything here is best effort: a mail that cannot go never undoes a
 * connection that was made.
 */
import { permissionsRepo, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { ACCOUNT_CONNECTED_TEMPLATE_KEY, CONNECT_LINK_TEMPLATE_KEY, enqueueEmail, type EmailLogger } from '../email/send.js';
import { recipientLocale, translatorFor } from '../i18n/server-i18n.js';
import { notify, type NotificationPublisher } from '../notifications/notify.js';

export const ACCOUNT_NOTICE_KINDS = ['accounts.connected', 'accounts.setup-refused', 'accounts.secret-ending', 'calendar.clash', 'calendar.stale-dropped', 'calendar.removed', 'calendar.remade', 'calendar.push-silent', 'calendar.unreadable'] as const;
export type AccountNoticeKind = (typeof ACCOUNT_NOTICE_KINDS)[number];

export interface AccountNoticeDeps {
  meta: MetaDb;
  secret?: string | undefined;
  hub?: NotificationPublisher | undefined;
  logger?: EmailLogger | undefined;
  now?: () => number;
}

/**
 * Who manages an app's connections: Super Admins, and each role that may both
 * send a link and disconnect. A front desk (links only) and a specialist
 * (their own row) hold one or the other, so neither is told of everyone's.
 */
export async function accountManagers(meta: MetaDb, appKey: string | null): Promise<string[]> {
  const roles = rolesRepo(meta);
  const roleIds = new Set<string>();
  const superAdmin = await roles.findBySlug('super-admin');
  if (superAdmin !== null) roleIds.add(superAdmin.id);
  if (appKey !== null) {
    const holders = async (action: string) =>
      new Set((await permissionsRepo(meta).listForResource('app', `accounts-${action}/${appKey}`)).filter((grant) => (grant.actions as { staff?: boolean }).staff === true).map((grant) => grant.roleId));
    const links = await holders('send-link');
    for (const roleId of await holders('disconnect')) if (links.has(roleId)) roleIds.add(roleId);
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

/** Tells whoever manages an app's connections. Never throws. */
export async function tellAccountManagers(
  deps: AccountNoticeDeps,
  appKey: string | null,
  kind: AccountNoticeKind,
  words: { title: { key: string; fallback: string }; body: { key: string; fallback: string }; values: Record<string, string> },
): Promise<void> {
  let managers: string[];
  try {
    managers = await accountManagers(deps.meta, appKey);
  } catch {
    return;
  }
  for (const userId of managers) {
    try {
      const i18n = await translatorFor(deps.meta, userId);
      // i18n-dynamic-key: each notice names its words under `addOns:accounts.notice.`, with the English beside them.
      const say = (part: { key: string; fallback: string }) => i18n.t(`addOns:accounts.notice.${part.key}`, { defaultValue: part.fallback, ...words.values });
      await notify(deps.meta, { userId, kind, title: say(words.title), body: say(words.body), actionUrl: '/studio/add-ons' }, { at: (deps.now ?? Date.now)(), ...(deps.hub === undefined ? {} : { hub: deps.hub }) });
    } catch {
      // One person's notice failing never stops the others'.
    }
  }
}

export function tellConnected(deps: AccountNoticeDeps, input: { appKey: string | null; provider: string; person: string; account: string }): Promise<void> {
  return tellAccountManagers(deps, input.appKey, 'accounts.connected', {
    title: { key: 'connectedTitle', fallback: '{person} connected an account' },
    body: { key: 'connectedBody', fallback: '{person} is now connected to {provider} as {account}.' },
    values: { person: input.person, provider: input.provider, account: input.account },
  });
}

export function tellClientRefused(deps: AccountNoticeDeps, input: { appKey: string | null; provider: string }): Promise<void> {
  return tellAccountManagers(deps, input.appKey, 'accounts.setup-refused', {
    title: { key: 'refusedTitle', fallback: '{provider} refused this server’s app' },
    body: { key: 'refusedBody', fallback: 'Check the client ID and secret saved for {provider}. Nobody needs to reconnect: connections resume once the app is accepted.' },
    values: { provider: input.provider },
  });
}

export function tellSecretEnding(deps: AccountNoticeDeps, input: { appKey: string | null; provider: string; date: string }): Promise<void> {
  return tellAccountManagers(deps, input.appKey, 'accounts.secret-ending', {
    title: { key: 'secretEndingTitle', fallback: 'The {provider} client secret ends on {date}' },
    body: { key: 'secretEndingBody', fallback: 'Make a new client secret and paste it into the setup guide before that day, or every {provider} connection stops. Nobody needs to reconnect.' },
    values: { provider: input.provider, date: input.date },
  });
}

/** Sends a connect link to the row's address. False: mail is not set up, or it could not be queued. */
export async function mailConnectLink(deps: AccountNoticeDeps, input: { to: string; business: string; person: string; link: string; days: number; about: string }): Promise<boolean> {
  try {
    const locale = await recipientLocale(deps.meta, null);
    const job = await enqueueEmail(
      { meta: deps.meta, ...(deps.secret === undefined ? {} : { secret: deps.secret }), ...(deps.logger === undefined ? {} : { logger: deps.logger }) },
      {
        to: input.to,
        templateKey: CONNECT_LINK_TEMPLATE_KEY,
        locale,
        vars: { business: input.business, name: input.person, link: input.link, days: String(input.days) },
        dedupeKey: `connect-link:${input.about}`,
      },
    );
    return job !== null;
  } catch {
    return false;
  }
}

/** Tells the person at the address on file which account was connected. */
export async function mailConnected(deps: AccountNoticeDeps, input: { to: string; business: string; person: string; provider: string; account: string; about: string }): Promise<void> {
  try {
    const locale = await recipientLocale(deps.meta, null);
    await enqueueEmail(
      { meta: deps.meta, ...(deps.secret === undefined ? {} : { secret: deps.secret }), ...(deps.logger === undefined ? {} : { logger: deps.logger }) },
      {
        to: input.to,
        templateKey: ACCOUNT_CONNECTED_TEMPLATE_KEY,
        locale,
        vars: { business: input.business, name: input.person, provider: input.provider, account: input.account },
        dedupeKey: `account-connected:${input.about}`,
      },
    );
  } catch {
    // The connection stands.
  }
}
