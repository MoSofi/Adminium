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
 *    is installed, connected to that app, and switched on there.
 *
 * Switching the app off already suspends its roles (the resolver); this adds
 * the add-on's side of the same question.
 */
import { permissionsRepo, rolesRepo, type MetaDb, type Role } from '@adminium/meta';

import { addOnSettingsRef } from './permissions.js';
import type { RbacPrincipal } from './principal.js';

export async function addOnSettingsGrantHeld(meta: MetaDb, principal: RbacPrincipal, addOnKey: string): Promise<boolean> {
  const roles = rolesRepo(meta);
  let held: Role[];
  if (principal.kind === 'api-key') {
    const role = await roles.findById(principal.roleId);
    held = role === null ? [] : [role];
  } else {
    held = await roles.rolesForUser(principal.id);
  }
  const permissions = permissionsRepo(meta);
  for (const role of held) {
    const row = await permissions.find(role.id, 'app', addOnSettingsRef(addOnKey));
    if ((row?.actions as { staff?: boolean } | undefined)?.staff !== true) continue;
    if (role.appKey === null) return true;
    const app = await meta.db
      .selectFrom('adminium_manifests')
      .select('id')
      .where('manifestKey', '=', role.appKey)
      .where('kind', '=', 'app')
      .where('status', '=', 'installed')
      .executeTakeFirst();
    if (app === undefined) continue;
    const attached = await meta.db
      .selectFrom('adminium_manifest_attachments as a')
      .innerJoin('adminium_manifests as m', 'm.id', 'a.manifestId')
      .select('a.id')
      .where('m.manifestKey', '=', addOnKey)
      .where('m.kind', '=', 'add-on')
      .where('m.status', '=', 'installed')
      .where('a.attachedTo', '=', role.appKey)
      .where('a.disabledAt', 'is', null)
      .executeTakeFirst();
    if (attached !== undefined) return true;
  }
  return false;
}
