/**
 * `adminium migrate` — run the meta migrations against the configured store.
 *
 * Delegates wholesale to `@adminium/meta`'s migrator (07-meta-store.md §4): the
 * ledger, checksum-drift detection, and the unknown-migration guard are its
 * rules, not this command's. Idempotence is therefore inherited, not
 * reimplemented — a second run applies nothing because the ledger says so.
 *
 * The one thing it does NOT delegate is what happens BEFORE the first statement.
 * `backup/pre-migration.ts` snapshots the store when there is pending work and
 * refuses outright when the ledger says a newer Adminium wrote it — the same
 * guards `start` runs, because "upgrade the deployment" is the same operation
 * whether it arrives through the Docker CMD or through this command in a
 * pre-upgrade job.
 */

import { UnknownMigrationError, applyMigrations, migrationStatus } from '@adminium/meta';

import {
  describePreMigration,
  downgradeRefusal,
  guardPreMigration,
  snapshotFailureRefusal,
} from '../../backup/pre-migration.js';
import { openMetaStore } from '../../meta/store.js';
import { boolFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_CONFIG, EXIT_OK } from '../exit.js';
import { renderTable } from '../io.js';
import { loadCliEnv } from '../runtime.js';

/**
 * `instanceof` plus the name, because the class travels across a package
 * boundary: a build that resolved `@adminium/meta` twice (src and dist, the
 * shape vitest can produce) would fail the identity check on an error that is
 * unmistakably this one, and the operator would get exit 1 with no remedy.
 */
function isUnknownMigration(error: unknown): error is UnknownMigrationError {
  return (
    error instanceof UnknownMigrationError ||
    (error instanceof Error && error.name === 'UnknownMigrationError')
  );
}

export const migrateCommand: Command = {
  name: 'migrate',
  summary: 'Run the meta-store migrations (idempotent)',
  usage: 'adminium migrate [--status]',
  describe:
    'Applies any pending adminium_* migrations to the meta store, in order.\n' +
    'A SQLite meta store is snapshotted to <data-dir>/backups before they run.\n' +
    'Safe to re-run: already-applied migrations are skipped via the ledger.\n' +
    '`start` and the setup wizard run this for you; call it directly when you\n' +
    'upgrade Adminium in a deployment that boots against a pre-migrated store.',
  flags: {
    status: { type: 'boolean', describe: 'List migrations and whether each is applied; apply nothing' },
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
  },

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, migrateCommand.flags, migrateCommand.name);
    const env = loadCliEnv(deps.env, {
      ...(stringFlag(values['meta-url']) === undefined ? {} : { metaUrl: stringFlag(values['meta-url']) }),
      ...(stringFlag(values['data-dir']) === undefined ? {} : { dataDir: stringFlag(values['data-dir']) }),
    });

    const store = await openMetaStore({
      metaUrl: env.ADMINIUM_META_URL,
      dataDir: env.ADMINIUM_DATA_DIR,
      secret: env.ADMINIUM_SECRET,
    });

    try {
      if (boolFlag(values.status)) {
        const entries = await migrationStatus(store.meta.db, { dialect: store.meta.dialect });
        io.out(
          renderTable(
            ['migration', 'applied', 'note'],
            entries.map((entry) => [
              entry.name,
              entry.applied ? 'yes' : 'no',
              entry.drift ? 'CHECKSUM DRIFT' : entry.known ? '' : 'unknown to this version',
            ]),
          ),
        );
        return EXIT_OK;
      }

      const guard = await guardPreMigration({
        meta: store.meta,
        engine: store.engine,
        metaUrl: store.url,
        source: store.source,
        dataDir: env.ADMINIUM_DATA_DIR,
        secret: env.ADMINIUM_SECRET,
      });
      if (guard.kind === 'downgrade' || guard.kind === 'failed') {
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

      const { applied } = await applyMigrations(store.meta.db, { dialect: store.meta.dialect });
      if (applied.length === 0) {
        io.out(`Meta store is up to date (${store.engine}).`);
      } else {
        io.out(`Applied ${String(applied.length)} migration(s) to the ${store.engine} meta store:`);
        for (const name of applied) io.out(`  ${name}`);
      }
      return EXIT_OK;
    } catch (error) {
      // Our own refusals already carry an exit code and a hint; re-wrapping one
      // here would flatten a 78 back into the generic 1 it was written to escape.
      if (error instanceof CliError) throw error;
      // A ledger row from the future. The pre-migration guard normally catches
      // this first; this is the backstop for the row that appears between the
      // two reads, and for the migrator's own detection path.
      if (isUnknownMigration(error)) {
        const refusal = downgradeRefusal(
          [{ name: error.migrationName, appliedBy: null }],
          env.ADMINIUM_DATA_DIR,
        );
        throw new CliError(refusal.message, {
          code: EXIT_CONFIG,
          hint: refusal.hint,
          cause: error,
        });
      }
      // The migrator's other errors already carry the remedy (drift → restore
      // the file); surfacing the message is the whole job.
      throw new CliError(error instanceof Error ? error.message : String(error), { cause: error });
    } finally {
      await store.close();
    }
  },
};
