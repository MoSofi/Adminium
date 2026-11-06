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
 *   `page:@<ref>:view`         a page or record panel of an add-on the app
 *                              requires or suggests (its ref starts with the
 *                              add-on's key): given while that add-on is here
 *                              for the app, as the role's `tables` are
 *   `app:@:staff`              the app's own staff screens
 *   `addOn:<key>:settings`     one add-on's non-secret settings — only an add-on
 *                              the app requires or suggests, never "every add-on"
 *   `privacy:@:people`         a person's data: find, download and erase
 *                              everything the workspace keeps about one address
 *                              (`system:privacy:people`); never the privacy
 *                              notice or the websites. Shown on the install check.
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
 * longer than the column holds. A file made on an Adminium may name a
 * `system:` grant its role held there: it is never given, only listed for the
 * owner to give by hand after installing.
 */
import { parseDatabaseModel } from '@adminium/engine';
import type { Manifest, RowReach } from '@adminium/manifest';
import { pagesRepo, permissionsRepo, rolesRepo, settingsRepo, snapshotsRepo, type MetaDb, type ReadLimit, type RowLimit, type RowReach as StoredRowReach, type TableActions, type UpdateLimit } from '@adminium/meta';

import { matrixRowsFromGrants } from '../rbac/permissions.js';
import type { RoleTableResult } from '@adminium/manifest';
import { grantKeyOf, installRoleSlug, type InstallAddress } from '../installs/resolve.js';
import type { AfterInstallItem } from './after-install.js';
import { ownsBlocks } from './owns-blocks.js';

type ManifestRole = NonNullable<Extract<Manifest, { kind: 'app' }>['roles']>[number];

/** `adminium_roles.slug` is `str(40)`. */
export const ROLE_SLUG_MAX = 40;

export const SEEDED_APP_ROLE_GRANTS_KEY = 'system.seededAppRoleGrants';

/**
 * A ledger pair of a grant on an add-on's table (`table:@<addOn>/<ref>:<action>`) or on one of its pages or panels
 * (`page:@<addOn>/<ref>:view`): the role-table writer's, never read here.
 */
const ADD_ON_TABLE = /^(?:table|page):@[a-z][a-z0-9-]{1,79}\//;

const TABLE = /^table:@([A-Za-z0-9_]+):(read|create|update|delete|export|import|read_pii)$/;
const PAGE = /^page:@([a-z][a-z0-9-]*):(view|edit)$/;
const APP = /^app:@:staff$/;
const ADD_ON_SETTINGS = /^addOn:([a-z][a-z0-9-]{1,79}):settings$/;
/** A person's data (find, download, erase), the one privacy right an app's role may carry. */
const PRIVACY_PEOPLE = /^privacy:@:people$/;
/** What `privacy:@:people` is given as: the console's own key for a person's data. */
const PRIVACY_PEOPLE_GRANT = 'system:privacy:people';

/**
 * An app role's slug: `<key>-<role>` for the install holding the bare
 * addresses; a later install's adds its own slug (`installRoleSlug`).
 */
export function roleSlugFor(appKey: string, roleKey: string, installSlug: string = ''): string {
  return installRoleSlug(appKey, roleKey, installSlug);
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
type RoleLimit = NonNullable<ManifestRole['limits']>[string];

function limitsOf(role: ManifestRole, roles: readonly ManifestRole[]): Record<string, RoleLimit> {
  const from = role.cloneFrom === undefined ? undefined : roles.find((other) => other.key === role.cloneFrom);
  return { ...(from?.limits ?? {}), ...(role.limits ?? {}) };
}

/**
 * A manifest's `rows` as a grant keeps it: each action's reach, or its several, copied whole (a column keeps its name
 * through an install). A listing `notThrough` names is a table, made real as a `belongs` way's `through.table` is
 * (`realId`: the short ref to the table's id; a ref it cannot place is kept as written, as that way's is).
 */
export function storedRowLimit(rows: NonNullable<RoleLimit['rows']>, realId: (ref: string) => string = (ref) => ref): RowLimit {
  const out: RowLimit = {};
  const listings = (written: string | readonly string[]): string | string[] => (typeof written === 'string' ? realId(written) : written.map(realId));
  const copied = (reach: RowReach): StoredRowReach => ({
    reach: reach.reach,
    ...(reach.unowned === true ? { unowned: true as const } : {}),
    ...(reach.while === undefined ? {} : { while: { column: reach.while.column, in: [...reach.while.in] } }),
    ...(reach.by === undefined ? {} : { by: reach.by }),
    ...(reach.notBy === undefined ? {} : { notBy: reach.notBy }),
    ...(reach.via === undefined ? {} : { via: reach.via }),
    ...(reach.notThrough === undefined ? {} : { notThrough: listings(reach.notThrough) }),
  });
  for (const action of ['read', 'update', 'delete'] as const) {
    const written = rows[action];
    if (written === undefined) continue;
    out[action] = Array.isArray(written) ? written.map(copied) : copied(written as RowReach);
  }
  return out;
}

/** A role's grants, with the ones of the role it clones (for the role-table writer). */
export function roleGrantsOf(role: ManifestRole, roles: readonly ManifestRole[]): string[] {
  return grantsOf(role, roles);
}

/** The keys of the add-ons an app requires or suggests. */
function namedAddOns(manifest: Manifest): string[] {
  const named = manifest.addOns as { requires?: readonly { key: string }[]; suggests?: readonly { key: string }[] } | undefined;
  return [...(named?.requires ?? []), ...(named?.suggests ?? [])].map((need) => need.key);
}

/**
 * The add-on a page grant of an app names, when the ref is not one of the
 * app's own pages: an add-on's pages and panels are named under its key
 * (`customiser-line` is the Customiser's), so the add-on is the one the app
 * names whose key the ref starts with — the longest, when two would do.
 */
export function addOnOfPageGrant(manifest: Manifest, ref: string): string | null {
  if (manifest.kind !== 'app' || (manifest.pages ?? []).some((page) => page.ref === ref)) return null;
  const fits = namedAddOns(manifest).filter((key) => ref === key || ref.startsWith(`${key}-`));
  return fits.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** The ids an add-on opens its own screens by: its pages' refs and its panels' ids. */
export function addOnScreensOf(manifest: Manifest): string[] {
  return codePagesOf(manifest);
}

/**
 * What is wrong with the app's grants of add-ons' pages and panels, judged by
 * each add-on's manifest at hand (an install's or update's check): a ref the
 * add-on has neither as a page nor as a panel. An add-on not at hand is
 * judged when it is attached, where an unknown ref is left out by name.
 */
export function addOnPageGrantIssues(manifest: Manifest, addOns: ReadonlyMap<string, Manifest>): { role: string; code: 'ROLE_INVALID'; message: string }[] {
  if (manifest.kind !== 'app') return [];
  const out: { role: string; code: 'ROLE_INVALID'; message: string }[] = [];
  for (const role of manifest.roles ?? []) {
    for (const grant of role.permissions ?? []) {
      const page = PAGE.exec(grant);
      const addOn = page === null ? null : addOnOfPageGrant(manifest, page[1]!);
      const theirs = addOn === null ? undefined : addOns.get(addOn);
      if (theirs === undefined || codePagesOf(theirs).includes(page![1]!)) continue;
      out.push({ role: role.key, code: 'ROLE_INVALID', message: `The role "${role.key}": "${grant}" names a page or panel the add-on "${addOn!}" does not have.` });
    }
  }
  return out;
}

/** The refs of the screens an add-on draws from its own bundle (`addOn.pages`); none for an app. */
function codePagesOf(manifest: Manifest): string[] {
  // A record panel is opened as a page of the add-on's code is: by its id, `page:<id>:view`.
  return manifest.kind === 'add-on' ? [...(manifest.addOn.pages ?? []).map((page) => page.ref), ...(manifest.addOn.panels ?? []).map((panel) => panel.id)] : [];
}

/** A file made on an Adminium (`publisher: local`). */
function isLocalFile(manifest: Manifest): boolean {
  return manifest.kind === 'app' && (manifest.publisher as { id?: string } | undefined)?.id === 'local';
}

/** A console permission the RBAC grammar knows, other than people's data (an app's role carries that as `privacy:@:people`). */
function isSystemGrant(grant: string): boolean {
  return grant.startsWith('system:') && grant !== PRIVACY_PEOPLE_GRANT && matrixRowsFromGrants([grant]).invalid.length === 0;
}

/**
 * The console permissions a file made on an Adminium names for its roles:
 * what the role held where it was made. The install never gives one; each is
 * an "after you install" item, for the owner to give by hand.
 */
export function plannedAfterInstallOfRoles(manifest: Manifest): AfterInstallItem[] {
  if (!isLocalFile(manifest) || manifest.kind !== 'app') return [];
  return (manifest.roles ?? []).flatMap((role) => (role.permissions ?? []).filter(isSystemGrant).map((grant) => ({ kind: 'system-grant' as const, item: role.key, field: grant })));
}

/** What is wrong with the manifest's roles, one message per problem. */
export function roleIssues(manifest: Manifest): { role: string; code: 'IDENTIFIER_TOO_LONG' | 'ROLE_INVALID'; message: string }[] {
  if (!ownsBlocks(manifest)) return [];
  const roles = manifest.roles ?? [];
  const tables = new Set((manifest.requiredSchema?.tables ?? []).map((table) => table.ref));
  // An add-on's own screens are pages a role may be given too.
  const pages = new Set([...(manifest.pages ?? []).map((page) => page.ref), ...codePagesOf(manifest)]);
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
    const own = new Set(role.permissions ?? []);
    for (const grant of grantsOf(role, roles)) {
      /*
       * A grant this role takes from the role it clones is judged where it is
       * written; only what turns on THIS role is asked again, or a clone would
       * be a way round it (a screens-only clone of the owner, erasing people).
       */
      if (!own.has(grant)) {
        if (PRIVACY_PEOPLE.test(grant) && (manifest as Manifest).kind !== 'add-on' && role.screensOnly === true) {
          refuse(`it clones "${role.cloneFrom ?? ''}", whose "${grant}" is used on the dashboard's privacy page, which a screens-only role never opens: give it to a role that opens the dashboard`);
        }
        continue;
      }
      if (grant.startsWith('system:')) {
        // A file made on an Adminium names a console permission its role held there: never given, listed for the owner.
        if (!isLocalFile(manifest) || !isSystemGrant(grant)) refuse(`"${grant}" gives a console permission, which an app cannot`);
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
        if (pages.has(page[1]!)) continue;
        // A page or panel of an add-on the app names: seen, never changed, from the app's role.
        const addOn = addOnOfPageGrant(manifest, page[1]!);
        if (addOn === null) refuse(`"${grant}" names a page the app does not declare, nor one of an add-on it requires or suggests (whose pages are named under its key)`);
        else if (page[2] !== 'view') refuse(`"${grant}" asks to edit a page of the add-on "${addOn}"; a role of the app is given its pages and panels to view`);
      } else if (ADD_ON_SETTINGS.test(grant)) {
        /*
         * One add-on's settings, and only one the app names: an app may not
         * hand its roles the letterhead of an add-on it has nothing to do with.
         */
        const addOn = ADD_ON_SETTINGS.exec(grant)![1]!;
        const named = [...(manifest.addOns?.requires ?? []), ...(manifest.addOns?.suggests ?? [])].some((need) => need.key === addOn);
        // An add-on's own role may be given the add-on's own settings: that is what its manager is for.
        const own = (manifest as Manifest).kind === 'add-on' && addOn === manifest.key;
        if (!named && !own) refuse(`"${grant}" names an add-on the app neither requires nor suggests`);
      } else if (PRIVACY_PEOPLE.test(grant)) {
        // An add-on's role is never given people's data: it is the business's to give, through its own apps' roles.
        if ((manifest as Manifest).kind === 'add-on') refuse(`"${grant}" is given by an app's role, never an add-on's`);
        // A person's data is found and erased on the dashboard's privacy page, which a screens-only person never opens.
        else if (role.screensOnly === true) refuse(`"${grant}" is used on the dashboard's privacy page, which a screens-only role never opens: give it to a role that opens the dashboard`);
      } else if (!APP.test(grant)) {
        // A grant that names an add-on the app builds on: the right place for it is said, with what to write.
        const named = [...(manifest.addOns?.requires ?? []), ...(manifest.addOns?.suggests ?? [])].find((need) => new RegExp(`(^|[:@.])${need.key}[.:/]`).test(grant));
        const theirs = /([a-z][a-z0-9_]*):(?:read|create|update)$/.exec(grant);
        refuse(
          named === undefined
            ? `"${grant}" is not a grant an app can give (table:@…, page:@…, app:@:staff or privacy:@:people)`
            : `"${grant}" is not a grant an app can give. A table of the add-on "${named.key}" is granted beside "permissions", on the role itself: "tables": [{ "addOn": "${named.key}", "table": "${theirs?.[1] ?? '<its table>'}", "actions": ["read"] }]`,
        );
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
export async function roleSlugProblems(meta: MetaDb, manifest: Manifest, install?: { id: string | null; slug: string }): Promise<{ role: string; code: 'ROLE_INVALID'; message: string }[]> {
  if (!ownsBlocks(manifest)) return [];
  const out: { role: string; code: 'ROLE_INVALID'; message: string }[] = [];
  for (const declared of manifest.roles ?? []) {
    const slug = roleSlugFor(manifest.key, declared.key, install?.slug ?? '');
    const held = await rolesRepo(meta).findBySlug(slug);
    // This install's own role, or one of the key's left by an install that went (its link set null).
    if (held === null || (held.appKey === manifest.key && (held.manifestId === null || held.manifestId === (install?.id ?? held.manifestId)))) continue;
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
  if (!ownsBlocks(manifest)) return [];
  const roles = manifest.roles ?? [];
  return roles.flatMap((role) =>
    grantsOf(role, roles).flatMap((grant) => {
      const match = ADD_ON_SETTINGS.exec(grant);
      return match === null ? [] : [{ role: roleSlugFor(manifest.key, role.key), roleName: role.name, addOn: match[1]!, grant: 'settings' as const }];
    }),
  );
}

/**
 * The roles that would find, download and erase people's data
 * (`privacy:@:people`) — shown on the install check, so whoever installs
 * sees that a shop's owner may erase anybody the workspace keeps.
 */
export function privacyGrantsOf(manifest: Manifest): { role: string; roleName: string }[] {
  if (!ownsBlocks(manifest) || manifest.kind !== 'app') return [];
  const roles = manifest.roles ?? [];
  return roles.flatMap((role) => (grantsOf(role, roles).some((grant) => PRIVACY_PEOPLE.test(grant)) ? [{ role: roleSlugFor(manifest.key, role.key), roleName: role.name }] : []));
}

/**
 * What a new version's roles are given that the running version's were not,
 * by role: the add-on settings (`addOn:<key>:settings`) and finding and
 * erasing people's data (`privacy:@:people`). An update gives them only when
 * the operator allows it, as it does more of an add-on's tables; a new role
 * that wants one counts too. Nothing is said for a first install, whose check
 * lists every grant.
 */
export function grantsAdded(running: Manifest | null, next: Manifest): { addOnGrants: ReturnType<typeof addOnGrantsOf>; privacyGrants: ReturnType<typeof privacyGrantsOf> } {
  if (running === null) return { addOnGrants: [], privacyGrants: [] };
  const had = new Set(addOnGrantsOf(running).map((grant) => `${grant.role}\u0000${grant.addOn}`));
  const erased = new Set(privacyGrantsOf(running).map((grant) => grant.role));
  return {
    addOnGrants: addOnGrantsOf(next).filter((grant) => !had.has(`${grant.role}\u0000${grant.addOn}`)),
    privacyGrants: privacyGrantsOf(next).filter((grant) => !erased.has(grant.role)),
  };
}

export interface RolesResult {
  /** Slugs of roles made now. */
  created: string[];
  /** Grants given now. */
  seeded: number;
  /** What the roles hold of the tables of the add-ons here for the app (the role-table writer's answer), when it asks for any. */
  tables?: RoleTableResult[];
}

/**
 * Install the manifest's roles and give each the grants it has not been
 * given before. Run after the tables are introspected and the pages written:
 * both are what the placeholders point at.
 */
export async function writeManifestRoles(input: {
  meta: MetaDb;
  manifest: Manifest;
  /** The install the roles belong to: each install of a key has its own. */
  install: InstallAddress;
  connectionId: string;
  /** Short name → real table. */
  names: Readonly<Record<string, string>>;
}): Promise<RolesResult> {
  const { meta, manifest, connectionId } = input;
  const result: RolesResult = { created: [], seeded: 0 };
  if (!ownsBlocks(manifest) || (manifest.roles ?? []).length === 0) return result;

  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  const model = snapshot === null ? null : parseDatabaseModel(snapshot.schema);
  // Tables made under a prefix are known by their record alone: with none, a grant never falls on whatever table of the
  // database happens to carry the short name.
  const prefixed = (manifest.requiredSchema as { prefixed?: boolean } | undefined)?.prefixed === true;
  const tableId = (ref: string): string | null => {
    const real = input.names[ref] ?? (prefixed ? null : ref);
    return real === null ? null : (model?.tables.find((table) => table.name === real)?.id ?? null);
  };
  const roles = rolesRepo(meta);
  const permissions = permissionsRepo(meta);
  const settings = settingsRepo(meta);
  const seeded = new Set(await settings.get(SEEDED_APP_ROLE_GRANTS_KEY));

  /** Put the manifest's limits on the role's table rows — what its update writes, what its read shows — and nothing else there. */
  const writeLimits = async (roleId: string, limits: Record<string, RoleLimit>): Promise<void> => {
    const wanted = new Map<string, RoleLimit>();
    for (const [ref, limit] of Object.entries(limits)) {
      const id = tableId(ref);
      if (id !== null) wanted.set(`${connectionId}/${id}`, limit);
    }
    for (const row of await permissions.listForRole(roleId)) {
      if (row.resourceKind !== 'table' || !row.resourceRef.startsWith(`${connectionId}/`)) continue;
      const actions = row.actions as TableActions;
      const limit = wanted.get(row.resourceRef);
      // Only the manifest's own tables: a limit on a row of an add-on's table is another writer's, written with its grant.
      if (!own.has(row.resourceRef)) continue;
      if (limit === undefined && actions.updateLimit === undefined && actions.readLimit === undefined && actions.createLimit === undefined && actions.rowLimit === undefined) continue;
      const { updateLimit: _previous, readLimit: _read, createLimit: _create, rowLimit: _rows, ...rest } = actions;
      const update: UpdateLimit | undefined =
        limit?.writable === undefined
          ? undefined
          : {
              writable: [...limit.writable],
              ...(limit.writableValues === undefined ? {} : { writableValues: limit.writableValues }),
              // Which rows the update reaches: dropped here, the role would reach every row.
              ...(limit.writableFrom === undefined ? {} : { writableFrom: limit.writableFrom }),
            };
      const read: ReadLimit | undefined = limit?.readable === undefined ? undefined : { readable: [...limit.readable] };
      const create: UpdateLimit | undefined =
        limit?.creatable === undefined ? undefined : { writable: [...limit.creatable], ...(limit.creatableValues === undefined ? {} : { writableValues: limit.creatableValues }) };
      // Which rows its read, update and delete reach: dropped here, the role would reach every row.
      const rows: RowLimit | undefined = limit?.rows === undefined ? undefined : storedRowLimit(limit.rows, (ref) => tableId(ref) ?? ref);
      await permissions.grant(roleId, 'table', row.resourceRef, {
        ...rest,
        ...(update === undefined ? {} : { updateLimit: update }),
        ...(read === undefined ? {} : { readLimit: read }),
        ...(create === undefined ? {} : { createLimit: create }),
        ...(rows === undefined ? {} : { rowLimit: rows }),
      });
    }
  };
  const own = new Set((manifest.requiredSchema?.tables ?? []).flatMap((table) => {
    const id = tableId(table.ref);
    return id === null ? [] : [`${connectionId}/${id}`];
  }));
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
      const anyLeft = Object.entries(actions).some(([name, value]) => name !== 'updateLimit' && name !== 'readLimit' && name !== 'createLimit' && value === true);
      if (anyLeft) await permissions.grant(roleId, kind, ref, actions as never);
      else await permissions.revoke(roleId, kind, ref);
    };
    if (table !== null) {
      const id = tableId(table[1]!);
      if (id !== null) await narrow('table', `${connectionId}/${id}`, table[2]!);
    } else if (page !== null) {
      // A grant on one of an add-on's own screens was made on its ref (no page row stands behind it), and is taken back there:
      // left behind, a page that later takes the same name would open for the role with nobody having said so.
      const byRef = await permissions.find(roleId, 'page', page[1]!);
      if (byRef !== null) await narrow('page', page[1]!, page[2]!);
      else {
        const target = await pagesRepo(meta).findBySlug(connectionId, page[1]!);
        if (target !== null) await narrow('page', target.id, page[2]!);
      }
    } else if (APP.test(grant)) {
      await permissions.revoke(roleId, 'app', grantKeyOf({ manifestKey: manifest.key, instanceSlug: input.install.slug }));
    } else if (PRIVACY_PEOPLE.test(grant)) {
      const row = matrixRowsFromGrants([PRIVACY_PEOPLE_GRANT]).rows[0];
      if (row !== undefined) await permissions.revoke(roleId, row.resourceKind, row.resourceRef);
    } else if (ADD_ON_SETTINGS.test(grant)) {
      const row = matrixRowsFromGrants([grant]).rows[0];
      if (row !== undefined) await permissions.revoke(roleId, row.resourceKind, row.resourceRef);
    }
  };

  for (const declared of manifest.roles ?? []) {
    const slug = installRoleSlug(manifest.key, declared.key, input.install.slug);
    let role = await roles.findBySlug(slug);
    let fresh = false;
    // Never another's role, another install's of the same key included: its grants would outlive this one.
    if (role !== null && (role.appKey !== manifest.key || (role.manifestId !== null && role.manifestId !== input.install.id))) throw new RoleTakenError(slug);
    if (role === null) {
      // A later install's role says which database it is for: "Clerk · kiln".
      const name = input.install.slug === '' ? declared.name : `${declared.name} · ${input.install.slug}`;
      role = await roles.create({ slug, name, appKey: manifest.key, manifestId: input.install.id, screensOnly: declared.screensOnly === true });
      result.created.push(slug);
      fresh = true;
    } else if (role.manifestId === null) {
      await roles.setInstall(role.id, input.install.id);
    }
    /*
     * ITS PARTS AND ITS NAME IN OTHER LANGUAGES, as this version says them.
     * A role still called what its manifest called it follows a new name; one
     * the owner renamed keeps theirs, and is then shown in one language.
     */
    const parts = 'modules' in declared && Array.isArray(declared.modules) ? declared.modules : null;
    const names = 'names' in declared && declared.names !== undefined ? { from: declared.name, names: { ...declared.names } } : null;
    if (role.names !== null && role.name === role.names.from && role.name !== declared.name) await roles.rename(role.id, declared.name);
    if (JSON.stringify(role.modules) !== JSON.stringify(parts) || JSON.stringify(role.names) !== JSON.stringify(names)) await roles.setParts(role.id, { modules: parts, names });
    const wanted = grantsOf(declared, manifest.roles ?? []);
    /*
     * WHAT AN EARLIER VERSION GAVE AND THIS ONE NO LONGER ASKS FOR is taken
     * back — the ledger says the app gave it, and the role is the app's own.
     * Otherwise a grant a release dropped (an add-on's settings) would stay
     * with the role for as long as the app is installed.
     */
    for (const pair of [...seeded].filter((entry) => entry.startsWith(`${slug}|`))) {
      const grant = pair.slice(slug.length + 1);
      // What the role holds of an add-on's table comes and goes with that add-on: settled by its own writer —
      // which gives it afresh to a role made a moment ago, whatever the ledger remembers of one of the same name.
      if (ADD_ON_TABLE.test(grant)) {
        if (fresh) {
          seeded.delete(pair);
          changed = true;
        }
        continue;
      }
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
        // One of an add-on's own screens FIRST: no page row stands behind it, so the grant is on its ref —
        // never on some other page of this database that happens to carry the same name as its slug.
        if (codePagesOf(manifest).includes(page[1]!)) {
          const held = await permissions.find(role.id, 'page', page[1]!);
          await permissions.grant(role.id, 'page', page[1]!, { view: false, edit: false, ...(held?.actions as Record<string, boolean> | undefined), [page[2]!]: true } as never);
          // In the ledger like any other grant: given once (an owner who takes it away keeps it away), and taken back by a version that drops it.
          seeded.add(pair);
          result.seeded += 1;
          continue;
        }
        // A page or panel of an add-on the app names: given with that add-on, by the role-table writer.
        if (addOnOfPageGrant(manifest, page[1]!) !== null) continue;
        const target = await pagesRepo(meta).findBySlug(connectionId, page[1]!);
        if (target === null) continue;
        const existing = await permissions.find(role.id, 'page', target.id);
        const actions = { view: false, edit: false, ...(existing?.actions as Record<string, boolean> | undefined), [page[2]!]: true };
        await permissions.grant(role.id, 'page', target.id, actions as never);
      } else if (APP.test(grant)) {
        await permissions.grant(role.id, 'app', grantKeyOf({ manifestKey: manifest.key, instanceSlug: input.install.slug }), { staff: true });
      } else if (PRIVACY_PEOPLE.test(grant)) {
        if (manifest.kind !== 'app') continue;
        const row = matrixRowsFromGrants([PRIVACY_PEOPLE_GRANT]).rows[0];
        if (row === undefined) continue;
        await permissions.grant(role.id, row.resourceKind, row.resourceRef, row.actions);
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
