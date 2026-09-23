// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The roles an app's manifest declares — a till's cashier, its manager —
 * installed as `<appKey>-<key>` roles that belong to the app.
 *
 * A manifest cannot know the install's connection, its tables' real names or
 * its pages' ids, so it grants through placeholders, filled in once the
 * tables exist and have been introspected:
 *
 *   `table:@<ref>:<action>`   read | create | update | delete | export | import
 *   `page:@<pageRef>:<action>` view | edit
 *   `app:@:staff`              the app's own staff screens
 *
 * Grants are SEEDED ONCE, like the built-in roles': a ledger of
 * `<role slug>|<placeholder>` pairs remembers what an install has already
 * given, so an update adds only what a new version asks for and an operator's
 * narrowing of an app role survives it.
 *
 * Refused at plan time: a `system:` grant (an app may not hand out the
 * console), a wildcard, a reference to a table or page the app does not
 * declare, `cloneFrom` anything but another of its own roles, and a slug
 * longer than the column holds.
 */
import { parseDatabaseModel } from '@adminium/engine';
import type { Manifest } from '@adminium/manifest';
import { pagesRepo, permissionsRepo, rolesRepo, settingsRepo, snapshotsRepo, type MetaDb } from '@adminium/meta';

type ManifestRole = NonNullable<Extract<Manifest, { kind: 'app' }>['roles']>[number];

/** `adminium_roles.slug` is `str(40)`. */
export const ROLE_SLUG_MAX = 40;

const SEEDED_APP_ROLE_GRANTS_KEY = 'system.seededAppRoleGrants';

const TABLE = /^table:@([A-Za-z0-9_]+):(read|create|update|delete|export|import)$/;
const PAGE = /^page:@([a-z][a-z0-9-]*):(view|edit)$/;
const APP = /^app:@:staff$/;

export function roleSlugFor(appKey: string, roleKey: string): string {
  return `${appKey}-${roleKey}`;
}

/** A role's grants: its own, and the ones of the role it clones. */
function grantsOf(role: ManifestRole, roles: readonly ManifestRole[]): string[] {
  const from = role.cloneFrom === undefined ? undefined : roles.find((other) => other.key === role.cloneFrom);
  return [...new Set([...(from?.permissions ?? []), ...(role.permissions ?? [])])];
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
      } else if (!APP.test(grant)) {
        refuse(`"${grant}" is not a grant an app can give (table:@…, page:@… or app:@:staff)`);
      }
    }
  }
  return out;
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
  const before = seeded.size;

  for (const declared of manifest.roles ?? []) {
    const slug = roleSlugFor(manifest.key, declared.key);
    let role = await roles.findBySlug(slug);
    let fresh = false;
    if (role === null) {
      role = await roles.create({ slug, name: declared.name, appKey: manifest.key, screensOnly: declared.screensOnly === true });
      result.created.push(slug);
      fresh = true;
    }
    for (const grant of grantsOf(declared, manifest.roles ?? [])) {
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
      } else {
        continue;
      }
      seeded.add(pair);
      result.seeded += 1;
    }
  }
  if (seeded.size !== before) await settings.set(SEEDED_APP_ROLE_GRANTS_KEY, [...seeded].sort());
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
