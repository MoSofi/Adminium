// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether a person may save one add-on's settings through the per-add-on
 * grant `addOn:<key>:settings` — and not merely hold it.
 *
 * The grant's string says nothing about WHY it was given. An app gives it to
 * its roles for an add-on it works with; that is a reason only while the app
 * actually has the add-on: connected to it and switched on there. Without
 * this, an app that merely SUGGESTS an add-on it never connected would hand
 * its cashier the settings every other app shares (the payment instructions
 * printed on every invoice) the day someone else installs it.
 *
 * So, role by role:
 *  - a role of the workspace's own (no app) holds it as given — someone who
 *    may manage roles gave it by name;
 *  - an app's role holds it only while that app is installed and the add-on
 *    is installed, connected to that app, and switched on there;
 *  - an add-on's own role holds its own add-on's settings while the add-on is
 *    installed (its role exists for nothing else), and no other add-on's.
 *
 * Switching the app off already suspends its roles (the resolver); this adds
 * the add-on's side of the same question.
 */
import { offeredRoles } from './app-parts.js';
import { permissionsRepo, rolesRepo, type InstalledManifest, type MetaDb, type Role } from '@adminium/meta';

import { grantKeyOf } from '../installs/resolve.js';
import { addOnSettingsRef } from './permissions.js';
import type { RbacPrincipal } from './principal.js';

/**
 * Whether the person may save ONE INSTALL's settings. The install is resolved
 * first (the request's selector) and only then is its grant asked: a
 * Fernhill letterhead editor naming Kiln's database gets nothing, because
 * her role is tied to Fernhill's install.
 *
 *  - a role of the server's own (no app) holds the install's grant by name:
 *    `addOn:<key>:settings` for the install with the bare addresses,
 *    `addOn:<key>~<slug>:settings` for a later one;
 *  - an add-on's own role holds its own install's settings (it is that
 *    install's role) while the install is installed;
 *  - an app's role holds it while its own install is installed and this
 *    add-on install is attached to that app install and switched on there.
 */
export async function addOnSettingsGrantHeld(meta: MetaDb, principal: RbacPrincipal, install: InstalledManifest): Promise<boolean> {
  if (install.row.kind !== 'add-on') return false;
  const roles = rolesRepo(meta);
  let held: Role[];
  if (principal.kind === 'api-key') {
    const role = await roles.findById(principal.roleId);
    held = role === null ? [] : [role];
  } else {
    held = await roles.rolesForUser(principal.id);
  }
  // A role that is not offered (its part of the app is off) gives nothing, this grant included.
  held = await offeredRoles(meta, held);
  const permissions = permissionsRepo(meta);
  const key = install.row.manifestKey;
  const named = addOnSettingsRef(grantKeyOf(install.row));
  for (const role of held) {
    const holds = async (ref: string) => ((await permissions.find(role.id, 'app', ref))?.actions as { staff?: boolean } | undefined)?.staff === true;
    if (role.appKey === null) {
      if (await holds(named)) return true;
      continue;
    }
    // An app's or an add-on's role holds the grant as its manifest wrote it: the bare key, for its own install.
    if (!(await holds(addOnSettingsRef(key))) && !(await holds(named))) continue;
    if (role.manifestId === null) continue;
    if (role.appKey === key) {
      if (role.manifestId === install.row.id && install.row.status === 'installed') return true;
      continue;
    }
    const app = await meta.db.selectFrom('adminium_manifests').select(['id']).where('id', '=', role.manifestId).where('kind', '=', 'app').where('status', '=', 'installed').executeTakeFirst();
    if (app === undefined || install.row.status !== 'installed') continue;
    if (install.attachments.some((attachment) => attachment.attachedTo === role.appKey && attachment.hostInstall === app.id && attachment.disabledAt === null)) return true;
  }
  return false;
}
