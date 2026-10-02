// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The apps a project folder carries, kept in step with this server.
 *
 * `adminium build` leaves each `apps/<key>/` as a composed manifest and built
 * sides, listed in the build manifest with a hash. This module reads that
 * list and brings the server to it, one app at a time:
 *
 *   not installed            → install it, through the same service an upload uses
 *   installed, same manifest → nothing
 *   installed, another one   → apply it in place: the app keeps serving
 *   installed from a package → refused, and said: one key cannot be both
 *
 * It never builds. A production image has no bundler, so everything here
 * works from what the build wrote.
 *
 * ─── Who is asking ──────────────────────────────────────────────────────────
 *
 * Nobody. A person installing an app is shown a check step and answers it;
 * here there is no person, so what may happen is fixed by where the server
 * runs. Under `adminium dev` the folder is the developer's own and the
 * database is theirs to change: add-ons the app requires are installed, a
 * table it reuses is adapted, public access is given as declared, sample data
 * is added once. Under `adminium start` the server may be the real one: it
 * adds what the committed files say and nothing else — no add-on installed,
 * no table of somebody else's changed, and no public access unless
 * `adminium.config.ts` says so for that app.
 *
 * ─── A failure is shown, not retried ────────────────────────────────────────
 *
 * An app that cannot be applied keeps running as it was. The reason is
 * recorded with the manifest it was about, and that same manifest is not
 * tried again: a loop over a broken file would only repeat the message. The
 * next change to the folder is the next attempt.
 */

import { projectAppsRepo, type MetaDb } from '@adminium/meta';

import { FOLDER_SOURCE, type AppInstallService, type InstallActor, type InstallHost, type Unattended } from '../../apps/install-service.js';
import { removalInWords } from '../../apps/removal.js';
import { AppError } from '../../errors.js';
import type { ProjectConfig } from '../config.js';
import type { AppsBuild, BuiltProjectApp } from './build-apps.js';

/** How one app stands after a reconcile. */
export interface AppliedApp {
  key: string;
  state:
    | 'installed' //   installed now, from the folder
    | 'applied' //     its manifest changed and was applied
    | 'unchanged' //   nothing to do
    | 'not-applied' // the newest manifest could not be applied; the app runs as it was
    | 'not-built'; //  the build listed it with problems
  /** The manifest hash this is about; null for an app that did not build. */
  hash: string | null;
  /** For `not-applied` and `not-built`: where it stopped and why. */
  stage?: string;
  message?: string;
}

export interface ProjectApps {
  /** Bring every built app to what the build says. Runs are serialised. */
  reconcile(): Promise<AppliedApp[]>;
  /** How each app stood after the last reconcile. */
  status(): readonly AppliedApp[];
}

export interface ProjectAppsOptions {
  mode: 'dev' | 'server';
  /** The apps the build lists, read from the build folder. */
  built: () => AppsBuild | null;
  service: AppInstallService;
  meta: MetaDb;
  /** The project's `apps` block. */
  apps: ProjectConfig['apps'];
  /** The configured databases that have a URL, in the config's order. */
  databases: readonly string[];
  /** The connection a database key names on this instance, or null. */
  connectionFor: (databaseKey: string) => Promise<string | null>;
  log: (message: string) => void;
  warn: (message: string) => void;
  /** The server this runs in, as the install service uses it. */
  host: InstallHost;
  /** Tell open pages one app changed. */
  changed?: ((key: string, hash: string) => void) | undefined;
  /** Add an app's sample data. Dev calls it once, after the first install. */
  addSampleData?: ((key: string) => Promise<void>) | undefined;
  /** Re-read which apps are served; called when only an app's screens changed. */
  refreshServed?: (() => Promise<unknown>) | undefined;
}

/** The hash a build problem is recorded under: no manifest was built to have one. */
const NOT_BUILT = 'not-built';

/** The actor behind everything done from the folder: no person, every permission, audited as the system. */
export const PROJECT_FOLDER_ACTOR: InstallActor = {
  id: null,
  label: 'project folder',
  kind: 'system',
  superAdmin: async () => true,
  can: async () => true,
};

/** A refusal as one sentence, with the plan's own problems where it has them. */
export function describeFailure(error: unknown): { stage: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof AppError)) return { stage: 'apply', message };
  const details = (error.details ?? {}) as { stage?: unknown; problems?: unknown };
  const problems = Array.isArray(details.problems)
    ? details.problems.flatMap((problem) => {
        const text = (problem as { message?: unknown } | null)?.message;
        return typeof text === 'string' ? [text] : [];
      })
    : [];
  return {
    stage: typeof details.stage === 'string' ? details.stage : 'check',
    message: problems.length === 0 ? message : `${message} ${problems.join(' ')}`,
  };
}

export function createProjectApps(opts: ProjectAppsOptions): ProjectApps {
  const repo = projectAppsRepo(opts.meta);
  const { service } = opts;
  let last: AppliedApp[] = [];
  let running: Promise<AppliedApp[]> = Promise.resolve([]);
  /**
   * The manifests this process already tried and could not apply. A failure
   * may have a cause outside the folder (a database that was down, an add-on
   * not installed yet), and restarting the server is how a person says "try
   * again": each start tries a failed manifest once, and a poll never does.
   */
  const attempted = new Set<string>();
  /** The sides' hash each app was last seen with, so a changed screen is told without an apply. */
  const sidesSeen = new Map<string, string>();
  const warnedShadowed = new Set<string>();

  const unattended: Unattended =
    opts.mode === 'dev' ? { installAddOns: true, adaptForeignTables: true } : { installAddOns: false, adaptForeignTables: false };

  /** Whether this app may be given the public access it declares. */
  function publicAccessFor(key: string): { allowed: boolean; refusal: string } {
    const allowed = opts.mode === 'dev' || opts.apps?.[key]?.publicAccess === true;
    return { allowed, refusal: `adminium.config.ts does not allow it: set apps.${key}.publicAccess to true` };
  }

  /** The connection an app is installed on: the database its config names, else the first one. */
  async function connectionOf(key: string): Promise<{ id: string } | { problem: string }> {
    const named = opts.apps?.[key]?.database;
    const database = named ?? opts.databases[0];
    if (database === undefined) {
      return { problem: 'this project has no database with a URL yet. Add one under `databases` in adminium.config.ts.' };
    }
    if (named !== undefined && !opts.databases.includes(named)) {
      return { problem: `adminium.config.ts puts it on the database "${named}", which the project does not list (or which has no URL yet).` };
    }
    const id = await opts.connectionFor(database);
    if (id === null) return { problem: `the database "${database}" is not connected on this server.` };
    return { id };
  }

  async function failed(app: BuiltProjectApp & { hash: string }, error: unknown): Promise<AppliedApp> {
    const { stage, message } = describeFailure(error);
    await repo.setFailure(app.key, { stage, message, hash: app.hash });
    opts.warn(`App "${app.key}" (apps/${app.key}) was not applied — it stopped at "${stage}": ${message} It keeps running as it was; change the folder to try again.`);
    return { key: app.key, state: 'not-applied', hash: app.hash, stage, message };
  }

  async function installNew(app: BuiltProjectApp & { hash: string; version: string }): Promise<AppliedApp> {
    const where = await connectionOf(app.key);
    const manifest = await service.verifiedManifest(app.key, app.version);
    const wantsTables = (manifest.requiredSchema?.tables ?? []).length > 0;
    if ('problem' in where && wantsTables) throw new Error(`It needs tables, and ${where.problem}`);
    const access = publicAccessFor(app.key);
    const declaresAccess = manifest.kind === 'app' && (manifest.publicAccess ?? []).length > 0;
    // Nobody ticks a box: under dev each add-on it requires is installed (or updated) with it.
    const addOns =
      opts.mode === 'dev'
        ? (await service.addOnRowsFor(manifest, 'id' in where ? where.id : null, true))
            .filter((row) => row.need === 'requires' && row.action !== null)
            .map((row) => ({ key: row.key, version: (row.action === 'attach' ? row.installedVersion : row.offeredVersion) ?? '', update: true }))
        : [];
    const reply = await service.install(PROJECT_FOLDER_ACTOR, opts.host, {
      key: app.key,
      version: app.version,
      ...('id' in where ? { connectionId: where.id } : {}),
      publicAccess: access.allowed,
      ...(addOns.length === 0 ? {} : { addOns }),
      source: FOLDER_SOURCE,
      unattended,
    });
    await repo.setApplied(app.key, app.hash);
    const made = reply.schema === undefined ? '' : ` Tables made: ${reply.schema.created.join(', ') || 'none'}.`;
    opts.log(`App "${app.key}" installed from apps/${app.key}.${made}`);
    if (declaresAccess && !access.allowed) {
      opts.log(`App "${app.key}" is installed WITHOUT public access: ${access.refusal} to give it what its manifest declares.`);
    }
    if (opts.mode === 'dev' && manifest.kind === 'app' && manifest.sampleData !== undefined && opts.apps?.[app.key]?.sampleData !== false) {
      try {
        await opts.addSampleData?.(app.key);
        if (opts.addSampleData !== undefined) opts.log(`App "${app.key}": its sample data was added.`);
      } catch (error) {
        opts.warn(`App "${app.key}": its sample data was not added (${error instanceof Error ? error.message : String(error)}).`);
      }
    }
    return { key: app.key, state: 'installed', hash: app.hash };
  }

  async function applyChanged(app: BuiltProjectApp & { hash: string; version: string }): Promise<AppliedApp> {
    const access = publicAccessFor(app.key);
    const reply = await service.applyInPlace(PROJECT_FOLDER_ACTOR, opts.host, {
      key: app.key,
      version: app.version,
      publicAccess: access.allowed,
      publicAccessRefusal: access.refusal,
      unattended,
    });
    await repo.setApplied(app.key, app.hash);
    const made = reply.schema?.created ?? [];
    opts.log(`App "${app.key}" applied from apps/${app.key}${made.length === 0 ? '' : ` (new tables: ${made.join(', ')})`}.`);

    // What the manifest no longer declares: gone where nothing is lost, asked about where data is.
    const say = (line: string): void => {
      opts.log(`App "${app.key}": ${line}`);
    };
    const removed = await service.removals.afterApply({
      key: app.key,
      rowId: reply.rowId,
      connectionId: reply.connectionId,
      previous: reply.previous,
      manifest: reply.manifest,
      hash: app.hash,
      // A server never drops, and never asks: what holds data is kept.
      drops: opts.mode === 'dev' ? 'ask' : 'never',
      actor: PROJECT_FOLDER_ACTOR,
      log: say,
    });
    if (removed.pages.removed.length > 0) say(`removed the page${removed.pages.removed.length === 1 ? '' : 's'} ${removed.pages.removed.join(', ')}.`);
    if (removed.pages.kept.length > 0) {
      say(`kept ${removed.pages.kept.join(', ')} as ${removed.pages.kept.length === 1 ? 'an ordinary page' : 'ordinary pages'}: somebody edited ${removed.pages.kept.length === 1 ? 'it' : 'them'}.`);
    }
    for (const role of removed.roles) {
      say(`removed the role ${role.slug}` + (role.members + role.apiKeys === 0 ? '.' : ` (${String(role.members)} member(s) and ${String(role.apiKeys)} API key(s) held it).`));
    }
    const dropped = [...removed.dropped.tables, ...removed.dropped.columns];
    if (dropped.length > 0) say(`dropped ${dropped.join(', ')}: ${dropped.length === 1 ? 'it' : 'they'} held nothing.`);
    if (removed.pending !== null) {
      opts.warn(
        `App "${app.key}": apps/${app.key} no longer declares ${removed.pending.changes.map(removalInWords).join('; ')}. ` +
          'Nothing was dropped. Answer it in Studio → Apps: "Remove them" drops the data, "Keep the data" leaves it in the database and out of the app.',
      );
    }
    return { key: app.key, state: 'applied', hash: app.hash };
  }

  async function one(app: BuiltProjectApp): Promise<AppliedApp> {
    if (app.problems !== undefined || app.hash === null || app.version === null) {
      const message = (app.problems ?? []).join(' ');
      // Recorded like any other failure, so the installed list can say it; a build that passes again clears it.
      await repo.setFailure(app.key, { stage: 'build', message, hash: NOT_BUILT });
      return { key: app.key, state: 'not-built', hash: null, stage: 'build', message };
    }
    const built = { ...app, hash: app.hash, version: app.version };
    const row = (await service.manifests.list('app')).find((m) => m.row.manifestKey === app.key);
    const state = await repo.find(app.key);
    // The same manifest that already failed here: shown, not tried again.
    const tried = attempted.has(`${app.key}:${app.hash}`);
    attempted.add(`${app.key}:${app.hash}`);
    if (tried && state?.failure != null && state.failure.hash === app.hash && state.appliedHash !== app.hash) {
      return { key: app.key, state: 'not-applied', hash: app.hash, stage: state.failure.stage, message: state.failure.message };
    }
    try {
      if (row !== undefined && row.row.source !== FOLDER_SOURCE) {
        throw new AppError(
          409,
          'CONFLICT',
          `apps/${app.key} is also installed from a package. One key cannot be both: uninstall that app in Studio → Apps, and the folder's is installed in its place.`,
          { stage: 'conflict' },
        );
      }
      // Not installed, or an install from the folder that stopped part way: installing again finishes it.
      if (row === undefined || row.row.status === 'installing') return await installNew(built);
      if (state?.appliedHash === app.hash) {
        // A manifest that failed and was put back as it was: the failure is over.
        if (state.failure !== null) await repo.setApplied(app.key, app.hash, state.appliedAt ?? Date.now());
        return { key: app.key, state: 'unchanged', hash: app.hash };
      }
      return await applyChanged(built);
    } catch (error) {
      return failed(built, error);
    }
  }

  async function run(): Promise<AppliedApp[]> {
    const build = opts.built();
    const results: AppliedApp[] = [];
    let screensChanged = false;
    for (const app of build?.apps ?? []) {
      // A package of the same key is still in the data directory: the folder is the one served.
      if (!warnedShadowed.has(app.key) && (await service.packagedVersions(app.key)).length > 0) {
        warnedShadowed.add(app.key);
        opts.log(`apps/${app.key} is also a package in the data directory. The folder is the one that is served.`);
      }
      let result: AppliedApp;
      try {
        result = await one(app);
      } catch (error) {
        // Reading or recording failed, not the app: said, and the next app still gets its turn.
        const message = error instanceof Error ? error.message : String(error);
        opts.warn(`App "${app.key}" could not be looked at: ${message}`);
        result = { key: app.key, state: 'not-applied', hash: app.hash, stage: 'read', message };
      }
      results.push(result);
      const seen = sidesSeen.get(app.key);
      sidesSeen.set(app.key, app.sidesHash);
      const sidesMoved = seen !== undefined && seen !== app.sidesHash;
      if (sidesMoved) screensChanged = true;
      if (app.hash !== null && (result.state === 'installed' || result.state === 'applied' || sidesMoved)) {
        opts.changed?.(app.key, app.hash);
      }
    }
    // New screens are files in the build folder: the registry reads them again.
    if (screensChanged) await opts.refreshServed?.();
    last = results;
    return results;
  }

  return {
    reconcile() {
      running = running.then(run, run);
      return running;
    },
    status: () => last,
  };
}
