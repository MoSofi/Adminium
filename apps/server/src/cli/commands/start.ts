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
 */

import { firstRun } from '@adminium/meta';

import { embeddedMetaWarning } from '../../meta/store.js';
import { numberFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { EXIT_OK } from '../exit.js';
import { loadCliEnv } from '../runtime.js';

export const startCommand: Command = {
  name: 'start',
  summary: 'Start the server and serve the dashboard',
  usage: 'adminium start [--port <n>] [--host <addr>]',
  describe:
    'Boots Adminium against the configured meta store, applying any pending\n' +
    'migrations first. With nothing configured it falls back to an embedded\n' +
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

    const env = loadCliEnv(deps.env, {
      ...(port === undefined ? {} : { port }),
      ...(host === undefined ? {} : { host }),
      ...(dataDir === undefined ? {} : { dataDir }),
      ...(metaUrl === undefined ? {} : { metaUrl }),
      ...(logLevel === undefined ? {} : { logLevel }),
    });

    const runtime = await deps.openRuntime(env);

    // §3.1 OD-1: the embedded fallback is legitimate but must announce itself.
    if (runtime.metaStore.source === 'embedded') {
      io.err(embeddedMetaWarning(runtime.metaStore.url));
    }

    if (values['skip-migrate'] !== true) {
      const { appliedMigrations } = await firstRun(runtime.metaStore.meta);
      if (appliedMigrations.length > 0) {
        io.out(`Applied ${String(appliedMigrations.length)} pending meta migration(s).`);
      }
    }

    const server = await deps.startServer(runtime);
    io.out(`Adminium is running at ${server.url}`);

    // The process now lives until a signal; `start` never "finishes". The exit
    // code is only reached in tests, where startServer is a fake.
    return EXIT_OK;
  },
};
