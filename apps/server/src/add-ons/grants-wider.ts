// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN APP'S ROLE HOLDS OF AN ADD-ON'S TABLES, AND WHAT A NEW VERSION
 * OF THE ADD-ON WOULD GIVE IT MORE OF.
 *
 * Pure: read by the add-on installer (an update that widens `appGrants`
 * asks first) and by the app install service (`apps/manifest-role-tables.ts`
 * settles and checks), so it lives where the installer may import it.
 */
import { addOnRoleTableHold, holdWider, type AddOnManifest, type Manifest, type RoleTableHold } from '@adminium/manifest';

type AppRole = NonNullable<Extract<Manifest, { kind: 'app' }>['roles']>[number];
type RoleTable = NonNullable<AppRole['tables']>[number];
type Action = RoleTable['actions'][number];

/** A role's grants on add-on tables: the ones of the role it clones, then its own over them — a clone of a limited role is limited alike. */
export function roleTablesOf(role: AppRole, roles: readonly AppRole[]): RoleTable[] {
  const from = role.cloneFrom === undefined ? undefined : roles.find((other) => other.key === role.cloneFrom);
  const by = new Map<string, RoleTable>();
  for (const entry of [...(from?.tables ?? []), ...(role.tables ?? [])]) by.set(`${entry.addOn}/${entry.table}`, entry);
  return [...by.values()];
}

/** One role's hold on one of an add-on's tables, as an install or update check shows it. */
export interface RoleTableCheck extends Omit<RoleTableHold, 'limit'> {
  role: string;
  roleName: string;
  addOn: string;
  table: string;
  /** The add-on is not on this server to judge the grant by: what the app asks, before the add-on's own words cut it. */
  unchecked?: true;
  /** An update's check: what this version's role holds here that the running version's did not (`*`: every column). */
  wider?: { actions: string[]; columns: string[] };
}

/** What a grant comes to against the add-on's words — or, with no add-on to judge it by, as the app asks it. */
export function holdOf(entry: RoleTable, addOn: AddOnManifest | undefined): Omit<RoleTableHold, 'limit'> & { unchecked?: true } {
  if (addOn !== undefined) {
    const { limit: _limit, ...hold } = addOnRoleTableHold(entry, addOn);
    return hold;
  }
  const actions = [...new Set(entry.actions)];
  const list = (action: Action, columns: readonly string[] | undefined) => (columns === undefined || !actions.includes(action) ? undefined : [...columns]);
  const readable = list('read', entry.limit?.readable);
  const writable = list('update', entry.limit?.writable);
  const creatable = list('create', entry.limit?.creatable);
  return { actions, ...(readable === undefined ? {} : { readable }), ...(writable === undefined ? {} : { writable }), ...(creatable === undefined ? {} : { creatable }), unchecked: true };
}

/** One role of an app that an add-on's new version lets do more with the add-on's tables (`appGrants` widened). */
export interface AddOnGrantWider extends RoleTableCheck {
  /** The app whose role it is. */
  app: string;
  appName: string;
  wider: { actions: string[]; columns: string[] };
}

/**
 * WHAT AN ADD-ON'S NEW VERSION GIVES APPS' ROLES MORE OF ITS TABLES.
 *
 * An app's grant on an add-on's table is cut to the add-on's own words
 * (`appGrants`, its ledgers, its columns). A version that widens those words
 * widens every role of every app that asks for more than the old words gave:
 * for each, the hold under the running version and under the new one, and
 * what the new one holds more (`holdWider`). An update gives it only when the
 * operator allows it, as an app's own update does.
 */
export function addOnGrantsWider(apps: readonly Manifest[], addOnKey: string, before: AddOnManifest, after: AddOnManifest): AddOnGrantWider[] {
  const out: AddOnGrantWider[] = [];
  for (const app of apps) {
    if (app.kind !== 'app') continue;
    const roles = app.roles ?? [];
    for (const role of roles) {
      for (const entry of roleTablesOf(role, roles)) {
        if (entry.addOn !== addOnKey) continue;
        const now = holdOf(entry, after);
        const wider = holdWider(holdOf(entry, before), now);
        if (wider === null) continue;
        const { unchecked: _unchecked, ...hold } = now;
        out.push({ app: app.key, appName: app.name, role: role.key, roleName: role.name, addOn: entry.addOn, table: entry.table, ...hold, actions: [...hold.actions], wider });
      }
    }
  }
  return out;
}

/** How a refusal and a check say one widened grant. */
export function widerWords(entry: Pick<RoleTableCheck, 'roleName' | 'addOn' | 'table'> & { wider: { actions: string[]; columns: string[] }; appName?: string | undefined }): string {
  const what = [...entry.wider.actions, ...entry.wider.columns.map((column) => (column === '*' ? 'every column' : column))].join(', ');
  return `${entry.appName === undefined ? '' : `${entry.appName}'s `}${entry.roleName} on ${entry.addOn}'s "${entry.table}" (${what})`;
}
