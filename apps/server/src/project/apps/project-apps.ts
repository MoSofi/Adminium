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

import type { Manifest } from '@adminium/manifest';
import { projectAppsRepo, publicKeysRepo, type MetaDb } from '@adminium/meta';

import { FOLDER_SOURCE, type AppInstallService, type InstallActor, type InstallHost, type Unattended } from '../../apps/install-service.js';
import { diffRemovals, removalInWords } from '../../apps/removal.js';
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
  /** For `installed` and `applied`: pages that were written with nothing to show, or without what the manifest gave them, and why. */
  pageWarnings?: string[];
  /** Public access the server left as it was, each with why. */
  accessWarnings?: string[];
}

/** What an install or an apply said about the pages it wrote, as sentences. */
function pageWarningsOf(reply: { pages?: { warnings: readonly { page: string; message: string }[] } | undefined }): { pageWarnings?: string[] } {
  const warnings = reply.pages?.warnings ?? [];
  return warnings.length === 0 ? {} : { pageWarnings: warnings.map((warning) => `Page ${warning.page}: ${warning.message}`) };
}

/** Public access the server left as it was, as sentences: a screen would go on being refused what the manifest grants. */
function accessWarningsOf(reply: { publicAccess?: { skipped: readonly { ref: string; reason: string }[] } | undefined }): { accessWarnings?: string[] } {
  const skipped = reply.publicAccess?.skipped ?? [];
  return skipped.length === 0 ? {} : { accessWarnings: skipped.map((entry) => `The public access of "${entry.ref}" was left as it was: ${entry.reason}`) };
}

export interface ProjectApps {
  /** Bring every built app to what the build says. Runs are serialised. */
  reconcile(): Promise<AppliedApp[]>;
  /** How each app stood after the last reconcile. */
  status(): readonly AppliedApp[];
  /**
   * A stamp that moves whenever this app was looked at with another manifest
   * or other screens; null for an app the folder does not carry. An open
   * screen polls it under `adminium dev` and reloads when it moves.
   */
  buildOf(key: string): string | null;
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
  /** Whether an app's sample data was ever added on this server (a person may have removed it since). Taken as "yes" when left out. */
  sampleEverAdded?: ((key: string) => Promise<boolean>) | undefined;
  /**
   * The public API of this server: whether its routes exist at all (they are
   * registered at boot, and only when `ADMINIUM_PUBLIC_API_ORIGINS` is set),
   * whether it is switched on, and how to switch it on. An app's customer
   * side reaches nothing without it. Absent in a composition with no public API.
   */
  publicApi?:
    | {
        registered: boolean;
        isEnabled(): Promise<boolean>;
        /** Switch it on for this app, and record that the folder did. */
        enable(key: string): Promise<void>;
        /** Whether this server listens beyond this machine. */
        reachable?: boolean;
      }
    | undefined;
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
  const stamps = new Map<string, string>();

  /**
   * What is recorded as applied: the manifest, and whether the config let it
   * have its public access. The switch is part of what was applied, so
   * turning it on (or off) is a change even when `app.json` is the same.
   */
  const markOf = (key: string, hash: string): string => (opts.apps?.[key]?.publicAccess === true ? `${hash}+public` : hash);

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

  /**
   * An app whose public access was just given needs the public API itself to
   * answer. Under `adminium dev` it is switched on, and said; a server only
   * says what is missing, because switching an anonymous API on is a
   * person's decision there.
   */
  const saidApiOff = new Set<string>();
  async function publicApiFor(key: string, declares: boolean, allowed: boolean): Promise<void> {
    if (!declares || !allowed || opts.publicApi === undefined) return;
    if (!opts.publicApi.registered) {
      if (!saidApiOff.has(key)) {
        opts.log(
          `App "${key}": its public access is made, and this server has no public API: set ADMINIUM_PUBLIC_API_ORIGINS (for its own pages, "self") and restart.`,
        );
      }
      saidApiOff.add(key);
      return;
    }
    if (await opts.publicApi.isEnabled()) return;
    if (opts.mode === 'dev') {
      await opts.publicApi.enable(key);
      opts.log(
        `App "${key}": switched the public API on (Settings → API), so its customer side can reach what its manifest grants.` +
          (opts.publicApi.reachable === true
            ? ' This server listens beyond this machine: whoever can reach it can use that too. Start it with --host 127.0.0.1 to keep it here.'
            : ''),
      );
    } else if (!saidApiOff.has(key)) {
      saidApiOff.add(key);
      opts.log(`App "${key}": its public access is made, and the public API is off. Switch it on in Settings → API.`);
    }
  }

  /** The add-ons that were installed, updated or connected with an app, in one line each. */
  function sayAddOns(
    key: string,
    done: { installed: { name: string; version: string }[]; updated: { name: string; from: string; to: string }[]; attached: { name: string; version: string }[] } | undefined,
  ): void {
    for (const addOn of done?.installed ?? []) opts.log(`App "${key}": installed the add-on ${addOn.name} ${addOn.version} with it.`);
    for (const addOn of done?.updated ?? []) opts.log(`App "${key}": updated the add-on ${addOn.name} from ${addOn.from} to ${addOn.to} with it.`);
    for (const addOn of done?.attached ?? []) opts.log(`App "${key}": connected the add-on ${addOn.name} ${addOn.version} to it.`);
  }

  /** Public access the committed config does not allow is said, once: it is never taken back unasked. */
  const saidAccessStays = new Set<string>();
  async function sayAccessThatStays(key: string): Promise<void> {
    if (publicAccessFor(key).allowed || saidAccessStays.has(key)) return;
    const live = await publicKeysRepo(opts.meta).newestLiveByApp(key, 'customer');
    if (live === null || live.managedBy !== key) return;
    saidAccessStays.add(key);
    opts.warn(
      `App "${key}" HAS public access that adminium.config.ts does not allow (it was given under \`adminium dev\`, or the switch was taken out). ` +
        `It stays as it is: revoke its key under Settings → API, or set apps.${key}.publicAccess to true.`,
    );
  }

  async function failed(
    app: BuiltProjectApp & { hash: string; version?: string },
    error: unknown,
    before?: { document: Manifest | null },
  ): Promise<AppliedApp> {
    const { stage, message } = describeFailure(error);
    /*
     * The columns this manifest drops are kept with the failure: an apply
     * that stopped after the installed document moved has nothing left to
     * compare the next one with.
     */
    const owed = [...((await repo.find(app.key))?.failure?.owed ?? [])];
    if (before !== undefined && app.version !== undefined) {
      try {
        for (const entry of diffRemovals(before.document, await service.verifiedManifest(app.key, app.version)).columns) {
          if (!owed.some((other) => other.table === entry.table && other.column === entry.column)) owed.push(entry);
        }
      } catch {
        // A manifest that cannot be read drops nothing yet.
      }
    }
    // Past these steps the installed document is the new one: nothing is applied in full any more.
    const moved = stage === 'pages' || stage === 'removals';
    await repo.setFailure(app.key, { stage, message, hash: app.hash, ...(owed.length === 0 ? {} : { owed }) }, Date.now(), { nothingApplied: moved });
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
    await repo.setApplied(app.key, markOf(app.key, app.hash));
    const made = reply.schema === undefined ? '' : ` Tables made: ${reply.schema.created.join(', ') || 'none'}.`;
    opts.log(`App "${app.key}" installed from apps/${app.key}.${made}`);
    sayAddOns(app.key, reply.addOns);
    if (declaresAccess && !access.allowed) {
      opts.log(`App "${app.key}" is installed WITHOUT public access: ${access.refusal} to give it what its manifest declares.`);
    }
    await publicApiFor(app.key, declaresAccess, access.allowed);
    if (opts.mode === 'dev' && manifest.kind === 'app' && manifest.sampleData !== undefined && opts.apps?.[app.key]?.sampleData !== false) {
      try {
        await opts.addSampleData?.(app.key);
        if (opts.addSampleData !== undefined) opts.log(`App "${app.key}": its sample data was added.`);
      } catch (error) {
        opts.warn(`App "${app.key}": its sample data was not added (${error instanceof Error ? error.message : String(error)}).`);
      }
    }
    return { key: app.key, state: 'installed', hash: app.hash, ...pageWarningsOf(reply), ...accessWarningsOf(reply) };
  }

  async function applyChanged(
    app: BuiltProjectApp & { hash: string; version: string },
    owed: readonly { table: string; column: string }[],
  ): Promise<AppliedApp> {
    const access = publicAccessFor(app.key);
    const reply = await service.applyInPlace(PROJECT_FOLDER_ACTOR, opts.host, {
      key: app.key,
      version: app.version,
      publicAccess: access.allowed,
      publicAccessRefusal: access.refusal,
      // While the folder is worked on, its access.json is the say: `adminium start` only runs it.
      editing: opts.mode === 'dev',
      unattended,
    });
    const made = reply.schema?.created ?? [];
    opts.log(`App "${app.key}" applied from apps/${app.key}${made.length === 0 ? '' : ` (new tables: ${made.join(', ')})`}.`);
    // Public access the server did not take: never in silence, or a screen goes on being refused what its manifest grants.
    for (const skipped of reply.publicAccess?.skipped ?? []) opts.warn(`App "${app.key}": the public access of "${skipped.ref}" was left as it was (${skipped.reason}).`);
    sayAddOns(app.key, reply.addOns);

    // What the manifest no longer declares: gone where nothing is lost, asked about where data is.
    const say = (line: string): void => {
      opts.log(`App "${app.key}": ${line}`);
    };
    let removed: Awaited<ReturnType<typeof service.removals.afterApply>>;
    try {
      removed = await service.removals.afterApply({
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
        owed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(409, 'APP_APPLY_INCOMPLETE', `What it no longer declares could not be dealt with: ${message}`, { stage: 'removals', cause: message });
    }
    // Only now is it applied in full: a stop above is tried again, and loses nothing.
    await repo.setApplied(app.key, markOf(app.key, app.hash));
    await publicApiFor(app.key, reply.manifest.kind === 'app' && (reply.manifest.publicAccess ?? []).length > 0, access.allowed);
    // Sample rows the app did not bring at its first install (they were written afterwards) are added when it first names them.
    // An apply that stopped half-way (its pages, its public access) already keeps the manifest that names them, and added no row: so
    // "it named them before" is not "they were added". What decides is whether they ever were.
    const hadSample = (reply.previous as { sampleData?: unknown } | null | undefined)?.sampleData !== undefined && (opts.sampleEverAdded === undefined || (await opts.sampleEverAdded(app.key).catch(() => true)));
    if (opts.mode === 'dev' && reply.manifest.kind === 'app' && reply.manifest.sampleData !== undefined && !hadSample && opts.apps?.[app.key]?.sampleData !== false && opts.addSampleData !== undefined) {
      try {
        await opts.addSampleData(app.key);
        say('its sample data was added.');
      } catch (error) {
        opts.warn(`App "${app.key}": its sample data was not added (${error instanceof Error ? error.message : String(error)}).`);
      }
    }
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
    return { key: app.key, state: 'applied', hash: app.hash, ...pageWarningsOf(reply), ...accessWarningsOf(reply) };
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
    const mark = markOf(app.key, app.hash);
    if (tried && state?.failure != null && state.failure.hash === app.hash && state.appliedHash !== mark) {
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
      await sayAccessThatStays(app.key);
      if (state?.appliedHash === mark) {
        // A manifest that failed and was put back as it was: the failure is over.
        if (state.failure !== null) await repo.setApplied(app.key, mark, state.appliedAt ?? Date.now());
        // Nothing to apply, and its customer side still needs the public API: a server started without it says so again.
        const declared = (row.document as { publicAccess?: unknown } | null)?.publicAccess;
        await publicApiFor(app.key, Array.isArray(declared) && declared.length > 0, publicAccessFor(app.key).allowed);
        return { key: app.key, state: 'unchanged', hash: app.hash };
      }
      return await applyChanged(built, state?.failure?.owed ?? []);
    } catch (error) {
      return failed(built, error, row === undefined ? undefined : { document: (row.document as Manifest | null) ?? null });
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
      // A build that broke serves what it served: open screens are not reloaded for it.
      if (app.hash !== null || !stamps.has(app.key)) stamps.set(app.key, `${app.hash ?? 'not-built'}:${app.sidesHash}`);
      const before = last.find((other) => other.key === app.key);
      const stoodStill = before !== undefined && before.state === result.state && before.message === result.message;
      const seen = sidesSeen.get(app.key);
      sidesSeen.set(app.key, app.sidesHash);
      const sidesMoved = seen !== undefined && seen !== app.sidesHash;
      if (sidesMoved) screensChanged = true;
      const failing = result.state === 'not-applied' || result.state === 'not-built';
      // A failure, and a failure that ended, are told too: the installed list says "Not applied" from them.
      if (result.state === 'installed' || result.state === 'applied' || sidesMoved || ((failing || before?.state === 'not-applied' || before?.state === 'not-built') && !stoodStill)) {
        opts.changed?.(app.key, app.hash ?? NOT_BUILT);
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
    buildOf: (key) => stamps.get(key) ?? null,
  };
}
