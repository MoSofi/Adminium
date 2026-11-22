// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SORTING STORED ROW LIMITS INTO THE APP'S AND THE OWNER'S.
 *
 * Limits stored before `ownerRows` existed say nothing of who set them. The
 * upgrade lists every install (meta wave 0106). At each start the server takes
 * them one by one: what the running version does not declare is the owner's.
 * One that cannot be read now stays on the list and does not hold up the
 * others, and until it is sorted no update changes its roles' limits.
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
  type InstalledManifest,
  type MetaDb,
  type Role,
  type RowLimit,
  type TableActions,
} from '@adminium/meta';

import { roleTablesOf } from '../add-ons/grants-wider.js';
import { installRoleSlug } from '../installs/resolve.js';
import { tableIdOrNull } from '../installs/table-id.js';
import { canonical } from '../rbac/role-within.js';
import { limitsOf, storedRowLimit } from './manifest-roles.js';
import { OWNER_ROW_LIMITS_PENDING_KEY, ownerRowsIn } from './owner-row-limits.js';

/** Only documents are read here: nothing asks for a credential. */
const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('no credential is written here');
  },
  decrypt: (): string => {
    throw new Error('no credential is read here');
  },
};

interface Declared {
  rows: RowLimit | undefined;
  /** On a table an add-on shares among apps: the condition the engine holds this app's roles to. */
  ownApp: { column: string; in: string[] } | null;
}

type ManifestRole = NonNullable<Manifest['roles']>[number];

/** What a version declares of which rows one role reaches, by table; null when the schema cannot be read now. */
async function declaredBy(meta: MetaDb, install: InstalledManifest, manifest: Manifest, declared: ManifestRole, addOns: readonly InstalledManifest[]): Promise<Map<string, Declared> | null> {
  const connectionId = install.row.connectionId;
  if (connectionId === null) return null;
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  if (snapshot === null) return null;
  const model = parseDatabaseModel(snapshot.schema);
  const declaredRoles = (manifest.roles ?? []) as ManifestRole[];
  const names = await appTablesRepo(meta).realNames(connectionId, manifest.key);
  const prefixed = (manifest.requiredSchema as { prefixed?: boolean } | undefined)?.prefixed === true;
  const tableId = (ref: string): string | null => {
    const real = names[ref] ?? (prefixed ? null : ref);
    return real === null ? null : tableIdOrNull(model, real);
  };
  const out = new Map<string, Declared>();
  for (const [ref, limit] of Object.entries(limitsOf(declared, declaredRoles))) {
    const id = tableId(ref);
    if (id !== null && limit.rows !== undefined) out.set(`${connectionId}/${id}`, { rows: storedRowLimit(limit.rows, (other) => tableId(other) ?? other), ownApp: null });
  }
  if (manifest.kind !== 'app') return out;
  const records = await appTablesRepo(meta).forConnection(connectionId);
  for (const entry of roleTablesOf(declared as never, declaredRoles as never)) {
    const record = records.find((one) => one.appKey === entry.addOn && one.ref === entry.table);
    const id = record === undefined ? null : tableIdOrNull(model, realTableOf(record));
    if (id === null) continue;
    const addOn = addOns.find((one) => one.row.manifestKey === entry.addOn)?.document as Manifest | null | undefined;
    const appColumn = (addOn?.requiredSchema?.tables.find((table) => table.ref === entry.table)?.appGrants as { appColumn?: string } | undefined)?.appColumn;
    const ownApp = appColumn === undefined ? null : { column: appColumn, in: [manifest.key] };
    const whole = entry.limit?.rows === undefined ? {} : storedRowLimit(entry.limit.rows);
    const rows: RowLimit = {};
    for (const action of ['read', 'update', 'delete'] as const) {
      if (!(entry.actions as readonly string[]).includes(action)) continue;
      const given = whole[action];
      if (ownApp === null) {
        if (given !== undefined) rows[action] = given;
        continue;
      }
      const reaches = given === undefined ? [{ reach: 'all' as const }] : Array.isArray(given) ? given : [given];
      if (reaches.some((reach) => reach.while !== undefined)) continue;
      const held = reaches.map((reach) => ({ ...reach, while: ownApp }));
      rows[action] = held.length === 1 ? held[0]! : held;
    }
    out.set(`${connectionId}/${id}`, { rows: Object.keys(rows).length === 0 ? undefined : rows, ownApp });
  }
  return out;
}

/** What the running version of a role's app declares of its rows, by table. Empty for a role no app made; null when it cannot be read now. */
export async function declaredRowLimitsOf(meta: MetaDb, role: Role): Promise<Map<string, RowLimit> | null> {
  if (role.appKey === null) return new Map();
  const manifests = manifestsRepo(meta, NO_SECRETS);
  const installs = await manifests.list();
  const install = installs.find((one) => one.row.id === role.manifestId) ?? installs.find((one) => one.row.manifestKey === role.appKey);
  const manifest = install?.document as Manifest | null | undefined;
  if (install === undefined || manifest === null || manifest === undefined) return new Map();
  const declared = (manifest.roles ?? []).find((one) => installRoleSlug(manifest.key, one.key, install.row.instanceSlug) === role.slug);
  if (declared === undefined) return new Map();
  const found = await declaredBy(meta, install, manifest, declared as ManifestRole, installs.filter((one) => one.row.kind === 'add-on'));
  if (found === null) return null;
  return new Map([...found].flatMap(([ref, one]) => (one.rows === undefined ? [] : [[ref, one.rows] as const])));
}

async function sortInstall(meta: MetaDb, install: InstalledManifest, addOns: readonly InstalledManifest[]): Promise<{ marked: number; done: boolean }> {
  const manifest = install.document as Manifest | null;
  if (manifest === null) return { marked: 0, done: false };
  const declaredRoles = (manifest.roles ?? []) as ManifestRole[];
  const roles = rolesRepo(meta);
  const permissions = permissionsRepo(meta);
  let marked = 0;
  let done = true;
  for (const declared of declaredRoles) {
    const role = await roles.findBySlug(installRoleSlug(manifest.key, declared.key, install.row.instanceSlug));
    if (role === null || role.appKey !== manifest.key) continue;
    const wanted = await declaredBy(meta, install, manifest, declared, addOns);
    for (const row of await permissions.listForRole(role.id)) {
      if (row.resourceKind !== 'table') continue;
      const actions = row.actions as TableActions;
      if (actions.rowLimit === undefined) continue;
      // Nothing to compare it with yet: this install comes round again.
      if (wanted === null) {
        done = false;
        break;
      }
      const here = wanted.get(row.resourceRef);
      const found = ownerRowsIn(actions.rowLimit, here?.rows, here?.ownApp ?? null);
      if (found === undefined) continue;
      // What was recorded since the upgrade is the owner's word on that action.
      const ownerRows = { ...found, ...(actions.ownerRows ?? {}) };
      if (canonical(ownerRows) === canonical(actions.ownerRows ?? null)) continue;
      await permissions.grant(role.id, 'table', row.resourceRef, { ...actions, ownerRows });
      marked += 1;
    }
  }
  return { marked, done };
}

/** Sorts every install still listed. Answers how many rows it found an owner's limit on. */
export async function markOwnerRowLimits(deps: { meta: MetaDb; onFailed?: (installId: string, error: unknown) => void }): Promise<number> {
  const { meta } = deps;
  const settings = settingsRepo(meta);
  const pending = await settings.get(OWNER_ROW_LIMITS_PENDING_KEY);
  if (pending.length === 0) return 0;
  const manifests = manifestsRepo(meta, NO_SECRETS);
  const installs = await manifests.list();
  const addOns = installs.filter((one) => one.row.kind === 'add-on');
  const left: string[] = [];
  let marked = 0;
  for (const id of pending) {
    const install = installs.find((one) => one.row.id === id);
    // An install gone since has no roles to sort.
    if (install === undefined) continue;
    try {
      const sorted = await sortInstall(meta, install, addOns);
      marked += sorted.marked;
      if (!sorted.done) left.push(id);
    } catch (error) {
      left.push(id);
      deps.onFailed?.(id, error);
    }
  }
  await settings.set(OWNER_ROW_LIMITS_PENDING_KEY, left);
  return marked;
}
