// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium start` — boot the server and serve the dashboard.
 *
 * The single-process topology: Fastify + the SPA build + the in-process engine +
 * the jobs loop, one node process, no Redis and no external scheduler. This
 * command adds nothing to that — it resolves configuration, bootstraps the meta
 * store, and hands off to the same composition root every other topology uses.
 *
 * BOOT RUNS `firstRun`, NOT `applyMigrations`. Migrations create `adminium_roles`;
 * NOTHING in the migration ledger seeds it. So a boot that only migrated would
 * serve a first-run wizard whose `POST /setup/super-admin` dies inside
 * `createFirstSuperAdmin` ("built-in roles missing") — permanently, because the
 * claim row rolls back with it and every retry re-fails. `firstRun` is the
 * documented, idempotent "safe to run at every boot" entry point: it migrates,
 * seeds the built-in roles, and seeds `system.*` (including the `instanceId`
 * telemetry needs). This is what makes the v0.5 gate criteria "Fresh install →
 * super admin created" and "`docker run` boots to first-run wizard" true on a real
 * install rather than only in a test harness.
 *
 * WHAT RUNS BEFORE IT (`backup/pre-migration.ts`). The action a self-host
 * operator performs most is `docker compose pull && up -d`, and until now this
 * command went straight from "open the store" to "apply whatever migrations the
 * new image brought". Two guards now sit in between: a snapshot when — and only
 * when — there is pending work to protect against, and a refusal to run at all
 * when the ledger says the database was migrated by a NEWER Adminium.
 *
 * Both sit INSIDE the `--skip-migrate` branch. For the snapshot that is simply
 * scope: an operator who opted out of migrating opted out of the thing it
 * protects. For the downgrade refusal it is deliberate — the flag is then also
 * the override, and there has to be one, or an accidental rollback would leave
 * no way to boot the old image at all (not even to export before restoring).
 */

import { createLocalOwner, firstRun, isBootstrapRequired, settingsRepo, usersRepo } from '@adminium/meta';

import {
  describePreMigration,
  downgradeRefusal,
  guardPreMigration,
  snapshotFailureRefusal,
} from '../../backup/pre-migration.js';
import { ownerOnThisComputer } from '../../auth/local-owner.js';
import { seedStorageDestination } from '../../config/storage-seed.js';
import { seedSourceConnection } from '../../connections/seed.js';
import { storageCryptoFromSecret } from '../../files/crypto.js';
import { embeddedMetaWarning } from '../../meta/store.js';
import { prepareProject } from '../../project/boot.js';
import { findProject } from '../../project/locate.js';
import { markRunning, refuseIfRunning } from '../../project/running.js';
import { withDefaults } from '../../project/config.js';
import { syncProjectDatabases } from '../../project/databases.js';
import { diskFileStore } from '../../project/file-store.js';
import { databasesWithPageFiles } from '../../project/project-files.js';
import { createProjectService, type ProjectServerOptions } from '../../project/service.js';
import { APP_VERSION } from '../../version.js';
import { numberFlag, parseFlags, stringFlag } from '../args.js';
import type { Command, CommandContext } from '../command.js';
import type { CliIo } from '../io.js';
import { CliError, EXIT_CONFIG, EXIT_OK, type ExitCode } from '../exit.js';
import { createRelocationHost } from '../relocation-host.js';
import { loadCliEnv } from '../runtime.js';

export const startCommand: Command = {
  name: 'start',
  summary: 'Start the server and serve the dashboard',
  usage: 'adminium start [--port <n>] [--host <addr>]',
  describe:
    'Boots Adminium against the configured meta store, applying any pending\n' +
    'migrations first — a SQLite meta store is snapshotted to <data-dir>/backups\n' +
    'before they run. With nothing configured it falls back to an embedded\n' +
    'SQLite meta store under the data directory and says so.\n' +
    '\n' +
    'Inside a project it loads .env and the built adminium.config.ts (building\n' +
    'it first when needed), keeps its data in the project, and connects the\n' +
    "databases the config lists. The environment still wins over the config.",
  flags: {
    port: {
      type: 'string',
      short: 'p',
      placeholder: '<n>',
      describe: 'Port to listen on',
      defaultDescription: 'PORT or 4600',
    },
    host: {
      type: 'string',
      placeholder: '<addr>',
      describe: 'Address to bind',
      defaultDescription: 'HOST or 0.0.0.0',
    },
    'meta-url': {
      type: 'string',
      placeholder: '<dsn>',
      describe: 'Meta store DSN',
      defaultDescription: 'ADMINIUM_META_URL, else embedded SQLite',
    },
    'data-dir': {
      type: 'string',
      placeholder: '<path>',
      describe: 'Data directory',
      defaultDescription: 'ADMINIUM_DATA_DIR, else ./data or ~/.adminium',
    },
    'log-level': {
      type: 'string',
      placeholder: '<level>',
      describe: 'fatal|error|warn|info|debug|trace',
      defaultDescription: 'ADMINIUM_LOG_LEVEL or info',
    },
    'static-root': {
      type: 'string',
      placeholder: '<path>',
      describe: 'Serve the dashboard build from this directory',
      defaultDescription: 'ADMINIUM_STATIC_ROOT, else the bundled build',
    },
    'skip-migrate': {
      type: 'boolean',
      describe: 'Do not bootstrap (migrate + seed built-in roles) the meta store on boot',
    },
  },

  async run(ctx) {
    return runStart(ctx);
  },
};

/** What `adminium design` adds to a start. */
export interface DesignStart {
  /**
   * Called once the meta store is migrated, before the server starts: the owner, and the token when there is one.
   * `thisComputer`: the link signs the project's owner in even when they have a password (the desktop app's start).
   */
  prepare(meta: import('@adminium/meta').MetaDb): Promise<{ token: string | null; thisComputer?: boolean }>;
  /** Called when the server listens: print the link, open the browser. */
  started(url: string, port: number, token: string | null): Promise<void>;
}

/**
 * Boot a server: `adminium start`, and `adminium design` with its additions.
 * Design mode listens on this machine only, runs the folder as its master
 * copy (as `adminium dev` does), and serves Adminium Designer.
 */
export async function runStart({ io, deps, argv }: CommandContext, design?: DesignStart): Promise<ExitCode> {
  const { values } = parseFlags(argv, startCommand.flags, startCommand.name);
  const started = await startUp(
    { io, deps },
    {
      port: numberFlag(values.port, 'port', startCommand.name),
      host: stringFlag(values.host),
      dataDir: stringFlag(values['data-dir']),
      metaUrl: stringFlag(values['meta-url']),
      logLevel: stringFlag(values['log-level']),
      staticRoot: stringFlag(values['static-root']),
      skipMigrate: values['skip-migrate'] === true,
    },
    design,
  );
  if (design !== undefined) {
    await design.started(started.url, started.port, started.token);
    return EXIT_OK;
  }
  io.out(`Adminium is running at ${started.url}`);

  // The local bridge's consent token (`routes/bridge`). Printed HERE as well
  // as in the wizard because the published Docker image's CMD is `start`, not
  // `init` — a container started with ADMINIUM_BRIDGE_ORIGINS set would
  // otherwise have a pairing code nothing on earth could tell you.
  if (started.bridgePairingCode !== null) {
    io.out('');
    io.out(`Pairing code: ${started.bridgePairingCode}`);
    io.out('Enter it on the site to hand this instance a connection string.');
  }

  // The process now lives until a signal; `start` never "finishes". The exit
  // code is only reached in tests, where startServer is a fake.
  return EXIT_OK;
}

/** What `adminium start`'s flags say, parsed. */
export interface StartFlags {
  port?: number | undefined;
  host?: string | undefined;
  dataDir?: string | undefined;
  metaUrl?: string | undefined;
  logLevel?: string | undefined;
  staticRoot?: string | undefined;
  skipMigrate?: boolean | undefined;
  /** Names the project's `.env` and config may not set (`prepareProject`'s `refuse`). */
  refuse?: readonly string[] | undefined;
}

/**
 * Design mode's owner, as `adminium design` makes it: the first time, the
 * project's owner with no password. `token` signs that owner in once, and only
 * while they have no password; `null` mints no link at all.
 */
export function localOwnerStart(io: CliIo, token: string | null, started: DesignStart['started'] = async () => undefined, opts: { thisComputer?: boolean } = {}): DesignStart {
  return {
    async prepare(meta) {
      if (await isBootstrapRequired(meta)) {
        await createLocalOwner(meta);
        io.out('Made you the owner of this project, with no password yet (`adminium owner set` gives you one).');
      }
      // A host on the person's own computer: the owner this project was made for is signed in there, password or
      // not. The password is what OTHER devices sign in with; whoever holds this folder holds its data and its key.
      if (opts.thisComputer === true) {
        const mine = await ownerOnThisComputer(meta);
        return { token: mine !== null && mine.status === 'active' ? token : null, thisComputer: true };
      }
      const ownerId = await settingsRepo(meta).get('designer.localOwnerId');
      const owner = ownerId === null ? null : await usersRepo(meta).findById(ownerId);
      // Only the owner `design` made, and only while they have no password, is signed in by the link.
      return { token: owner !== null && owner.passwordHash === null && owner.status === 'active' ? token : null };
    },
    started,
  };
}

/** A server that was started: where it answers, and the ways to stop it and to ask what it is doing. */
export interface StartedUp {
  url: string;
  port: number;
  /** Design mode's one-use token, when one was minted. */
  token: string | null;
  bridgePairingCode: string | null;
  /** Names from the project's `.env` or config that were ignored (`StartFlags.refuse`). */
  refused: string[];
  /** Ends the server, then the stores, and resolves when both are gone. */
  close(): Promise<void>;
  /** What has the project's folder right now (a turn, a save, a restore…), or `null`. */
  busy(): StartBusy | null;
}

/** What {@link StartedUp.busy} answers: the Designer's own word for it. */
export interface StartBusy {
  kind: string;
  sessionId: string | null;
}

/**
 * Everything `adminium start` does between reading its flags and waiting for a
 * signal. `runStart` is its caller on a terminal; the desktop app's server
 * child is its other caller (`startProject`), which needs the handle this
 * returns: a terminal's process ends by a signal, the app's child is told to
 * stop and must be able to say when it has.
 */
export async function startUp({ io, deps }: Pick<CommandContext, 'io' | 'deps'>, flags: StartFlags, design?: DesignStart): Promise<StartedUp> {
  {
    const port = flags.port;
    // Design mode is on this machine only, whatever the environment or .env says.
    const host = design !== undefined ? '127.0.0.1' : flags.host;
    if (design !== undefined && (flags.host ?? deps.env.HOST ?? '') !== '' && (flags.host ?? deps.env.HOST) !== '127.0.0.1') {
      io.err('Adminium Designer listens on this machine only (127.0.0.1): the HOST you set is not used.');
    }
    const { dataDir, metaUrl, logLevel, staticRoot } = flags;

    // Inside a project: `.env` and adminium.config.ts fill in whatever the
    // environment leaves unset, and the config's databases are connected below.
    /*
     * Read BEFORE the project's `.env` is copied in: the mode is what the
     * process was started as (`adminium dev` sets it), never a line in a file
     * that is deployed with the folder. A server started with `adminium
     * start` is a server, whatever its `.env` says.
     */
    const projectMode: 'dev' | 'server' = design !== undefined || deps.env.ADMINIUM_PROJECT_MODE === 'dev' ? 'dev' : 'server';
    // The apps' screens are built one way for a developer and another for a server; a build of the other kind is redone.
    // Before the folder's code is built or run: a second server on one folder would write the same database.
    const located = findProject(deps.cwd, deps.env);
    if (located !== null) refuseIfRunning(located.root);
    const project = await prepareProject({ cwd: deps.cwd, env: deps.env, version: APP_VERSION, dev: projectMode === 'dev', ...(flags.refuse === undefined ? {} : { refuse: flags.refuse }) });
    if (project !== null && project.refused.length > 0) {
      io.err(`Ignored from this project's .env and config (the app decides these itself): ${project.refused.join(', ')}`);
    }
    if (project !== null) {
      const built = project.from === 'new-build' ? ' (built it first)' : project.appsRebuilt === true ? ` (built its apps' screens again, for ${projectMode === 'dev' ? 'development' : 'a server'})` : '';
      io.out(`Project: ${project.project.root}${built}`);
    }

    /*
     * Under `adminium dev` the public API answers this address's own pages
     * unless the environment says otherwise. Its routes are registered at
     * boot, so an app's customer side would otherwise reach nothing until
     * somebody found the variable; `self` is the narrowest value there is,
     * and the API still answers nothing until it is switched on.
     */
    const developing = project !== null && projectMode === 'dev';
    const projectEnv =
      project !== null && developing ? withDefaults(project.env, { ADMINIUM_PUBLIC_API_ORIGINS: 'self' }) : project?.env;

    const env = loadCliEnv(
      projectEnv ?? deps.env,
      {
        ...(port === undefined ? {} : { port }),
        ...(host === undefined ? {} : { host }),
        ...(dataDir === undefined ? {} : { dataDir }),
        ...(metaUrl === undefined ? {} : { metaUrl }),
        ...(logLevel === undefined ? {} : { logLevel }),
        ...(staticRoot === undefined ? {} : { staticRoot }),
      },
      project?.sources,
    );

    const runtime = await deps.openRuntime(env);

    // The embedded fallback is legitimate but must announce itself.
    if (runtime.metaStore.source === 'embedded') {
      io.err(embeddedMetaWarning(runtime.metaStore.url));
    }

    if (flags.skipMigrate !== true) {
      const guard = await guardPreMigration({
        meta: runtime.metaStore.meta,
        engine: runtime.metaStore.engine,
        metaUrl: runtime.metaStore.url,
        source: runtime.metaStore.source,
        dataDir: env.ADMINIUM_DATA_DIR,
        secret: env.ADMINIUM_SECRET,
      });

      // The two refusals close the runtime themselves: `cli/index.ts` sets
      // `process.exitCode` and lets the event loop drain, so a Postgres pool
      // left open here would hold the process up forever instead of exiting.
      if (guard.kind === 'downgrade' || guard.kind === 'failed') {
        await runtime.close().catch(() => undefined);
        const refusal =
          guard.kind === 'downgrade'
            ? downgradeRefusal(guard.newer, env.ADMINIUM_DATA_DIR)
            : snapshotFailureRefusal(guard);
        throw new CliError(refusal.message, { code: EXIT_CONFIG, hint: refusal.hint });
      }

      const report = describePreMigration(guard);
      for (const line of report.lines) {
        if (report.warn) io.err(line);
        else io.out(line);
      }

      const { appliedMigrations } = await firstRun(runtime.metaStore.meta);
      if (appliedMigrations.length > 0) {
        io.out(`Applied ${String(appliedMigrations.length)} pending meta migration(s).`);
      }
    }

    // The first-boot source seed, AFTER `firstRun` because it reads and
    // writes `adminium_settings` and that table arrives with the migrations.
    // Before the server starts, so a container that seeds successfully is
    // already serving the generated pages on its first request rather than an
    // empty dashboard that fills in a moment later.
    //
    // Not inside the `--skip-migrate` branch. That flag means "do not touch the
    // schema", not "ignore my configuration" — and on an already-migrated store,
    // which is the only kind that flag is used against, the seed is exactly as
    // valid as it is on any other boot. Both seeds fail soft if the store really
    // is unmigrated — each wraps its own body in a catch-all, because this is a
    // container's PID 1 and neither seed is worth a crash loop.
    //
    // Storage BEFORE the source seed, because the source seed generates pages
    // and a generation run can write files: a destination configured for this
    // boot must already be the default when the first artifact of the boot is
    // written, or that artifact lands on a disk the operator was told not to
    // rely on. `composeServer` seeds storage as
    // well, for every boot path that is not this one — but on THIS path it runs
    // below, inside `relocationHost.start` → `startServer`, long after the
    // source seed has already generated. That ordering is the whole reason this
    // call site stays. The seed is idempotent, so the two do not fight.
    await seedStorageDestination({
      meta: runtime.metaStore.meta,
      crypto: storageCryptoFromSecret(env.ADMINIUM_SECRET),
      env,
      log: (message) => {
        io.out(message);
      },
      warn: (message) => {
        io.err(message);
      },
    });

    let projectServer: ProjectServerOptions | undefined;
    if (project !== null) {
      if (env.ADMINIUM_SOURCE_URL !== undefined) {
        io.err('ADMINIUM_SOURCE_URL is ignored in a project; list the database in adminium.config.ts instead.');
      }
      const withPageFiles = await databasesWithPageFiles(diskFileStore(project.project.root));
      await syncProjectDatabases({
        manager: runtime.manager,
        meta: runtime.metaStore.meta,
        root: project.project.root,
        databases: project.databases.ready,
        missing: project.databases.missing,
        hasPageFiles: (key) => withPageFiles.has(key),
        log: (message) => {
          io.out(message);
        },
        warn: (message) => {
          io.err(message);
        },
      });

      // The folder's pages and schema customizations, before the first
      // request. `adminium dev` runs this command with the folder as the
      // master copy; everywhere else the folder changes only with a deploy.
      projectServer = {
        root: project.project.root,
        mode: projectMode,
        log: (message) => {
          io.out(message);
        },
        warn: (message) => {
          io.err(message);
        },
        ...(project.config.apps === undefined ? {} : { apps: project.config.apps }),
        databases: [...project.databases.ready.keys()],
      };
      const boot = createProjectService({ meta: runtime.metaStore.meta, ...projectServer, pollMs: 0, watchFiles: false });
      try {
        await boot.reconcile();
      } catch (error) {
        // The database is fine; only the files are out of step. Serve, and say so.
        io.err(`Could not sync the project files: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await boot.close();
      }
    } else if (env.ADMINIUM_SOURCE_URL !== undefined) {
      await seedSourceConnection({
        manager: runtime.manager,
        meta: runtime.metaStore.meta,
        sourceUrl: env.ADMINIUM_SOURCE_URL,
        log: (message) => {
          io.out(message);
        },
        warn: (message) => {
          io.err(message);
        },
      });
    } else if ((deps.env.DATABASE_URL ?? '') !== '') {
      // The rename's migration path, and the one thing the schema cannot do for
      // us: an unknown key is STRIPPED by Zod, not rejected, so a container
      // still carrying the old name would get exactly the silence this whole
      // feature exists to end — for the third time. Every compose file in the
      // marketplace fleet shipped `DATABASE_URL`, so this is the line their
      // operators will see after pulling an image that finally implements it.
      io.err(
        'DATABASE_URL is set and Adminium does not read it — the first-boot source seed is ADMINIUM_SOURCE_URL.\n' +
          'Rename the variable to connect that database on boot, or connect it in the first-run wizard.',
      );
    }

    // Through the host, not `startServer` directly: the Docker image's CMD is
    // `start`, so this is the process that serves the Studio for a container
    // install — and its meta step must be able to move the store too, not only
    // the wizard's `npx` boot.
    // A project `adminium design` made, started as a server, has an owner nobody can sign in as yet.
    if (design === undefined && project !== null) {
      const ownerId = await settingsRepo(runtime.metaStore.meta).get('designer.localOwnerId').catch(() => null);
      const owner = ownerId === null ? null : await usersRepo(runtime.metaStore.meta).findById(ownerId).catch(() => null);
      if (owner !== null && owner.passwordHash === null) {
        io.err('This project has no owner password yet (it was made with `adminium design`). Set one first:  npx @adminiumjs/adminium owner set');
      }
    }
    // The owner and the one-use link, for design mode: after the store is migrated, before the server answers anyone.
    const prepared = design === undefined ? null : await design.prepare(runtime.metaStore.meta);
    const relocationHost = createRelocationHost({
      env,
      deps,
      ...(projectServer === undefined ? {} : { project: projectServer }),
      ...(prepared === null ? {} : { designer: { mode: 'local' as const, token: prepared.token, port: env.PORT, ...(prepared.thisComputer === true ? { thisComputer: true } : {}), ...(project === null || project.refused.length === 0 ? {} : { ignoredEnv: project.refused }) } }),
      log: (message) => {
        io.out(message);
      },
    });
    const server = await relocationHost.start(runtime);
    const forget = project === null ? () => undefined : markRunning(project.project.root, { port: env.PORT, mode: design !== undefined ? 'design' : projectMode === 'dev' ? 'dev' : 'start', by: deps.env.ADMINIUM_RUNTIME === 'desktop' ? 'desktop' : 'cli' });
    return {
      url: server.url,
      port: env.PORT,
      token: prepared?.token ?? null,
      bridgePairingCode: server.bridgePairingCode,
      refused: project?.refused ?? [],
      async close() {
        try {
          await relocationHost.close();
        } finally {
          forget();
        }
      },
      busy() {
        const live = relocationHost.current()?.app as unknown as { designerBusy?: () => StartBusy | null } | undefined;
        return live?.designerBusy?.() ?? null;
      },
    };
  }
}
