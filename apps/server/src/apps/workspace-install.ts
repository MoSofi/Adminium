// SPDX-License-Identifier: AGPL-3.0-only
/**
 * INSTALLING A WORKSPACE FILE: one run, recorded on its row, app by app.
 *
 * Each app goes through the install (or the update) one app file gets, with
 * the answers its own review recorded; nothing here installs anything
 * itself. The row says what was chosen and how far each app got, so a run
 * that stops is finished later, after a reload, by running the same row again:
 * the apps already installed are skipped.
 *
 *  - **One run at a time per row**: the row's lock, taken over only once it
 *    is old enough that the run holding it is gone.
 *  - **The workspace** is for connection managers only: create one, add to an
 *    existing one, or none. Every database chosen in an "Install on" joins it,
 *    even when its app is refused or stops: it groups the business's
 *    databases, and a refusal usually means the database already has the app.
 *  - **A newer app is an update** of every copy of its key (one version per
 *    app on a server), through the existing update, each copy on its own;
 *    then it is installed on its target when the target has no copy.
 *  - **An app already at that version on its target** counts as installed.
 *  - **A refusal is per app** (its own checks said no): it is recorded on its
 *    row and the next app installs. **A stop** (anything else, or an install
 *    that stopped part way) ends the run: the apps before it stay installed,
 *    and running the row again resumes at it.
 *  - The staged app files stay until the row is done or discarded.
 */
import { randomBytes } from 'node:crypto';

import { compareSemver, type WorkspaceFile } from '@adminium/manifest';
import { workspaceInstallsRepo, workspacesRepo, WorkspaceNameTaken, type MetaDb, type WorkspaceInstall, type WorkspaceInstallApp } from '@adminium/meta';

import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../errors.js';

export type WorkspaceChoice = { mode: 'create'; name: string } | { mode: 'existing'; workspaceId: string } | { mode: 'none' };

export interface WorkspaceInstallAppRequest {
  key: string;
  /** The database it installs on: an existing one. Null leaves it for later ("Needs a choice"). */
  connectionId: string | null;
  /** The install's answers, as its review recorded them (`POST /apps/install`'s body without key, version and database). */
  install?: Record<string, unknown> | undefined;
  /** The update's answers, for an app that updates the copies already here (`POST /apps/:key/update`'s body). */
  update?: Record<string, unknown> | null | undefined;
}

export interface WorkspaceInstallRequest {
  workspace?: WorkspaceChoice | undefined;
  apps: WorkspaceInstallAppRequest[];
}

/** One copy of an app on this server. */
export interface AppCopy {
  installId: string;
  connectionId: string | null;
  version: string;
}

export interface WorkspaceInstallerDeps {
  meta: MetaDb;
  /** The staged package's fingerprint, or null when it is not staged. */
  stagedIntegrity(key: string, version: string): Promise<string | null>;
  /** Discard a staged package that nothing installed. */
  discardStaged(key: string, version: string): Promise<void>;
  copiesOf(key: string): Promise<AppCopy[]>;
  install(input: { key: string; version: string; connectionId: string; answers: Record<string, unknown> }): Promise<void>;
  update(input: { key: string; installId: string; connectionId: string | null; answers: Record<string, unknown> }): Promise<void>;
  connectionExists(connectionId: string): Promise<boolean>;
  /** Told when the run changed the workspaces (for the menus). */
  workspacesChanged?: (() => Promise<void>) | undefined;
  now?: () => number;
}

export interface InstallActor {
  userId: string | null;
  managesConnections: boolean;
}

const DONE: ReadonlySet<WorkspaceInstallApp['state']> = new Set(['installed', 'updated', 'refused']);
/** An install that stopped part way is a stop, not a refusal: running it again resumes it. */
const STOP_CODES = new Set(['APP_INSTALL_INCOMPLETE', 'INTERNAL']);

export function createWorkspaceInstaller(deps: WorkspaceInstallerDeps) {
  const now = deps.now ?? Date.now;
  const installs = workspaceInstallsRepo(deps.meta);
  const workspaces = workspacesRepo(deps.meta);

  async function mustFind(id: string): Promise<WorkspaceInstall> {
    const row = await installs.findById(id);
    if (row === null) throw new NotFoundError('There is no such workspace file here. Upload it again.', { id });
    return row;
  }

  /** The workspace the databases join: made once, then named by its id so a run again never makes a second. */
  async function resolveWorkspace(row: WorkspaceInstall, asked: WorkspaceChoice | undefined, actor: InstallActor): Promise<WorkspaceInstall['workspaceChoice']> {
    const held = row.workspaceChoice;
    if (held !== null && held.workspaceId !== undefined) {
      // Chosen and made on an earlier run: kept, whatever this run asks.
      if ((await workspaces.findById(held.workspaceId)) !== null) return held;
    }
    const choice = asked ?? (held === null ? { mode: 'none' as const } : held.mode === 'existing' && held.workspaceId !== undefined ? { mode: 'existing' as const, workspaceId: held.workspaceId } : held.mode === 'create' && held.name !== undefined ? { mode: 'create' as const, name: held.name } : { mode: 'none' as const });
    if (choice.mode === 'none') return { mode: 'none' };
    if (!actor.managesConnections) throw new ForbiddenError('Putting databases in a workspace needs managing connections. Install with no workspace.', 'FORBIDDEN', { reason: 'WORKSPACE_CHOICE_NOT_YOURS' });
    if (choice.mode === 'existing') {
      const found = await workspaces.findById(choice.workspaceId);
      if (found === null) throw new NotFoundError('There is no such workspace.', { workspaceId: choice.workspaceId });
      return { mode: 'existing', workspaceId: found.id, name: found.name };
    }
    try {
      const made = await workspaces.create({ name: choice.name, createdBy: actor.userId }, now());
      return { mode: 'create', workspaceId: made.id, name: made.name };
    } catch (error) {
      if (error instanceof WorkspaceNameTaken) throw new ConflictError(`A workspace is already called "${choice.name}". Add to it instead.`, 'UNIQUE_VIOLATION', { reason: 'WORKSPACE_NAME_TAKEN', name: choice.name });
      throw error;
    }
  }

  /** Put each database in the workspace, keeping the others it is in. */
  async function join(workspaceId: string, connectionIds: readonly string[]): Promise<boolean> {
    let changed = false;
    for (const connectionId of new Set(connectionIds)) {
      const held = await workspaces.forConnection(connectionId);
      if (held.includes(workspaceId)) continue;
      await workspaces.setForConnection(connectionId, [...held, workspaceId], now());
      changed = true;
    }
    return changed;
  }

  /** Install or update one app; returns its new state. Throws only what is a stop. */
  async function runApp(app: WorkspaceInstallApp, asked: WorkspaceInstallAppRequest | undefined): Promise<Pick<WorkspaceInstallApp, 'state' | 'reason' | 'error'>> {
    const target = app.target!;
    try {
      const staged = await deps.stagedIntegrity(app.key, app.version);
      const copies = await deps.copiesOf(app.key);
      const onTarget = copies.find((copy) => copy.connectionId === target);
      if (onTarget !== undefined && onTarget.version === app.version && copies.every((copy) => copy.version === app.version)) return { state: 'installed' };
      if (staged !== app.integrity) {
        return { state: 'refused', reason: 'WORKSPACE_APP_NOT_STAGED', error: `${app.name ?? app.key} ${app.version} is no longer the file that was uploaded. Upload the workspace file again.` };
      }
      const older = copies.filter((copy) => compareSemver(app.version, copy.version) > 0);
      // A newer version moves every copy; one already newer is refused by the update itself.
      for (const copy of older) await deps.update({ key: app.key, installId: copy.installId, connectionId: copy.connectionId, answers: asked?.update ?? {} });
      if (onTarget === undefined) await deps.install({ key: app.key, version: app.version, connectionId: target, answers: asked?.install ?? {} });
      return { state: older.length > 0 ? 'updated' : 'installed' };
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500 && !STOP_CODES.has(error.code)) {
        const details = error.details as { reason?: unknown } | undefined;
        return { state: 'refused', reason: typeof details?.reason === 'string' ? details.reason : error.code, error: error.message };
      }
      throw error;
    }
  }

  return {
    find: mustFind,

    async run(id: string, request: WorkspaceInstallRequest, actor: InstallActor): Promise<WorkspaceInstall> {
      const row = await mustFind(id);
      if (row.state === 'done' || row.state === 'discarded') {
        throw new ConflictError(row.state === 'done' ? 'This workspace file is installed.' : 'This workspace file was discarded. Upload it again.', 'CONFLICT', { reason: 'WORKSPACE_INSTALL_FINISHED', state: row.state });
      }
      const keys = new Set(row.apps.map((app) => app.key));
      const unknown = request.apps.filter((one) => !keys.has(one.key)).map((one) => one.key);
      if (unknown.length > 0) throw new ValidationFailedError('Those apps are not in this workspace file.', { reason: 'WORKSPACE_APP_UNKNOWN', keys: unknown });
      for (const one of request.apps) {
        if (one.connectionId !== null && !(await deps.connectionExists(one.connectionId))) {
          throw new ValidationFailedError('Install on a database connected here. Connect it first.', { reason: 'WORKSPACE_TARGET_UNKNOWN', connectionId: one.connectionId });
        }
      }

      const runId = randomBytes(12).toString('hex');
      if (!(await installs.lock(id, runId, now()))) {
        throw new ConflictError('This workspace file is being installed. Wait for that to finish.', 'CONFLICT', { reason: 'WORKSPACE_INSTALL_RUNNING' });
      }
      let apps = row.apps.map((app) => ({ ...app }));
      let state: WorkspaceInstall['state'] = 'running';
      try {
        const asked = new Map(request.apps.map((one) => [one.key, one]));
        // A finished app keeps its target; the others take what this run chose.
        apps = apps.map((app) => (DONE.has(app.state) || !asked.has(app.key) ? app : { ...app, target: asked.get(app.key)!.connectionId }));
        const choice = await resolveWorkspace(row, request.workspace, actor);
        await installs.update(id, { apps, workspaceChoice: choice, state }, now());
        if (choice?.workspaceId !== undefined) {
          // Every database chosen joins, before any app installs: a stop or a refusal never leaves one out.
          const joined = await join(choice.workspaceId, apps.map((app) => app.target).filter((target): target is string => target !== null));
          if (joined || choice.mode === 'create') await deps.workspacesChanged?.();
        }

        for (const [n, app] of apps.entries()) {
          if (DONE.has(app.state) || app.target === null) continue;
          let outcome: Pick<WorkspaceInstallApp, 'state' | 'reason' | 'error'>;
          try {
            outcome = await runApp(app, asked.get(app.key));
          } catch (error) {
            const details = error instanceof AppError ? (error.details as { reason?: unknown; stage?: unknown } | undefined) : undefined;
            apps[n] = { ...app, state: 'stopped', reason: typeof details?.reason === 'string' ? details.reason : error instanceof AppError ? error.code : 'STOPPED', error: error instanceof Error ? error.message : String(error) };
            state = 'stopped';
            await installs.update(id, { apps, state }, now());
            break;
          }
          const { reason: _reason, error: _error, ...rest } = app;
          apps[n] = { ...rest, ...outcome };
          await installs.update(id, { apps }, now());
        }
        if (state !== 'stopped') {
          // Done when no app is left to install; one waiting for its database keeps the file staged.
          state = apps.every((app) => DONE.has(app.state)) ? 'done' : 'staged';
          if (state === 'done') {
            for (const app of apps) {
              if (app.state !== 'refused') continue;
              const copies = await deps.copiesOf(app.key);
              if (!copies.some((copy) => copy.version === app.version)) await deps.discardStaged(app.key, app.version).catch(() => undefined);
            }
          }
          await installs.update(id, { apps, state }, now());
        }
      } finally {
        await installs.unlock(id, runId, now());
      }
      return mustFind(id);
    },

    /** Throw the staged file away: the app files nothing installed go, and the row says so. */
    async discard(id: string): Promise<WorkspaceInstall> {
      const row = await mustFind(id);
      if (row.state === 'done' || row.state === 'discarded') return row;
      const runId = randomBytes(12).toString('hex');
      if (!(await installs.lock(id, runId, now()))) {
        throw new ConflictError('This workspace file is being installed. Wait for that to finish.', 'CONFLICT', { reason: 'WORKSPACE_INSTALL_RUNNING' });
      }
      try {
        for (const app of row.apps) {
          const copies = await deps.copiesOf(app.key);
          if (copies.some((copy) => copy.version === app.version)) continue;
          if ((await deps.stagedIntegrity(app.key, app.version)) === app.integrity) await deps.discardStaged(app.key, app.version).catch(() => undefined);
        }
        await installs.update(id, { state: 'discarded' }, now());
      } finally {
        await installs.unlock(id, runId, now());
      }
      return mustFind(id);
    },
  };
}

export type WorkspaceInstaller = ReturnType<typeof createWorkspaceInstaller>;

/** The file-level facts of a row's `workspace.json`, or nothing for a row without one. */
export function documentOf(row: Pick<WorkspaceInstall, 'document'>): WorkspaceFile | null {
  if (row.document === null) return null;
  try {
    return JSON.parse(row.document) as WorkspaceFile;
  } catch {
    return null;
  }
}
