// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's manifest no longer declares.
 *
 * An update of a packaged app is additive: nothing notices a page, a role, a
 * table or a column that a newer version left out. For an app a person edits
 * in a project folder that would pile up dead pages and dead tables with
 * every experiment, so applying a folder's manifest compares it with the one
 * applied before, and deals with what went:
 *
 *   a page             gone, when nobody edited it; kept as an ordinary page when somebody did
 *   a role             gone, with its grants; who held it is counted and said first
 *   emails, documents  gone when the manifest declares none any more
 *   a table, a column  HOLD DATA. Never dropped on the way: recorded as a
 *                      question, and dropped only when a person says yes
 *   a narrower column  never changed in the database at all. The rows that no
 *                      longer fit are counted and said, and stay
 *
 * A table or a column that holds NOTHING loses nothing by going, so it goes
 * without a question — where dropping is allowed at all. A server never
 * drops: it keeps the table, releases it from the app, and says so.
 *
 * The question is a record in the meta store, not a prompt: the apply runs in
 * the server, and the person who can answer is in Studio, or at another
 * terminal, or is a model with a tool. Everything else of the new manifest is
 * applied while the question waits.
 */

import type { Manifest, RequiredColumn } from '@adminium/manifest';
import type { DatabaseModel } from '@adminium/engine';
import {
  appTablesRepo,
  pagesRepo,
  permissionsRepo,
  projectAppsRepo,
  publicApiStateRepo, publicEndpointsRepo,
  publicKeysRepo,
  rolesRepo,
  settingsRepo,
  type AppTableRecord,
  type InstalledManifest,
  type MetaDb,
  type ProjectAppRemovalChange,
  type ProjectAppRemovals,
} from '@adminium/meta';

import { uninstallAppDocuments } from '../documents/app-documents.js';
import { AppError, ForbiddenError, NotFoundError, ValidationFailedError } from '../errors.js';
import { isUntouched } from '../pages/generated-stamp.js';
import type { EditBody } from '../schema-ddl/programmatic.js';
import { addOnTablesByName, addOnsKeptBy } from './add-ons.js';
import { builtOnTables } from './app-shapes.js';
import { removeOutbox } from './manifest-outbox.js';
import { removeAutomations } from './manifest-automations.js';
import { announceRulesChanged } from '../documents/trigger-sync.js';
import { forgetAppRoleGrants, roleSlugFor } from './manifest-roles.js';
import { removeManifestRules } from './manifest-rules.js';
import type { AppSchemaTarget, RowTest } from './schema-target.js';

export interface RemovalDeps {
  meta: MetaDb;
  credentialCrypto: { encrypt(v: string): string; decrypt(v: string): string };
  schemaTarget?: AppSchemaTarget | undefined;
  /** A public key that stopped: whoever holds it in memory forgets it. */
  invalidateKey?: ((keyId: string) => void) | undefined;
  /** The installed apps' names by key, for saying who else uses a table. */
  names?: (() => Promise<Map<string, string>>) | undefined;
  /** Endpoints about to go: every live key that grants one loses the grant (`endpoint-service.ts` `dropEndpointGrants`). */
  dropEndpointGrants?: ((connectionId: string, endpointIds: readonly string[]) => Promise<unknown>) | undefined;
}

/** Whether an uninstall also deletes the tables it may, and who asks. */
export interface DropOptions {
  dropTables: boolean;
  superAdmin: boolean;
}

/** What went between two manifests of one app. Refs, never real table names. */
export interface RemovalDiff {
  pages: string[];
  roles: string[];
  tables: string[];
  columns: { table: string; column: string }[];
  narrowings: { table: string; column: string; detail: string; test: RowTest }[];
  outbox: boolean;
  documents: boolean;
}

/** Why a column of the new manifest holds less than it did, and which rows that concerns; null when it holds as much. */
function narrowingOf(before: RequiredColumn, after: RequiredColumn): { detail: string; test: RowTest } | null {
  if (before.type !== after.type) {
    // A whole number that may now be larger loses nothing.
    if (before.type === 'int' && after.type === 'bigint') return null;
    return { detail: `its type changes from ${before.type} to ${after.type}`, test: { kind: 'not-null', column: after.ref } };
  }
  if (after.type === 'text' && after.maxLength !== undefined && (before.maxLength === undefined || after.maxLength < before.maxLength)) {
    return {
      detail: `it now holds at most ${String(after.maxLength)} characters${before.maxLength === undefined ? '' : ` (it held ${String(before.maxLength)})`}`,
      test: { kind: 'longer', column: after.ref, length: after.maxLength },
    };
  }
  if (after.type === 'enum') {
    const removed = (before.enum ?? []).filter((value) => !(after.enum ?? []).includes(value));
    if (removed.length > 0) {
      return { detail: `it no longer allows ${removed.map((value) => `"${value}"`).join(', ')}`, test: { kind: 'in', column: after.ref, values: removed } };
    }
  }
  // A column requires a value unless it says `nullable: true`.
  if (before.nullable === true && after.nullable !== true && after.default === undefined) {
    return { detail: 'it must now have a value', test: { kind: 'null', column: after.ref } };
  }
  return null;
}

/** What `next` no longer declares that `previous` did. */
export function diffRemovals(previous: Manifest | null, next: Manifest): RemovalDiff {
  const empty: RemovalDiff = { pages: [], roles: [], tables: [], columns: [], narrowings: [], outbox: false, documents: false };
  if (previous === null || previous.kind !== 'app' || next.kind !== 'app') return empty;
  const nextPages = new Set((next.pages ?? []).map((page) => page.ref));
  const nextRoles = new Set((next.roles ?? []).map((role) => role.key));
  const nextTables = new Map((next.requiredSchema?.tables ?? []).map((table) => [table.ref, table]));
  const diff: RemovalDiff = {
    ...empty,
    pages: (previous.pages ?? []).map((page) => page.ref).filter((ref) => !nextPages.has(ref)),
    roles: (previous.roles ?? []).map((role) => role.key).filter((key) => !nextRoles.has(key)),
    outbox: previous.outbox !== undefined && next.outbox === undefined,
    documents:
      (previous.documents ?? []).length + builtOnTables(previous).length > 0 && (next.documents ?? []).length + builtOnTables(next).length === 0,
  };
  for (const table of previous.requiredSchema?.tables ?? []) {
    const now = nextTables.get(table.ref);
    if (now === undefined) {
      diff.tables.push(table.ref);
      continue;
    }
    const columns = new Map(now.columns.map((column) => [column.ref, column]));
    for (const column of table.columns) {
      const after = columns.get(column.ref);
      if (after === undefined) {
        diff.columns.push({ table: table.ref, column: column.ref });
        continue;
      }
      const narrowed = narrowingOf(column, after);
      if (narrowed !== null) diff.narrowings.push({ table: table.ref, column: column.ref, ...narrowed });
    }
  }
  return diff;
}

/** One change of a question, as a sentence. */
export function removalInWords(change: ProjectAppRemovalChange): string {
  const rows = `${String(change.rows)} row${change.rows === 1 ? '' : 's'}`;
  if (change.kind === 'table') return `the table "${change.tableName}" (${rows})`;
  if (change.kind === 'column') return `the column "${change.tableName}.${change.column ?? ''}" (${rows} hold a value)`;
  return `"${change.tableName}.${change.column ?? ''}": ${change.detail ?? 'it holds less than it did'} — ${rows} do not fit and stay as they are`;
}

export interface RemovalOutcome {
  pages: { removed: string[]; kept: string[] };
  roles: { slug: string; members: number; apiKeys: number }[];
  /** What was dropped without a question: it held nothing. Real names. */
  dropped: { tables: string[]; columns: string[] };
  /** What was kept and released from the app: real names, with why. */
  kept: string[];
  /** The question now waiting, or null. */
  pending: ProjectAppRemovals | null;
}

export interface RemovalActor {
  id: string | null;
  label: string;
  kind?: 'user' | 'system' | undefined;
  superAdmin: () => Promise<boolean>;
}

/** The table of that name in the default schema; one elsewhere only when it is the only one so named. */
const idOf = (model: DatabaseModel, name: string): string => {
  const here = model.tables.find((t) => t.name === name && (t.schema === model.defaultSchema || t.schema === null));
  if (here !== undefined) return here.id;
  const named = model.tables.filter((t) => t.name === name);
  return named.length === 1 ? (named[0] as (typeof named)[number]).id : name;
};

export function createRemovals(deps: RemovalDeps) {
  const tables = appTablesRepo(deps.meta);
  const state = projectAppsRepo(deps.meta);

  /** A table this app may drop: it made it, and nothing else names it. */
  async function droppable(record: AppTableRecord): Promise<boolean> {
    if (!record.owned || record.state !== 'created') return false;
    const others = (await tables.forConnection(record.connectionId)).filter(
      (other) => other.appKey !== record.appKey && other.tableName === record.tableName && other.state !== 'dropped' && other.state !== 'released',
    );
    if (others.length > 0) return false;
    // Another add-on's table is never this manifest's to drop; an add-on's own table is its own.
    const holder = (await addOnTablesByName({ meta: deps.meta, credentialCrypto: deps.credentialCrypto })).get(record.tableName);
    return holder === undefined || holder === record.appKey;
  }

  /**
   * How many rows a change concerns; `gone` when the table (or the column) is
   * not in the database any more; `unknown` when the count failed for any
   * other reason. A failed read is never taken for an empty table: a database
   * that hiccups must not mark a live table as dropped.
   */
  async function count(connectionId: string, table: string, test: RowTest): Promise<number | 'gone' | 'unknown'> {
    if (deps.schemaTarget?.count === undefined) return 'unknown';
    try {
      return await deps.schemaTarget.count(connectionId, table, test);
    } catch {
      try {
        const live = await deps.schemaTarget.read(connectionId, new Set([table]));
        const found = live.tables.find((candidate) => candidate.ref === table);
        if (found === undefined) return 'gone';
        if (test.kind !== 'all' && !found.columns.some((column) => column.ref === test.column)) return 'gone';
      } catch {
        // Nothing can be said of it now.
      }
      return 'unknown';
    }
  }

  /** Drop tables and columns in one schema change. Refused as a whole when any step is. */
  async function drop(
    connectionId: string,
    doomed: { tables: readonly string[]; columns: readonly { table: string; column: string }[] },
    by: { superAdmin: boolean; createdBy: string | null },
  ): Promise<void> {
    if (doomed.tables.length + doomed.columns.length === 0) return;
    if (deps.schemaTarget === undefined) {
      throw new ValidationFailedError('This server has no connection layer to drop tables in.', { reason: 'DDL_UNAVAILABLE' });
    }
    const edit = (model: DatabaseModel): EditBody => ({
      dropTables: doomed.tables.map((name) => idOf(model, name)),
      // A column of a table that goes in the same change goes with its table.
      dropColumns: doomed.columns
        .filter((entry) => !doomed.tables.includes(entry.table))
        .map((entry) => ({ table: idOf(model, entry.table), column: entry.column })),
    });
    const plan = await deps.schemaTarget.planEdit(connectionId, edit, { superAdmin: by.superAdmin });
    if (plan.refusals.length > 0) {
      throw new AppError(422, 'SCHEMA_EDIT_REFUSED', 'This cannot be dropped on this database.', { refusals: plan.refusals });
    }
    await deps.schemaTarget.edit(connectionId, edit, by);
  }

  /**
   * A column that stays in a table the app still writes to, and that the app
   * no longer fills: where it requires a value and has no default, every new
   * row would be refused. It is made optional, which loses nothing. Only ever
   * on a table of the app's own.
   */
  async function relax(
    connectionId: string,
    columns: readonly { table: string; column: string }[],
    by: { superAdmin: boolean; createdBy: string | null },
    log: (message: string) => void,
  ): Promise<void> {
    if (columns.length === 0 || deps.schemaTarget === undefined) return;
    const edit = (model: DatabaseModel): EditBody => ({
      alterColumns: columns.flatMap((entry) => {
        const table = model.tables.find((candidate) => candidate.id === idOf(model, entry.table));
        const column = table?.columns.find((candidate) => candidate.name === entry.column);
        if (table === undefined || column === undefined) return [];
        if (column.nullable || column.default !== null || table.primaryKey.includes(column.name)) return [];
        return [{ table: table.id, column: column.name, nullable: true as const }];
      }),
    });
    try {
      const plan = await deps.schemaTarget.planEdit(connectionId, edit, { superAdmin: by.superAdmin });
      if (plan.steps.length === 0) return;
      if (plan.refusals.length > 0) throw new Error(plan.refusals.map((refusal) => refusal.message).join(' '));
      await deps.schemaTarget.edit(connectionId, edit, by);
      log(`${plan.steps.map((step) => `"${step.table ?? ''}.${step.column ?? ''}"`).join(', ')} may be left empty from now on: the app no longer fills ${plan.steps.length === 1 ? 'it' : 'them'}.`);
    } catch (error) {
      log(
        `${columns.map((entry) => `"${entry.table}.${entry.column}"`).join(', ')} still require${columns.length === 1 ? 's' : ''} a value the app no longer gives, and could not be made optional (${
          error instanceof Error ? error.message : String(error)
        }): new rows will be refused until that is done.`,
      );
    }
  }

  /** A table the app no longer has: its rules go, and its record is released (kept) or marked dropped. */
  async function letGo(record: AppTableRecord, as: 'released' | 'dropped'): Promise<void> {
    await removeManifestRules(deps.meta, [record], record.connectionId);
    await tables.setState(record.id, as);
  }

  /** The real table ids a drop names, in the database as it is read. */
  const dropEdit =
    (doomed: readonly { record: AppTableRecord }[]) =>
    (model: DatabaseModel): EditBody => ({
      dropTables: doomed.map(
        (entry) =>
          model.tables.find((t) => t.name === entry.record.tableName && (t.schema === model.defaultSchema || t.schema === null))?.id ??
          model.tables.find((t) => t.name === entry.record.tableName)?.id ??
          entry.record.tableName,
      ),
    });

  /** What an uninstall would remove and keep: the dialog's list, and the uninstall's own. */
  async function listOf(row: InstalledManifest) {
    const key = row.row.manifestKey;
    const connectionId = row.row.connectionId;
    const pageRows = await pagesRepo(deps.meta).listByManifest(row.row.id);
    const keys = (await publicKeysRepo(deps.meta).list()).filter((candidate) => candidate.managedBy === key && candidate.revokedAt === null);
    const endpoints =
      connectionId === null ? [] : (await publicEndpointsRepo(deps.meta).listByConnection(connectionId)).filter((endpoint) => endpoint.managedBy === key);
    const roles = [];
    for (const role of (await rolesRepo(deps.meta).list()).filter((candidate) => candidate.appKey === key)) {
      const members = await deps.meta.db.selectFrom('adminium_user_roles').select('userId').where('roleId', '=', role.id).execute();
      const apiKeys = await deps.meta.db.selectFrom('adminium_api_keys').select('id').where('roleId', '=', role.id).execute();
      roles.push({ role, members: members.map((m) => m.userId), apiKeys: apiKeys.map((k) => k.id) });
    }
    // An add-on's table is never an app's to drop, even one the app made first.
    const addOnTables = await addOnTablesByName({ meta: deps.meta, credentialCrypto: deps.credentialCrypto });
    const records =
      connectionId === null
        ? []
        : (await tables.forInstall(connectionId, key)).filter(
            (record) => (record.role === 'app' || record.role === 'sample-ledger') && record.state !== 'dropped' && record.state !== 'pending',
          );
    const others =
      connectionId === null
        ? []
        : (await tables.forConnection(connectionId)).filter((record) => record.appKey !== key && record.state !== 'dropped' && record.state !== 'released');
    const domains = await settingsRepo(deps.meta).get('surfaces.domains');
    // The add-ons connected to it: kept, only their link to it goes.
    const addOns = await addOnsKeptBy({ meta: deps.meta, credentialCrypto: deps.credentialCrypto }, key);
    // The other apps that use a table too (a shared menu), by name: the dialog says who keeps it.
    // An add-on's record of a table is not a share: its table is simply kept (never droppable, above).
    const addOnKeys = new Set(addOnTables.values());
    const sharing = others.filter((other) => other.role === 'app' && !addOnKeys.has(other.appKey) && records.some((record) => record.tableName === other.tableName));
    const appNames = sharing.length === 0 || deps.names === undefined ? new Map<string, string>() : await deps.names();
    const sharedWith = (tableName: string) =>
      [...new Set(sharing.filter((other) => other.tableName === tableName).map((other) => other.appKey))]
        .sort()
        .map((other) => ({ key: other, name: appNames.get(other) ?? other }));
    return {
      key,
      connectionId,
      addOns,
      pages: {
        removed: pageRows.filter((page) => isUntouched(page.config)),
        kept: pageRows.filter((page) => !isUntouched(page.config)),
      },
      keys,
      endpoints,
      roles,
      tables: records.map((record) => ({
        record,
        sharedWith: sharedWith(record.tableName),
        // Made by this app, and no other app's record names it.
        droppable: record.owned && record.state === 'created' && !others.some((other) => other.tableName === record.tableName) && (addOnTables.get(record.tableName) ?? key) === key,
      })),
      hosts: Object.entries(domains)
        .filter(([, target]) => target.appKey === key)
        .map(([host]) => host),
    };
  }
  type UninstallList = Awaited<ReturnType<typeof listOf>>;

  /**
   * EVERYTHING THAT COULD REFUSE THE DROP IS ASKED FIRST. Discarding data is
   * Super Admin's alone in the schema editor, and a plan can refuse a table;
   * finding either out after the keys, pages and roles had gone would leave
   * half an uninstall behind.
   */
  async function checkDrop(list: UninstallList, opts: DropOptions): Promise<void> {
    const doomed = opts.dropTables ? list.tables.filter((entry) => entry.droppable) : [];
    if (doomed.length === 0) return;
    if (!opts.superAdmin) {
      throw new ForbiddenError('Deleting an app’s tables and data requires Super Admin.', 'FORBIDDEN', { reason: 'DROP_NEEDS_SUPER_ADMIN' });
    }
    if (deps.schemaTarget === undefined || list.connectionId === null) {
      throw new ValidationFailedError('This server has no connection layer to drop tables in.', { reason: 'DDL_UNAVAILABLE' });
    }
    const check = await deps.schemaTarget.planEdit(list.connectionId, dropEdit(doomed), { superAdmin: opts.superAdmin });
    if (check.refusals.length > 0) {
      throw new AppError(422, 'SCHEMA_EDIT_REFUSED', 'These tables cannot be dropped on this database.', { refusals: check.refusals });
    }
  }

  /**
   * What an uninstall removes, IN ORDER, each step idempotent, so a failure
   * part way can be run again and finishes the rest.
   */
  async function remove(list: UninstallList, opts: DropOptions & { createdBy: string | null }) {
    const doomed = opts.dropTables ? list.tables.filter((entry) => entry.droppable) : [];
    /*
     * 1. Its own keys stop, THEN its endpoints go: an endpoint a live key
     *    still grants cannot be removed.
     */
    for (const managed of list.keys) {
      await publicKeysRepo(deps.meta).revoke(managed.id);
      deps.invalidateKey?.(managed.id);
    }
    // A key the owner made by hand may grant one of them too: it loses that grant first, or it would go on serving a table this leaves behind.
    const leaving = new Map<string, string[]>();
    for (const endpoint of list.endpoints) leaving.set(endpoint.connectionId, [...(leaving.get(endpoint.connectionId) ?? []), endpoint.id]);
    for (const [connectionId, ids] of leaving) await deps.dropEndpointGrants?.(connectionId, ids);
    for (const endpoint of list.endpoints) await publicEndpointsRepo(deps.meta).remove(endpoint.id);
    // Every other process drops what it remembers of the keys at once (a revoked key is else served from memory for a while yet).
    if (list.keys.length > 0 || list.endpoints.length > 0) await publicApiStateRepo(deps.meta).bump();
    /*
     * 2. Pages: one nobody touched goes, with its grants (a grant is a
     *    polymorphic string no FK reaches); one somebody edited stays, as
     *    their own ordinary page.
     */
    const pagePermissions = permissionsRepo(deps.meta);
    for (const page of list.pages.removed) {
      await pagePermissions.revokeAllForResource('page', page.id);
      await pagesRepo(deps.meta).delete(page.id);
    }
    for (const page of list.pages.kept) await pagesRepo(deps.meta).releaseFromManifest(page.id);
    /*
     * 3. Its roles. Deleting a role CASCADES: its members lose it and its
     *    `adm_sk_` keys are hard-deleted, not revoked — which is why the
     *    dialog listed them and the audit row names them.
     */
    for (const entry of list.roles) {
      await deps.meta.db.deleteFrom('adminium_roles').where('id', '=', entry.role.id).execute();
    }
    await forgetAppRoleGrants(deps.meta, list.roles.map((entry) => entry.role.slug));
    /*
     * 4. The column rules it wrote, while they are still as it wrote them.
     *    One the operator changed, switched off or re-saved differently is
     *    theirs, and stays.
     */
    const rulesRemoved =
      list.connectionId === null ? 0 : await removeManifestRules(deps.meta, list.tables.map((entry) => entry.record), list.connectionId);
    // Its emails: the outbox definition, and the templates nobody edited.
    const emailsRemoved = await removeOutbox(deps.meta, list.key);
    // The rules it shipped: gone unless the owner changed one, and that one switched off when its tables go too.
    const rulesGone = await removeAutomations(deps.meta, list.key, list.connectionId, { tablesDropped: opts.dropTables && list.tables.some((entry) => entry.droppable) });
    if (rulesGone > 0 || opts.dropTables) await announceRulesChanged(deps.meta);
    // The document profiles it made; an operator's own stay.
    if (list.connectionId !== null) await uninstallAppDocuments(deps.meta, list.connectionId, list.key);
    /*
     * 5. Its tables: dropped only when asked, and only the ones it made and
     *    nothing else names. Every other table is kept and its record
     *    released, so a reinstall recognises it.
     */
    const dropped: string[] = [];
    if (doomed.length > 0 && deps.schemaTarget !== undefined && list.connectionId !== null) {
      await deps.schemaTarget.edit(list.connectionId, dropEdit(doomed), { superAdmin: opts.superAdmin, createdBy: opts.createdBy });
      for (const entry of doomed) {
        await tables.setState(entry.record.id, 'dropped');
        dropped.push(entry.record.tableName);
      }
    }
    const kept = list.tables.filter((entry) => !dropped.includes(entry.record.tableName));
    for (const entry of kept) await tables.setState(entry.record.id, 'released');
    return { rulesRemoved, emailsRemoved, dropped, kept };
  }

  return {
    listOf,
    checkDrop,
    remove,
    /**
     * After a manifest was applied: remove what can simply go, and record
     * what would lose data.
     *
     * `drops` says what a table or column that holds data becomes: `ask`
     * records the question (under `adminium dev`), `never` keeps it and
     * releases it from the app (a server).
     */
    async afterApply(input: {
      key: string;
      rowId: string;
      connectionId: string | null;
      previous: Manifest | null;
      manifest: Manifest;
      /** The hash of the manifest just applied. */
      hash: string;
      drops: 'ask' | 'never';
      actor: RemovalActor;
      log: (message: string) => void;
      /** Columns an apply that stopped left undealt with: looked at here as if this apply had dropped them. */
      owed?: readonly { table: string; column: string }[] | undefined;
    }): Promise<RemovalOutcome> {
      const { key, connectionId, manifest } = input;
      const diff = diffRemovals(input.previous, manifest);
      const outcome: RemovalOutcome = { pages: { removed: [], kept: [] }, roles: [], dropped: { tables: [], columns: [] }, kept: [], pending: null };

      // Pages: every page of this install the manifest no longer declares, not only the ones this apply dropped.
      const declared = new Set((manifest.kind === 'app' ? (manifest.pages ?? []) : []).map((page) => page.ref));
      const pages = pagesRepo(deps.meta);
      for (const page of await pages.listByManifest(input.rowId)) {
        if (declared.has(page.slug)) continue;
        if (isUntouched(page.config)) {
          // A grant is a polymorphic string no foreign key reaches.
          await permissionsRepo(deps.meta).revokeAllForResource('page', page.id);
          await pages.delete(page.id);
          outcome.pages.removed.push(page.slug);
        } else {
          await pages.releaseFromManifest(page.id);
          outcome.pages.kept.push(page.slug);
        }
      }

      // Roles: deleting one takes its members' hold of it and its API keys with it, so both are counted first.
      const wanted = new Set((manifest.kind === 'app' ? (manifest.roles ?? []) : []).map((role) => roleSlugFor(key, role.key)));
      const gone = (await rolesRepo(deps.meta).list()).filter((role) => role.appKey === key && !wanted.has(role.slug));
      for (const role of gone) {
        const members = await deps.meta.db.selectFrom('adminium_user_roles').select('userId').where('roleId', '=', role.id).execute();
        const apiKeys = await deps.meta.db.selectFrom('adminium_api_keys').select('id').where('roleId', '=', role.id).execute();
        await deps.meta.db.deleteFrom('adminium_roles').where('id', '=', role.id).execute();
        outcome.roles.push({ slug: role.slug, members: members.length, apiKeys: apiKeys.length });
      }
      await forgetAppRoleGrants(deps.meta, gone.map((role) => role.slug));

      if (diff.outbox) await removeOutbox(deps.meta, key);
      if (diff.documents && connectionId !== null) await uninstallAppDocuments(deps.meta, connectionId, key);

      if (connectionId === null) return outcome;

      /*
       * WHAT HOLDS DATA. A question already waiting is carried over: the row's
       * document was replaced by this apply, so the next one would no longer
       * see what an earlier one dropped. A table or column the manifest
       * declares again leaves the question.
       */
      const records = (await tables.forInstall(connectionId, key)).filter(
        (record) => record.role === 'app' && record.state !== 'dropped' && record.state !== 'released' && record.state !== 'pending',
      );
      const byRef = new Map(records.map((record) => [record.ref, record]));
      const nextTables = new Map((manifest.requiredSchema?.tables ?? []).map((table) => [table.ref, table]));
      const waiting = (await state.find(key))?.removals ?? null;
      const carried = (waiting?.changes ?? []).filter((change) => {
        const table = nextTables.get(change.table);
        if (change.kind === 'table') return table === undefined && byRef.has(change.table);
        if (change.kind === 'column') return table !== undefined && !table.columns.some((column) => column.ref === change.column);
        return false; // a narrowing is counted again from the manifest now applied
      });
      const asked = new Set(carried.map((change) => `${change.kind}:${change.table}.${change.column ?? ''}`));

      const changes: ProjectAppRemovalChange[] = [...carried];
      const empty: { tables: AppTableRecord[]; columns: { record: AppTableRecord; column: string }[] } = { tables: [], columns: [] };
      const declined = (await state.find(key))?.declinedHash === input.hash;
      /** Columns that stay in a table the app goes on writing to. */
      const staying: { table: string; column: string }[] = carried.flatMap((change) =>
        change.kind === 'column' && change.column !== undefined ? [{ table: change.tableName, column: change.column }] : [],
      );

      /*
       * THE TABLES COME FROM WHAT IS RECORDED, not from the manifest before:
       * an apply that stopped after the installed document moved leaves no
       * "before" to compare with, and its table would otherwise stay the
       * app's for good. The columns have no record of their own, so the ones
       * a stopped apply left are handed in as `owed`.
       */
      const goneTables = records.filter((record) => !nextTables.has(record.ref)).map((record) => record.ref);
      const goneColumns = [...diff.columns];
      for (const entry of input.owed ?? []) {
        const table = nextTables.get(entry.table);
        if (table === undefined || table.columns.some((column) => column.ref === entry.column)) continue;
        if (!goneColumns.some((other) => other.table === entry.table && other.column === entry.column)) goneColumns.push(entry);
      }

      for (const ref of goneTables) {
        const record = byRef.get(ref);
        if (record === undefined || asked.has(`table:${ref}.`)) continue;
        const rows = await count(connectionId, record.tableName, { kind: 'all' });
        const mine = await droppable(record);
        if (rows === 'gone') {
          await letGo(record, 'dropped');
        } else if (rows === 'unknown') {
          // Could not be read now: left exactly as it is, and looked at again on the next apply.
          input.log(`"${record.tableName}" could not be read, so nothing was decided about it.`);
        } else if (input.drops === 'never' || declined || !mine) {
          await letGo(record, 'released');
          outcome.kept.push(record.tableName);
          input.log(
            `kept "${record.tableName}": ${
              !mine ? 'the app did not make it' : declined ? 'that was the answer' : 'removing data is done from `adminium dev` or Studio'
            }.`,
          );
        } else if (rows === 0) {
          empty.tables.push(record);
        } else {
          changes.push({ kind: 'table', table: ref, tableName: record.tableName, rows });
        }
      }
      for (const { table: ref, column } of goneColumns) {
        const record = byRef.get(ref);
        if (record === undefined || asked.has(`column:${ref}.${column}`)) continue;
        const rows = await count(connectionId, record.tableName, { kind: 'not-null', column });
        if (rows === 'gone' || rows === 'unknown') continue; // not there, or not readable now
        // A column of a table another app or an add-on uses is theirs too: never dropped for this app.
        const mine = await droppable(record);
        if (input.drops === 'never' || declined || !mine) {
          outcome.kept.push(`${record.tableName}.${column}`);
          input.log(
            `kept "${record.tableName}.${column}": ${
              !mine
                ? 'the app did not make that table, or does not use it alone'
                : declined
                  ? 'that was the answer'
                  : 'removing data is done from `adminium dev` or Studio'
            }.`,
          );
          if (mine) staying.push({ table: record.tableName, column });
        } else if (rows === 0) {
          empty.columns.push({ record, column });
        } else {
          changes.push({ kind: 'column', table: ref, tableName: record.tableName, column, rows });
          staying.push({ table: record.tableName, column });
        }
      }
      for (const narrowed of diff.narrowings) {
        const record = byRef.get(narrowed.table);
        if (record === undefined) continue;
        const rows = await count(connectionId, record.tableName, narrowed.test);
        if (typeof rows !== 'number' || rows === 0) continue;
        // A server asks nothing: it says what it found.
        if (input.drops === 'never') {
          input.log(`"${record.tableName}.${narrowed.column}": ${narrowed.detail}; ${String(rows)} row(s) do not fit and stay as they are.`);
          continue;
        }
        changes.push({ kind: 'narrow', table: narrowed.table, tableName: record.tableName, column: narrowed.column, rows, detail: narrowed.detail });
      }

      // What holds nothing loses nothing by going.
      if (empty.tables.length + empty.columns.length > 0) {
        try {
          await drop(
            connectionId,
            {
              tables: empty.tables.map((record) => record.tableName),
              columns: empty.columns.map((entry) => ({ table: entry.record.tableName, column: entry.column })),
            },
            { superAdmin: await input.actor.superAdmin(), createdBy: input.actor.id },
          );
          for (const record of empty.tables) await letGo(record, 'dropped');
          outcome.dropped.tables.push(...empty.tables.map((record) => record.tableName));
          outcome.dropped.columns.push(...empty.columns.map((entry) => `${entry.record.tableName}.${entry.column}`));
        } catch (error) {
          // Could not be dropped (another table links to it): kept, and said, never half an answer.
          for (const record of empty.tables) {
            await letGo(record, 'released');
            outcome.kept.push(record.tableName);
          }
          for (const entry of empty.columns) {
            outcome.kept.push(`${entry.record.tableName}.${entry.column}`);
            staying.push({ table: entry.record.tableName, column: entry.column });
          }
          input.log(`kept what the manifest dropped: it could not be removed (${error instanceof Error ? error.message : String(error)}).`);
        }
      }
      await relax(connectionId, staying, { superAdmin: await input.actor.superAdmin(), createdBy: input.actor.id }, input.log);

      const pending = changes.length === 0 ? null : { hash: input.hash, changes };
      if (pending !== null || waiting !== null) await state.setRemovals(key, pending);
      outcome.pending = pending;
      return outcome;
    },

    /** The question waiting for an app, or null. */
    async pending(key: string): Promise<ProjectAppRemovals | null> {
      return (await state.find(key))?.removals ?? null;
    },

    /**
     * Answer the question. `accept` drops the tables and columns it lists (a
     * narrowing changes nothing in the database either way); declining keeps
     * every one of them, released from the app, and the same manifest does
     * not ask again.
     */
    async answer(input: {
      key: string;
      connectionId: string | null;
      accept: boolean;
      actor: RemovalActor;
      /** The manifest the app runs on now: what it declares is never dropped or released, whatever was asked earlier. */
      manifest: Manifest | null;
    }): Promise<{
      key: string;
      accepted: boolean;
      dropped: { tables: string[]; columns: string[] };
      kept: string[];
    }> {
      const { key, connectionId } = input;
      const asked = (await state.find(key))?.removals ?? null;
      if (asked === null || connectionId === null || input.manifest === null) {
        throw new NotFoundError(`"${key}" has no removal waiting for an answer.`, { reason: 'NO_REMOVAL' });
      }
      /*
       * THE QUESTION IS READ AGAINST THE APP AS IT IS NOW. A later manifest may
       * declare a table again and then stop part way, leaving an old question
       * behind: answering it must never touch what the app declares today.
       */
      const declared = new Map((input.manifest.requiredSchema?.tables ?? []).map((table) => [table.ref, table]));
      const waiting = {
        ...asked,
        changes: asked.changes.filter((change) => {
          const table = declared.get(change.table);
          if (change.kind === 'table') return table === undefined;
          if (change.kind === 'column') return table !== undefined && !table.columns.some((column) => column.ref === change.column);
          return true;
        }),
      };
      if (waiting.changes.length === 0) {
        await state.setRemovals(key, null);
        throw new NotFoundError(`"${key}" declares all of that again: nothing is waiting for an answer.`, { reason: 'NO_REMOVAL' });
      }
      const records = new Map(
        (await tables.forInstall(connectionId, key)).filter((record) => record.role === 'app').map((record) => [record.ref, record]),
      );
      const droppedTables: AppTableRecord[] = [];
      const droppedColumns: { table: string; column: string }[] = [];
      const kept: string[] = [];

      if (input.accept) {
        // Destroying data is Super Admin's alone, as it is on an uninstall.
        const superAdmin = await input.actor.superAdmin();
        if (!superAdmin) {
          throw new ForbiddenError('Removing an app’s tables and columns with their data requires Super Admin.', 'FORBIDDEN', {
            reason: 'DROP_NEEDS_SUPER_ADMIN',
          });
        }
        for (const change of waiting.changes) {
          const record = records.get(change.table);
          if (record === undefined) continue;
          if (change.kind === 'table') {
            if (await droppable(record)) droppedTables.push(record);
            else kept.push(record.tableName);
          } else if (change.kind === 'column' && change.column !== undefined) {
            if (await droppable(record)) droppedColumns.push({ table: record.tableName, column: change.column });
            else kept.push(`${record.tableName}.${change.column}`);
          }
        }
        await drop(connectionId, { tables: droppedTables.map((record) => record.tableName), columns: droppedColumns }, { superAdmin, createdBy: input.actor.id });
        for (const record of droppedTables) await letGo(record, 'dropped');
        // A table that could not be the app's to drop is released, like a declined one.
        for (const change of waiting.changes) {
          const record = records.get(change.table);
          if (change.kind === 'table' && record !== undefined && !droppedTables.includes(record)) await letGo(record, 'released');
        }
        await state.setRemovals(key, null);
      } else {
        for (const change of waiting.changes) {
          const record = records.get(change.table);
          if (record === undefined) continue;
          if (change.kind === 'table') {
            await letGo(record, 'released');
            kept.push(record.tableName);
          } else if (change.kind === 'column') {
            kept.push(`${record.tableName}.${change.column ?? ''}`);
          }
        }
        await state.decline(key, waiting.hash);
      }
      return {
        key,
        accepted: input.accept,
        dropped: { tables: droppedTables.map((record) => record.tableName), columns: droppedColumns.map((entry) => `${entry.table}.${entry.column}`) },
        kept,
      };
    },
  };
}

export type Removals = ReturnType<typeof createRemovals>;
/** What an uninstall would remove and keep. */
export type UninstallList = Awaited<ReturnType<Removals['listOf']>>;
