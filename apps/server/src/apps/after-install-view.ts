// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN INSTALL'S "AFTER YOU INSTALL" LIST, AS ITS PAGE SHOWS IT.
 *
 * `after-install.ts` records what a person still has to fill in after an
 * install (a webhook's address, a mail's sender, who a report goes to, a
 * console permission). This reads that list back for one install, with:
 *
 *  - what each item points at, by its name (the rule, the mail, the report,
 *    the document, the role) — never the value to fill in;
 *  - the permission a person needs to do it (`right`), and so whether the
 *    reader may tick it;
 *  - whether the server can see it done already (`seen`): the rule's address
 *    filled in, the mail's sender set, the report's recipients chosen, the
 *    role given the permission. A seen item reads as done though nobody
 *    ticked it. Best effort: payment keys and bank accounts are never seen,
 *    only ticked.
 */
import {
  appAfterInstallRepo,
  appPartsRepo,
  appTablesRepo,
  automationsRepo,
  documentProfilesRepo,
  emailTemplatesRepo,
  realTableOf,
  rolesRepo,
  scheduledReportsRepo,
  type AfterInstallItem as StoredItem,
  type MetaDb,
} from '@adminium/meta';

import { installRoleSlug, installTemplateKey } from '../installs/resolve.js';
import { isGranted, PERMISSIONS } from '../rbac/permissions.js';
import { resolveForRoles } from '../rbac/resolver.js';
import type { AfterInstallKind } from './after-install.js';
import { afterInstallItemsOfRule } from './manifest-automations.js';

/** The permission each kind of item needs: the one the screen it is done on is kept behind. */
export const AFTER_INSTALL_RIGHTS: Readonly<Record<AfterInstallKind, string>> = {
  webhook: PERMISSIONS.automationsManage,
  address: PERMISSIONS.automationsManage,
  // A rule's step that makes a document: chosen on the rule.
  document: PERMISSIONS.automationsManage,
  // The slot a document is mailed to: on the app's document set-up, kept behind the manifests grant.
  delivery: PERMISSIONS.manifestsManage,
  recipients: PERMISSIONS.reportsManage,
  'payment-key': PERMISSIONS.paymentsManage,
  'bank-account': PERMISSIONS.paymentsManage,
  sender: PERMISSIONS.settingsManage,
  'system-grant': PERMISSIONS.rolesManage,
};

export type AfterInstallLinkTo = 'automation' | 'email-templates' | 'reports' | 'roles' | 'payments' | 'documents' | 'settings';

export interface AfterInstallViewItem {
  id: string;
  kind: string;
  item: string;
  field: string;
  name: string | null;
  done: boolean;
  doneBy: { id: string; name: string } | null;
  doneAt: number | null;
  seen: boolean;
  right: string;
  canTick: boolean;
  link: { to: AfterInstallLinkTo; id?: string } | null;
}

export interface AfterInstallView {
  items: AfterInstallViewItem[];
  hidden: boolean;
}

/** The install, as this list is about it. */
export interface AfterInstallInstall {
  id: string;
  manifestKey: string;
  connectionId: string | null;
  instanceSlug: string;
}

export function rightOf(kind: string): string {
  return (AFTER_INSTALL_RIGHTS as Record<string, string | undefined>)[kind] ?? PERMISSIONS.manifestsManage;
}

interface Found {
  name: string | null;
  seen: boolean;
  link: AfterInstallViewItem['link'];
}

/** What one item points at, and whether it is done there already. */
function finder(meta: MetaDb, install: AfterInstallInstall): (item: StoredItem) => Promise<Found> {
  const key = install.manifestKey;
  // Each source read once per list.
  let rules: Promise<Awaited<ReturnType<ReturnType<typeof automationsRepo>['listManagedBy']>>> | null = null;
  let templates: Promise<Awaited<ReturnType<ReturnType<typeof emailTemplatesRepo>['listManagedBy']>>> | null = null;
  let roles: Promise<Awaited<ReturnType<ReturnType<typeof rolesRepo>['listForInstall']>>> | null = null;
  const none: Found = { name: null, seen: false, link: null };

  return async (row) => {
    switch (row.kind) {
      case 'webhook':
      case 'address':
      case 'document': {
        rules ??= automationsRepo(meta).listManagedBy(key, install.connectionId);
        const rule = (await rules).find((one) => (one.installId === null || one.installId === install.id) && one.templateKey === row.item);
        if (rule === undefined) return none;
        const open = afterInstallItemsOfRule(row.item, rule.graph);
        const seen = !open.some((one) => one.kind === row.kind && one.field === row.field);
        return { name: rule.name, seen, link: { to: 'automation', id: rule.id } };
      }
      case 'sender': {
        templates ??= emailTemplatesRepo(meta).listManagedBy(key, install.id);
        const stored = installTemplateKey(row.item, { key, slug: install.instanceSlug });
        const mine = (await templates).filter((one) => one.key === stored);
        if (mine.length === 0) return none;
        const seen = mine.every((one) => typeof one.brand?.fromEmail === 'string' && one.brand.fromEmail.trim() !== '');
        return { name: mine[0]!.name, seen, link: { to: 'email-templates', id: mine[0]!.id } };
      }
      case 'recipients': {
        const part = (await appPartsRepo(meta).list(install.id, 'scheduled-report')).find((one) => one.partKey === row.item);
        if (part === undefined) return { ...none, link: { to: 'reports' } };
        const schedule = await scheduledReportsRepo(meta).findById(part.targetId);
        if (schedule === null) return { ...none, link: { to: 'reports' } };
        return { name: schedule.name, seen: schedule.recipients.length > 0, link: { to: 'reports', id: schedule.id } };
      }
      case 'delivery': {
        if (install.connectionId === null) return none;
        const slash = row.item.lastIndexOf('/');
        const ref = row.item.slice(0, slash);
        const kind = row.item.slice(slash + 1);
        const record = (await appTablesRepo(meta).forInstall(install.connectionId, key)).find((one) => one.ref === ref);
        const real = record === undefined ? ref : realTableOf(record);
        const ofKind = (await documentProfilesRepo(meta).listOwnedBy(install.connectionId, key)).filter((one) => one.kind === kind);
        const profile = ofKind.length === 1 ? ofKind[0] : ofKind.find((one) => one.table === real || one.table.endsWith(`.${real}`) || one.table.endsWith(`/${real}`));
        if (profile === undefined) return { ...none, link: { to: 'documents' } };
        const slot = (profile.deliver as { emailSlot?: unknown }).emailSlot;
        return { name: profile.name, seen: typeof slot === 'string' && slot !== '', link: { to: 'documents', id: profile.id } };
      }
      case 'system-grant': {
        roles ??= rolesRepo(meta).listForInstall(install.id);
        const slug = installRoleSlug(key, row.item, install.instanceSlug);
        const role = (await roles).find((one) => one.slug === slug);
        if (role === undefined) return { ...none, link: { to: 'roles' } };
        const grants = await resolveForRoles(meta, [role]);
        return { name: role.name, seen: isGranted(grants.grants, row.field), link: { to: 'roles', id: role.id } };
      }
      case 'payment-key':
      case 'bank-account':
        return { name: null, seen: false, link: { to: 'payments' } };
      default:
        return none;
    }
  };
}

/** The install's list as its page shows it, for a reader who holds `can`. */
export async function afterInstallView(meta: MetaDb, install: AfterInstallInstall, can: (permission: string) => Promise<boolean>): Promise<AfterInstallView> {
  const repo = appAfterInstallRepo(meta);
  const rows = await repo.list(install.id);
  const find = finder(meta, install);
  const names = new Map<string, string>();
  const doneByIds = [...new Set(rows.map((row) => row.doneBy).filter((one): one is string => one !== null))];
  if (doneByIds.length > 0) {
    const users = await meta.db.selectFrom('adminium_users').select(['id', 'name', 'email']).where('id', 'in', doneByIds).execute();
    for (const user of users) names.set(user.id, user.name !== null && user.name !== '' ? user.name : user.email);
  }
  const rights = new Map<string, boolean>();
  const items: AfterInstallViewItem[] = [];
  for (const row of rows) {
    const right = rightOf(row.kind);
    if (!rights.has(right)) rights.set(right, await can(right));
    const found = await find(row);
    items.push({
      id: row.id,
      kind: row.kind,
      item: row.item,
      field: row.field,
      name: found.name,
      done: row.done || found.seen,
      doneBy: row.done && row.doneBy !== null ? { id: row.doneBy, name: names.get(row.doneBy) ?? row.doneBy } : null,
      doneAt: row.done ? row.doneAt : null,
      seen: found.seen,
      right,
      canTick: rights.get(right) ?? false,
      link: found.link,
    });
  }
  const allDone = items.every((item) => item.done);
  return { items, hidden: allDone && (await repo.hiddenAt(install.id)) !== null };
}
