// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHOSE PEOPLE A PRIVACY REQUEST REACHES.
 *
 * `privacy.manage` (the Super Admin's) reaches everything the workspace keeps
 * about an address, as it always has. `privacy.people` alone is narrower:
 * an app's role carries it (`privacy:@:people`) so a shop's owner answers
 * their own customers, and it reaches only the apps whose roles give it to
 * them —
 *
 *  - those apps' people tables and the copies they declare (with the add-on
 *    rows their declared links reach), and their outboxes;
 *  - what Adminium keeps about the rows found there (campaign mail, documents,
 *    payments, run history, notifications and files of those rows), never a
 *    store matched by the address alone, which no app owns (a campaign's
 *    failure list, a designer invoice, a payment service's message);
 *  - the consent log's rows about those rows, never the do-not-email list
 *    (the workspace's) nor a forms add-on's answers (the dashboard's);
 *  - their own downloads.
 *
 * A role made on the Team page (no app) that carries `privacy.people` was
 * given it by someone who manages roles for the whole workspace: it reaches
 * the whole workspace, as `privacy.manage` does, without the notice or the
 * websites.
 *
 * Whoever holds `privacy.people` without `privacy.manage` may never look up
 * or erase an address that is a staff account's: erasing it would rewrite
 * the audit log's record of what that person did and had done to them.
 */
import { rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { AppError } from '../errors.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { permissionSetAllows, resolveForRoles, resolvePermissionSet } from '../rbac/resolver.js';

/** The apps a request reaches; `null` reaches the whole workspace. */
export type AppScope = ReadonlySet<string> | null;

export interface PrivacyScope {
  /** Holds `privacy.manage`: the whole workspace, a staff address included. */
  manage: boolean;
  apps: AppScope;
}

/** What a person may reach with the privacy action, or null when they may not use it at all (or are not active). */
export async function privacyScopeOf(meta: MetaDb, userId: string): Promise<PrivacyScope | null> {
  const user = await usersRepo(meta).findById(userId);
  if (user === null || user.status !== 'active') return null;
  const set = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.name });
  if (permissionSetAllows(set, PERMISSIONS.privacyManage)) return { manage: true, apps: null };
  if (!permissionSetAllows(set, PERMISSIONS.privacyPeople)) return null;
  // Role by role: which of them gives it, and for which app. A role of an app that is off gives nothing.
  const apps = new Set<string>();
  for (const role of await rolesRepo(meta).rolesForUser(user.id)) {
    if (!permissionSetAllows(await resolveForRoles(meta, [role]), PERMISSIONS.privacyPeople)) continue;
    if (role.appKey === null) return { manage: false, apps: null };
    apps.add(role.appKey);
  }
  return { manage: false, apps };
}

/** Whether an app's rows are within the scope. */
export const inScope = (apps: AppScope | undefined, appKey: string): boolean => apps === undefined || apps === null || apps.has(appKey);

/** The sentence a staff account's address is refused with (the page says it in the reader's language, by its code). */
export const STAFF_ADDRESS_REFUSAL = 'This address belongs to a member of staff here. Only someone who manages privacy for the whole server may look it up or erase it.';

/** Refuses a staff account's address to a holder of `privacy.people` alone. */
export async function refuseStaffAddress(meta: MetaDb, scope: PrivacyScope, address: string): Promise<void> {
  if (scope.manage) return;
  if ((await usersRepo(meta).findByEmail(address)) !== null) throw new AppError(403, 'STAFF_ADDRESS', STAFF_ADDRESS_REFUSAL);
}
