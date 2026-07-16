/**
 * `adminium migrate` — run the meta migrations against the configured store.
 *
 * Delegates wholesale to `@adminium/meta`'s migrator (07-meta-store.md §4): the
 * ledger, checksum-drift detection, and the unknown-migration guard are its
 * rules, not this command's. Idempotence is therefore inherited, not
 * reimplemented — a second run applies nothing because the ledger says so.
 */

import { applyMigrations, migrationStatus } from '@adminium/meta';

import { openMetaStore } from '../../meta/store.js';
import { boolFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK } from '../exit.js';
import { renderTable } from '../io.js';
import { loadCliEnv } from '../runtime.js';

export const migrateCommand: Command = {
  name: 'migrate',
  summary: 'Run the meta-store migrations (idempotent)',
  usage: 'adminium migrate [--status]',
  describe:
    'Applies any pending adminium_* migrations to the meta store, in order.\n' +
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

      const { applied } = await applyMigrations(store.meta.db, { dialect: store.meta.dialect });
      if (applied.length === 0) {
        io.out(`Meta store is up to date (${store.engine}).`);
      } else {
        io.out(`Applied ${String(applied.length)} migration(s) to the ${store.engine} meta store:`);
        for (const name of applied) io.out(`  ${name}`);
      }
      return EXIT_OK;
    } catch (error) {
      // The migrator's errors already carry the remedy (drift → restore the
      // file; unknown → upgrade the app); surfacing the message is the whole job.
      throw new CliError(error instanceof Error ? error.message : String(error), { cause: error });
    } finally {
      await store.close();
    }
  },
};
