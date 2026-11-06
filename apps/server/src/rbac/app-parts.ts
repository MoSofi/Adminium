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

/** The add-ons connected to each of the host installs `ids` and running: install id → add-on keys. */
async function connectedAddOns(meta: MetaDb, ids: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (ids.length === 0) return out;
  const rows = await meta.db
    .selectFrom('adminium_manifest_attachments')
    .innerJoin('adminium_manifests', 'adminium_manifests.id', 'adminium_manifest_attachments.manifestId')
    .select(['adminium_manifests.manifestKey as addOn', 'adminium_manifest_attachments.hostInstall as host'])
    .where('adminium_manifests.kind', '=', 'add-on')
    .where('adminium_manifests.status', '=', 'installed')
    .where('adminium_manifest_attachments.disabledAt', 'is', null)
    .where('adminium_manifest_attachments.hostInstall', 'in', [...ids])
    .execute();
  for (const row of rows) {
    const held = out.get(row.host) ?? new Set<string>();
    held.add(row.addOn);
    out.set(row.host, held);
  }
  return out;
}

/**
 * The parts of the apps named (every app when none is): by install id, and by
 * app key for the install that owns the key's bare addresses (the only one of
 * most keys). Each install of an app has its own switches and add-ons.
 */
export async function loadAppParts(meta: MetaDb, keys?: readonly string[]): Promise<Map<string, AppParts>> {
  const out = new Map<string, AppParts>();
  const rows = await appModulesOf(meta, keys);
  const needy = rows.filter((row) => row.modules?.defs.some((def) => def.needs.length > 0) === true).map((row) => row.id);
  const connected = await connectedAddOns(meta, needy);
  const slugs = new Map(
    rows.length === 0
      ? []
      : (await meta.db.selectFrom('adminium_manifests').select(['id', 'instanceSlug']).where('id', 'in', rows.map((row) => row.id)).execute()).map((row) => [row.id, row.instanceSlug] as const),
  );
  for (const row of rows) {
    const off = new Set<string>();
    const waiting = new Map<string, readonly string[]>();
    for (const def of row.modules?.defs ?? []) {
      const missing = def.needs.filter((addOn) => connected.get(row.id)?.has(addOn) !== true);
      if (missing.length > 0) waiting.set(def.id, missing);
      if (missing.length > 0 || !switchOf(row.modules!, def.id)) off.add(def.id);
    }
    const parts: AppParts = { key: row.key, id: row.id, running: row.status === 'installed', disabled: row.status === 'disabled', modules: row.modules, off, waiting };
    out.set(row.id, parts);
    if ((slugs.get(row.id) ?? '') === '' || !out.has(row.key)) out.set(row.key, parts);
  }
  return out;
}

/** Whether `module` of the app `appKey` is on — of one install when it is named. True for an app that is not installed: its own gate answers for that. */
export async function appPartIsOn(meta: MetaDb, appKey: string | null | undefined, module: string | null | undefined, installId?: string | null): Promise<boolean> {
  if (appKey === null || appKey === undefined || module === null || module === undefined) return true;
  const parts = await loadAppParts(meta, [appKey]);
  return partIsOn((installId === undefined || installId === null ? undefined : parts.get(installId)) ?? parts.get(appKey), module);
}

/**
 * Whether a role is offered: it names no part, or one of its parts is on —
 * the parts of its own install. A role of an app that is not installed, or
 * of one with no parts, is.
 */
export function roleIsOffered(role: Pick<Role, 'appKey' | 'modules'> & { manifestId?: string | null }, parts: ReadonlyMap<string, AppParts>): boolean {
  if (role.appKey === null || role.modules === null) return true;
  const app = (role.manifestId === undefined || role.manifestId === null ? undefined : parts.get(role.manifestId)) ?? parts.get(role.appKey);
  if (app === undefined || app.modules === null) return true;
  return role.modules.some((id) => !app.off.has(id));
}

/**
 * The tables a role of a part does not reach while the part is off: for each
 * app with a part off, `<connectionId>` and the table's real name, with the
 * part it belongs to.
 */
export async function tablesOfPartsOff(meta: MetaDb, parts: ReadonlyMap<string, AppParts>): Promise<{ app: string; install: string; connectionId: string; table: string; schema: string | null; module: string }[]> {
  // Per install: Kiln's part switched off stops Kiln's tables, never Fernhill's.
  const installs = [...new Map([...parts.values()].map((app) => [app.id, app])).values()].filter((app) => app.off.size > 0);
  if (installs.length === 0) return [];
  const rows = await meta.db
    .selectFrom('adminium_app_tables')
    .select(['appKey', 'manifestId', 'connectionId', 'tableName', 'schemaName', 'module'])
    .where('manifestId', 'in', installs.map((app) => app.id))
    .where('module', 'is not', null)
    .where('state', 'in', ['created', 'adopted', 'shared'])
    .execute();
  return rows.flatMap((row) =>
    row.module !== null && row.manifestId !== null && parts.get(row.manifestId)?.off.has(row.module) === true
      ? [{ app: row.appKey, install: row.manifestId, connectionId: row.connectionId, table: row.tableName, schema: row.schemaName, module: row.module }]
      : [],
  );
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
export async function assertAppPartOn(meta: MetaDb, appKey: string | null | undefined, module: string | null | undefined, installId?: string | null): Promise<void> {
  if (appKey === null || appKey === undefined || module === null || module === undefined) return;
  if (!(await appPartIsOn(meta, appKey, module, installId))) throw new PartOffError(appKey, module);
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
export async function rulePartOff(meta: MetaDb, rule: { managedBy: string | null; module: string | null; installId?: string | null }): Promise<boolean> {
  if (rule.managedBy === null || rule.module === null) return false;
  // The part of the install that shipped the rule: another copy's switch is not this one's.
  return !(await appPartIsOn(meta, rule.managedBy, rule.module, rule.installId));
}

/** The roles among `roles` that are offered now: not one whose every part is off, nor one of an app that is switched off. */
export async function offeredRoles<R extends Pick<Role, 'appKey' | 'modules'> & { manifestId?: string | null }>(meta: MetaDb, roles: readonly R[]): Promise<R[]> {
  const keys = [...new Set(roles.flatMap((role) => (role.appKey === null ? [] : [role.appKey])))];
  if (keys.length === 0) return [...roles];
  const parts = await loadAppParts(meta, keys);
  // An app's role is suspended while ITS install is switched off; another install of the key does not decide it.
  const of = (role: R) => (role.manifestId === undefined || role.manifestId === null ? undefined : parts.get(role.manifestId)) ?? (role.appKey === null ? undefined : parts.get(role.appKey));
  return roles.filter((role) => (role.appKey === null || of(role)?.disabled !== true) && roleIsOffered(role, parts));
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
export async function closedDoorsOf(meta: MetaDb, appKey: string | null, installId?: string | null): Promise<ReadonlySet<string>> {
  if (appKey === null) return NO_DOORS;
  let known = closedDoors.get(meta);
  if (known === undefined) {
    known = new Map();
    closedDoors.set(meta, known);
  }
  // The key's install the asking public key belongs to: each copy of an app has its own switches.
  const slot = installId === undefined || installId === null ? appKey : installId;
  const held = known.get(slot);
  const now = Date.now();
  if (held !== undefined && now - held.at < DOORS_TTL_MS) return held.closed;
  const all = await loadAppParts(meta, [appKey]);
  const parts = all.get(slot) ?? all.get(appKey);
  const closed = new Set(Object.entries(parts?.modules?.doors ?? {}).flatMap(([ref, module]) => (partIsOn(parts, module) ? [] : [ref])));
  known.set(slot, { at: now, closed: closed.size === 0 ? NO_DOORS : closed });
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
export async function withOpenDoors<K extends { managedBy: string | null; connectionId?: string; scope: { byRef: ReadonlyMap<string, unknown> } }>(meta: MetaDb, key: K): Promise<K> {
  // The app's install on the key's database: its parts decide, not another copy's.
  const install =
    key.managedBy === null || key.connectionId === undefined
      ? undefined
      : (await meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', key.managedBy).where('scopeKey', '=', key.connectionId).executeTakeFirst())?.id;
  const closed = await closedDoorsOf(meta, key.managedBy, install);
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

/**
 * A dashboard's cards without those of parts of its app that are off: a card
 * names its part (`layout.items[].module`) and is not drawn while that part
 * is off, as a page of it is not. Nothing to drop answers the same array.
 */
export async function cardsOfPartsOn<I extends { module?: string | undefined }>(meta: MetaDb, appKey: string | null | undefined, items: readonly I[]): Promise<readonly I[]> {
  if (appKey === null || appKey === undefined || !items.some((item) => typeof item.module === 'string')) return items;
  const parts = (await loadAppParts(meta, [appKey])).get(appKey);
  const kept = items.filter((item) => partIsOn(parts, item.module));
  return kept.length === items.length ? items : kept;
}

/** The cards among `items` of parts of the app that are off: what a layout saved without them keeps (they were not drawn to be moved). */
export async function cardsOfPartsOff<I extends { module?: string | undefined }>(meta: MetaDb, appKey: string | null | undefined, items: readonly I[]): Promise<I[]> {
  if (appKey === null || appKey === undefined || !items.some((item) => typeof item.module === 'string')) return [];
  const parts = (await loadAppParts(meta, [appKey])).get(appKey);
  return items.filter((item) => !partIsOn(parts, item.module));
}

/** A stored page's envelope with {@link cardsOfPartsOn} applied to its layout (`config.layout.items`). */
export async function withCardsOfPartsOn(meta: MetaDb, envelope: unknown): Promise<unknown> {
  const part = pageAppPart(envelope);
  if (part === null || typeof envelope !== 'object' || envelope === null) return envelope;
  const body = (envelope as { config?: unknown }).config;
  const layout = typeof body === 'object' && body !== null ? (body as { layout?: unknown }).layout : undefined;
  const items = typeof layout === 'object' && layout !== null ? (layout as { items?: unknown }).items : undefined;
  if (!Array.isArray(items)) return envelope;
  const kept = await cardsOfPartsOn(meta, part.app, items as { module?: string }[]);
  if (kept === items) return envelope;
  return { ...envelope, config: { ...(body as object), layout: { ...(layout as object), items: kept } } };
}
