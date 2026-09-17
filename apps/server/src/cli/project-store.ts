// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Opening a project's own meta store from a command other than `start`:
 * `pull` reads it, and `new` over an existing instance adopts it.
 *
 * Reading needs the store at this version already, so `pull` refuses a store
 * with migrations pending instead of running them behind the developer's
 * back. Adopting is an upgrade by definition, so `new` runs them, with the
 * same pre-migration snapshot and downgrade refusal `start` uses.
 */

import { firstRun, migrationStatus } from '@adminium/meta';

import {
  describePreMigration,
  downgradeRefusal,
  guardPreMigration,
  snapshotFailureRefusal,
} from '../backup/pre-migration.js';
import type { Env } from '../config/env.js';
import { CliError, EXIT_CONFIG } from './exit.js';
import type { CliIo } from './io.js';
import type { CliRuntime } from './runtime.js';

export async function readyMetaStore(opts: {
  runtime: CliRuntime;
  env: Env;
  io: CliIo;
  migrate: boolean;
}): Promise<void> {
  const { runtime, env, io } = opts;
  const { meta } = runtime.metaStore;

  if (!opts.migrate) {
    const pending = (await migrationStatus(meta.db, { dialect: meta.dialect })).filter((entry) => !entry.applied);
    if (pending.length > 0) {
      throw new CliError(`This project's database needs ${String(pending.length)} update(s) before it can be read.`, {
        hint: 'Start the project once, which applies them:  npm run dev',
      });
    }
    return;
  }

  const guard = await guardPreMigration({
    meta,
    engine: runtime.metaStore.engine,
    metaUrl: runtime.metaStore.url,
    source: runtime.metaStore.source,
    dataDir: env.ADMINIUM_DATA_DIR,
    secret: env.ADMINIUM_SECRET,
  });
  if (guard.kind === 'downgrade' || guard.kind === 'failed') {
    const refusal = guard.kind === 'downgrade' ? downgradeRefusal(guard.newer, env.ADMINIUM_DATA_DIR) : snapshotFailureRefusal(guard);
    throw new CliError(refusal.message, { code: EXIT_CONFIG, hint: refusal.hint });
  }
  const report = describePreMigration(guard);
  for (const line of report.lines) {
    if (report.warn) io.err(line);
    else io.out(line);
  }
  await firstRun(meta);
}
