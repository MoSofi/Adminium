// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONCE: WRITE DOWN WHICH STORED ROW LIMITS ARE THE OWNER'S.
 *
 * Limits stored before `ownerRows` existed say nothing of who set them. At the
 * first boot of this version the installed version of each app is what wrote
 * its limits, so a stored limit it does not declare is the owner's. Run before
 * any later update can move the app on; a failure is tried again next boot.
 */
import { parseDatabaseModel } from '@adminium/engine';
import type { Manifest } from '@adminium/manifest';
import {
  appTablesRepo,
  manifestsRepo,
  permissionsRepo,
  realTableOf,
  rolesRepo,
  settingsRepo,
  snapshotsRepo,
  type MetaDb,
  type RowLimit,
  type TableActions,
} from '@adminium/meta';

import { roleTablesOf } from '../add-ons/grants-wider.js';
import { tableIdOrNull } from '../installs/table-id.js';
import { installRoleSlug } from '../installs/resolve.js';
import { limitsOf, storedRowLimit } from './manifest-roles.js';
import { ownerRowsIn } from './owner-row-limits.js';

export const OWNER_ROW_LIMITS_MARKED_KEY = 'system.ownerRowLimitsMarked';

export async function markOwnerRowLimits(deps: { meta: MetaDb; credentialCrypto: Parameters<typeof manifestsRepo>[1] }): Promise<number> {
  const { meta } = deps;
  const settings = settingsRepo(meta);
  if (await settings.get(OWNER_ROW_LIMITS_MARKED_KEY)) return 0;
  const roles = rolesRepo(meta);
  const permissions = permissionsRepo(meta);
  let marked = 0;
  for (const install of await manifestsRepo(meta, deps.credentialCrypto).list()) {
    const manifest = install.document as Manifest | null;
    const connectionId = install.row.connectionId;
    const declaredRoles = manifest?.roles ?? [];
    if (manifest === null || connectionId === null || declaredRoles.length === 0) continue;
    const snapshot = await snapshotsRepo(meta).latest(connectionId);
    const model = snapshot === null ? null : parseDatabaseModel(snapshot.schema);
    if (model === null) continue;
    const names = await appTablesRepo(meta).realNames(connectionId, manifest.key);
    const prefixed = (manifest.requiredSchema as { prefixed?: boolean } | undefined)?.prefixed === true;
    const tableId = (ref: string): string | null => {
      const real = names[ref] ?? (prefixed ? null : ref);
      return real === null ? null : tableIdOrNull(model, real);
    };
    const records = await appTablesRepo(meta).forConnection(connectionId);
    for (const declared of declaredRoles) {
      const role = await roles.findBySlug(installRoleSlug(manifest.key, declared.key, install.row.instanceSlug));
      if (role === null || role.appKey !== manifest.key) continue;
      const wanted = new Map<string, RowLimit>();
      for (const [ref, limit] of Object.entries(limitsOf(declared, declaredRoles))) {
        const id = tableId(ref);
        if (id !== null && limit.rows !== undefined) wanted.set(`${connectionId}/${id}`, storedRowLimit(limit.rows, (other) => tableId(other) ?? other));
      }
      for (const entry of manifest.kind === 'app' ? roleTablesOf(declared as never, declaredRoles as never) : []) {
        const record = records.find((one) => one.appKey === entry.addOn && one.ref === entry.table);
        const id = record === undefined ? null : tableIdOrNull(model, realTableOf(record));
        if (id !== null && entry.limit?.rows !== undefined) wanted.set(`${connectionId}/${id}`, storedRowLimit(entry.limit.rows));
      }
      for (const row of await permissions.listForRole(role.id)) {
        if (row.resourceKind !== 'table') continue;
        const actions = row.actions as TableActions;
        if (actions.rowLimit === undefined || actions.ownerRows !== undefined) continue;
        const ownerRows = ownerRowsIn(actions.rowLimit, wanted.get(row.resourceRef), manifest.key);
        if (ownerRows === undefined) continue;
        await permissions.grant(role.id, 'table', row.resourceRef, { ...actions, ownerRows });
        marked += 1;
      }
    }
  }
  await settings.set(OWNER_ROW_LIMITS_MARKED_KEY, true);
  return marked;
}
