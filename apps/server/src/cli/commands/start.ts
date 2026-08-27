// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium start` — boot the server and serve the dashboard (01 §4.1).
 *
 * The single-process topology: Fastify + the SPA build + the in-process engine +
 * the jobs loop, one node process, no Redis and no external scheduler. This
 * command adds nothing to that — it resolves configuration, bootstraps the meta
 * store, and hands off to the same composition root every other topology uses.
 *
 * BOOT RUNS `firstRun`, NOT `applyMigrations` (07-meta-store.md §6). Migrations
 * create `adminium_roles`; NOTHING in the migration ledger seeds it. So a boot
 * that only migrated would serve a first-run wizard whose `POST /setup/super-admin`
 * dies inside `createFirstSuperAdmin` ("built-in roles missing") — permanently,
 * because the claim row rolls back with it and every retry re-fails. `firstRun`
 * is the documented, idempotent "safe to run at every boot" entry point: it
 * migrates, seeds the built-in roles, and seeds `system.*` (including the
 * `instanceId` telemetry needs). This is what makes the v0.5 gate criteria
 * "Fresh install → super admin created" and "`docker run` boots to first-run
 * wizard" true on a real install rather than only in a test harness.
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

import { firstRun } from '@adminium/meta';

import {
  describePreMigration,
  downgradeRefusal,
  guardPreMigration,
  snapshotFailureRefusal,
} from '../../backup/pre-migration.js';
import { seedSourceConnection } from '../../connections/seed.js';
import { embeddedMetaWarning } from '../../meta/store.js';
import { numberFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_CONFIG, EXIT_OK } from '../exit.js';
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
    'SQLite meta store under the data directory and says so.',
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
      defaultDescription: 'ADMINIUM_DATA_DIR or ./data',
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

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, startCommand.flags, startCommand.name);
    const port = numberFlag(values.port, 'port', startCommand.name);
    const host = stringFlag(values.host);
    const dataDir = stringFlag(values['data-dir']);
    const metaUrl = stringFlag(values['meta-url']);
    const logLevel = stringFlag(values['log-level']);
    const staticRoot = stringFlag(values['static-root']);

    const env = loadCliEnv(deps.env, {
      ...(port === undefined ? {} : { port }),
      ...(host === undefined ? {} : { host }),
      ...(dataDir === undefined ? {} : { dataDir }),
      ...(metaUrl === undefined ? {} : { metaUrl }),
      ...(logLevel === undefined ? {} : { logLevel }),
      ...(staticRoot === undefined ? {} : { staticRoot }),
    });

    const runtime = await deps.openRuntime(env);

    // §3.1 OD-1: the embedded fallback is legitimate but must announce itself.
    if (runtime.metaStore.source === 'embedded') {
      io.err(embeddedMetaWarning(runtime.metaStore.url));
    }

    if (values['skip-migrate'] !== true) {
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

    // The first-boot source seed (28-T31), AFTER `firstRun` because it reads and
    // writes `adminium_settings` and that table arrives with the migrations.
    // Before the server starts, so a container that seeds successfully is
    // already serving the generated pages on its first request rather than an
    // empty dashboard that fills in a moment later.
    //
    // Not inside the `--skip-migrate` branch. That flag means "do not touch the
    // schema", not "ignore my configuration" — and on an already-migrated store,
    // which is the only kind that flag is used against, the seed is exactly as
    // valid as it is on any other boot. It fails soft if the store really is
    // unmigrated.
    if (env.ADMINIUM_SOURCE_URL !== undefined) {
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
    const relocationHost = createRelocationHost({
      env,
      deps,
      log: (message) => {
        io.out(message);
      },
    });
    const server = await relocationHost.start(runtime);
    io.out(`Adminium is running at ${server.url}`);

    // The local bridge's consent token (`routes/bridge`). Printed HERE as well
    // as in the wizard because the published Docker image's CMD is `start`, not
    // `init` — a container started with ADMINIUM_BRIDGE_ORIGINS set would
    // otherwise have a pairing code nothing on earth could tell you.
    if (server.bridgePairingCode !== null) {
      io.out('');
      io.out(`Pairing code: ${server.bridgePairingCode}`);
      io.out('Enter it on the site to hand this instance a connection string.');
    }

    // The process now lives until a signal; `start` never "finishes". The exit
    // code is only reached in tests, where startServer is a fake.
    return EXIT_OK;
  },
};
