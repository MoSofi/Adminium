// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The roles an app's manifest declares — a till's cashier, its manager —
 * installed as `<appKey>-<key>` roles that belong to the app.
 *
 * A manifest cannot know the install's connection, its tables' real names or
 * its pages' ids, so it grants through placeholders, filled in once the
 * tables exist and have been introspected:
 *
 *   `table:@<ref>:<action>`   read | create | update | delete | export | import | read_pii
 *   `page:@<pageRef>:<action>` view | edit
 *   `app:@:staff`              the app's own staff screens
 *   `addOn:<key>:settings`     one add-on's non-secret settings — only an add-on
 *                              the app requires or suggests, never "every add-on"
 *
 * `read_pii` shows the table's personal columns in clear (crud/mask.ts): a
 * reception that rings patients holds it on the patients table.
 *
 * Grants are SEEDED ONCE, like the built-in roles': a ledger of
 * `<role slug>|<placeholder>` pairs remembers what an install has already
 * given, so an update adds only what a new version asks for and an operator's
 * narrowing of an app role survives it.
 *
 * A role's `limits` (what its update on a table may write) are not grants and
 * are not seeded once: every install and update writes the manifest's
 * current limits onto the role's rows, and takes away one the manifest no
 * longer declares. A limit only ever narrows the app's own grant, so
 * following the app's latest word on it widens nothing the operator gave.
 *
 * Refused at plan time: a `system:` grant (an app may not hand out the
 * console), a wildcard, a reference to a table or page the app does not
 * declare, `cloneFrom` anything but another of its own roles, and a slug
 * longer than the column holds.
 */
import { parseDatabaseModel } from '@adminium/engine';
import type { Manifest } from '@adminium/manifest';
import { pagesRepo, permissionsRepo, rolesRepo, settingsRepo, snapshotsRepo, type MetaDb, type TableActions, type UpdateLimit } from '@adminium/meta';

import { matrixRowsFromGrants } from '../rbac/permissions.js';

type ManifestRole = NonNullable<Extract<Manifest, { kind: 'app' }>['roles']>[number];

/** `adminium_roles.slug` is `str(40)`. */
export const ROLE_SLUG_MAX = 40;

const SEEDED_APP_ROLE_GRANTS_KEY = 'system.seededAppRoleGrants';

const TABLE = /^table:@([A-Za-z0-9_]+):(read|create|update|delete|export|import|read_pii)$/;
const PAGE = /^page:@([a-z][a-z0-9-]*):(view|edit)$/;
const APP = /^app:@:staff$/;
const ADD_ON_SETTINGS = /^addOn:([a-z][a-z0-9-]{1,79}):settings$/;

export function roleSlugFor(appKey: string, roleKey: string): string {
  return `${appKey}-${roleKey}`;
}

/** A role's grants: its own, and the ones of the role it clones. */
function grantsOf(role: ManifestRole, roles: readonly ManifestRole[]): string[] {
  const from = role.cloneFrom === undefined ? undefined : roles.find((other) => other.key === role.cloneFrom);
  return [...new Set([...(from?.permissions ?? []), ...(role.permissions ?? [])])];
}

/**
 * A role's limits: the ones of the role it clones, then its own over them. A
 * clone of a limited role is limited alike unless it says otherwise, or a
 * copy would be a way round the limit.
 */
function limitsOf(role: ManifestRole, roles: readonly ManifestRole[]): Record<string, UpdateLimit> {
  const from = role.cloneFrom === undefined ? undefined : roles.find((other) => other.key === role.cloneFrom);
  return { ...(from?.limits ?? {}), ...(role.limits ?? {}) };
}

/** What is wrong with the manifest's roles, one message per problem. */
export function roleIssues(manifest: Manifest): { role: string; code: 'IDENTIFIER_TOO_LONG' | 'ROLE_INVALID'; message: string }[] {
  if (manifest.kind !== 'app') return [];
  const roles = manifest.roles ?? [];
  const tables = new Set((manifest.requiredSchema?.tables ?? []).map((table) => table.ref));
  const pages = new Set((manifest.pages ?? []).map((page) => page.ref));
  const out: { role: string; code: 'IDENTIFIER_TOO_LONG' | 'ROLE_INVALID'; message: string }[] = [];
  for (const role of roles) {
    const slug = roleSlugFor(manifest.key, role.key);
    const refuse = (message: string) => out.push({ role: role.key, code: 'ROLE_INVALID', message: `The role "${role.key}": ${message}.` });
    if (slug.length > ROLE_SLUG_MAX) {
      out.push({
        role: role.key,
        code: 'IDENTIFIER_TOO_LONG',
        message: `The role "${slug}" is longer than ${String(ROLE_SLUG_MAX)} characters.`,
      });
    }
    if (role.cloneFrom !== undefined && !roles.some((other) => other.key === role.cloneFrom && other !== role)) {
      refuse(`it clones "${role.cloneFrom}", which is not another of this app's roles`);
    }
    for (const grant of role.permissions ?? []) {
      if (grant.startsWith('system:')) {
        refuse(`"${grant}" gives a console permission, which an app cannot`);
        continue;
      }
      if (grant.includes('*')) {
        refuse(`"${grant}" is a wildcard; name each table and page`);
        continue;
      }
      const table = TABLE.exec(grant);
      const page = PAGE.exec(grant);
      if (table !== null) {
        if (!tables.has(table[1]!)) refuse(`"${grant}" names a table the app does not declare`);
      } else if (page !== null) {
        if (!pages.has(page[1]!)) refuse(`"${grant}" names a page the app does not declare`);
      } else if (ADD_ON_SETTINGS.test(grant)) {
        /*
         * One add-on's settings, and only one the app names: an app may not
         * hand its roles the letterhead of an add-on it has nothing to do with.
         */
        const addOn = ADD_ON_SETTINGS.exec(grant)![1]!;
        const named = [...(manifest.addOns?.requires ?? []), ...(manifest.addOns?.suggests ?? [])].some((need) => need.key === addOn);
        if (!named) refuse(`"${grant}" names an add-on the app neither requires nor suggests`);
      } else if (!APP.test(grant)) {
        refuse(`"${grant}" is not a grant an app can give (table:@…, page:@… or app:@:staff)`);
      }
    }
  }
  return out;
}

/**
 * The app's roles whose name is already a role it does not own — an
 * operator's own role, a built-in one, or another app's. Installing would
 * merge the app's grants into that role, where they would outlive the app
 * (switching it off suspends only roles it owns; uninstalling deletes only
 * those). Refused by name at the check, never merged.
 */
export async function roleSlugProblems(meta: MetaDb, manifest: Manifest): Promise<{ role: string; code: 'ROLE_INVALID'; message: string }[]> {
  if (manifest.kind !== 'app') return [];
  const out: { role: string; code: 'ROLE_INVALID'; message: string }[] = [];
  for (const declared of manifest.roles ?? []) {
    const slug = roleSlugFor(manifest.key, declared.key);
    const held = await rolesRepo(meta).findBySlug(slug);
    if (held === null || held.appKey === manifest.key) continue;
    out.push({
      role: declared.key,
      code: 'ROLE_INVALID',
      message:
        `The role "${declared.key}": the role name "${slug}" is taken by ` +
        `${held.appKey === null ? 'a role of this workspace' : `the app "${held.appKey}"`}, so the app cannot make its own. ` +
        'Rename that role, then install again.',
    });
  }
  return out;
}

/** An app role's name found on a role the app does not own; the install stops rather than merge. */
export class RoleTakenError extends Error {
  constructor(readonly slug: string) {
    super(`The role name "${slug}" is taken by a role this app does not own.`);
  }
}

/**
 * The add-on settings the app's roles would hold — shown on the install check,
 * so whoever installs sees that a till's role may edit the letterhead every
 * app shares before it can.
 */
export function addOnGrantsOf(manifest: Manifest): { role: string; roleName: string; addOn: string; grant: 'settings' }[] {
  if (manifest.kind !== 'app') return [];
  const roles = manifest.roles ?? [];
  return roles.flatMap((role) =>
    grantsOf(role, roles).flatMap((grant) => {
      const match = ADD_ON_SETTINGS.exec(grant);
      return match === null ? [] : [{ role: roleSlugFor(manifest.key, role.key), roleName: role.name, addOn: match[1]!, grant: 'settings' as const }];
    }),
  );
}

export interface RolesResult {
  /** Slugs of roles made now. */
  created: string[];
  /** Grants given now. */
  seeded: number;
}

/**
 * Install the manifest's roles and give each the grants it has not been
 * given before. Run after the tables are introspected and the pages written:
 * both are what the placeholders point at.
 */
export async function writeManifestRoles(input: {
  meta: MetaDb;
  manifest: Manifest;
  connectionId: string;
  /** Short name → real table. */
  names: Readonly<Record<string, string>>;
}): Promise<RolesResult> {
  const { meta, manifest, connectionId } = input;
  const result: RolesResult = { created: [], seeded: 0 };
  if (manifest.kind !== 'app' || (manifest.roles ?? []).length === 0) return result;

  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  const model = snapshot === null ? null : parseDatabaseModel(snapshot.schema);
  const tableId = (ref: string): string | null => {
    const real = input.names[ref] ?? ref;
    return model?.tables.find((table) => table.name === real)?.id ?? null;
  };
  const roles = rolesRepo(meta);
  const permissions = permissionsRepo(meta);
  const settings = settingsRepo(meta);
  const seeded = new Set(await settings.get(SEEDED_APP_ROLE_GRANTS_KEY));

  /** Put the manifest's limits on the role's table rows, and nothing else there. */
  const writeLimits = async (roleId: string, limits: Record<string, UpdateLimit>): Promise<void> => {
    const wanted = new Map<string, UpdateLimit>();
    for (const [ref, limit] of Object.entries(limits)) {
      const id = tableId(ref);
      if (id !== null) wanted.set(`${connectionId}/${id}`, limit);
    }
    for (const row of await permissions.listForRole(roleId)) {
      if (row.resourceKind !== 'table' || !row.resourceRef.startsWith(`${connectionId}/`)) continue;
      const actions = row.actions as TableActions;
      const limit = wanted.get(row.resourceRef);
      if (limit === undefined && actions.updateLimit === undefined) continue;
      const { updateLimit: _previous, ...rest } = actions;
      await permissions.grant(roleId, 'table', row.resourceRef, limit === undefined ? rest : { ...rest, updateLimit: limit });
    }
  };
  const before = seeded.size;
  let changed = false;

  /** Take one app-given grant back from the role: that action only, the row if nothing is left. */
  const revokeGrant = async (roleId: string, grant: string): Promise<void> => {
    const table = TABLE.exec(grant);
    const page = PAGE.exec(grant);
    const narrow = async (kind: 'table' | 'page', ref: string, action: string): Promise<void> => {
      const existing = await permissions.find(roleId, kind, ref);
      if (existing === null) return;
      const actions = { ...(existing.actions as Record<string, unknown>), [action]: false };
      const anyLeft = Object.entries(actions).some(([name, value]) => name !== 'updateLimit' && value === true);
      if (anyLeft) await permissions.grant(roleId, kind, ref, actions as never);
      else await permissions.revoke(roleId, kind, ref);
    };
    if (table !== null) {
      const id = tableId(table[1]!);
      if (id !== null) await narrow('table', `${connectionId}/${id}`, table[2]!);
    } else if (page !== null) {
      const target = await pagesRepo(meta).findBySlug(connectionId, page[1]!);
      if (target !== null) await narrow('page', target.id, page[2]!);
    } else if (APP.test(grant)) {
      await permissions.revoke(roleId, 'app', manifest.key);
    } else if (ADD_ON_SETTINGS.test(grant)) {
      const row = matrixRowsFromGrants([grant]).rows[0];
      if (row !== undefined) await permissions.revoke(roleId, row.resourceKind, row.resourceRef);
    }
  };

  for (const declared of manifest.roles ?? []) {
    const slug = roleSlugFor(manifest.key, declared.key);
    let role = await roles.findBySlug(slug);
    let fresh = false;
    // Never another's role: its grants would outlive this app.
    if (role !== null && role.appKey !== manifest.key) throw new RoleTakenError(slug);
    if (role === null) {
      role = await roles.create({ slug, name: declared.name, appKey: manifest.key, screensOnly: declared.screensOnly === true });
      result.created.push(slug);
      fresh = true;
    }
    const wanted = grantsOf(declared, manifest.roles ?? []);
    /*
     * WHAT AN EARLIER VERSION GAVE AND THIS ONE NO LONGER ASKS FOR is taken
     * back — the ledger says the app gave it, and the role is the app's own.
     * Otherwise a grant a release dropped (an add-on's settings) would stay
     * with the role for as long as the app is installed.
     */
    for (const pair of [...seeded].filter((entry) => entry.startsWith(`${slug}|`))) {
      const grant = pair.slice(slug.length + 1);
      if (wanted.includes(grant)) continue;
      // A role made a moment ago holds nothing to take back; the entry is stale.
      if (!fresh) await revokeGrant(role.id, grant);
      seeded.delete(pair);
      changed = true;
    }
    for (const grant of wanted) {
      const pair = `${slug}|${grant}`;
      // A role made a moment ago has been given nothing, whatever the ledger
      // remembers of an earlier install's role of the same name.
      if (!fresh && seeded.has(pair)) continue;
      const table = TABLE.exec(grant);
      const page = PAGE.exec(grant);
      if (table !== null) {
        const id = tableId(table[1]!);
        if (id === null) continue;
        const ref = `${connectionId}/${id}`;
        const existing = await permissions.find(role.id, 'table', ref);
        const actions = {
          read: false,
          create: false,
          update: false,
          delete: false,
          export: false,
          import: false,
          ...(existing?.actions as Record<string, boolean> | undefined),
          [table[2]!]: true,
        };
        await permissions.grant(role.id, 'table', ref, actions as never);
      } else if (page !== null) {
        const target = await pagesRepo(meta).findBySlug(connectionId, page[1]!);
        if (target === null) continue;
        const existing = await permissions.find(role.id, 'page', target.id);
        const actions = { view: false, edit: false, ...(existing?.actions as Record<string, boolean> | undefined), [page[2]!]: true };
        await permissions.grant(role.id, 'page', target.id, actions as never);
      } else if (APP.test(grant)) {
        await permissions.grant(role.id, 'app', manifest.key, { staff: true });
      } else if (ADD_ON_SETTINGS.test(grant)) {
        const row = matrixRowsFromGrants([grant]).rows[0];
        if (row === undefined) continue;
        await permissions.grant(role.id, row.resourceKind, row.resourceRef, row.actions);
      } else {
        continue;
      }
      seeded.add(pair);
      result.seeded += 1;
    }
    await writeLimits(role.id, limitsOf(declared, manifest.roles ?? []));
  }
  if (changed || seeded.size !== before) await settings.set(SEEDED_APP_ROLE_GRANTS_KEY, [...seeded].sort());
  return result;
}

/** Forget the pairs of roles an uninstall deleted, so a reinstall's are seeded afresh. */
export async function forgetAppRoleGrants(meta: MetaDb, roleSlugs: readonly string[]): Promise<void> {
  if (roleSlugs.length === 0) return;
  const settings = settingsRepo(meta);
  const slugs = roleSlugs.map((slug) => `${slug}|`);
  const seeded = await settings.get(SEEDED_APP_ROLE_GRANTS_KEY);
  const kept = seeded.filter((pair) => !slugs.some((prefix) => pair.startsWith(prefix)));
  if (kept.length !== seeded.length) await settings.set(SEEDED_APP_ROLE_GRANTS_KEY, kept);
}
