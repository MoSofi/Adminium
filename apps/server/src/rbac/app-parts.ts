// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PARTS OF AN APP, AND WHETHER EACH IS ON.
 *
 * An app's manifest may cut it into parts (`modules`) its owner switches on
 * and off. This is the one place that answers "is this part on": the page
 * route, the menu, the permission resolver, the rule matcher, scheduler and
 * runner, documents, outbox producers, public entries and scheduled reports
 * all ask here, so a part is off everywhere or nowhere.
 *
 * A part is on when its switch says so (or it has none: `always`), AND every
 * add-on its feature needs is installed and connected to the app. The answer
 * is read from the installed row's `modules` column, never from the manifest.
 *
 * OFF IS NOT GONE. The part's tables and rows stay, and a role of another
 * part that is granted one of them goes on reading it. What stops is what
 * the part itself does and shows, and what its own roles hold on its tables.
 */
import { appModulesOf, pageAppPart, type AppModules, type MetaDb, type Role } from '@adminium/meta';

import { PartOffError } from '../errors.js';

/** The parts of one installed app, as they stand now. */
export interface AppParts {
  key: string;
  /** The installed row's id. */
  id: string;
  /** Whether the app itself is switched on (`installed`). */
  running: boolean;
  /** Whether its owner switched the whole app off (`disabled`): its roles then grant nothing. */
  disabled: boolean;
  /** What the app declares, with the owner's switches; null for an app with no parts. */
  modules: AppModules | null;
  /** The ids of the parts that are off now. */
  off: ReadonlySet<string>;
  /** The add-ons a part waits for, by part id: empty for a part that waits for none. */
  waiting: ReadonlyMap<string, readonly string[]>;
}

/** Whether a part of `parts` is on: one the app does not declare is, as is everything of an app with no parts. */
export function partIsOn(parts: AppParts | undefined, module: string | null | undefined): boolean {
  if (parts === undefined || module === null || module === undefined) return true;
  return !parts.off.has(module);
}

/** The switch of a part as the owner left it, or its default. */
export function switchOf(modules: AppModules, id: string): boolean {
  const def = modules.defs.find((one) => one.id === id);
  if (def === undefined || def.default === 'always') return true;
  return modules.on[id] ?? def.default === 'on';
}

/** The add-ons connected to each of `keys` and running: app key → add-on keys. */
async function connectedAddOns(meta: MetaDb, keys: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (keys.length === 0) return out;
  const rows = await meta.db
    .selectFrom('adminium_manifest_attachments')
    .innerJoin('adminium_manifests', 'adminium_manifests.id', 'adminium_manifest_attachments.manifestId')
    .select(['adminium_manifests.manifestKey as addOn', 'adminium_manifest_attachments.attachedTo as app'])
    .where('adminium_manifests.kind', '=', 'add-on')
    .where('adminium_manifests.status', '=', 'installed')
    .where('adminium_manifest_attachments.disabledAt', 'is', null)
    .where('adminium_manifest_attachments.attachedTo', 'in', [...keys])
    .execute();
  for (const row of rows) {
    const held = out.get(row.app) ?? new Set<string>();
    held.add(row.addOn);
    out.set(row.app, held);
  }
  return out;
}

/** The parts of the apps named (every app when none is), by app key. */
export async function loadAppParts(meta: MetaDb, keys?: readonly string[]): Promise<Map<string, AppParts>> {
  const out = new Map<string, AppParts>();
  const rows = await appModulesOf(meta, keys);
  const needy = rows.filter((row) => row.modules?.defs.some((def) => def.needs.length > 0) === true).map((row) => row.key);
  const connected = await connectedAddOns(meta, needy);
  for (const row of rows) {
    const off = new Set<string>();
    const waiting = new Map<string, readonly string[]>();
    for (const def of row.modules?.defs ?? []) {
      const missing = def.needs.filter((addOn) => connected.get(row.key)?.has(addOn) !== true);
      if (missing.length > 0) waiting.set(def.id, missing);
      if (missing.length > 0 || !switchOf(row.modules!, def.id)) off.add(def.id);
    }
    out.set(row.key, { key: row.key, id: row.id, running: row.status === 'installed', disabled: row.status === 'disabled', modules: row.modules, off, waiting });
  }
  return out;
}

/** Whether `module` of the app `appKey` is on. True for an app that is not installed: its own gate answers for that. */
export async function appPartIsOn(meta: MetaDb, appKey: string | null | undefined, module: string | null | undefined): Promise<boolean> {
  if (appKey === null || appKey === undefined || module === null || module === undefined) return true;
  return partIsOn((await loadAppParts(meta, [appKey])).get(appKey), module);
}

/**
 * Whether a role is offered: it names no part, or one of its parts is on.
 * A role of an app that is not installed, or of one with no parts, is.
 */
export function roleIsOffered(role: Pick<Role, 'appKey' | 'modules'>, parts: ReadonlyMap<string, AppParts>): boolean {
  if (role.appKey === null || role.modules === null) return true;
  const app = parts.get(role.appKey);
  if (app === undefined || app.modules === null) return true;
  return role.modules.some((id) => !app.off.has(id));
}

/**
 * The tables a role of a part does not reach while the part is off: for each
 * app with a part off, `<connectionId>` and the table's real name, with the
 * part it belongs to.
 */
export async function tablesOfPartsOff(meta: MetaDb, parts: ReadonlyMap<string, AppParts>): Promise<{ app: string; connectionId: string; table: string; schema: string | null; module: string }[]> {
  const apps = [...parts.values()].filter((app) => app.off.size > 0).map((app) => app.key);
  if (apps.length === 0) return [];
  const rows = await meta.db
    .selectFrom('adminium_app_tables')
    .select(['appKey', 'connectionId', 'tableName', 'schemaName', 'module'])
    .where('appKey', 'in', apps)
    .where('module', 'is not', null)
    .where('state', 'in', ['created', 'adopted', 'shared'])
    .execute();
  return rows.flatMap((row) => (row.module !== null && parts.get(row.appKey)?.off.has(row.module) === true ? [{ app: row.appKey, connectionId: row.connectionId, table: row.tableName, schema: row.schemaName, module: row.module }] : []));
}

/**
 * Whether a table grant's ref (`<connectionId>/<schema>.<table>`) names
 * `table` of `connectionId`. With the schema the app's table was made in, only
 * that schema's table; without one (it was not recorded), a table of that
 * name in any schema.
 */
export function refNamesTable(ref: string, connectionId: string, table: string, schema: string | null = null): boolean {
  if (!ref.startsWith(`${connectionId}/`)) return false;
  const id = ref.slice(connectionId.length + 1);
  if (schema !== null) return id === `${schema}.${table}`;
  return id === table || id.endsWith(`.${table}`);
}

/** Refuses with `PART_OFF` when `module` of `appKey` is off. */
export async function assertAppPartOn(meta: MetaDb, appKey: string | null | undefined, module: string | null | undefined): Promise<void> {
  if (appKey === null || appKey === undefined || module === null || module === undefined) return;
  if (!(await appPartIsOn(meta, appKey, module))) throw new PartOffError(appKey, module);
}

/** Refuses with `PART_OFF` when a stored page belongs to a part of its app that is off. */
export async function assertPagePartOn(meta: MetaDb, config: unknown): Promise<void> {
  const part = pageAppPart(config);
  if (part !== null) await assertAppPartOn(meta, part.app, part.module);
}

/**
 * Whether a rule an app shipped belongs to a part of it that is off: such a
 * rule starts no run and is passed over by one already waiting. A rule an
 * owner made, and one of no part, never is.
 */
export async function rulePartOff(meta: MetaDb, rule: { managedBy: string | null; module: string | null }): Promise<boolean> {
  if (rule.managedBy === null || rule.module === null) return false;
  return !(await appPartIsOn(meta, rule.managedBy, rule.module));
}

/** The roles among `roles` that are offered now: not one whose every part is off, nor one of an app that is switched off. */
export async function offeredRoles<R extends Pick<Role, 'appKey' | 'modules'>>(meta: MetaDb, roles: readonly R[]): Promise<R[]> {
  const keys = [...new Set(roles.flatMap((role) => (role.appKey === null ? [] : [role.appKey])))];
  if (keys.length === 0) return [...roles];
  const parts = await loadAppParts(meta, keys);
  return roles.filter((role) => (role.appKey === null || parts.get(role.appKey)?.disabled !== true) && roleIsOffered(role, parts));
}

/*
 * THE PUBLIC ENTRIES OF PARTS THAT ARE OFF, per app, remembered for a moment:
 * the public API asks on every request, and most apps have no entry of a part
 * at all. The switch forgets what is remembered ({@link forgetClosedDoors}),
 * so a part switched off closes its entries at once in this process; an
 * add-on connected or switched off is seen within the moment.
 */
const DOORS_TTL_MS = 3_000;
const closedDoors = new WeakMap<MetaDb, Map<string, { at: number; closed: ReadonlySet<string> }>>();

/** The refs of the app's public entries that are closed now: those of a part that is off. */
export async function closedDoorsOf(meta: MetaDb, appKey: string | null): Promise<ReadonlySet<string>> {
  if (appKey === null) return NO_DOORS;
  let known = closedDoors.get(meta);
  if (known === undefined) {
    known = new Map();
    closedDoors.set(meta, known);
  }
  const held = known.get(appKey);
  const now = Date.now();
  if (held !== undefined && now - held.at < DOORS_TTL_MS) return held.closed;
  const parts = (await loadAppParts(meta, [appKey])).get(appKey);
  const closed = new Set(Object.entries(parts?.modules?.doors ?? {}).flatMap(([ref, module]) => (partIsOn(parts, module) ? [] : [ref])));
  known.set(appKey, { at: now, closed: closed.size === 0 ? NO_DOORS : closed });
  return closed.size === 0 ? NO_DOORS : closed;
}
const NO_DOORS: ReadonlySet<string> = new Set();

/** Forget which public entries are closed: a switch moved, or an app's parts were written again. */
export function forgetClosedDoors(meta: MetaDb): void {
  closedDoors.delete(meta);
}

/** Whether a public entry an app declares (by the ref it is served under) belongs to a part of it that is off. */
export async function publicEntryPartOff(meta: MetaDb, appKey: string | null, ref: string): Promise<boolean> {
  return (await closedDoorsOf(meta, appKey)).has(ref);
}

/**
 * A public key as it stands now: its scope without the entries of parts that
 * are off. The key itself when nothing is closed (every app with no part).
 * Every door of the public API reads a key through this, so an entry of a
 * part that is off is answered as one that is not there, by all of them.
 */
export async function withOpenDoors<K extends { managedBy: string | null; scope: { byRef: ReadonlyMap<string, unknown> } }>(meta: MetaDb, key: K): Promise<K> {
  const closed = await closedDoorsOf(meta, key.managedBy);
  if (closed.size === 0 || ![...closed].some((ref) => key.scope.byRef.has(ref))) return key;
  return { ...key, scope: { ...key.scope, byRef: new Map([...key.scope.byRef].filter(([ref]) => !closed.has(ref))) } };
}

/** The ids of the pages among `rows` that belong to a part of their app that is off: listed and offered by nothing. */
export async function pagesOfPartsOff(meta: MetaDb, rows: readonly { id: string; appKey?: string | null; appModule?: string | null }[]): Promise<ReadonlySet<string>> {
  const named = rows.filter((row) => row.appKey != null && row.appModule != null);
  if (named.length === 0) return new Set();
  const parts = await loadAppParts(meta, [...new Set(named.map((row) => row.appKey as string))]);
  return new Set(named.filter((row) => !partIsOn(parts.get(row.appKey as string), row.appModule)).map((row) => row.id));
}

/** Whether a stored page belongs to a part of its app that is off. */
export async function pagePartOff(meta: MetaDb, config: unknown): Promise<boolean> {
  const part = pageAppPart(config);
  return part !== null && !(await appPartIsOn(meta, part.app, part.module));
}
