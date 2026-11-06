// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which installs of a key a request's person may reach.
 *
 * With several installs of a key and nothing naming which, a route answers
 * `409 APP_INSTALL_AMBIGUOUS` with a list to choose from. That list names
 * databases, so it holds only the installs this person could act on anyway,
 * checked before any name is read. Someone who reaches none of them gets the
 * route's own 403 or 404, as if the key were installed once.
 *
 * A person reaches an install when they manage installs (`manifests.manage`),
 * hold that install's own grant (its staff screens, or its add-on settings),
 * or hold a right on a table of its database. An install kept once per
 * server names no database, so it is never hidden.
 */
import type { InstalledManifest, MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import { addOnSettingsGrantHeld } from '../rbac/add-on-grant.js';
import { parseGrant, PERMISSIONS } from '../rbac/permissions.js';
import { getPrincipal } from '../rbac/principal.js';
import type { PermissionSet } from '../rbac/resolver.js';
import { grantKeyOf } from './resolve.js';

export type InstallReach = (install: InstalledManifest) => Promise<boolean>;

/** Whether a grant string gives a right on some table of a database. */
function tableGrantOn(grant: string, connectionId: string): boolean {
  const parsed = parseGrant(grant);
  return parsed !== null && parsed.kind === 'table' && (parsed.connectionId === '*' || parsed.connectionId === connectionId);
}

/** The installs a request's person reaches, asked one at a time. */
export function installReachOf(meta: MetaDb, request: FastifyRequest): InstallReach {
  return async (install) => {
    // A harness with no RBAC wired: every install, as every check there passes.
    if (typeof request.can !== 'function') return true;
    if (await request.can(PERMISSIONS.manifestsManage)) return true;
    const connectionId = install.row.connectionId;
    if (connectionId === null) return true;
    const grantKey = grantKeyOf(install.row);
    if (install.row.kind === 'app' && (await request.can(`app:${grantKey}:staff` as never))) return true;
    if (install.row.kind === 'add-on') {
      const principal = getPrincipal(request);
      if (principal !== null && (await addOnSettingsGrantHeld(meta, principal, install))) return true;
    }
    const set = request.server.hasDecorator('rbac') ? await request.server.rbac.resolve(request) : null;
    if (set === null) return false;
    if (set.superAdmin) return true;
    // A set built without grants (a harness's) reaches no table.
    const grants: Iterable<string> = (set as Partial<PermissionSet>).grants ?? [];
    for (const grant of grants) if (tableGrantOn(grant, connectionId)) return true;
    return false;
  };
}
