// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE WORKSPACE: one app per database of a workspace, in one download.
 *
 * Each database becomes an ordinary Save as app file, made by the same
 * service with the same checks and recorded as its own save (its own next
 * version and lineage). The workspace file wraps them: `workspace.json`
 * naming each app's member, key, version, fingerprint and source database, a
 * stub `manifest.json` that makes an older Adminium say "needs Adminium X",
 * and the app files under `apps/`.
 *
 * `plan` writes nothing: each app's Check, grouped per app, for the quick
 * dialog. `save` makes every app's file first and records them only when the
 * whole workspace file can be made, so a refusal (a choice left open, a file
 * over 128 MB) never uses up an app's version. "Download again" packs the
 * file again from the stored `workspace.json` and the apps' kept files, byte
 * for byte, and checks the fingerprint it had.
 *
 * At most one app carries the server-wide part (`instance`): the dialog's
 * "Server settings: from {database} / none", none by default.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  WORKSPACE_FILE,
  WORKSPACE_FILE_APPS_MAX,
  WORKSPACE_FILE_FLOOR,
  WORKSPACE_FILE_FORMAT,
  compareSemver,
  workspaceFileKey,
  workspaceFileName,
  workspaceStubManifest,
  type WorkspaceFile,
} from '@adminium/manifest';
import { appSavesRepo, workspaceSavesRepo, workspacesRepo, type MetaDb, type WorkspaceSave } from '@adminium/meta';

import { packStagedTree } from '../../add-ons/pack.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import type { SaveDialect } from './types.js';
import type { MadeFile, SavePlan, SaveRequest, SaveRights, SaveService } from './service.js';

/** A workspace file is uploaded whole: this is its upload's limit too. */
export const WORKSPACE_FILE_MAX_BYTES = 128 * 1024 * 1024;
/** One app inside, as an app file is uploaded on its own. */
export const WORKSPACE_APP_MAX_BYTES = 32 * 1024 * 1024;

/** One app of the workspace file, as the dialog sends it: Save as app's body without the label. */
export type WorkspaceAppRequest = Omit<SaveRequest, 'label'>;

export interface WorkspaceSaveRequest {
  /** Where it was made, as the target shows it: the display name when absent. */
  label?: string | undefined;
  /** The database whose server settings travel with its app; none when absent. */
  instanceFrom?: string | null | undefined;
  /** The apps, one per database; every database of the workspace when absent. */
  apps?: WorkspaceAppRequest[] | undefined;
}

export interface WorkspaceAppPlan {
  connectionId: string;
  database: { name: string; engine: SaveDialect };
  key: string;
  name: string;
  /** The version this database's app was last saved at, or null for a first save. */
  lastSaved: string | null;
  plan: SavePlan;
}

export interface WorkspaceSavePlan {
  workspaceId: string;
  name: string;
  label: string;
  filename: string;
  minAdminiumVersion: string;
  /** Every app ready: `save` would write the file. */
  ready: boolean;
  instanceFrom: string | null;
  apps: WorkspaceAppPlan[];
  /** The workspaces the apps' databases are in, by name: for your information on the target. */
  workspaces: string[];
}

export interface SavedWorkspaceFile {
  id: string;
  name: string;
  filename: string;
  integrity: string;
  bytes: number;
  savedAt: number;
  apps: { key: string; version: string; integrity: string; bytes: number }[];
}

export interface WorkspaceSaveDeps {
  meta: MetaDb;
  save: SaveService;
  adminiumVersion: string;
  dialectOf(connectionId: string): Promise<SaveDialect | null>;
  displayName(): Promise<string>;
  now?: () => number;
}

const KEY = /^[a-z][a-z0-9-]{1,79}$/;

export function createWorkspaceSaveService(deps: WorkspaceSaveDeps) {
  const now = deps.now ?? Date.now;
  const workspaces = workspacesRepo(deps.meta);

  /** The connection names, by id. */
  async function connectionNames(): Promise<Map<string, string>> {
    const rows = await deps.meta.db.selectFrom('adminium_connections').select(['id', 'name']).execute();
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** Every database of the workspace, by name, each with the key and name its app would take. */
  async function defaults(connectionIds: readonly string[], names: Map<string, string>): Promise<WorkspaceAppRequest[]> {
    const ordered = [...connectionIds].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b) || a.localeCompare(b));
    const out: WorkspaceAppRequest[] = [];
    const taken = new Set<string>();
    for (const connectionId of ordered) {
      const name = names.get(connectionId) ?? connectionId;
      const last = (await appSavesRepo(deps.meta).list({ connectionId }))[0];
      let key = last?.appKey ?? keyOf(name);
      for (let n = 2; taken.has(key); n += 1) key = `${keyOf(name).slice(0, 75)}-${String(n)}`;
      taken.add(key);
      out.push({ connectionId, key, name: name.slice(0, 80) });
    }
    return out;
  }

  async function mustFind(workspaceId: string) {
    const workspace = await workspaces.findById(workspaceId);
    if (workspace === null) throw new NotFoundError('There is no such workspace.', { workspaceId });
    return workspace;
  }

  /** The apps asked for, checked as a whole: inside the workspace, one per database, keys unique, at most eight. */
  async function appsOf(workspaceId: string, request: WorkspaceSaveRequest) {
    const workspace = await mustFind(workspaceId);
    const names = await connectionNames();
    const apps = request.apps ?? (await defaults(workspace.connectionIds, names));
    if (apps.length === 0) throw new ValidationFailedError('Choose at least one database to save.', { reason: 'WORKSPACE_SAVE_EMPTY' });
    if (apps.length > WORKSPACE_FILE_APPS_MAX) {
      throw new ValidationFailedError(`A workspace file holds at most ${String(WORKSPACE_FILE_APPS_MAX)} apps. Leave out a database.`, { reason: 'WORKSPACE_SAVE_TOO_MANY' });
    }
    const members = new Set(workspace.connectionIds);
    const outside = apps.filter((app) => !members.has(app.connectionId)).map((app) => app.connectionId);
    if (outside.length > 0) throw new ValidationFailedError('Some of those databases are not in this workspace.', { reason: 'WORKSPACE_SAVE_NOT_MEMBER', connectionIds: outside });
    if (new Set(apps.map((app) => app.connectionId)).size !== apps.length) {
      throw new ValidationFailedError('Each database becomes one app: name it once.', { reason: 'WORKSPACE_SAVE_DUPLICATE' });
    }
    const keys = apps.map((app) => app.key);
    const twice = keys.filter((key, i) => keys.indexOf(key) !== i);
    if (twice.length > 0) throw new ValidationFailedError(`Two apps would have the key "${twice[0]!}". Give each its own.`, { reason: 'WORKSPACE_SAVE_DUPLICATE_KEY', keys: [...new Set(twice)] });
    const instanceFrom = request.instanceFrom ?? null;
    if (instanceFrom !== null && !apps.some((app) => app.connectionId === instanceFrom)) {
      throw new ValidationFailedError('The server settings travel with one of the apps saved.', { reason: 'WORKSPACE_SAVE_INSTANCE_FROM' });
    }
    const label = request.label?.trim() || (await deps.displayName());
    // At most one app carries the server-wide part: the one chosen, whatever an app's own body says.
    const requests: SaveRequest[] = apps.map((app) => ({
      ...app,
      label,
      include: { ...(app.include ?? {}), instance: app.connectionId === instanceFrom },
    }));
    return { workspace, names, requests, label, instanceFrom };
  }

  async function databaseOf(connectionId: string, names: Map<string, string>): Promise<{ name: string; engine: SaveDialect }> {
    const engine = await deps.dialectOf(connectionId);
    if (engine === null) throw new NotFoundError('That database is not connected here.', { connectionId });
    return { name: names.get(connectionId) ?? connectionId, engine };
  }

  /** The names of the workspaces the apps' databases are in. */
  async function workspaceNames(connectionIds: readonly string[]): Promise<string[]> {
    const all = await workspaces.list();
    const wanted = new Set(connectionIds);
    return all.filter((one) => one.connectionIds.some((id) => wanted.has(id))).map((one) => one.name);
  }

  function floorOf(versions: readonly string[]): string {
    return [WORKSPACE_FILE_FLOOR, ...versions].sort(compareSemver).at(-1)!;
  }

  return {
    async plan(workspaceId: string, request: WorkspaceSaveRequest, rights: SaveRights): Promise<WorkspaceSavePlan> {
      const { workspace, names, requests, label, instanceFrom } = await appsOf(workspaceId, request);
      const apps: WorkspaceAppPlan[] = [];
      for (const one of requests) {
        const lastSaved = (await appSavesRepo(deps.meta).listForKey(one.key)).find((save) => save.connectionId === one.connectionId)?.version ?? null;
        apps.push({ connectionId: one.connectionId, database: await databaseOf(one.connectionId, names), key: one.key, name: one.name, lastSaved, plan: await deps.save.plan(one, rights) });
      }
      const savedAt = new Date(now()).toISOString();
      return {
        workspaceId,
        name: workspace.name,
        label,
        filename: workspaceFileName(workspace.name, savedAt),
        minAdminiumVersion: floorOf(apps.map((app) => app.plan.minAdminiumVersion)),
        ready: apps.every((app) => app.plan.ready),
        instanceFrom,
        apps,
        workspaces: await workspaceNames(requests.map((one) => one.connectionId)),
      };
    },

    async save(workspaceId: string, request: WorkspaceSaveRequest, rights: SaveRights): Promise<SavedWorkspaceFile & { tarball: Uint8Array }> {
      const { workspace, names, requests, label } = await appsOf(workspaceId, request);
      // Every app's file made and checked before any is recorded.
      const made: { request: SaveRequest; file: MadeFile; database: { name: string; engine: SaveDialect } }[] = [];
      for (const one of requests) {
        const database = await databaseOf(one.connectionId, names);
        let file: MadeFile;
        try {
          file = await deps.save.make(one, rights);
        } catch (error) {
          if (error instanceof ConflictError || error instanceof ValidationFailedError) {
            throw new ConflictError(`${one.name}: ${error.message}`, 'CONFLICT', { ...(typeof error.details === 'object' && error.details !== null ? error.details : {}), app: one.key, connectionId: one.connectionId });
          }
          throw error;
        }
        if (file.tarball.byteLength > WORKSPACE_APP_MAX_BYTES) {
          throw new ConflictError(`${one.name} would be larger than 32 MB. Leave out its sample rows and try again.`, 'CONFLICT', { reason: 'WORKSPACE_APP_TOO_LARGE', app: one.key });
        }
        made.push({ request: one, file, database });
      }
      const total = made.reduce((n, one) => n + one.file.tarball.byteLength, 0);
      if (total > WORKSPACE_FILE_MAX_BYTES) {
        throw new ConflictError('This workspace file would be larger than 128 MB. Leave out a database or its sample rows and try again.', 'CONFLICT', { reason: 'WORKSPACE_FILE_TOO_LARGE' });
      }

      const savedAt = new Date(now()).toISOString();
      const document: WorkspaceFile = {
        v: WORKSPACE_FILE_FORMAT,
        name: workspace.name,
        savedAt,
        label,
        adminiumVersion: deps.adminiumVersion,
        minAdminiumVersion: floorOf(made.map((one) => one.file.manifest.compatibility.minAdminiumVersion)),
        apps: installOrder(made).map(({ file, database }) => ({
          file: `apps/${file.filename}`,
          key: file.plan.key,
          version: file.plan.version,
          integrity: file.integrity,
          database,
        })),
      };
      const text = `${JSON.stringify(document, null, 2)}\n`;
      const inner = new Map(made.map(({ file }) => [`apps/${file.filename}`, file.tarball]));
      const tarball = await packWorkspaceFile(text, document, inner);
      if (tarball.byteLength > WORKSPACE_FILE_MAX_BYTES) {
        throw new ConflictError('This workspace file would be larger than 128 MB. Leave out a database or its sample rows and try again.', 'CONFLICT', { reason: 'WORKSPACE_FILE_TOO_LARGE' });
      }
      const integrity = integrityOf(tarball);

      // Now each app's save is recorded, in the file's order, then the workspace's.
      const byFile = new Map(made.map((one) => [`apps/${one.file.filename}`, one]));
      const saved = [];
      for (const entry of document.apps) saved.push(await byFile.get(entry.file)!.file.commit());
      const row = await workspaceSavesRepo(deps.meta).create(
        { workspaceId: workspace.id, name: workspace.name, label, savedBy: rights.userId, integrity, bytes: tarball.byteLength, appSaveIds: saved.map((one) => one.id), document: text },
        now(),
      );
      return {
        id: row.id,
        name: row.name,
        filename: workspaceFileName(document.name, savedAt),
        integrity,
        bytes: tarball.byteLength,
        savedAt: row.savedAt,
        apps: saved.map((one) => ({ key: one.key, version: one.version, integrity: one.integrity, bytes: one.bytes })),
        tarball,
      };
    },

    /** The saved workspace file again ("Download again"), or null when an app's copy is gone. */
    async file(id: string): Promise<{ save: WorkspaceSave; filename: string; bytes: Uint8Array } | null> {
      const save = await workspaceSavesRepo(deps.meta).findById(id);
      if (save === null) return null;
      const document = JSON.parse(save.document) as WorkspaceFile;
      const inner = new Map<string, Uint8Array>();
      for (const [n, appSaveId] of save.appSaveIds.entries()) {
        const found = await deps.save.file(appSaveId);
        const entry = document.apps[n];
        if (found === null || entry === undefined || integrityOf(found.bytes) !== entry.integrity) return null;
        inner.set(entry.file, found.bytes);
      }
      const bytes = await packWorkspaceFile(save.document, document, inner);
      if (integrityOf(bytes) !== save.integrity) {
        throw new ConflictError('The workspace file came out different from the one saved. Save the workspace again.', 'CONFLICT', { reason: 'WORKSPACE_FILE_CHANGED' });
      }
      return { save, filename: workspaceFileName(document.name, document.savedAt), bytes };
    },

    async list(): Promise<WorkspaceSave[]> {
      return workspaceSavesRepo(deps.meta).list();
    },
  };
}

export type WorkspaceSaveService = ReturnType<typeof createWorkspaceSaveService>;

/** A connection name made into an app key: `Fernhill Ops` → `fernhill-ops`. */
function keyOf(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return KEY.test(slug) ? slug : 'app';
}

/**
 * Install order: an app another app of the file requires goes first; the
 * rest keep the order they were given (the workspace's databases by name).
 */
function installOrder<T extends { file: MadeFile }>(made: readonly T[]): T[] {
  const keys = new Set(made.map((one) => one.file.plan.key));
  const needs = (one: T): string[] => (one.file.manifest.apps?.requires ?? []).map((need) => need.key).filter((key) => keys.has(key));
  const out: T[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const place = (one: T): void => {
    const key = one.file.plan.key;
    if (placed.has(key) || visiting.has(key)) return;
    visiting.add(key);
    for (const need of needs(one)) {
      const required = made.find((other) => other.file.plan.key === need);
      if (required !== undefined) place(required);
    }
    visiting.delete(key);
    placed.add(key);
    out.push(one);
  };
  for (const one of made) place(one);
  return out;
}

function integrityOf(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** The workspace file's bytes: the document as written, its stub manifest, and each app file. Deterministic. */
export async function packWorkspaceFile(documentText: string, document: Pick<WorkspaceFile, 'name' | 'savedAt' | 'minAdminiumVersion'>, inner: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'adminium-workspace-'));
  try {
    await writeFile(join(dir, WORKSPACE_FILE), documentText);
    const stub = workspaceStubManifest(workspaceFileKey(document.name, document.savedAt), document.minAdminiumVersion);
    await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(stub, null, 2)}\n`);
    for (const [path, bytes] of inner) {
      const target = join(dir, path);
      if (!target.startsWith(`${dir}/apps/`)) throw new Error(`workspace file: "${path}" is outside apps/`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    return (await packStagedTree(dir, { maxFileBytes: WORKSPACE_APP_MAX_BYTES })).tarball;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

