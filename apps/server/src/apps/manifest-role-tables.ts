// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN APP'S ROLES HOLD OF AN ADD-ON'S TABLES (`roles[].tables`).
 *
 * An app may give one of its roles a narrow hold on a table of an add-on it
 * names: a hotel's housekeeping writes a stock transfer; a clinic's clinician
 * reads the item list without its costs. The grant is the app's, the table is
 * the add-on's — so it is written when the two are together and taken back
 * when they are not:
 *
 *  - written while the add-on is live for the app (named by it, installed in
 *    the same database, attached to it and switched on);
 *  - taken back the moment that stops being true, and given again on return;
 *  - an action is given ONCE (a ledger of what was given says so): an owner
 *    who takes it away keeps it away; the limit is written every time;
 *  - the actions and their limit go in ONE row, one statement: never a grant
 *    that stands for a moment without its limit;
 *  - never widened past what the add-on's own shape allows: no hold at all on
 *    a ledger's receipts, read only on a table a ledger's code writes;
 *  - never past what the add-on lets an app's role hold (`appGrants`): an
 *    action or a column outside it is left out, by name, and a grant on such
 *    a table is written with its column lists — never whole;
 *  - a table or a column the add-on does not have skips the entry, by name —
 *    a role is then narrower than the app asked, never wider.
 *
 * Reads and writes the meta store only.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { addOnRoleTableHold, holdWider, type RoleTableResult, type AddOnManifest, type Manifest, type RoleTableHold } from '@adminium/manifest';
import { appTablesRepo, permissionsRepo, rolesRepo, settingsRepo, snapshotsRepo, type MetaDb, type ReadLimit, type TableActions, type UpdateLimit } from '@adminium/meta';

import { roleSlugFor, SEEDED_APP_ROLE_GRANTS_KEY, storedRowLimit } from './manifest-roles.js';

type AppRole = NonNullable<Extract<Manifest, { kind: 'app' }>['roles']>[number];
type RoleTable = NonNullable<AppRole['tables']>[number];
type Action = RoleTable['actions'][number];

/** What a settle gave each role of an add-on's tables (kept beside the add-on's own words, so the add-on installer reads it too). */
export type { RoleTableResult } from '@adminium/manifest';

/** A role's grants on add-on tables: the ones of the role it clones, then its own over them — a clone of a limited role is limited alike. */
export function roleTablesOf(role: AppRole, roles: readonly AppRole[]): RoleTable[] {
  const from = role.cloneFrom === undefined ? undefined : roles.find((other) => other.key === role.cloneFrom);
  const by = new Map<string, RoleTable>();
  for (const entry of [...(from?.tables ?? []), ...(role.tables ?? [])]) by.set(`${entry.addOn}/${entry.table}`, entry);
  return [...by.values()];
}

/** What each role of the app asks of add-ons' tables, for whoever is about to install it. */
export function roleTablesAsked(app: Manifest): { role: string; roleName: string; addOn: string; table: string; actions: string[] }[] {
  if (app.kind !== 'app') return [];
  const roles = app.roles ?? [];
  return roles.flatMap((role) => roleTablesOf(role, roles).map((entry) => ({ role: role.key, roleName: role.name, addOn: entry.addOn, table: entry.table, actions: [...entry.actions] })));
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
function holdOf(entry: RoleTable, addOn: AddOnManifest | undefined): Omit<RoleTableHold, 'limit'> & { unchecked?: true } {
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

/**
 * What each role of the app will hold of the add-ons' tables, judged by each
 * add-on's manifest where one is at hand; with `before` (the running
 * version), what each holds more than it did.
 */
/** The parts of a grant's limit that narrow it beyond its columns. */
const NARROWING = ['rows', 'writableValues', 'creatableValues', 'writableFrom'] as const;

export function roleTablesChecked(
  app: Manifest,
  addOns: ReadonlyMap<string, AddOnManifest>,
  before?: Manifest | null,
  /** The add-ons as they run now, when the update brings another version of one: the running version's hold is judged by the running add-on. */
  addOnsBefore?: ReadonlyMap<string, AddOnManifest>,
): RoleTableCheck[] {
  if (app.kind !== 'app') return [];
  const roles = app.roles ?? [];
  const earlier = before?.kind === 'app' ? (before.roles ?? []) : null;
  return roles.flatMap((role) =>
    roleTablesOf(role, roles).map((entry) => {
      const hold = holdOf(entry, addOns.get(entry.addOn));
      const out: RoleTableCheck = { role: role.key, roleName: role.name, addOn: entry.addOn, table: entry.table, ...hold, actions: [...hold.actions] };
      if (earlier === null) return out;
      const was = earlier.find((one) => one.key === role.key);
      const old = was === undefined ? undefined : roleTablesOf(was, earlier).find((one) => one.addOn === entry.addOn && one.table === entry.table);
      let wider = holdWider(old === undefined ? null : holdOf(old, addOnsBefore?.get(entry.addOn) ?? addOns.get(entry.addOn)), hold);
      // Which rows it reaches and which values it may write narrow a grant as its columns do: one the running version
      // held that this one drops or changes is a widening too, said by the limit's name (`rows`, `writableValues`, …).
      const loosened = old === undefined ? [] : NARROWING.filter((key) => old.limit?.[key] !== undefined && JSON.stringify(old.limit[key]) !== JSON.stringify(entry.limit?.[key]));
      if (loosened.length > 0) wider = { actions: wider?.actions ?? [], columns: [...(wider?.columns ?? []), ...loosened.map((key) => `(${key})`)] };
      return wider === null ? out : { ...out, wider };
    }),
  );
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

const PAIR = /^table:@([a-z][a-z0-9-]{1,79})\/([A-Za-z0-9_]+):(read|create|update)$/;
/** Whether a ledger pair is a grant on an add-on's table (its `/` cannot occur in a grant on the app's own). */
export const isAddOnTablePair = (grant: string): boolean => PAIR.test(grant);

const pairOf = (slug: string, addOn: string, table: string, action: string): string => `${slug}|table:@${addOn}/${table}:${action}`;

interface LiveForApp {
  key: string;
  manifest: AddOnManifest;
}

/**
 * Settles what the app's roles hold of every add-on's tables: written for an
 * add-on in `live`, taken back for any other. Answers what each entry came
 * to, by name.
 */
export async function settleRoleTables(input: { meta: MetaDb; app: Manifest; connectionId: string; live: readonly LiveForApp[] }): Promise<RoleTableResult[]> {
  const { meta, app, connectionId } = input;
  const out: RoleTableResult[] = [];
  if (app.kind !== 'app') return out;
  const declared = app.roles ?? [];
  const settings = settingsRepo(meta);
  const seeded = new Set(await settings.get(SEEDED_APP_ROLE_GRANTS_KEY));
  const slugs = new Map(declared.map((role) => [roleSlugFor(app.key, role.key), role]));
  /** What the ledger says was given to this app's roles on add-ons' tables. */
  const given = [...seeded].flatMap((pair) => {
    const cut = pair.indexOf('|');
    const found = PAIR.exec(pair.slice(cut + 1));
    return found === null || !slugs.has(pair.slice(0, cut)) ? [] : [{ pair, slug: pair.slice(0, cut), addOn: found[1]!, table: found[2]!, action: found[3]! as Action }];
  });
  if (given.length === 0 && !declared.some((role) => roleTablesOf(role, declared).length > 0)) return out;

  const roles = rolesRepo(meta);
  const permissions = permissionsRepo(meta);
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  const model = snapshot === null ? null : parseDatabaseModel(snapshot.schema);
  const records = await appTablesRepo(meta).forConnection(connectionId);
  /** One of an add-on's own tables as it stands here: made or taken by it, and still its own. A released record answers nothing. */
  const tableId = (addOn: string, ref: string): string | null => {
    const record = records.find((one) => one.appKey === addOn && one.ref === ref && (one.state === 'created' || one.state === 'adopted'));
    return record === undefined ? null : (model?.tables.find((table) => table.name === record.tableName)?.id ?? null);
  };
  let changed = false;

  /**
   * Takes these actions of one table back from a role: the row goes when
   * nothing is left on it. The ledger forgets a pair only once its action is
   * off the row (or the role is gone): a table that cannot be found right now
   * keeps its pairs, so the next event tries again. An action the row no
   * longer held (the owner took it away) keeps its pair: given once, it is
   * not given again when the add-on returns.
   */
  const takeBack = async (slug: string, addOn: string, table: string, actions: readonly string[]): Promise<void> => {
    const role = await roles.findBySlug(slug);
    // Never another's role: neither its row nor its pairs are this app's to touch.
    if (role !== null && role.appKey !== app.key) return;
    let forget: readonly string[] = actions;
    if (role !== null) {
      // The table wherever it still stands — a record the add-on has let go of names it too: the row must be found to be narrowed.
      const name = records.find((one) => one.appKey === addOn && one.ref === table)?.tableName;
      const real = tableId(addOn, table) ?? (name === undefined ? null : (model?.tables.find((one) => one.name === name)?.id ?? null));
      if (real === null) return;
      const ref = `${connectionId}/${real}`;
      const existing = await permissions.find(role.id, 'table', ref);
      // Only what the row still held was this grant's to take; what the owner already took stays remembered
      // while the add-on is away, so its return gives nothing back. An entry the app itself no longer asks for is forgotten whole.
      if (!live.has(addOn)) forget = actions.filter((action) => (existing?.actions as Record<string, unknown> | undefined)?.[action] === true);
      if (existing !== null) {
        const held = { ...(existing.actions as Record<string, unknown>) };
        for (const action of actions) held[action] = false;
        // A limit narrows an action: with the action taken back, so is what narrowed it.
        if (actions.includes('read')) delete held['readLimit'];
        if (actions.includes('update')) delete held['updateLimit'];
        if (actions.includes('create')) delete held['createLimit'];
        // Which rows an action reaches goes with the action too.
        if (held['rowLimit'] !== undefined) {
          const rows = Object.fromEntries(Object.entries(held['rowLimit'] as Record<string, unknown>).filter(([action]) => !(actions as readonly string[]).includes(action)));
          if (Object.keys(rows).length === 0) delete held['rowLimit'];
          else held['rowLimit'] = rows;
        }
        const anyLeft = Object.entries(held).some(([name_, value]) => !name_.endsWith('Limit') && value === true);
        if (anyLeft) await permissions.grant(role.id, 'table', ref, held as never);
        else await permissions.revoke(role.id, 'table', ref);
      }
    }
    for (const action of forget) changed = seeded.delete(pairOf(slug, addOn, table, action)) || changed;
  };

  const live = new Map(input.live.map((addOn) => [addOn.key, addOn.manifest]));
  const asked = new Set<string>();
  try {
  for (const [slug, declaredRole] of slugs) {
    for (const entry of roleTablesOf(declaredRole, declared)) {
      const manifest = live.get(entry.addOn);
      // Not here for this app: nothing is written, and what was given before is taken back below.
      if (manifest === undefined) continue;
      const result = (hold: RoleTableHold): void => {
        const { limit: _limit, ...said } = hold;
        out.push({ role: declaredRole.key, addOn: entry.addOn, table: entry.table, ...said, actions: [...said.actions] });
      };
      const role = await roles.findBySlug(slug);
      if (role === null || role.appKey !== app.key) continue;
      const id = tableId(entry.addOn, entry.table);
      // Cut to the add-on's own words: its shape (receipts, ledger tables), its columns, and what it lets an app's role hold (`appGrants`).
      const hold = addOnRoleTableHold(entry, manifest);
      if (id === null || hold.skipped === 'unknown-table') {
        result({ actions: [], narrowed: { actions: [...new Set(entry.actions)] }, skipped: 'unknown-table' });
        continue;
      }
      // Nothing left to give: the whole entry is said, and what was given before is taken back below.
      if (hold.actions.length === 0) {
        result(hold);
        continue;
      }
      const actions = hold.actions;
      const limit = hold.limit;
      asked.add(`${slug}|${entry.addOn}/${entry.table}`);

      const ref = `${connectionId}/${id}`;
      const existing = await permissions.find(role.id, 'table', ref);
      const { updateLimit: _update, readLimit: _read, createLimit: _create, rowLimit: _rows, ...held } = { read: false, create: false, update: false, delete: false, export: false, import: false, ...(existing?.actions as TableActions | undefined) };
      const next: Record<string, unknown> = { ...held };
      const giving: string[] = [];
      for (const action of actions) {
        const pair = pairOf(slug, entry.addOn, entry.table, action);
        // Given once: an owner who took it away keeps it away.
        if (seeded.has(pair)) continue;
        next[action] = true;
        giving.push(pair);
      }
      // An action the app no longer asks for (or may not hold here any more) leaves the row.
      const leaving = given.filter((one) => one.slug === slug && one.addOn === entry.addOn && one.table === entry.table && !actions.includes(one.action));
      for (const before of leaving) next[before.action] = false;
      /*
       * The limit of every action the entry asks for, whatever that action's
       * state on the row right now: an owner who unticks "read" and ticks it
       * again finds it limited as the app wrote it, never whole.
       */
      const asks = (action: Action): boolean => (actions as readonly string[]).includes(action);
      const update: UpdateLimit | undefined = limit?.writable === undefined || !asks('update') ? undefined : { writable: [...limit.writable], ...(limit.writableValues === undefined ? {} : { writableValues: limit.writableValues }), ...(limit.writableFrom === undefined ? {} : { writableFrom: limit.writableFrom }) };
      const read: ReadLimit | undefined = limit?.readable === undefined || !asks('read') ? undefined : { readable: [...limit.readable] };
      const create: UpdateLimit | undefined = limit?.creatable === undefined || !asks('create') ? undefined : { writable: [...limit.creatable], ...(limit.creatableValues === undefined ? {} : { writableValues: limit.creatableValues }) };
      // Which rows the read and the update reach: kept for the actions the entry asks for, as the limits above are.
      const wholeRows = limit?.rows === undefined ? {} : storedRowLimit(limit.rows);
      const rows = Object.fromEntries(Object.entries(wholeRows).filter(([action]) => asks(action as Action)));
      const rowLimit = Object.keys(rows).length === 0 ? undefined : rows;
      const anyLeft = Object.values(next).some((value) => value === true);
      // The actions and their limits, one row, one statement.
      if (anyLeft || (existing !== null && (update !== undefined || read !== undefined || create !== undefined || rowLimit !== undefined))) {
        await permissions.grant(role.id, 'table', ref, { ...next, ...(update === undefined ? {} : { updateLimit: update }), ...(read === undefined ? {} : { readLimit: read }), ...(create === undefined ? {} : { createLimit: create }), ...(rowLimit === undefined ? {} : { rowLimit }) } as never);
      } else if (existing !== null) await permissions.revoke(role.id, 'table', ref);
      // The ledger says what the row now holds — written down only once the row does.
      for (const pair of giving) seeded.add(pair);
      for (const before of leaving) seeded.delete(before.pair);
      changed = changed || giving.length > 0 || leaving.length > 0;
      result({ ...hold, actions: actions.filter((action) => next[action] === true) });
    }
  }

  // What was given and is no longer asked for, or whose add-on is not here for the app any more: taken back.
  const stale = new Map<string, { slug: string; addOn: string; table: string; actions: string[] }>();
  for (const one of given) {
    if (!seeded.has(one.pair) || asked.has(`${one.slug}|${one.addOn}/${one.table}`)) continue;
    const at = `${one.slug}|${one.addOn}/${one.table}`;
    const kept = stale.get(at) ?? { slug: one.slug, addOn: one.addOn, table: one.table, actions: [] };
    kept.actions.push(one.action);
    stale.set(at, kept);
  }
  for (const one of stale.values()) await takeBack(one.slug, one.addOn, one.table, one.actions);
  } finally {
    // Whatever stopped it part way: the ledger holds every grant that was written, so each can be taken back later.
    if (changed) await settings.set(SEEDED_APP_ROLE_GRANTS_KEY, [...seeded].sort());
  }
  return out;
}
