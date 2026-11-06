// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Apps a person saves, what an install still needs, and workspace files
 * (wave 0075).
 *
 *  - `appSavesRepo`: one row per Save as app. A version of a key is saved
 *    once (the unique index refuses a second), and the next version is the
 *    last one + 1, read from here.
 *  - `appAfterInstallRepo`: the items an install still needs from a person
 *    (a key, a webhook address, a sender), keyed by the install, ticked off
 *    when done. The rows go with the install (cascade).
 *  - `workspaceSavesRepo`, `workspaceInstallsRepo`: a workspace saved as one
 *    file, and the install of one — kept on the server, so "Install the
 *    rest" survives a reload and one run at a time holds a row.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumAppAfterInstallTable, AdminiumAppSavesTable, AdminiumWorkspaceInstallsTable, AdminiumWorkspaceSavesTable } from '../schema/tables.js';
import { affected, packJson, readBool, readJson, readJsonOrNull, writeBool } from './util.js';

export type AppSave = Selectable<AdminiumAppSavesTable>;

export interface CreateAppSaveInput {
  appKey: string;
  version: string;
  lineage: string;
  connectionId: string | null;
  label: string;
  savedBy: string | null;
  integrity: string;
  bytes: number;
  fileId?: string | null;
}

/** A version of a key that was saved before: it is never saved again. */
export class AppVersionSaved extends Error {
  override name = 'AppVersionSaved';
}

export function appSavesRepo(meta: MetaDb) {
  const { db } = meta;
  const read = (row: AppSave): AppSave => ({ ...row, bytes: Number(row.bytes) });
  return {
    async create(input: CreateAppSaveInput, at: number = Date.now()): Promise<AppSave> {
      const held = await db
        .selectFrom('adminium_app_saves')
        .select('id')
        .where('appKey', '=', input.appKey)
        .where('version', '=', input.version)
        .executeTakeFirst();
      if (held !== undefined) throw new AppVersionSaved(`${input.appKey} ${input.version}`);
      const row: AppSave = { id: newId('asv'), ...input, fileId: input.fileId ?? null, savedAt: at };
      await db.insertInto('adminium_app_saves').values(row).execute();
      return row;
    },
    async findById(id: string): Promise<AppSave | null> {
      const row = await db.selectFrom('adminium_app_saves').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : read(row);
    },
    /** Every save, newest first; one database's when it is named. */
    async list(filter: { connectionId?: string } = {}): Promise<AppSave[]> {
      let query = db.selectFrom('adminium_app_saves').selectAll();
      if (filter.connectionId !== undefined) query = query.where('connectionId', '=', filter.connectionId);
      return (await query.orderBy('savedAt', 'desc').orderBy('id', 'desc').execute()).map(read);
    },
    /** The saves of one key, newest first: the last one names the lineage and the next version. */
    async listForKey(appKey: string): Promise<AppSave[]> {
      const rows = await db.selectFrom('adminium_app_saves').selectAll().where('appKey', '=', appKey).orderBy('savedAt', 'desc').orderBy('id', 'desc').execute();
      return rows.map(read);
    },
  };
}

export interface AfterInstallItem {
  id: string;
  manifestId: string;
  appKey: string;
  kind: string;
  item: string;
  field: string;
  done: boolean;
  doneBy: string | null;
  doneAt: number | null;
  createdAt: number;
}

function afterItem(row: Selectable<AdminiumAppAfterInstallTable>): AfterInstallItem {
  return { ...row, done: readBool(row.done) };
}

export function appAfterInstallRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /**
     * Record what an install (or an update) still needs. An item already
     * recorded keeps its tick: an update never undoes what a person did.
     */
    async put(install: { manifestId: string; appKey: string }, items: readonly { kind: string; item: string; field: string }[], at: number = Date.now()): Promise<AfterInstallItem[]> {
      for (const one of items) {
        const held = await db
          .selectFrom('adminium_app_after_install')
          .select('id')
          .where('manifestId', '=', install.manifestId)
          .where('kind', '=', one.kind)
          .where('item', '=', one.item)
          .where('field', '=', one.field)
          .executeTakeFirst();
        if (held !== undefined) continue;
        await db
          .insertInto('adminium_app_after_install')
          .values({ id: newId('aai'), manifestId: install.manifestId, appKey: install.appKey, ...one, done: writeBool(meta, false), doneBy: null, doneAt: null, createdAt: at })
          .execute();
      }
      return this.list(install.manifestId);
    },
    async list(manifestId: string): Promise<AfterInstallItem[]> {
      const rows = await db
        .selectFrom('adminium_app_after_install')
        .selectAll()
        .where('manifestId', '=', manifestId)
        .orderBy('createdAt', 'asc')
        .orderBy('kind', 'asc')
        .orderBy('item', 'asc')
        .orderBy('field', 'asc')
        .execute();
      return rows.map(afterItem);
    },
    /** Tick an item off (or back on), within its own install only. */
    async setDone(manifestId: string, id: string, done: boolean, by: string | null, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_app_after_install')
        .set({ done: writeBool(meta, done), doneBy: done ? by : null, doneAt: done ? at : null })
        .where('id', '=', id)
        .where('manifestId', '=', manifestId)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },
    /** An update whose file no longer names an item: it goes. */
    async remove(manifestId: string, keep: readonly { kind: string; item: string; field: string }[]): Promise<number> {
      const rows = await this.list(manifestId);
      const wanted = new Set(keep.map((one) => `${one.kind}\u0000${one.item}\u0000${one.field}`));
      const gone = rows.filter((row) => !wanted.has(`${row.kind}\u0000${row.item}\u0000${row.field}`)).map((row) => row.id);
      if (gone.length === 0) return 0;
      const res = await db.deleteFrom('adminium_app_after_install').where('id', 'in', gone).executeTakeFirst();
      return affected(res.numDeletedRows);
    },
  };
}

export interface WorkspaceSave {
  id: string;
  workspaceId: string | null;
  name: string;
  label: string;
  savedBy: string | null;
  savedAt: number;
  integrity: string;
  bytes: number;
  appSaveIds: string[];
  document: string;
}

function workspaceSave(row: Selectable<AdminiumWorkspaceSavesTable>): WorkspaceSave {
  return { ...row, bytes: Number(row.bytes), appSaveIds: readJson<string[]>(row.appSaveIds) };
}

export function workspaceSavesRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: Omit<WorkspaceSave, 'id' | 'savedAt'>, at: number = Date.now()): Promise<WorkspaceSave> {
      const id = newId('wss');
      await db
        .insertInto('adminium_workspace_saves')
        .values({ ...input, id, savedAt: at, appSaveIds: packJson(input.appSaveIds) })
        .execute();
      return { ...input, id, savedAt: at };
    },
    async findById(id: string): Promise<WorkspaceSave | null> {
      const row = await db.selectFrom('adminium_workspace_saves').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : workspaceSave(row);
    },
    async list(): Promise<WorkspaceSave[]> {
      return (await db.selectFrom('adminium_workspace_saves').selectAll().orderBy('savedAt', 'desc').orderBy('id', 'desc').execute()).map(workspaceSave);
    },
  };
}

export type WorkspaceInstallState = 'staged' | 'running' | 'stopped' | 'done' | 'discarded';

export interface WorkspaceInstallApp {
  key: string;
  version: string;
  integrity: string;
  /** The connection chosen to install on; null until chosen. */
  target: string | null;
  /**
   * `pending` until run; `installed` or `updated` when done (an app already at
   * its version on its target is `installed`); `refused` when its own checks
   * said no, the others still installing; `stopped` when the run stopped at it.
   */
  state: 'pending' | 'installed' | 'updated' | 'refused' | 'stopped';
  /** The app's name, as its manifest gives it. */
  name?: string;
  /** Why it was refused or where it stopped: a stable reason and a sentence. */
  reason?: string;
  error?: string;
}

export interface WorkspaceInstall {
  id: string;
  integrity: string;
  staged: string;
  name: string;
  apps: WorkspaceInstallApp[];
  workspaceChoice: { mode: 'create' | 'existing' | 'none'; workspaceId?: string; name?: string } | null;
  state: WorkspaceInstallState;
  runLock: string | null;
  lockedAt: number | null;
  /** The file's `workspace.json` as uploaded; null on a row from before 0082. */
  document: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

function workspaceInstall(row: Selectable<AdminiumWorkspaceInstallsTable>): WorkspaceInstall {
  return {
    ...row,
    apps: readJson<WorkspaceInstallApp[]>(row.apps),
    workspaceChoice: readJsonOrNull<WorkspaceInstall['workspaceChoice']>(row.workspaceChoice),
    state: row.state as WorkspaceInstallState,
  };
}

export function workspaceInstallsRepo(meta: MetaDb) {
  const { db } = meta;
  async function findById(id: string): Promise<WorkspaceInstall | null> {
    const row = await db.selectFrom('adminium_workspace_installs').selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : workspaceInstall(row);
  }
  return {
    findById,
    async create(input: { integrity: string; staged: string; name: string; apps: WorkspaceInstallApp[]; document?: string | null; createdBy: string | null }, at: number = Date.now()): Promise<WorkspaceInstall> {
      const id = newId('wsi');
      await db
        .insertInto('adminium_workspace_installs')
        .values({ id, ...input, document: input.document ?? null, apps: packJson(input.apps), workspaceChoice: null, state: 'staged', runLock: null, lockedAt: null, createdAt: at, updatedAt: at })
        .execute();
      return (await findById(id))!;
    },
    /** The installs not done and not discarded, newest first: what the review may still finish. */
    async listOpen(): Promise<WorkspaceInstall[]> {
      const rows = await db
        .selectFrom('adminium_workspace_installs')
        .selectAll()
        .where('state', 'not in', ['done', 'discarded'])
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .execute();
      return rows.map(workspaceInstall);
    },
    async update(id: string, patch: { apps?: WorkspaceInstallApp[]; workspaceChoice?: WorkspaceInstall['workspaceChoice']; state?: WorkspaceInstallState }, at: number = Date.now()): Promise<void> {
      await db
        .updateTable('adminium_workspace_installs')
        .set({
          ...(patch.apps === undefined ? {} : { apps: packJson(patch.apps) }),
          ...(patch.workspaceChoice === undefined ? {} : { workspaceChoice: patch.workspaceChoice === null ? null : packJson(patch.workspaceChoice) }),
          ...(patch.state === undefined ? {} : { state: patch.state }),
          updatedAt: at,
        })
        .where('id', '=', id)
        .execute();
    },
    /**
     * Take the run lock: one run at a time per row. A lock older than
     * `staleMs` is taken over (the process that held it is gone).
     */
    async lock(id: string, run: string, at: number = Date.now(), staleMs = 15 * 60_000): Promise<boolean> {
      const res = await db
        .updateTable('adminium_workspace_installs')
        .set({ runLock: run, lockedAt: at, updatedAt: at })
        .where('id', '=', id)
        .where((eb) => eb.or([eb('runLock', 'is', null), eb('lockedAt', '<', at - staleMs)]))
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },
    async unlock(id: string, run: string, at: number = Date.now()): Promise<void> {
      await db.updateTable('adminium_workspace_installs').set({ runLock: null, lockedAt: null, updatedAt: at }).where('id', '=', id).where('runLock', '=', run).execute();
    },
  };
}
