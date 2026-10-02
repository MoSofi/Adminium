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
  rolesRepo,
  type AppTableRecord,
  type MetaDb,
  type ProjectAppRemovalChange,
  type ProjectAppRemovals,
} from '@adminium/meta';

import { uninstallAppDocuments } from '../documents/app-documents.js';
import { AppError, ForbiddenError, NotFoundError, ValidationFailedError } from '../errors.js';
import { isUntouched } from '../pages/generated-stamp.js';
import type { EditBody } from '../schema-ddl/programmatic.js';
import { addOnTablesByName } from './add-ons.js';
import { builtOnTables } from './app-shapes.js';
import { removeOutbox } from './manifest-outbox.js';
import { forgetAppRoleGrants, roleSlugFor } from './manifest-roles.js';
import { removeManifestRules } from './manifest-rules.js';
import type { AppSchemaTarget, RowTest } from './schema-target.js';

export interface RemovalDeps {
  meta: MetaDb;
  credentialCrypto: { encrypt(v: string): string; decrypt(v: string): string };
  schemaTarget?: AppSchemaTarget | undefined;
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
  if (before.nullable !== false && after.nullable === false && after.default === undefined) {
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

const idOf = (model: DatabaseModel, name: string): string =>
  model.tables.find((t) => t.name === name && (t.schema === model.defaultSchema || t.schema === null))?.id ??
  model.tables.find((t) => t.name === name)?.id ??
  name;

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
    return !(await addOnTablesByName({ meta: deps.meta, credentialCrypto: deps.credentialCrypto })).has(record.tableName);
  }

  /** How many rows a change concerns, or null when the table cannot be read (it is gone already). */
  async function count(connectionId: string, table: string, test: RowTest): Promise<number | null> {
    if (deps.schemaTarget?.count === undefined) return null;
    try {
      return await deps.schemaTarget.count(connectionId, table, test);
    } catch {
      return null;
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

  /** A table the app no longer has: its rules go, and its record is released (kept) or marked dropped. */
  async function letGo(record: AppTableRecord, as: 'released' | 'dropped'): Promise<void> {
    await removeManifestRules(deps.meta, [record], record.connectionId);
    await tables.setState(record.id, as);
  }

  return {
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

      for (const ref of diff.tables) {
        const record = byRef.get(ref);
        if (record === undefined || asked.has(`table:${ref}.`)) continue;
        const rows = await count(connectionId, record.tableName, { kind: 'all' });
        const mine = await droppable(record);
        if (rows === null) {
          // Nothing to read: the table is gone already.
          await letGo(record, 'dropped');
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
      for (const { table: ref, column } of diff.columns) {
        const record = byRef.get(ref);
        if (record === undefined || asked.has(`column:${ref}.${column}`)) continue;
        const rows = await count(connectionId, record.tableName, { kind: 'not-null', column });
        if (rows === null) continue; // the column is not there
        if (input.drops === 'never' || declined || !record.owned || record.state !== 'created') {
          outcome.kept.push(`${record.tableName}.${column}`);
          input.log(
            `kept "${record.tableName}.${column}": ${
              !record.owned || record.state !== 'created'
                ? 'the app did not make that table'
                : declined
                  ? 'that was the answer'
                  : 'removing data is done from `adminium dev` or Studio'
            }.`,
          );
        } else if (rows === 0) {
          empty.columns.push({ record, column });
        } else {
          changes.push({ kind: 'column', table: ref, tableName: record.tableName, column, rows });
        }
      }
      for (const narrowed of diff.narrowings) {
        const record = byRef.get(narrowed.table);
        if (record === undefined) continue;
        const rows = await count(connectionId, record.tableName, narrowed.test);
        if (rows === null || rows === 0) continue;
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
          for (const entry of empty.columns) outcome.kept.push(`${entry.record.tableName}.${entry.column}`);
          input.log(`kept what the manifest dropped: it could not be removed (${error instanceof Error ? error.message : String(error)}).`);
        }
      }

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
    async answer(input: { key: string; connectionId: string | null; accept: boolean; actor: RemovalActor }): Promise<{
      key: string;
      accepted: boolean;
      dropped: { tables: string[]; columns: string[] };
      kept: string[];
    }> {
      const { key, connectionId } = input;
      const waiting = (await state.find(key))?.removals ?? null;
      if (waiting === null || connectionId === null) {
        throw new NotFoundError(`"${key}" has no removal waiting for an answer.`, { reason: 'NO_REMOVAL' });
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
            if (record.owned && record.state === 'created') droppedColumns.push({ table: record.tableName, column: change.column });
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
