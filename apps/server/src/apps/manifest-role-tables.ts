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
 *  - a table or a column the add-on does not have skips the entry, by name —
 *    a role is then narrower than the app asked, never wider.
 *
 * Reads and writes the meta store only.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { ledgersOf, type AddOnManifest, type Manifest } from '@adminium/manifest';
import { appTablesRepo, permissionsRepo, rolesRepo, settingsRepo, snapshotsRepo, type MetaDb, type ReadLimit, type TableActions, type UpdateLimit } from '@adminium/meta';

import { roleSlugFor, SEEDED_APP_ROLE_GRANTS_KEY } from './manifest-roles.js';

type AppRole = NonNullable<Extract<Manifest, { kind: 'app' }>['roles']>[number];
type RoleTable = NonNullable<AppRole['tables']>[number];
type Action = RoleTable['actions'][number];

export interface RoleTableResult {
  /** The role's key in the app. */
  role: string;
  addOn: string;
  table: string;
  /** What the role holds of the table now by this grant (after any narrowing below). */
  actions: string[];
  /** Why the entry, or part of it, was left out. */
  skipped?: 'unknown-table' | 'unknown-column' | 'ledger-table';
}

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
   * keeps its pairs, so the next event tries again.
   */
  const takeBack = async (slug: string, addOn: string, table: string, actions: readonly string[]): Promise<void> => {
    const role = await roles.findBySlug(slug);
    // Never another's role: neither its row nor its pairs are this app's to touch.
    if (role !== null && role.appKey !== app.key) return;
    if (role !== null) {
      // The table wherever it still stands — a record the add-on has let go of names it too: the row must be found to be narrowed.
      const name = records.find((one) => one.appKey === addOn && one.ref === table)?.tableName;
      const real = tableId(addOn, table) ?? (name === undefined ? null : (model?.tables.find((one) => one.name === name)?.id ?? null));
      if (real === null) return;
      const ref = `${connectionId}/${real}`;
      const existing = await permissions.find(role.id, 'table', ref);
      if (existing !== null) {
        const held = { ...(existing.actions as Record<string, unknown>) };
        for (const action of actions) held[action] = false;
        // A limit narrows an action: with the action taken back, so is what narrowed it.
        if (actions.includes('read')) delete held['readLimit'];
        if (actions.includes('update')) delete held['updateLimit'];
        if (actions.includes('create')) delete held['createLimit'];
        const anyLeft = Object.entries(held).some(([name_, value]) => !name_.endsWith('Limit') && value === true);
        if (anyLeft) await permissions.grant(role.id, 'table', ref, held as never);
        else await permissions.revoke(role.id, 'table', ref);
      }
    }
    for (const action of actions) changed = seeded.delete(pairOf(slug, addOn, table, action)) || changed;
  };

  const live = new Map(input.live.map((addOn) => [addOn.key, addOn.manifest]));
  const asked = new Set<string>();
  try {
  for (const [slug, declaredRole] of slugs) {
    for (const entry of roleTablesOf(declaredRole, declared)) {
      const manifest = live.get(entry.addOn);
      // Not here for this app: nothing is written, and what was given before is taken back below.
      if (manifest === undefined) continue;
      const result = (actions: readonly string[], skipped?: RoleTableResult['skipped']): void => {
        out.push({ role: declaredRole.key, addOn: entry.addOn, table: entry.table, actions: [...actions], ...(skipped === undefined ? {} : { skipped }) });
      };
      const role = await roles.findBySlug(slug);
      if (role === null || role.appKey !== app.key) continue;
      const id = tableId(entry.addOn, entry.table);
      const shape = (manifest.requiredSchema?.tables ?? []).find((table) => table.ref === entry.table);
      if (id === null || shape === undefined) {
        result([], 'unknown-table');
        continue;
      }
      // Never widened past the add-on's own shape: no hold on a receipt, read only on what a ledger's code writes.
      const ledgers = ledgersOf(manifest);
      if (ledgers.some((ledger) => ledger.receipts === entry.table)) {
        result([], 'ledger-table');
        continue;
      }
      const written = ledgers.some((ledger) => Object.prototype.hasOwnProperty.call(ledger.writes ?? {}, entry.table));
      const actions = [...new Set(entry.actions)].filter((action) => !written || action === 'read');
      const limit = entry.limit;
      const named = [...(limit?.readable ?? []), ...(limit?.writable ?? []), ...(limit?.creatable ?? []), ...Object.keys(limit?.writableValues ?? {}), ...Object.keys(limit?.creatableValues ?? {})];
      const columns = new Set(shape.columns.map((column) => column.ref));
      // A grant is never written without its limit: a limit that names a column the table has not skips the whole entry.
      if (named.some((column) => !columns.has(column))) {
        result([], 'unknown-column');
        continue;
      }
      if (actions.length === 0) {
        result([], 'ledger-table');
        continue;
      }
      asked.add(`${slug}|${entry.addOn}/${entry.table}`);

      const ref = `${connectionId}/${id}`;
      const existing = await permissions.find(role.id, 'table', ref);
      const { updateLimit: _update, readLimit: _read, createLimit: _create, ...held } = { read: false, create: false, update: false, delete: false, export: false, import: false, ...(existing?.actions as TableActions | undefined) };
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
      const asks = (action: Action): boolean => actions.includes(action);
      const update: UpdateLimit | undefined = limit?.writable === undefined || !asks('update') ? undefined : { writable: [...limit.writable], ...(limit.writableValues === undefined ? {} : { writableValues: limit.writableValues }) };
      const read: ReadLimit | undefined = limit?.readable === undefined || !asks('read') ? undefined : { readable: [...limit.readable] };
      const create: UpdateLimit | undefined = limit?.creatable === undefined || !asks('create') ? undefined : { writable: [...limit.creatable], ...(limit.creatableValues === undefined ? {} : { writableValues: limit.creatableValues }) };
      const anyLeft = Object.values(next).some((value) => value === true);
      // The actions and their limits, one row, one statement.
      if (anyLeft || (existing !== null && (update !== undefined || read !== undefined || create !== undefined))) {
        await permissions.grant(role.id, 'table', ref, { ...next, ...(update === undefined ? {} : { updateLimit: update }), ...(read === undefined ? {} : { readLimit: read }), ...(create === undefined ? {} : { createLimit: create }) } as never);
      } else if (existing !== null) await permissions.revoke(role.id, 'table', ref);
      // The ledger says what the row now holds — written down only once the row does.
      for (const pair of giving) seeded.add(pair);
      for (const before of leaving) seeded.delete(before.pair);
      changed = changed || giving.length > 0 || leaving.length > 0;
      result(actions.filter((action) => next[action] === true), actions.length === new Set(entry.actions).size ? undefined : 'ledger-table');
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
